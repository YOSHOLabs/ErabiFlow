import type { AnalysisMode } from "./analysisArtifact.ts"

export type AnalysisJobStatus = "queued" | "running" | "cancelling" | "success" | "error" | "cancelled"

export type AnalysisStageId =
    | "probe_media"
    | "detect_audio_tracks"
    | "transcribe"
    | "analyze_audio"
    | "score_highlights"
    | "generate_draft"

export type AnalysisStageStatus = "pending" | "running" | "complete" | "error" | "skipped"

export interface AnalysisStageDefinition {
    id: AnalysisStageId
    label: string
    description: string
}

export interface AnalysisJobStage extends AnalysisStageDefinition {
    status: AnalysisStageStatus
    progress: number
    startedAt: string | null
    finishedAt: string | null
    message: string
}

export interface AnalysisLogEntry {
    id: string
    at: string
    level: "info" | "warning" | "error"
    stageId: AnalysisStageId | null
    message: string
}

export interface AnalysisJob {
    id: string
    sourcePath: string
    mode: AnalysisMode
    status: AnalysisJobStatus
    createdAt: string
    startedAt: string | null
    finishedAt: string | null
    progress: number
    currentStageId: AnalysisStageId
    stages: AnalysisJobStage[]
    logs: AnalysisLogEntry[]
    lastError: string | null
    params: Record<string, unknown>
}

export interface CreateAnalysisJobInput {
    id: string
    sourcePath: string
    mode: AnalysisMode
    params?: Record<string, unknown>
    now?: string
}

export interface AnalysisProgressInput {
    progress: number
    message?: string
}

export const ANALYSIS_STAGE_DEFINITIONS: AnalysisStageDefinition[] = [
    {
        id: "probe_media",
        label: "素材確認",
        description: "動画の尺・構造・チャンクを確認します",
    },
    {
        id: "detect_audio_tracks",
        label: "音声トラック判別",
        description: "声トラックとゲーム音トラックを分けます",
    },
    {
        id: "transcribe",
        label: "字幕起こし",
        description: "Whisperで発話を字幕化します",
    },
    {
        id: "analyze_audio",
        label: "盛り上がり解析",
        description: "音量・ピーク・反応の強さを解析します",
    },
    {
        id: "score_highlights",
        label: "候補スコアリング",
        description: "字幕と音声から見どころ候補を採点します",
    },
    {
        id: "generate_draft",
        label: "AI初稿生成",
        description: "KEEP／没判断用の候補・字幕・グラフを整形します",
    },
]

const STAGE_ORDER = new Map<AnalysisStageId, number>(
    ANALYSIS_STAGE_DEFINITIONS.map((stage, index) => [stage.id, index]),
)

const MAX_LOGS = 200

function clamp01(value: number) {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(1, value))
}

function stageIndex(stageId: AnalysisStageId) {
    return STAGE_ORDER.get(stageId) ?? 0
}

function makeLogId(at: string, index: number) {
    return `${at}-${index}`.replace(/[^a-zA-Z0-9_-]/g, "")
}

function appendLog(
    logs: AnalysisLogEntry[],
    entry: Omit<AnalysisLogEntry, "id">,
): AnalysisLogEntry[] {
    const last = logs[logs.length - 1]
    if (last?.level === entry.level && last.message === entry.message && last.stageId === entry.stageId) {
        return logs
    }

    const next = [
        ...logs,
        {
            ...entry,
            id: makeLogId(entry.at, logs.length),
        },
    ]

    return next.slice(-MAX_LOGS)
}

function createDefaultStages(now: string): AnalysisJobStage[] {
    return ANALYSIS_STAGE_DEFINITIONS.map((stage, index) => ({
        ...stage,
        status: index === 0 ? "running" : "pending",
        progress: 0,
        startedAt: index === 0 ? now : null,
        finishedAt: null,
        message: "",
    }))
}

export function createAnalysisJob(input: CreateAnalysisJobInput): AnalysisJob {
    const now = input.now ?? new Date().toISOString()
    return {
        id: input.id,
        sourcePath: input.sourcePath,
        mode: input.mode,
        status: "running",
        createdAt: now,
        startedAt: now,
        finishedAt: null,
        progress: 0,
        currentStageId: "probe_media",
        stages: createDefaultStages(now),
        logs: [
            {
                id: makeLogId(now, 0),
                at: now,
                level: "info",
                stageId: "probe_media",
                message: input.mode === "subtitle" ? "字幕生成を開始しました" : "高速ハイライト解析を開始しました",
            },
        ],
        lastError: null,
        params: input.params ?? {},
    }
}

export function inferAnalysisStage(message = "", progress = 0): AnalysisStageId {
    const normalized = message.toLowerCase()

    if (/音声トラック|声 vs ゲーム音|track detection/.test(normalized)) {
        return "detect_audio_tracks"
    }
    if (/文字起こし|字幕|whisper|transcrib/.test(normalized)) {
        return "transcribe"
    }
    if (/音声解析|盛り上がり|energy|ピーク/.test(normalized)) {
        return "analyze_audio"
    }
    if (/スコアリング|採点|score/.test(normalized)) {
        return "score_highlights"
    }
    if (/候補を抽出|結果を整形|初稿|完了|draft|highlight/.test(normalized)) {
        return "generate_draft"
    }
    if (/チャンク分割|素材|probe|パイプライン初期化|開始/.test(normalized)) {
        return "probe_media"
    }

    const p = clamp01(progress)
    if (p < 0.08) return "probe_media"
    if (p < 0.1) return "detect_audio_tracks"
    if (p < 0.58) return "transcribe"
    if (p < 0.65) return "analyze_audio"
    if (p < 0.75) return "score_highlights"
    return "generate_draft"
}

