export type BackgroundJobKind =
    | "export"
    | "creator-batch"
    | "ffmpeg-download"
    | "whisper-download"

export type BackgroundJobStatus =
    | "running"
    | "cancelling"
    | "success"
    | "partial"
    | "cancelled"
    | "error"

export interface BackgroundJobItemResult {
    state: "pending" | "running" | "success" | "failed"
    outputPath?: string
    error?: string
}

export interface BackgroundJob {
    id: string
    kind: BackgroundJobKind
    label: string
    status: BackgroundJobStatus
    phase: string
    progress: number
    detailProgress: number | null
    message: string
    error: string | null
    outputPath: string | null
    startedAt: string
    finishedAt: string | null
    stopRequested: boolean
    blocksProjectChange: boolean
    exclusiveGroup: string | null
    itemResults: Record<string, BackgroundJobItemResult>
    metrics: Record<string, string | number | boolean | null>
}

export interface CreateBackgroundJobInput {
    kind: BackgroundJobKind
    label: string
    blocksProjectChange?: boolean
    exclusiveGroup?: string | null
    itemResults?: Record<string, BackgroundJobItemResult>
    now?: () => string
    makeId?: () => string
}

export type BackgroundJobPatch = Partial<Omit<BackgroundJob, "id" | "kind" | "startedAt">>

export function clampJobProgress(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}

export function createBackgroundJob(input: CreateBackgroundJobInput): BackgroundJob {
    const now = input.now ?? (() => new Date().toISOString())
    const makeId = input.makeId ?? (() => globalThis.crypto?.randomUUID?.() ?? `job-${Date.now()}`)
    return {
        id: makeId(),
        kind: input.kind,
        label: input.label,
        status: "running",
        phase: "preparing",
        progress: 0,
        detailProgress: null,
        message: `${input.label}を準備中...`,
        error: null,
        outputPath: null,
        startedAt: now(),
        finishedAt: null,
        stopRequested: false,
        blocksProjectChange: input.blocksProjectChange ?? false,
        exclusiveGroup: input.exclusiveGroup ?? null,
        itemResults: { ...(input.itemResults ?? {}) },
        metrics: {},
    }
}

export function patchBackgroundJob(job: BackgroundJob, patch: BackgroundJobPatch): BackgroundJob {
    return {
        ...job,
        ...patch,
        progress: patch.progress === undefined ? job.progress : clampJobProgress(patch.progress),
        detailProgress: patch.detailProgress === undefined
            ? job.detailProgress
            : patch.detailProgress === null
                ? null
                : clampJobProgress(patch.detailProgress),
        itemResults: patch.itemResults ? { ...patch.itemResults } : job.itemResults,
        metrics: patch.metrics ? { ...job.metrics, ...patch.metrics } : job.metrics,
    }
}

export function isActiveBackgroundJob(job: BackgroundJob | undefined): boolean {
    return job?.status === "running" || job?.status === "cancelling"
}

/** Backend側でcancellation tokenが有効になったprogressを受け取るまでは中断させない。 */
export function canCancelDownloadJob(job: BackgroundJob | undefined): boolean {
    return job?.status === "running" && typeof job.metrics.state === "string"
}

export function hasBlockingBackgroundJob(
    jobs: Partial<Record<BackgroundJobKind, BackgroundJob>>,
): boolean {
    return Object.values(jobs).some((job) => Boolean(job?.blocksProjectChange && isActiveBackgroundJob(job)))
}

export function didBatchStopBeforeCompletion(
    stopRequested: boolean,
    completedCount: number,
    totalCount: number,
): boolean {
    return stopRequested && completedCount < totalCount
}
