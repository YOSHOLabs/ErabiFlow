import { listen } from "@tauri-apps/api/event"
import { createBackgroundJob, didBatchStopBeforeCompletion, isActiveBackgroundJob } from "../lib/backgroundJob.ts"
import { buildCreatorBatchExportParams } from "../lib/creatorBatch.ts"
import { buildExportParams, type ExportSettings } from "../lib/exportParams.ts"
import { normalizeExportError, shortExportStatus } from "../lib/exportStatus.ts"
import { analyzeAndComputeCrop } from "../lib/faceTracker.ts"
import { commands } from "../tauri/commands.ts"
import { useBackgroundJobStore } from "../stores/backgroundJobs.ts"
import { useDocumentStore } from "../stores/document.ts"
import { recordHighlightFeedback, recordHighlightFeedbackBatch } from "../lib/highlightFeedback.ts"
import { parseHighlightCandidateClipId } from "../lib/highlightCandidateClip.ts"

interface ProcessingProgressPayload {
    phase: string
    progress: number
    message: string
}

interface RunExportInput {
    video: HTMLVideoElement | null
    settings: ExportSettings
}

interface RunCreatorBatchInput {
    video: HTMLVideoElement | null
    onlyIds?: ReadonlySet<string>
}

function makeRunId() {
    return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(2, 14)
}

function mediaProtocolUrl(inputPath: string): string {
    const protocol = /Windows/i.test(navigator.userAgent) ? "http://vfocus.localhost" : "vfocus://"
    return `${protocol}/media/${encodeURIComponent(inputPath)}`
}

/** Reactのmount状態に依存しない顔検出用videoを用意する。 */
async function createCropVideo(inputPath: string): Promise<{ video: HTMLVideoElement; dispose: () => void }> {
    const video = document.createElement("video")
    video.crossOrigin = "anonymous"
    video.preload = "auto"
    video.muted = true
    video.src = mediaProtocolUrl(inputPath)
    await new Promise<void>((resolve, reject) => {
        let timeout = 0
        const cleanup = () => {
            window.clearTimeout(timeout)
            video.removeEventListener("loadedmetadata", loaded)
            video.removeEventListener("error", failed)
        }
        const loaded = () => { cleanup(); resolve() }
        const rejectAndDispose = (error: Error) => {
            cleanup()
            video.pause()
            video.removeAttribute("src")
            video.load()
            reject(error)
        }
        const failed = () => rejectAndDispose(new Error("顔検出用動画を読み込めませんでした"))
        video.addEventListener("loadedmetadata", loaded, { once: true })
        video.addEventListener("error", failed, { once: true })
        timeout = window.setTimeout(
            () => rejectAndDispose(new Error("顔検出用動画の読み込みがタイムアウトしました")),
            15_000,
        )
        video.load()
    })
    return {
        video,
        dispose: () => {
            video.pause()
            video.removeAttribute("src")
            video.load()
        },
    }
}

async function resolveCropVideo(inputPath: string, existing: HTMLVideoElement | null) {
    if (existing?.readyState && existing.readyState >= HTMLMediaElement.HAVE_METADATA) {
        return { video: existing, dispose: () => undefined }
    }
    return createCropVideo(inputPath)
}

