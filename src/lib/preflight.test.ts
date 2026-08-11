import test from "node:test"
import assert from "node:assert/strict"
import { computeExportPreflight } from "./preflight.ts"

function baseDocument(overrides: Record<string, unknown> = {}) {
    return {
        inputPath: "C:\\video.mp4",
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        timelineClips: [
            { id: "clip1", mediaStart: 10, mediaEnd: 35, label: "AI: good" },
        ],
        trim: { start: 0, end: 0 },
        subtitles: [],
        text: { content: "" },
        bgmPath: "",
        seSlots: [],
        ...overrides,
    } as any
}

test("書き出し前チェックは動画未選択と空シーケンスをエラーにする", () => {
    const summary = computeExportPreflight(baseDocument({
        inputPath: "",
        videoInfo: null,
        timelineClips: [],
    }))

    assert.equal(summary.canExport, false)
    assert.ok(summary.items.some((item) => item.id === "missing-input" && item.severity === "error"))
    assert.ok(summary.items.some((item) => item.id === "empty-sequence" && item.severity === "error"))
})

test("元動画全体が残っていても任意尺のラフカットとして出力できる", () => {
    const summary = computeExportPreflight(baseDocument({
        videoInfo: { duration: 120, width: 1920, height: 1080 },
        timelineClips: [{ id: "source", mediaStart: 0, mediaEnd: 120 }],
    }))

    assert.equal(summary.canExport, true)
    assert.ok(summary.items.some((item) => item.id === "original-only" && item.severity === "info"))
    assert.equal(summary.sequenceDuration, 120)
})

test("素材だけ読み込んだ状態ではKEEP区間未作成として受け渡せない", () => {
    const summary = computeExportPreflight(baseDocument({
        timelineClips: [],
    }))

    assert.equal(summary.canExport, false)
    assert.ok(summary.items.some((item) => item.id === "empty-sequence" && item.severity === "error"))
})

test("採用済みシーケンス上の要確認字幕を数える", () => {
    const summary = computeExportPreflight(baseDocument({
        timelineClips: [{ id: "clip1", mediaStart: 10, mediaEnd: 35 }],
        subtitles: [
            { id: "sub1", text: "怪しい", start: 12, end: 14, flags: ["needs_review"] },
            { id: "sub2", text: "範囲外", start: 80, end: 82, flags: ["needs_review"] },
        ],
    }))

    assert.equal(summary.reviewSubtitleCount, 1)
    assert.ok(summary.items.some((item) => item.id === "subtitle-review" && item.severity === "info"))
})

test("縦動画でも横動画でも長さ上限なしで受け渡せる", () => {
    const portrait = computeExportPreflight(baseDocument({
        videoInfo: { duration: 14400, width: 1080, height: 1920, fps: 60 },
        timelineClips: [{ id: "long", mediaStart: 0, mediaEnd: 7200 }],
    }))
    const landscape = computeExportPreflight(baseDocument({
        videoInfo: { duration: 14400, width: 3840, height: 2160, fps: 30 },
        timelineClips: [{ id: "long", mediaStart: 0, mediaEnd: 10800 }],
    }))

    assert.equal(portrait.canExport, true)
    assert.equal(landscape.canExport, true)
    assert.ok(portrait.items.some((item) => item.id === "source-format" && item.title.includes("縦動画")))
    assert.ok(landscape.items.some((item) => item.id === "source-format" && item.title.includes("横動画")))
    assert.ok(portrait.items.every((item) => !item.id.includes("platform")))
})

test("旧編集効果をラフカットとして無効化した尺と字幕件数を表示する", () => {
    const summary = computeExportPreflight(baseDocument({
        timelineClips: [{
            id: "legacy-edited",
            mediaStart: 10,
            mediaEnd: 20,
            speed: 2,
            freezeFrame: 15,
            freezeDuration: 30,
            reverse: true,
        }],
        subtitles: [{ id: "sub", text: "source time", start: 18, end: 19, flags: ["needs_review"] }],
    }))

    assert.equal(summary.sequenceDuration, 10)
    assert.equal(summary.subtitleCount, 1)
    assert.equal(summary.reviewSubtitleCount, 1)
})
