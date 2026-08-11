import test from "node:test"
import assert from "node:assert/strict"
import { createDiagnosticReport } from "./diagnosticReport.ts"

function document(overrides: Record<string, unknown> = {}) {
    return {
        inputPath: "C:\\Users\\Someone\\Videos\\source.mp4",
        videoInfo: { duration: 75, width: 1920, height: 1080 },
        timelineClips: [{ id: "clip1", mediaStart: 10, mediaEnd: 25 }],
        trim: { start: 0, end: 0, previewTime: 0 },
        subtitles: [
            { id: "sub1", text: "hello", start: 12, end: 14, confidence: 0.9 },
        ],
        text: { content: "" },
        bgmPath: "C:\\Users\\Someone\\Music\\bgm.wav",
        avatarPath: "",
        images: [],
        seSlots: [],
        recommendedCuts: [],
        analysisArtifacts: [],
        activeAnalysisId: null,
        excitementGraph: [],
        agentThinking: "",
        processing: {
            gpuType: "CPU",
            enableAutoReframe: true,
            enableJumpCut: false,
            status: "待機中",
            phase: "",
            progress: 0,
            lastOutputPath: null,
            lastStartedAt: null,
            lastFinishedAt: null,
            lastError: null,
        },
        ...overrides,
    } as any
}

test("診断レポートは主要な通しテスト状態を含む", () => {
    const report = createDiagnosticReport(document(), "2026-07-08T00:00:00.000Z")

    assert.match(report, /TateClip Diagnostic Report/)
    assert.match(report, /inputFile: source\.mp4/)
    assert.match(report, /videoInfo: 1920x1080 \/ 1:15/)
    assert.match(report, /canExport: yes/)
    assert.match(report, /readyForSmokeTest: yes/)
    assert.match(report, /\[Release Readiness\]/)
    assert.doesNotMatch(report, /Beta|readyForBetaShare/)
    assert.match(report, /subtitleAverageConfidence: 90%/)
})

test("診断レポートは素材やBGMのフルパスを既定で出さない", () => {
    const report = createDiagnosticReport(document())

    assert.match(report, /inputFile: source\.mp4/)
    assert.match(report, /bgm: bgm\.wav/)
    assert.doesNotMatch(report, /C:\\Users\\Someone\\Videos/)
    assert.doesNotMatch(report, /C:\\Users\\Someone\\Music/)
})

test("診断レポートは直近の書き出しエラーを含む", () => {
    const report = createDiagnosticReport(document({
        processing: {
            gpuType: "NVIDIA",
            enableAutoReframe: true,
            enableJumpCut: false,
            status: "エラー: ffmpeg failed",
            phase: "failed",
            progress: 0,
            lastOutputPath: null,
            lastStartedAt: "2026-07-08T01:00:00.000Z",
            lastFinishedAt: "2026-07-08T01:00:10.000Z",
            lastError: "ffmpeg failed: invalid filter",
        },
    }))

    assert.match(report, /status: エラー: ffmpeg failed/)
    assert.match(report, /lastError: ffmpeg failed: invalid filter/)
})
