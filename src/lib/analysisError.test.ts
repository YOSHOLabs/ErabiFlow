import assert from "node:assert/strict"
import test from "node:test"
import { visibleAnalysisError } from "./analysisError.ts"

test("解析エラーは発生元の動画を開いている間だけ表示する", () => {
    const error = {
        jobId: "job-broken-1",
        sourcePath: "C:\\broken.mp4",
        message: "ffmpeg probe failed",
    }

    assert.equal(visibleAnalysisError(error, "C:\\broken.mp4", ["job-broken-1"]), "ffmpeg probe failed")
    assert.equal(visibleAnalysisError(error, "C:\\valid.mp4", ["job-broken-1"]), "")
    assert.equal(visibleAnalysisError(error, null, ["job-broken-1"]), "")
    assert.equal(visibleAnalysisError(null, "C:\\valid.mp4", []), "")
})

test("同じpathでも入力またはprojectの世代が変われば古い解析エラーを隠す", () => {
    const error = {
        jobId: "old-job",
        sourcePath: "C:\\same.mp4",
        message: "old failure",
    }

    assert.equal(visibleAnalysisError(error, "C:\\same.mp4", []), "")
    assert.equal(visibleAnalysisError(error, "C:\\same.mp4", ["new-job"]), "")
})
