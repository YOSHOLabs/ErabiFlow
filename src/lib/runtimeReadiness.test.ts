import test from "node:test"
import assert from "node:assert/strict"
import { computeRuntimeReadiness } from "./runtimeReadiness.ts"

test("ブラウザプレビューではデスクトップ機能を警告する", () => {
    const summary = computeRuntimeReadiness({ isTauri: false })

    assert.equal(summary.canExport, false)
    assert.equal(summary.canRunAi, false)
    assert.ok(summary.items.some((item) => item.id === "desktop-runtime" && item.severity === "warning"))
})

test("AIデーモン接続失敗はAI実行不可にする", () => {
    const summary = computeRuntimeReadiness({
        isTauri: true,
        daemonError: "Daemon process exited unexpectedly",
        ffmpegRuntime: { state: "ready", source: "downloaded" },
    })

    assert.equal(summary.canExport, true)
    assert.equal(summary.canRunAi, false)
    assert.ok(summary.items.some((item) => item.id === "daemon" && item.severity === "error"))
})

test("Tauriとデーモンが正常ならAI実行可能として扱う", () => {
    const summary = computeRuntimeReadiness({
        isTauri: true,
        daemon: {
            status: "healthy",
            engine_loaded: false,
            device: "not_initialized",
            hardware_gpu: "NVIDIA (CUDA)",
        },
        whisperModel: {
            state: "ready",
            source: "bundled",
        },
        ffmpegRuntime: {
            state: "ready",
            source: "downloaded",
        },
    })

    assert.equal(summary.canExport, true)
    assert.equal(summary.canRunAi, true)
    assert.equal(summary.counts.error, 0)
    assert.ok(summary.items.some((item) => item.id === "daemon" && item.severity === "ok"))
    assert.ok(summary.items.some((item) => item.id === "whisper-model" && item.severity === "ok"))
})

test("字幕モデルが未取得ならデーモン正常でもAI実行不可にする", () => {
    const summary = computeRuntimeReadiness({
        isTauri: true,
        daemon: { status: "healthy" },
        whisperModel: {
            state: "missing",
            downloadedBytes: 0,
            expectedBytes: 1_624_555_275,
            message: "字幕モデルの取得が必要です。",
        },
        ffmpegRuntime: { state: "ready", source: "downloaded" },
    })

    assert.equal(summary.canRunAi, false)
    assert.ok(summary.items.some((item) => item.id === "whisper-model" && item.severity === "warning"))
})

test("動画エンジンが未取得なら読み込みと書き出しを準備未完了にする", () => {
    const summary = computeRuntimeReadiness({
        isTauri: true,
        daemon: { status: "healthy" },
        whisperModel: { state: "ready", source: "downloaded" },
        ffmpegRuntime: {
            state: "missing",
            downloadedBytes: 0,
            expectedBytes: 146_549_301,
            message: "動画エンジンの初回準備が必要です。",
        },
    })

    assert.equal(summary.canExport, false)
    assert.equal(summary.canRunAi, false)
    assert.ok(summary.items.some((item) => item.id === "ffmpeg-runtime" && item.severity === "warning"))
})
