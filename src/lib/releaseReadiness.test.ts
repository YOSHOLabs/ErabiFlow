import test from "node:test"
import assert from "node:assert/strict"
import { computeReleaseReadiness } from "./releaseReadiness.ts"

function document(overrides: Record<string, unknown> = {}) {
    return {
        inputPath: "",
        videoInfo: null,
        analysisArtifacts: [],
        recommendedCuts: [],
        agentThinking: "",
        timelineClips: [],
        trim: { start: 0, end: 0, previewTime: 0 },
        subtitles: [],
        text: { content: "" },
        bgmPath: "",
        seSlots: [],
        processing: {
            status: "待機中",
            lastOutputPath: null,
        },
        ...overrides,
    } as any
}

test("配布確認は素材未選択なら実動画読み込みを最初の作業にする", () => {
    const summary = computeReleaseReadiness(document())

    assert.equal(summary.readyForSmokeTest, false)
    assert.equal(summary.readyForDistribution, false)
    assert.equal(summary.nextItem?.id, "source")
    assert.equal(summary.items.find((item) => item.id === "source")?.state, "todo")
})

test("候補採用済みでも要確認字幕があれば警告として残す", () => {
    const summary = computeReleaseReadiness(document({
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        recommendedCuts: [
            { start: 10, end: 25, label: "見どころ", reason: "盛り上がり", excitement: 88 },
        ],
        timelineClips: [{ id: "clip1", mediaStart: 10, mediaEnd: 25 }],
        subtitles: [
            { id: "sub1", text: "要確認", start: 12, end: 14, flags: ["needs_review"] },
        ],
    }))

    assert.equal(summary.readyForSmokeTest, true)
    assert.equal(summary.readyForDistribution, false)
    assert.equal(summary.items.find((item) => item.id === "review")?.state, "done")
    assert.equal(summary.items.find((item) => item.id === "subtitle-review")?.state, "warning")
})

test("書き出し成功後は目視確認が最後の手動項目になる", () => {
    const summary = computeReleaseReadiness(document({
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        recommendedCuts: [
            { start: 10, end: 25, label: "見どころ", reason: "盛り上がり", excitement: 88 },
        ],
        timelineClips: [{ id: "clip1", mediaStart: 10, mediaEnd: 25 }],
        subtitles: [
            { id: "sub1", text: "OK", start: 12, end: 14 },
        ],
        bgmPath: "C:\\audio\\bgm.wav",
        seSlots: [{ id: "se1", path: "C:\\audio\\hit.wav", volume: 0.8, triggerTime: 2 }],
        processing: {
            status: "処理完了 → out.mp4",
            lastOutputPath: "C:\\out.mp4",
        },
    }))

    assert.equal(summary.readyForSmokeTest, true)
    assert.equal(summary.readyForDistribution, true)
    assert.equal(summary.items.find((item) => item.id === "export")?.state, "done")
    assert.equal(summary.items.find((item) => item.id === "watch-output")?.state, "manual")
})