export async function runSingleExport({ video, settings }: RunExportInput): Promise<boolean> {
    const documentState = useDocumentStore.getState()
    if (!documentState.inputPath || documentState.processing.isProcessing) return false

    const job = createBackgroundJob({
        kind: "export",
        label: "動画書き出し",
        blocksProjectChange: true,
        exclusiveGroup: "media-processing",
    })
    const jobs = useBackgroundJobStore.getState()
    if (!jobs.startJob(job)) return false

    documentState.setProcessing({
        isProcessing: true,
        phase: "preparing",
        progress: 0,
        phaseMessage: job.message,
        status: "",
        lastError: null,
        lastOutputPath: null,
        lastStartedAt: job.startedAt,
        lastFinishedAt: null,
    })

    let unlisten: (() => void) | undefined
    let cropVideo: { video: HTMLVideoElement; dispose: () => void } | undefined
    try {
        unlisten = await listen<ProcessingProgressPayload>("processing-progress", (event) => {
            const current = useBackgroundJobStore.getState().jobs.export
            if (!current || current.id !== job.id || !isActiveBackgroundJob(current)) return
            const progress = event.payload.progress
            jobs.updateJob("export", job.id, {
                phase: event.payload.phase,
                progress,
                message: event.payload.message || "レンダリング中...",
            })
            useDocumentStore.getState().setProcessing({
                phase: event.payload.phase,
                progress,
                phaseMessage: event.payload.message,
            })
        })

        let cropData: string | undefined
        if (documentState.game.layoutMode !== "source" && documentState.processing.enableAutoReframe) {
            jobs.updateJob("export", job.id, { phase: "reframing", message: "顔位置を検出中..." })
            documentState.setProcessing({ phase: "reframing", phaseMessage: "顔位置を検出中..." })
            cropVideo = await resolveCropVideo(documentState.inputPath, video)
            cropData = await analyzeAndComputeCrop(cropVideo.video, "commentary", (value) => {
                const progress = value * 100
                const message = `顔検出中 ${Math.round(progress)}%`
                jobs.updateJob("export", job.id, { progress, message })
                useDocumentStore.getState().setProcessing({ progress, phaseMessage: message })
            })
        }

        jobs.updateJob("export", job.id, { phase: "rendering", progress: 0, message: "レンダリング開始..." })
        useDocumentStore.getState().setProcessing({ progress: 0, phase: "rendering", phaseMessage: "レンダリング開始..." })
        // 顔検出の待機中にUI状態が変わっても、開始時の編集内容を書き出す。
        const params = buildExportParams(documentState, cropData ?? null, settings)
        await commands.processVideoVFocus({ params })
        void recordHighlightFeedbackBatch(documentState.timelineClips
            .filter((clip) => !clip.isGap)
            .map((clip) => {
                const candidate = parseHighlightCandidateClipId(clip.id)
                return {
                    action: "exported" as const,
                    clipId: clip.id,
                    currentRange: { start: clip.mediaStart, end: clip.mediaEnd },
                    ...(candidate ?? {}),
                }
            }))

        const finishedAt = new Date().toISOString()
        const status = `処理完了 → ${params.outputPath.split(/[\\/]/).pop()}`
        jobs.updateJob("export", job.id, {
            status: "success",
            phase: "complete",
            progress: 100,
            message: "完了",
            outputPath: params.outputPath,
            finishedAt,
        })
        useDocumentStore.getState().setProcessing({
            phase: "complete",
            progress: 100,
            phaseMessage: "完了",
            status,
            lastOutputPath: params.outputPath,
            lastFinishedAt: finishedAt,
        })
        return true
    } catch (reason) {
        const error = normalizeExportError(reason)
        const finishedAt = new Date().toISOString()
        jobs.updateJob("export", job.id, {
            status: "error",
            phase: "failed",
            progress: 0,
            message: "書き出しに失敗しました",
            error,
            finishedAt,
        })
        useDocumentStore.getState().setProcessing({
            status: `エラー: ${shortExportStatus(error)}`,
            phase: "failed",
            progress: 0,
            phaseMessage: "書き出しに失敗しました",
            lastError: error,
            lastFinishedAt: finishedAt,
        })
        console.error(reason)
        return false
    } finally {
        unlisten?.()
        cropVideo?.dispose()
        useDocumentStore.getState().setProcessing({ isProcessing: false })
    }
}

