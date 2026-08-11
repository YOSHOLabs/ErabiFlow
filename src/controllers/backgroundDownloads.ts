import { listen } from "@tauri-apps/api/event"
import { createBackgroundJob, isActiveBackgroundJob } from "../lib/backgroundJob.ts"
import { useBackgroundJobStore } from "../stores/backgroundJobs.ts"

export interface DownloadProgressPayload {
    state: string
    downloadedBytes: number
    totalBytes: number
    progress: number
    message: string
}

interface RunDownloadInput<TResult> {
    kind: "ffmpeg-download" | "whisper-download"
    label: string
    eventName: "ffmpeg-runtime-progress" | "whisper-model-progress"
    download: () => Promise<TResult>
}

export interface DownloadJobOutcome<TResult> {
    result: TResult | null
    error: string | null
    cancelled: boolean
}

export async function runDownloadJob<TResult>({
    kind,
    label,
    eventName,
    download,
}: RunDownloadInput<TResult>): Promise<DownloadJobOutcome<TResult>> {
    const job = createBackgroundJob({ kind, label })
    const jobs = useBackgroundJobStore.getState()
    if (!jobs.startJob(job)) return { result: null, error: null, cancelled: false }
    let unlisten: (() => void) | undefined
    try {
        unlisten = await listen<DownloadProgressPayload>(eventName, (event) => {
            const progress = Math.max(0, Math.min(100, event.payload.progress * 100))
            jobs.updateJob(kind, job.id, {
                phase: event.payload.state,
                progress,
                message: event.payload.message,
                metrics: {
                    state: event.payload.state,
                    downloadedBytes: event.payload.downloadedBytes,
                    totalBytes: event.payload.totalBytes,
                },
            })
        })
        const result = await download()
        jobs.updateJob(kind, job.id, {
            status: "success",
            phase: "ready",
            progress: 100,
            message: `${label}が完了しました`,
            finishedAt: new Date().toISOString(),
        })
        return { result, error: null, cancelled: false }
    } catch (reason) {
        const error = String(reason)
        const cancelled = /中断|キャンセル|cancel/i.test(error)
        jobs.updateJob(kind, job.id, {
            status: cancelled ? "cancelled" : "error",
            phase: cancelled ? "cancelled" : "failed",
            message: cancelled ? `${label}を中断しました` : `${label}に失敗しました`,
            error: cancelled ? null : error,
            finishedAt: new Date().toISOString(),
        })
        return { result: null, error: cancelled ? null : error, cancelled }
    } finally {
        unlisten?.()
    }
}

export async function cancelDownloadJob(
    kind: "ffmpeg-download" | "whisper-download",
    cancel: () => Promise<void>,
): Promise<void> {
    const store = useBackgroundJobStore.getState()
    const job = store.jobs[kind]
    if (!job || !isActiveBackgroundJob(job)) return
    store.updateJob(kind, job.id, { status: "cancelling", message: `${job.label}を中断しています...` })
    try {
        await cancel()
    } catch (reason) {
        store.updateJob(kind, job.id, { status: "error", error: String(reason), message: `${job.label}の中断に失敗しました` })
        throw reason
    }
}
