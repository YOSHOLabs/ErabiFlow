import test from "node:test"
import assert from "node:assert/strict"
import {
    canSplitTimelineClip,
    createFullSourceClip,
    createClipsExcludingRanges,
    getSequenceDuration,
    getTimelineClipDuration,
    getTimelineClipSpeed,
    getTimelineClipTransform,
    isFullSourceTimeline,
    shouldReplaceTimelineOnFirstAdoption,
    layoutTimelineClips,
    mediaRangeToSequenceRanges,
    sequenceTimeToMedia,
    setTimelineClipEdge,
    splitTimelineClipAt,
    subtitlesToSequence,
    trimTimelineClipEdge,
} from "./timeline.ts"
import type { TimelineClip } from "./types.ts"

const clips: TimelineClip[] = [
    { id: "a", mediaStart: 10, mediaEnd: 20 },
    { id: "gap", isGap: true, mediaStart: 2, mediaEnd: 0 },
    { id: "b", mediaStart: 40, mediaEnd: 55 },
]

test("シーケンス長とレイアウトを一つの規則で計算する", () => {
    assert.equal(getSequenceDuration(clips), 27)
    assert.deepEqual(
        layoutTimelineClips(clips).map(({ id, sequenceStart, duration }) => ({
            id,
            sequenceStart,
            duration,
        })),
        [
            { id: "a", sequenceStart: 0, duration: 10 },
            { id: "gap", sequenceStart: 10, duration: 2 },
            { id: "b", sequenceStart: 12, duration: 15 },
        ],
    )
})

test("無音カットの下書きは最初のAI候補採用時に置換する", () => {
    const autoCut = createClipsExcludingRanges(120, [
        { start: 4, end: 6 },
        { start: 20, end: 23 },
    ])
    assert.equal(isFullSourceTimeline(autoCut, 120), false)
    assert.equal(shouldReplaceTimelineOnFirstAdoption(autoCut, 120), true)
    assert.equal(shouldReplaceTimelineOnFirstAdoption([
        { id: "selected", mediaStart: 30, mediaEnd: 45, label: "AI: clutch" },
    ], 120), false)
})

test("シーケンス時刻を元動画時刻へ変換する", () => {
    assert.equal(sequenceTimeToMedia(clips, 4)?.mediaTime, 14)
    assert.equal(sequenceTimeToMedia(clips, 10.5)?.clip.id, "gap")
    assert.equal(sequenceTimeToMedia(clips, 14)?.mediaTime, 42)
    assert.equal(sequenceTimeToMedia(clips, 27), null)
})

test("速度変更をシーケンス長・時刻変換・字幕位置へ一貫して反映する", () => {
    const sped: TimelineClip[] = [
        { id: "fast", mediaStart: 10, mediaEnd: 20, speed: 2 },
        { id: "slow", mediaStart: 30, mediaEnd: 34, speed: 0.5 },
    ]

    assert.equal(getTimelineClipSpeed(sped[0]), 2)
    assert.equal(getTimelineClipDuration(sped[0]), 5)
    assert.equal(getSequenceDuration(sped), 13)
    assert.equal(sequenceTimeToMedia(sped, 2)?.mediaTime, 14)
    assert.equal(sequenceTimeToMedia(sped, 7)?.mediaTime, 31)
    assert.deepEqual(mediaRangeToSequenceRanges(sped, 12, 32), [
        { clipId: "fast", sequenceStart: 1, sequenceEnd: 5 },
        { clipId: "slow", sequenceStart: 5, sequenceEnd: 9 },
    ])
})

test("カーブ速度・逆再生・フリーズを同じ時間変換へ反映する", () => {
    const curved: TimelineClip = { id: "curve", mediaStart: 10, mediaEnd: 20, speedCurve: [{ position: 0, speed: 1 }, { position: 0.5, speed: 1 }, { position: 1, speed: 2 }] }
    assert.equal(Number(getTimelineClipDuration(curved).toFixed(3)), 8.333)
    const reversed = { ...curved, reverse: true }
    assert.equal(sequenceTimeToMedia([reversed], 0)?.mediaTime, 20 - 1 / 30)
    assert.ok((sequenceTimeToMedia([reversed], 2)?.mediaTime ?? 20) < 20)
    const frozen: TimelineClip = { id: "freeze", mediaStart: 0, mediaEnd: 10, freezeFrame: 4.2, freezeDuration: 3 }
    assert.equal(getTimelineClipDuration(frozen), 3)
    assert.equal(sequenceTimeToMedia([frozen], 2)?.mediaTime, 4.2)
})

test("フリーズ位置と逆再生開始位置は素材末尾の一つ前のフレームへ収める", () => {
    const freezeAtEnd: TimelineClip = {
        id: "freeze-end",
        mediaStart: 2,
        mediaEnd: 10,
        freezeFrame: 10,
        freezeDuration: 2,
    }
    const reverse: TimelineClip = {
        id: "reverse-end",
        mediaStart: 2,
        mediaEnd: 10,
        reverse: true,
    }

    assert.equal(sequenceTimeToMedia([freezeAtEnd], 0)?.mediaTime, 10 - 1 / 30)
    assert.equal(sequenceTimeToMedia([reverse], 0)?.mediaTime, 10 - 1 / 30)
})

