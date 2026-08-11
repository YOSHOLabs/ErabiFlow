import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DEFAULT_CLIP_AUDIO_EFFECTS, DEFAULT_CLIP_COLOR, DEFAULT_CLIP_EFFECTS } from "./types.ts"

interface CapabilityEntry {
    id: string
    preview: "exact" | "approximate" | "unsupported"
    export: "exact" | "approximate" | "unsupported"
    canvasMarker?: string
    ffmpegMarker?: string
    target?: string
    fields?: string[]
}

interface RenderCapabilities {
    version: number
    color: CapabilityEntry[]
    transitions: CapabilityEntry[]
    playback: CapabilityEntry[]
    audioEffects: CapabilityEntry[]
    visualEffects: CapabilityEntry[]
}

const contract = JSON.parse(
    readFileSync(new URL("./renderCapabilities.json", import.meta.url), "utf8"),
) as RenderCapabilities
const canvasEffectsSource = [
    readFileSync(new URL("./effects.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../preview/layers/VideoLayer.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../preview/layers/TrackVideoLayer.ts", import.meta.url), "utf8"),
].join("\n")
const canvasColorSource = readFileSync(new URL("./color.ts", import.meta.url), "utf8")
const canvasTransitionSource = readFileSync(new URL("./transitions.ts", import.meta.url), "utf8")
const previewPlaybackSource = [
    readFileSync(new URL("../components/VideoPreview.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../hooks/usePreviewPlaybackClock.ts", import.meta.url), "utf8"),
].join("\n")

test("描画能力契約がClipVisualEffectsの全fieldを一度ずつ覆う", () => {
    const expected = Object.keys(DEFAULT_CLIP_EFFECTS).sort()
    const actual = contract.visualEffects.map((entry) => entry.id).sort()
    assert.deepEqual(actual, expected)
    assert.equal(new Set(actual).size, actual.length)
})

test("全visual effectにCanvasとFFmpegの実装根拠がある", () => {
    for (const entry of contract.visualEffects) {
        assert.notEqual(entry.preview, "unsupported", `${entry.id}: preview support`)
        assert.notEqual(entry.export, "unsupported", `${entry.id}: export support`)
        assert.ok(entry.canvasMarker && canvasEffectsSource.includes(entry.canvasMarker), `${entry.id}: Canvas marker`)
        assert.ok(entry.ffmpegMarker, `${entry.id}: FFmpeg marker`)
    }
})

test("LUTのexport-only差異と数値カラー補正の近似を明示する", () => {
    const numeric = contract.color.find((entry) => entry.id === "numericAdjustments")
    const lut = contract.color.find((entry) => entry.id === "lutPath")
    assert.deepEqual([numeric?.preview, numeric?.export], ["approximate", "exact"])
    assert.deepEqual([lut?.preview, lut?.export], ["unsupported", "exact"])
    assert.ok(numeric?.canvasMarker && canvasColorSource.includes(numeric.canvasMarker))
    assert.ok(lut?.canvasMarker && canvasColorSource.includes(lut.canvasMarker))
    assert.deepEqual(
        numeric?.fields?.slice().sort(),
        Object.keys(DEFAULT_CLIP_COLOR).filter((key) => key !== "lutPath").sort(),
    )
})

test("transition typeとCanvas分岐が能力契約から欠落しない", () => {
    assert.deepEqual(contract.transitions.map((entry) => entry.id), ["none", "fade", "dissolve", "slide", "zoom", "rotate"])
    for (const entry of contract.transitions.filter((item) => item.id !== "none")) {
        assert.ok(canvasTransitionSource.includes(`transitionIn.type === "${entry.id}"`), `${entry.id}: Canvas branch`)
        assert.ok(entry.target)
    }
})

test("再生方式と高度な追加track音声の差異を契約化する", () => {
    assert.deepEqual(contract.playback.map((entry) => entry.id), [
        "constantSpeed", "reverseVideo", "freezeFrameVideo", "speedCurveVideo", "advancedTrackAudio",
    ])
    for (const entry of contract.playback) {
        assert.ok(entry.canvasMarker && previewPlaybackSource.includes(entry.canvasMarker), `${entry.id}: preview marker`)
        assert.ok(entry.ffmpegMarker, `${entry.id}: FFmpeg marker`)
    }
    const advancedAudio = contract.playback.find((entry) => entry.id === "advancedTrackAudio")
    assert.deepEqual([advancedAudio?.preview, advancedAudio?.export], ["unsupported", "exact"])
})

test("全audio effectをexport-only能力として列挙する", () => {
    assert.deepEqual(
        contract.audioEffects.map((entry) => entry.id).sort(),
        Object.keys(DEFAULT_CLIP_AUDIO_EFFECTS).sort(),
    )
    for (const entry of contract.audioEffects) {
        assert.deepEqual([entry.preview, entry.export], ["unsupported", "exact"], entry.id)
        assert.ok(entry.ffmpegMarker, `${entry.id}: FFmpeg marker`)
    }
})
