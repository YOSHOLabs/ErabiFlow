import type { VFocusDocument } from "@/stores/document"
import { computeExportPreflight } from "./preflight.ts"
import { computeWorkflowSummary } from "./workflow.ts"

export type ReleaseReadinessState = "done" | "todo" | "warning" | "manual"

export interface ReleaseReadinessItem {
    id: string
    state: ReleaseReadinessState
    title: string
    detail: string
}

export interface ReleaseReadinessSummary {
    readyForSmokeTest: boolean
    readyForDistribution: boolean
    doneCount: number
    totalCount: number
    items: ReleaseReadinessItem[]
    nextItem: ReleaseReadinessItem | null
}

function isCompletedStatus(status: string) {
    return status.includes("完了") || status.toLowerCase().includes("complete")
}

export function computeReleaseReadiness(document: VFocusDocument): ReleaseReadinessSummary {
    const workflow = computeWorkflowSummary(document)
    const preflight = computeExportPreflight(document)
    const hasExportSuccess = Boolean(document.processing.lastOutputPath && isCompletedStatus(document.processing.status))
    const hasAiDraft = workflow.stats.hasAnalysisDraft
    const hasAdoptedClip = workflow.stats.adoptedClipCount > 0
    const hasSubtitleReview = workflow.stats.reviewSubtitleCount > 0

    const items: ReleaseReadinessItem[] = [
        {
            id: "source",
            state: workflow.stats.hasSource && workflow.stats.hasVideoInfo ? "done" : "todo",
            title: "実動画を読み込む",
            detail: workflow.stats.hasVideoInfo
                ? "素材動画と動画情報を取得済みです。"
                : "まず実際の横動画または縦動画を読み込み、尺と解像度を取得します。",
        },
        {
            id: "analysis",
            state: hasAiDraft ? "done" : "todo",
            title: "見どころを検出する",
            detail: hasAiDraft
                ? "見どころ候補・字幕・解析メモのいずれかがあります。"
                : "解析を実行して、KEEP／没の判断材料を作ります。",
        },
        {
            id: "review",
            state: hasAdoptedClip ? "done" : "todo",
            title: "KEEP／没を判断する",
            detail: hasAdoptedClip
                ? `${workflow.stats.adoptedClipCount}区間をKEEPしています。`
                : "AI候補から1区間以上をKEEPし、残りは没か保留にします。",
        },
        {
            id: "subtitle-review",
            state: hasSubtitleReview ? "warning" : preflight.subtitleCount > 0 ? "done" : "manual",
            title: "字幕を確認する",
            detail: hasSubtitleReview
                ? `${workflow.stats.reviewSubtitleCount}件の要確認字幕が残っています。`
                : preflight.subtitleCount > 0
                    ? `${preflight.subtitleCount}件の字幕がシーケンスに乗ります。`
                    : "字幕なしで出す場合も、意図通りか目視確認します。",
        },
        {
            id: "preflight",
            state: preflight.canExport
                ? preflight.counts.warning > 0 ? "warning" : "done"
                : "todo",
            title: "受け渡し前チェックを通す",
            detail: preflight.canExport
                ? preflight.counts.warning > 0
                    ? `${preflight.counts.warning}件の警告があります。配布前に許容できるか確認してください。`
                    : "受け渡しを止めるエラーはありません。"
                : `${preflight.counts.error}件のエラーを解消してください。`,
        },
        {
            id: "export",
            state: hasExportSuccess ? "done" : "todo",
            title: "ラフカット動画を書き出す",
            detail: hasExportSuccess
                ? `直近の出力: ${document.processing.lastOutputPath}`
                : "元画角を維持したラフカットを最後まで書き出します。",
        },
        {
            id: "watch-output",
            state: hasExportSuccess ? "manual" : "todo",
            title: "出力動画を目視確認する",
            detail: hasExportSuccess
                ? "出力ファイルを再生し、音ズレ・欠落・意図しないクロップがないか確認します。"
                : "書き出し成功後、ラフカット動画を実際に再生して確認します。",
        },
    ]

    const doneCount = items.filter((item) => item.state === "done").length
    const nextItem = items.find((item) => item.state === "warning" || item.state === "todo" || item.state === "manual") ?? null
    const blockingTodo = items.some((item) => item.state === "todo")
    const warnings = items.some((item) => item.state === "warning")

    return {
        readyForSmokeTest: workflow.stats.hasSource && preflight.canExport,
        readyForDistribution: !blockingTodo && !warnings && hasExportSuccess,
        doneCount,
        totalCount: items.length,
        items,
        nextItem,
    }
}