test("旧プロジェクトの未設定クリップは安全な編集既定値を使う", () => {
    const legacy: TimelineClip = { id: "legacy", mediaStart: 0, mediaEnd: 10 }
    assert.equal(getTimelineClipSpeed(legacy), 1)
    assert.deepEqual(getTimelineClipTransform(legacy), {
        positionX: 0,
        positionY: 0,
        scale: 1,
        rotation: 0,
        flipHorizontal: false,
        flipVertical: false,
        opacity: 1,
    })
})

test("元動画区間を採用済みクリップのシーケンス区間へ展開する", () => {
    assert.deepEqual(mediaRangeToSequenceRanges(clips, 15, 45), [
        { clipId: "a", sequenceStart: 5, sequenceEnd: 10 },
        { clipId: "b", sequenceStart: 12, sequenceEnd: 17 },
    ])
})

test("字幕をカット後のシーケンス時間とRust向けフィールド名へ変換する", () => {
    assert.deepEqual(
        subtitlesToSequence(clips, [{
            id: "sub",
            text: "テスト字幕",
            start: 15,
            end: 45,
        }]),
        [
            {
                id: "sub_a",
                text: "テスト字幕",
                startTime: 5,
                endTime: 10,
                emotion: "neutral",
            },
            {
                id: "sub_b",
                text: "テスト字幕",
                startTime: 12,
                endTime: 17,
                emotion: "neutral",
            },
        ],
    )
})

test("字幕個別設定はカット後の各字幕へ引き継ぐ", () => {
    const result = subtitlesToSequence(clips, [{
        id: "styled",
        text: "ここだけ赤",
        start: 15,
        end: 45,
        styleOverride: { color: "#FF0000", size: 72, positionY: 0.65 },
    }])

    assert.equal(result.length, 2)
    assert.deepEqual(result[0]?.styleOverride, { color: "#FF0000", size: 72, positionY: 0.65 })
    assert.deepEqual(result[1]?.styleOverride, result[0]?.styleOverride)
})

test("重複した無音区間を統合して有音クリップを作る", () => {
    const result = createClipsExcludingRanges(20, [
        { start: 3, end: 6 },
        { start: 5, end: 8 },
        { start: 15, end: 30 },
    ])
    assert.deepEqual(
        result.map(({ mediaStart, mediaEnd }) => ({ mediaStart, mediaEnd })),
        [
            { mediaStart: 0, mediaEnd: 3 },
            { mediaStart: 8, mediaEnd: 15 },
        ],
    )
})

test("極端に短い有音島を挟む無音区間は一つのカットへまとめる", () => {
    const result = createClipsExcludingRanges(10, [
        { start: 2, end: 4 },
        { start: 4.08, end: 6 },
    ])
    assert.deepEqual(result.map(({ mediaStart, mediaEnd }) => ({ mediaStart, mediaEnd })), [
        { mediaStart: 0, mediaEnd: 2 },
        { mediaStart: 6, mediaEnd: 10 },
    ])
})

test("クリップ端の微調整は動画範囲と最短尺を守る", () => {
    const clip: TimelineClip = { id: "clip", mediaStart: 10, mediaEnd: 20 }

    assert.deepEqual(
        trimTimelineClipEdge(clip, "start", -15, 60),
        { id: "clip", mediaStart: 0, mediaEnd: 20 },
    )
    assert.deepEqual(
        trimTimelineClipEdge(clip, "end", 100, 60),
        { id: "clip", mediaStart: 10, mediaEnd: 60 },
    )
    assert.deepEqual(
        setTimelineClipEdge(clip, "start", 19.99, 60, 0.5),
        { id: "clip", mediaStart: 19.5, mediaEnd: 20 },
    )
    assert.deepEqual(
        setTimelineClipEdge(clip, "end", 10.01, 60, 0.5),
        { id: "clip", mediaStart: 10, mediaEnd: 10.5 },
    )
})

test("再生ヘッド分割は両側に十分な尺がある時だけ成立する", () => {
    const clip: TimelineClip = { id: "clip", mediaStart: 10, mediaEnd: 20, label: "A" }

    assert.equal(canSplitTimelineClip(clip, 10.05, 0.1), false)
    assert.equal(canSplitTimelineClip(clip, 15, 0.1), true)

    const split = splitTimelineClipAt(clip, 15, () => "clip-b", 0.1)
    assert.deepEqual(split, [
        { id: "clip", mediaStart: 10, mediaEnd: 15, label: "A" },
        { id: "clip-b", mediaStart: 15, mediaEnd: 20, label: "A" },
    ])

    assert.equal(splitTimelineClipAt(clip, 20, () => "never"), null)
})

test("元動画全体クリップを識別する", () => {
    const source = createFullSourceClip(120, () => "source")

    assert.deepEqual(source, { id: "source", mediaStart: 0, mediaEnd: 120, label: "元動画" })
    assert.equal(isFullSourceTimeline([source], 120), true)
    assert.equal(isFullSourceTimeline([{ ...source, mediaEnd: 60 }], 120), false)
    assert.equal(isFullSourceTimeline([
        { ...source, id: "left", mediaEnd: 45 },
        { ...source, id: "right", mediaStart: 45 },
    ], 120), true)
    assert.equal(isFullSourceTimeline([
        { ...source, id: "left", mediaEnd: 45 },
        { ...source, id: "right", mediaStart: 55 },
    ], 120), false)
    assert.equal(isFullSourceTimeline([
        { ...source, id: "right", mediaStart: 45 },
        { ...source, id: "left", mediaEnd: 45 },
    ], 120), false)
})
