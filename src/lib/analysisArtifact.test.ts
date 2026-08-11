import test from "node:test"
import assert from "node:assert/strict"
import { createAnalysisArtifactFromResponse, normalizeSubtitleSequence } from "./analysisArtifact.ts"
import type { HighlightAnalysisResponse } from "../tauri/commands.ts"

test("解析結果を信頼度つき字幕成果物へ正規化する", () => {
    const response: HighlightAnalysisResponse = {
        status: "success",
        highlights: [{
            start: 12,
            end: 24,
            label: "クラッチ",
            reason: "盛り上がり",
            excitement: 90,
            scoreDetails: {
                event: 108,
                reaction: -6,
                clipability: 82,
                confidence: 1.4,
            },
            evidence: ["audio", "visual_change"],
            falsePositiveRisk: 1.4,
            durationVariants: {
                "15": { start: -4, end: 8 },
                "30": { start: 40, end: 30 },
                "60": { start: 2, end: 62 },
            },
        }],
        excitement_graph: [0, 50, 90],
        segments: [{
            id: "seg1",
            text: "ナイス",
            startTime: 12.3,
            endTime: 13.5,
            confidence: 0.91,
            sourceTrack: 2,
        }],
        transcript_text: "ナイス",
        stats: {
            highlights_found: 1,
            processing_time_sec: 3,
        },
    }

    const artifact = createAnalysisArtifactFromResponse(response, "C:\\video.mp4", "fast")

    assert.equal(artifact.highlights.length, 1)
    assert.deepEqual(artifact.highlights[0].scoreDetails, {
        event: 100,
        reaction: 0,
        clipability: 82,
        confidence: 1,
    })
    assert.deepEqual(artifact.highlights[0].evidence, ["audio", "visual_change"])
    assert.equal(artifact.highlights[0].falsePositiveRisk, 1)
    assert.deepEqual(artifact.highlights[0].durationVariants?.["15"], { start: 0, end: 8 })
    assert.deepEqual(artifact.highlights[0].durationVariants?.["30"], { start: 40, end: 40 })
    assert.equal(artifact.subtitles[0].confidence, 0.91)
    assert.equal(artifact.subtitles[0].sourceTrack, 2)
    assert.deepEqual(artifact.subtitles[0].flags, [])
})

test("低信頼字幕と定番幻覚文に確認フラグを付ける", () => {
    const response: HighlightAnalysisResponse = {
        status: "success",
        highlights: [],
        excitement_graph: [],
        segments: [{
            text: "ご視聴ありがとうございました",
            start_time: 30,
            end_time: 32,
            confidence: 0.2,
            source_track: 1,
        }],
        transcript_text: "",
        stats: {
            highlights_found: 0,
            processing_time_sec: 1,
        },
    }

    const artifact = createAnalysisArtifactFromResponse(response, "C:\\video.mp4", "subtitle")
    const flags = artifact.subtitles[0].flags ?? []

    assert.equal(artifact.warnings.length, 1)
    assert.ok(flags.includes("low_confidence"))
    assert.ok(flags.includes("possible_hallucination"))
    assert.ok(flags.includes("needs_review"))
})

test("空の尺候補は15・30・60秒ボタン用データへ偽装しない", () => {
    const response: HighlightAnalysisResponse = {
        status: "success",
        highlights: [{
            start: 1,
            end: 10,
            label: "legacy",
            reason: "",
            excitement: 50,
            durationVariants: {},
        }],
        excitement_graph: [],
        segments: [],
        transcript_text: "",
        stats: { highlights_found: 1, processing_time_sec: 1 },
    }

    const artifact = createAnalysisArtifactFromResponse(response, "C:\\video.mp4", "fast")
    assert.equal(artifact.highlights[0].durationVariants, undefined)
})

test("音声トラック判定情報を解析成果物へ保持する", () => {
    const response: HighlightAnalysisResponse = {
        status: "success",
        highlights: [],
        excitement_graph: [],
        segments: [],
        transcript_text: "",
        track_info: {
            voice_tracks: [2],
            game_tracks: [0, 1],
            stream_count: 3,
            track_stats: [
                { track: 0, role: "game", rms: 0.05, silence_ratio: 0.2 },
                { track: 2, role: "voice", rms: 0.01, silence_ratio: 0.8 },
            ],
        },
        stats: {
            highlights_found: 0,
            processing_time_sec: 1,
        },
    }

    const artifact = createAnalysisArtifactFromResponse(response, "C:\\video.mp4", "fast")

    assert.deepEqual(artifact.trackInfo?.voiceTracks, [2])
    assert.deepEqual(artifact.trackInfo?.gameTracks, [0, 1])
    assert.equal(artifact.trackInfo?.trackStats[1].silenceRatio, 0.8)
})

test("重なった字幕は次の発話前に終了する", () => {
    const result = normalizeSubtitleSequence([
        { id: "a", text: "最初の発言", start: 1, end: 5 },
        { id: "b", text: "次の発言", start: 3, end: 4 },
    ])

    assert.equal(result[0].end, 2.99)
    assert.equal(result[1].start, 3)
})

test("長い字幕は画面に収まる短い字幕へ分割する", () => {
    const result = normalizeSubtitleSequence([{
        id: "long",
        text: "これは縦動画の横幅からはみ出さないように複数の字幕へ分割されるとても長い発言です",
        start: 10,
        end: 14,
    }])

    assert.ok(result.length >= 2)
    assert.ok(result.every((segment) => Array.from(segment.text).length <= 24))
    assert.equal(result[0].start, 10)
    assert.equal(result.at(-1)?.end, 14)
})
