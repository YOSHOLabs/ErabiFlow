import assert from "node:assert/strict"
import test from "node:test"
import {
    applyAnalysisProgress,
    canApplyAnalysisResult,
    cancelAnalysisJob,
    completeAnalysisJob,
    createAnalysisJob,
    failAnalysisJob,
    inferAnalysisStage,
    isActiveAnalysisJob,
    requestCancelAnalysisJob,
} from "./analysisJob.ts"

test("daemon進捗メッセージを解析ステージへ変換する", () => {
    assert.equal(inferAnalysisStage("音声トラックを判別中 (声 vs ゲーム音)...", 0.08), "detect_audio_tracks")
    assert.equal(inferAnalysisStage("Chunk 1/3 Track 2 文字起こし (41%)", 0.22), "transcribe")
    assert.equal(inferAnalysisStage("Chunk 1/3 処理中 (スコアリング)...", 0.45), "score_highlights")
    assert.equal(inferAnalysisStage("候補を抽出中...", 0.72), "generate_draft")
    assert.equal(inferAnalysisStage("結果を整形中...", 0.95), "generate_draft")
})

test("解析ジョブはキャンセル状態を保持する", () => {
    const job = createAnalysisJob({
        id: "job-1",
        sourcePath: "C:/video.mp4",
        mode: "fast",
        now: "2026-07-09T00:00:00.000Z",
    })

    const progressed = applyAnalysisProgress(job, {
        progress: 0.2,
        message: "Chunk 1/2 Track 2 文字起こし (30%)",
    }, "2026-07-09T00:01:00.000Z")
    const cancelled = cancelAnalysisJob(progressed, "キャンセル要求を送信しました", "2026-07-09T00:02:00.000Z")

    assert.equal(cancelled.status, "cancelled")
    assert.equal(cancelled.lastError, null)
    assert.equal(cancelled.stages.find((stage) => stage.id === "transcribe")?.status, "skipped")
    assert.match(cancelled.logs.at(-1)?.message ?? "", /キャンセル/)
})

test("キャンセル要求中は完了扱いにせずproject lockを維持する", () => {
    const job = createAnalysisJob({
        id: "job-cancelling",
        sourcePath: "C:/video.mp4",
        mode: "fast",
        now: "2026-07-09T00:00:00.000Z",
    })
    const cancelling = requestCancelAnalysisJob(job, "停止要求中", "2026-07-09T00:01:00.000Z")
    const progressed = applyAnalysisProgress(cancelling, { progress: 0.5, message: "停止処理中" })

    assert.equal(cancelling.status, "cancelling")
    assert.equal(cancelling.finishedAt, null)
    assert.equal(progressed.status, "cancelling")
    assert.equal(isActiveAnalysisJob(progressed), true)
    assert.equal(isActiveAnalysisJob(cancelAnalysisJob(progressed)), false)
})

test("解析結果は同じjobと入力素材がまだactiveな場合だけ反映できる", () => {
    const job = createAnalysisJob({ id: "job-1", sourcePath: "C:/old.mp4", mode: "fast" })
    const input = {
        job,
        activeJobId: "job-1",
        clientJobId: "job-1",
        capturedSourcePath: "C:/old.mp4",
        currentSourcePath: "C:/old.mp4",
    }
    assert.equal(canApplyAnalysisResult(input), true)
    assert.equal(canApplyAnalysisResult({ ...input, currentSourcePath: "C:/new.mp4" }), false)
    assert.equal(canApplyAnalysisResult({ ...input, activeJobId: "job-2" }), false)
    assert.equal(canApplyAnalysisResult({ ...input, job: requestCancelAnalysisJob(job) }), false)
})

test("解析ジョブは進捗から現在ステージとログを更新する", () => {
    const job = createAnalysisJob({
        id: "job-1",
        sourcePath: "C:/video.mp4",
        mode: "fast",
        now: "2026-07-09T00:00:00.000Z",
    })

    const updated = applyAnalysisProgress(job, {
        progress: 0.2,
        message: "Chunk 1/2 Track 2 文字起こし (30%)",
    }, "2026-07-09T00:01:00.000Z")

    assert.equal(updated.status, "running")
    assert.equal(updated.currentStageId, "transcribe")
    assert.equal(updated.stages.find((stage) => stage.id === "probe_media")?.status, "complete")
    assert.equal(updated.stages.find((stage) => stage.id === "transcribe")?.status, "running")
    assert.match(updated.logs.at(-1)?.message ?? "", /文字起こし/)
})

test("解析ジョブは成功/失敗の最終状態を保持する", () => {
    const job = createAnalysisJob({
        id: "job-1",
        sourcePath: "C:/video.mp4",
        mode: "fast",
        now: "2026-07-09T00:00:00.000Z",
    })

    const progressed = applyAnalysisProgress(job, {
        progress: 0.62,
        message: "候補をスコアリング中...",
    }, "2026-07-09T00:02:00.000Z")

    const failed = failAnalysisJob(progressed, "候補の採点に失敗しました", "2026-07-09T00:03:00.000Z")
    assert.equal(failed.status, "error")
    assert.equal(failed.lastError, "候補の採点に失敗しました")
    assert.equal(failed.stages.find((stage) => stage.id === "score_highlights")?.status, "error")

    const completed = completeAnalysisJob(progressed, "解析完了", "2026-07-09T00:04:00.000Z")
    assert.equal(completed.status, "success")
    assert.equal(completed.progress, 1)
    assert.ok(completed.stages.every((stage) => stage.status === "complete"))
})