export function applyAnalysisProgress(
    job: AnalysisJob,
    input: AnalysisProgressInput,
    now = new Date().toISOString(),
): AnalysisJob {
    const progress = clamp01(input.progress)
    const message = input.message?.trim() ?? ""
    const currentStageId = inferAnalysisStage(message, progress)
    const currentIndex = stageIndex(currentStageId)

    const stages = job.stages.map((stage, index): AnalysisJobStage => {
        if (progress >= 1) {
            return {
                ...stage,
                status: "complete",
                progress: 1,
                startedAt: stage.startedAt ?? now,
                finishedAt: stage.finishedAt ?? now,
                message: stage.id === currentStageId && message ? message : stage.message,
            }
        }

        if (index < currentIndex) {
            return {
                ...stage,
                status: stage.status === "error" ? "error" : "complete",
                progress: 1,
                startedAt: stage.startedAt ?? now,
                finishedAt: stage.finishedAt ?? now,
            }
        }

        if (index === currentIndex) {
            const stageStartProgress = currentIndex / ANALYSIS_STAGE_DEFINITIONS.length
            const stageEndProgress = (currentIndex + 1) / ANALYSIS_STAGE_DEFINITIONS.length
            const localProgress = (progress - stageStartProgress) / Math.max(0.001, stageEndProgress - stageStartProgress)

            return {
                ...stage,
                status: "running",
                progress: Math.max(stage.progress, clamp01(localProgress)),
                startedAt: stage.startedAt ?? now,
                finishedAt: null,
                message: message || stage.message,
            }
        }

        return stage
    })

    return {
        ...job,
        // cancel IPCの完了前はproject切替ロックを維持する。
        status: job.status === "cancelling" ? "cancelling" : "running",
        progress: Math.max(job.progress, progress),
        currentStageId,
        stages,
        logs: message
            ? appendLog(job.logs, {
                at: now,
                level: "info",
                stageId: currentStageId,
                message,
            })
            : job.logs,
    }
}

export function requestCancelAnalysisJob(
    job: AnalysisJob,
    message = "キャンセル要求を送信しました",
    now = new Date().toISOString(),
): AnalysisJob {
    return {
        ...job,
        status: "cancelling",
        finishedAt: null,
        logs: appendLog(job.logs, {
            at: now,
            level: "warning",
            stageId: job.currentStageId,
            message,
        }),
    }
}

export function isActiveAnalysisJob(job: AnalysisJob | null | undefined): boolean {
    return job?.status === "queued" || job?.status === "running" || job?.status === "cancelling"
}

export function canApplyAnalysisResult({
    job,
    activeJobId,
    clientJobId,
    capturedSourcePath,
    currentSourcePath,
}: {
    job: AnalysisJob | null | undefined
    activeJobId: string | null
    clientJobId: string
    capturedSourcePath: string
    currentSourcePath: string
}): boolean {
    return activeJobId === clientJobId
        && currentSourcePath === capturedSourcePath
        && job?.id === clientJobId
        && job.sourcePath === capturedSourcePath
        && job.status === "running"
}

export function completeAnalysisJob(
    job: AnalysisJob,
    message = "解析が完了しました",
    now = new Date().toISOString(),
): AnalysisJob {
    return {
        ...job,
        status: "success",
        progress: 1,
        currentStageId: "generate_draft",
        finishedAt: now,
        stages: job.stages.map((stage) => ({
            ...stage,
            status: stage.status === "skipped" ? "skipped" : "complete",
            progress: 1,
            startedAt: stage.startedAt ?? now,
            finishedAt: stage.finishedAt ?? now,
        })),
        logs: appendLog(job.logs, {
            at: now,
            level: "info",
            stageId: "generate_draft",
            message,
        }),
    }
}

export function failAnalysisJob(
    job: AnalysisJob,
    error: string,
    now = new Date().toISOString(),
): AnalysisJob {
    const currentStageId = job.currentStageId
    return {
        ...job,
        status: "error",
        finishedAt: now,
        lastError: error,
        stages: job.stages.map((stage) => stage.id === currentStageId
            ? {
                ...stage,
                status: "error",
                finishedAt: now,
                message: error,
            }
            : stage
        ),
        logs: appendLog(job.logs, {
            at: now,
            level: "error",
            stageId: currentStageId,
            message: error,
        }),
    }
}

export function cancelAnalysisJob(
    job: AnalysisJob,
    message = "解析をキャンセルしました",
    now = new Date().toISOString(),
): AnalysisJob {
    const currentStageId = job.currentStageId
    return {
        ...job,
        status: "cancelled",
        finishedAt: now,
        lastError: null,
        stages: job.stages.map((stage) => stage.id === currentStageId
            ? {
                ...stage,
                status: "skipped",
                finishedAt: now,
                message,
            }
            : stage
        ),
        logs: appendLog(job.logs, {
            at: now,
            level: "warning",
            stageId: currentStageId,
            message,
        }),
    }
}
