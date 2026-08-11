import type { VFocusDocument } from "@/stores/document"
import { computeExportPreflight } from "./preflight.ts"

export type WorkflowStepId = "source" | "analysis" | "review" | "edit" | "export"
export type WorkflowStepState = "locked" | "active" | "attention" | "complete"
export type WorkflowWorkspaceId = "draft" | "edit" | "export"
export type WorkflowWorkspaceState = "ready" | "attention" | "complete"
export type WorkflowDocument = Pick<
    VFocusDocument,
    | "inputPath"
    | "videoInfo"
    | "mediaAssets"
    | "timelineClips"
    | "subtitles"
    | "recommendedCuts"
    | "analysisArtifacts"
    | "agentThinking"
    | "publishing"
    | "text"
    | "bgmPath"
    | "seSlots"
    | "processing"
>

export interface WorkflowStep {
    id: WorkflowStepId
    label: string
    shortLabel: string
    description: string
    actionLabel: string
    state: WorkflowStepState
    metric: string
}

export interface WorkflowSummary {
    activeStepId: WorkflowStepId
    nextAction: string
    steps: WorkflowStep[]
    stats: {
        hasSource: boolean
        hasVideoInfo: boolean
        hasAnalysisDraft: boolean
        adoptedClipCount: number
        sequenceDuration: number
        reviewSubtitleCount: number
        exportWarnings: number
        exportErrors: number
    }
}

export interface WorkflowWorkspace {
    id: WorkflowWorkspaceId
    number: string
    title: string
    description: string
    metric: string
    state: WorkflowWorkspaceState
    nextId: WorkflowWorkspaceId | null
    nextLabel: string | null
}

export interface WorkflowPresentation {
    project: {
        fileName: string
        sourceMeta: string
        assetCount: number
        clipCount: number
        subtitleCount: number
    }
    workspaces: WorkflowWorkspace[]
    completedCount: number
}

const WORKSPACE_DEFINITIONS: ReadonlyArray<Pick<
    WorkflowWorkspace,
    "id" | "number" | "title" | "description"
>> = [
    {
        id: "draft",
        number: "01",
        title: "見どころを見つける",
        description: "AI候補をKEEP／没で判断",
    },
    {
        id: "edit",
        number: "02",
        title: "ラフカットを決める",
        description: "残す区間と順番を決める",
    },
    {
        id: "export",
        number: "03",
        title: "受け渡す",
        description: "動画と編集データを出力",
    },
]

function formatDuration(seconds: number) {
    if (seconds <= 0) return "0秒"
    if (seconds < 60) return `${seconds.toFixed(1)}秒`
    const minutes = Math.floor(seconds / 60)
    const rest = Math.round(seconds % 60).toString().padStart(2, "0")
    return `${minutes}:${rest}`
}

function isOriginalOnlyWarning(preflight: ReturnType<typeof computeExportPreflight>) {
    return preflight.items.some((item) => item.id === "original-only")
}

function firstActionableStep(steps: WorkflowStep[]) {
    return steps.find((step) => step.state === "attention")
        ?? steps.find((step) => step.state === "active")
        ?? steps.find((step) => step.state !== "complete" && step.state !== "locked")
        ?? steps.at(-1)
}

function workspaceState(state: WorkflowStepState): WorkflowWorkspaceState {
    if (state === "complete") return "complete"
    if (state === "attention") return "attention"
    return "ready"
}

function formatSourceDuration(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "時間未取得"
    const minutes = Math.floor(seconds / 60)
    const rest = Math.floor(seconds % 60).toString().padStart(2, "0")
    return `${minutes}:${rest}`
}

