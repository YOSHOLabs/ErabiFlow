import test from "node:test"
import assert from "node:assert/strict"
import {
    canCancelDownloadJob,
    clampJobProgress,
    createBackgroundJob,
    didBatchStopBeforeCompletion,
    hasBlockingBackgroundJob,
    isActiveBackgroundJob,
    patchBackgroundJob,
} from "./backgroundJob.ts"
import { useBackgroundJobStore } from "../stores/backgroundJobs.ts"

test("background jobを決定的なIDと時刻で開始できる", () => {
    const job = createBackgroundJob({
        kind: "export",
        label: "書き出し",
        blocksProjectChange: true,
        exclusiveGroup: "media-processing",
        makeId: () => "job-1",
        now: () => "2026-07-29T00:00:00.000Z",
    })
    assert.equal(job.id, "job-1")
    assert.equal(job.status, "running")
    assert.equal(job.startedAt, "2026-07-29T00:00:00.000Z")
    assert.equal(job.blocksProjectChange, true)
    assert.equal(isActiveBackgroundJob(job), true)
})

test("download中断はbackend progress受信後だけ有効になる", () => {
    const preparing = createBackgroundJob({
        kind: "whisper-download",
        label: "字幕モデル",
        makeId: () => "download-1",
    })
    assert.equal(canCancelDownloadJob(preparing), false)

    const active = patchBackgroundJob(preparing, {
        phase: "downloading",
        metrics: { state: "downloading" },
    })
    assert.equal(canCancelDownloadJob(active), true)
    assert.equal(canCancelDownloadJob(patchBackgroundJob(active, { status: "cancelling" })), false)
})

test("進捗を0〜100へ正規化しmetricsを差分更新する", () => {
    const source = createBackgroundJob({ kind: "ffmpeg-download", label: "FFmpeg", makeId: () => "job-2" })
    const first = patchBackgroundJob(source, { progress: 180, metrics: { downloadedBytes: 10 } })
    const second = patchBackgroundJob(first, { detailProgress: -4, metrics: { totalBytes: 20 } })
    assert.equal(first.progress, 100)
    assert.equal(second.detailProgress, 0)
    assert.deepEqual(second.metrics, { downloadedBytes: 10, totalBytes: 20 })
    assert.equal(clampJobProgress(Number.NaN), 0)
})

test("project切替を止めるのは実行中のblocking jobだけ", () => {
    const running = createBackgroundJob({ kind: "creator-batch", label: "Batch", blocksProjectChange: true })
    const download = createBackgroundJob({ kind: "whisper-download", label: "Model" })
    assert.equal(hasBlockingBackgroundJob({ "creator-batch": running, "whisper-download": download }), true)
    assert.equal(hasBlockingBackgroundJob({
        "creator-batch": patchBackgroundJob(running, { status: "success" }),
        "whisper-download": download,
    }), false)
})

test("同じexclusive groupの同時開始と古いjob idからの更新を拒否する", () => {
    const store = useBackgroundJobStore.getState()
    const exportJob = createBackgroundJob({
        kind: "export",
        label: "Export",
        exclusiveGroup: "media-processing",
        makeId: () => "exclusive-export",
    })
    const batchJob = createBackgroundJob({
        kind: "creator-batch",
        label: "Batch",
        exclusiveGroup: "media-processing",
        makeId: () => "exclusive-batch",
    })

    assert.equal(store.startJob(exportJob), true)
    assert.equal(store.startJob(batchJob), false)
    store.updateJob("export", "stale-id", { progress: 80 })
    assert.equal(useBackgroundJobStore.getState().jobs.export?.progress, 0)
    store.updateJob("export", exportJob.id, { status: "success", progress: 100 })
    assert.equal(useBackgroundJobStore.getState().jobs.export?.progress, 100)
    assert.equal(useBackgroundJobStore.getState().startJob(batchJob), true)
})

test("最終itemが完了済みなら遅い停止要求をcancel扱いにしない", () => {
    assert.equal(didBatchStopBeforeCompletion(true, 1, 2), true)
    assert.equal(didBatchStopBeforeCompletion(true, 2, 2), false)
    assert.equal(didBatchStopBeforeCompletion(false, 1, 2), false)
})