export async function runCreatorBatch({ video, onlyIds }: RunCreatorBatchInput): Promise<boolean> {
    const documentState = useDocumentStore.getState()
    if (!documentState.inputPath || documentState.processing.isProcessing) return false
    const queue = documentState.creatorBatch
    const targets = queue.filter((item) => !onlyIds || onlyIds.has(item.id))
    if (targets.length === 0) return false

    const previousResults = useBackgroundJobStore.getState().jobs["creator-batch"]?.itemResults ?? {}
    const itemResults = {
        ...previousResults,
        ...Object.fromEntries(targets.map((item) => [item.id, { state: "pending" as const }])),
    }
    const job = createBackgroundJob({
        kind: "creator-batch",
        label: "Creator一括書き出し",
        blocksProjectChange: true,
        exclusiveGroup: "media-processing",
        itemResults,
    })
    const jobs = useBackgroundJobStore.getState()
    if (!jobs.startJob(job)) return false

    documentState.setProcessing({
        isProcessing: true,
        phase: "batch",
        progress: 0,
        phaseMessage: job.message,
        status: "",
        lastError: null,
        lastOutputPath: null,
        lastStartedAt: job.startedAt,
        lastFinishedAt: null,
    })

    let activeIndex = 0
    let completedCount = 0
    let cropData: string | null = null
    let lastOutputPath: string | null = null
    const errors: string[] = []
    let unlisten: (() => void) | undefined
    let cropVideo: { video: HTMLVideoElement; dispose: () => void } | undefined

    try {
        if (documentState.processing.enableAutoReframe) {
            jobs.updateJob("creator-batch", job.id, { phase: "reframing", message: "顔位置を一度だけ検出中..." })
            cropVideo = await resolveCropVideo(documentState.inputPath, video)
            cropData = await analyzeAndComputeCrop(cropVideo.video, "commentary", (value) => {
                const detailProgress = value * 100
                const message = `顔検出中 ${Math.round(detailProgress)}%`
                jobs.updateJob("creator-batch", job.id, { detailProgress, message })
                useDocumentStore.getState().setProcessing({ progress: detailProgress, phaseMessage: message })
            })
        }

        unlisten = await listen<ProcessingProgressPayload>("processing-progress", (event) => {
            const current = useBackgroundJobStore.getState().jobs["creator-batch"]
            if (!current || current.id !== job.id || !isActiveBackgroundJob(current)) return
            const detailProgress = Math.max(0, Math.min(100, event.payload.progress))
            const progress = ((activeIndex + detailProgress / 100) / targets.length) * 100
            const message = event.payload.message || "レンダリング中..."
            jobs.updateJob("creator-batch", job.id, { phase: event.payload.phase, progress, detailProgress, message })
            useDocumentStore.getState().setProcessing({
                phase: event.payload.phase,
                progress,
                phaseMessage: `${activeIndex + 1}/${targets.length} ${message}`,
            })
        })

        // 一括処理もジョブ開始時の編集内容を全itemで共有する。
        const documentSnapshot = documentState
        const runId = makeRunId()
        for (activeIndex = 0; activeIndex < targets.length; activeIndex += 1) {
            if (useBackgroundJobStore.getState().jobs["creator-batch"]?.stopRequested) break
            const item = targets[activeIndex]
            jobs.updateItemResult("creator-batch", job.id, item.id, { state: "running" })
            jobs.updateJob("creator-batch", job.id, {
                progress: (activeIndex / targets.length) * 100,
                detailProgress: 0,
                message: `${activeIndex + 1}/${targets.length} ${item.label}`,
            })
            try {
                const queueIndex = queue.findIndex((queued) => queued.id === item.id)
                const params = buildCreatorBatchExportParams(documentSnapshot, item, Math.max(0, queueIndex), runId, cropData)
                await commands.processVideoVFocus({ params })
                const candidateMatch = item.id.match(/^([A-Za-z0-9_-]+):candidate:(\d+)$/)
                void recordHighlightFeedback({
                    action: "exported",
                    candidateId: candidateMatch ? item.id : undefined,
                    analysisId: candidateMatch?.[1],
                    candidateIndex: candidateMatch ? Number(candidateMatch[2]) : undefined,
                    currentRange: { start: item.mediaStart, end: item.mediaEnd },
                })
                lastOutputPath = params.outputPath
                jobs.updateItemResult("creator-batch", job.id, item.id, { state: "success", outputPath: params.outputPath })
            } catch (reason) {
                const error = normalizeExportError(reason)
                errors.push(`${item.label}: ${error}`)
                jobs.updateItemResult("creator-batch", job.id, item.id, { state: "failed", error })
            }
            completedCount += 1
        }

        const stopped = didBatchStopBeforeCompletion(
            Boolean(useBackgroundJobStore.getState().jobs["creator-batch"]?.stopRequested),
            completedCount,
            targets.length,
        )
        const message = stopped
            ? `一括書き出しを停止しました（${completedCount}/${targets.length}）`
            : errors.length > 0
                ? `一括書き出し完了（成功 ${completedCount - errors.length} / 失敗 ${errors.length}）`
                : `一括書き出し完了（${completedCount}本）`
        const finishedAt = new Date().toISOString()
        const status = stopped ? "cancelled" : errors.length > 0 ? "partial" : "success"
        jobs.updateJob("creator-batch", job.id, {
            status,
            phase: stopped ? "cancelled" : errors.length > 0 ? "complete-with-errors" : "complete",
            progress: stopped ? useBackgroundJobStore.getState().jobs["creator-batch"]?.progress ?? 0 : 100,
            detailProgress: null,
            message,
            error: errors.length > 0 ? errors.join("\n\n") : null,
            outputPath: lastOutputPath,
            finishedAt,
        })
        useDocumentStore.getState().setProcessing({
            phase: stopped ? "cancelled" : errors.length > 0 ? "complete-with-errors" : "complete",
            progress: stopped ? useDocumentStore.getState().processing.progress : 100,
            phaseMessage: message,
            status: message,
            lastError: errors.length > 0 ? errors.join("\n\n") : null,
            lastOutputPath,
            lastFinishedAt: finishedAt,
        })
        return !stopped && errors.length === 0
    } catch (reason) {
        const error = normalizeExportError(reason)
        const finishedAt = new Date().toISOString()
        jobs.updateJob("creator-batch", job.id, {
            status: "error",
            phase: "failed",
            progress: 0,
            detailProgress: null,
            message: "一括書き出しの準備に失敗しました",
            error,
            outputPath: lastOutputPath,
            finishedAt,
        })
        useDocumentStore.getState().setProcessing({
            phase: "failed",
            progress: 0,
            phaseMessage: "一括書き出しの準備に失敗しました",
            status: "Creator一括書き出し失敗",
            lastError: error,
            lastOutputPath,
            lastFinishedAt: finishedAt,
        })
        return false
    } finally {
        unlisten?.()
        cropVideo?.dispose()
        useDocumentStore.getState().setProcessing({ isProcessing: false })
    }
}

export function requestCreatorBatchStop(): void {
    const job = useBackgroundJobStore.getState().jobs["creator-batch"]
    if (job) useBackgroundJobStore.getState().requestStop("creator-batch", job.id)
}