export function computeWorkflowSummary(document: WorkflowDocument): WorkflowSummary {
    const preflight = computeExportPreflight(document)
    const hasSource = Boolean(document.inputPath)
    const hasVideoInfo = Boolean(document.videoInfo && document.videoInfo.duration > 0)
    const hasAnalysisDraft =
        document.analysisArtifacts.length > 0 ||
        document.recommendedCuts.length > 0 ||
        document.agentThinking.trim().length > 0
    const originalOnly = isOriginalOnlyWarning(preflight)
    const adoptedClipCount = originalOnly ? 0 : preflight.sequenceClipCount
    const hasSequence = preflight.sequenceDuration > 0 && !originalOnly
    const hasAdoptedSequence = adoptedClipCount > 0

    const sourceState: WorkflowStepState = hasSource
        ? hasVideoInfo ? "complete" : "attention"
        : "active"

    const analysisState: WorkflowStepState = !hasSource
        ? "locked"
        : hasAnalysisDraft ? "complete" : "active"

    const reviewState: WorkflowStepState = !hasSource
        ? "locked"
        : hasAdoptedSequence ? "complete"
            : hasAnalysisDraft ? "attention"
                : "locked"

    const editState: WorkflowStepState = !hasSequence
        ? "locked"
        : preflight.reviewSubtitleCount > 0 ? "attention" : "complete"

    const exportState: WorkflowStepState = !preflight.canExport
        ? "locked"
        : preflight.counts.warning > 0 ? "attention" : "active"

    const steps: WorkflowStep[] = [
        {
            id: "source",
            label: "素材を読み込む",
            shortLabel: "素材",
            description: hasSource
                ? hasVideoInfo ? "元動画の情報を取得済みです。" : "動画情報の取得を待っています。"
                : "横・縦を問わず、整理したい元動画を選びます。",
            actionLabel: "素材を見る",
            state: sourceState,
            metric: hasVideoInfo
                ? `${document.videoInfo!.width}×${document.videoInfo!.height}`
                : hasSource ? "読込中" : "未選択",
        },
        {
            id: "analysis",
            label: "見どころを検出する",
            shortLabel: "AI検出",
            description: hasAnalysisDraft
                ? "見どころ・盛り上がり・字幕の解析結果があります。"
                : "映像・音声・盛り上がりから判断材料を作ります。",
            actionLabel: "AI解析へ",
            state: analysisState,
            metric: hasAnalysisDraft
                ? `${document.recommendedCuts.length}候補`
                : hasSource ? "未解析" : "素材待ち",
        },
        {
            id: "review",
            label: "KEEP／没を判断する",
            shortLabel: "KEEP／没",
            description: hasAdoptedSequence
                ? "残す区間がラフカットに入っています。"
                : hasAnalysisDraft ? "AI候補を見て、残すか没にするか判断します。"
                    : "AI検出後に見どころを判断します。",
            actionLabel: "見どころ判断",
            state: reviewState,
            metric: hasAdoptedSequence ? `${adoptedClipCount}本` : "未採用",
        },
        {
            id: "edit",
            label: "ラフカットを決める",
            shortLabel: "ラフカット",
            description: hasSequence
                ? "KEEP区間の端と順番を決め、不要部分を削れます。"
                : "KEEP区間を作るとラフカットを調整できます。",
            actionLabel: "ラフカットへ",
            state: editState,
            metric: formatDuration(preflight.sequenceDuration),
        },
        {
            id: "export",
            label: "編集ソフトへ受け渡す",
            shortLabel: "受け渡し",
            description: preflight.canExport
                ? preflight.counts.warning > 0
                    ? "受け渡し可能ですが、確認項目があります。"
                    : "ラフカット動画と編集データを出力できます。"
                : "未解決のエラーがあるため、まだ受け渡せません。",
            actionLabel: "受け渡しへ",
            state: exportState,
            metric: preflight.canExport
                ? preflight.counts.warning > 0 ? `${preflight.counts.warning}警告` : "準備OK"
                : `${preflight.counts.error}エラー`,
        },
    ]

    const activeStep = firstActionableStep(steps) ?? steps[0]

    return {
        activeStepId: activeStep.id,
        nextAction: activeStep.actionLabel,
        steps,
        stats: {
            hasSource,
            hasVideoInfo,
            hasAnalysisDraft,
            adoptedClipCount,
            sequenceDuration: preflight.sequenceDuration,
            reviewSubtitleCount: preflight.reviewSubtitleCount,
            exportWarnings: preflight.counts.warning,
            exportErrors: preflight.counts.error,
        },
    }
}

/**
 * UIが表示する3つの制作空間を、詳細な5工程の判定から一度だけ組み立てる。
 * 素材選択・AI解析・KEEP/没判断は同じ「見どころを見つける」空間に属する。
 */
export function computeWorkflowPresentation(document: WorkflowDocument): WorkflowPresentation {
    const summary = computeWorkflowSummary(document)
    const analysis = summary.steps.find((step) => step.id === "analysis")!
    const review = summary.steps.find((step) => step.id === "review")!
    const edit = summary.steps.find((step) => step.id === "edit")!
    const exportStep = summary.steps.find((step) => step.id === "export")!

    const draftState: WorkflowWorkspaceState = analysis.state === "complete" && review.state === "complete"
        ? "complete"
        : analysis.state === "attention" || review.state === "attention"
            ? "attention"
            : "ready"
    const exportComplete = document.processing?.phase === "complete"
        && Boolean(document.processing.lastOutputPath)
        && !document.processing.lastError
    const exportState: WorkflowWorkspaceState = exportComplete
        ? "complete"
        : exportStep.state === "locked" && summary.stats.hasSource
            ? "attention"
            : workspaceState(exportStep.state)

    const values: Record<WorkflowWorkspaceId, Pick<WorkflowWorkspace, "metric" | "state">> = {
        draft: {
            metric: `${document.recommendedCuts.length}候補`,
            state: draftState,
        },
        edit: {
            metric: edit.metric,
            state: workspaceState(edit.state),
        },
        export: {
            metric: exportComplete ? "動画出力済み" : exportStep.metric,
            state: exportState,
        },
    }

    const workspaces = WORKSPACE_DEFINITIONS.map((definition, index) => {
        const next = WORKSPACE_DEFINITIONS[index + 1]
        return {
            ...definition,
            ...values[definition.id],
            nextId: next?.id ?? null,
            nextLabel: next?.title ?? null,
        }
    })

    const fileName = document.inputPath.split(/[\\/]/).pop() ?? "新規プロジェクト"
    const sourceMeta = document.videoInfo
        ? `${document.videoInfo.width}×${document.videoInfo.height} · ${formatSourceDuration(document.videoInfo.duration)}`
        : "素材を読み込んで開始"

    return {
        project: {
            fileName,
            sourceMeta,
            assetCount: document.mediaAssets.length,
            clipCount: document.timelineClips.length,
            subtitleCount: document.subtitles.length,
        },
        workspaces,
        completedCount: workspaces.filter((workspace) => workspace.state === "complete").length,
    }
}
