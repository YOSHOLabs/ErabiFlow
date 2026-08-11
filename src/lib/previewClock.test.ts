import test from "node:test"
import assert from "node:assert/strict"
import {
    advancePreviewSequenceTime,
    hasReachedPreviewEnd,
    sequenceTimeFromPresentedMedia,
} from "./previewClock.ts"

test("gapと特殊再生のwall clockをclip境界で止める", () => {
    assert.equal(advancePreviewSequenceTime(1.5, 0.25, 2), 1.75)
    assert.equal(advancePreviewSequenceTime(1.9, 0.25, 2), 2)
    assert.equal(advancePreviewSequenceTime(Number.NaN, -1, 2), 0)
})

test("提示media時刻を速度込みのsequence時刻へ写像する", () => {
    assert.equal(sequenceTimeFromPresentedMedia({
        mediaTime: 14,
        mediaStart: 10,
        sequenceStart: 3,
        sequenceEnd: 8,
        speed: 2,
    }), 5)
    assert.equal(sequenceTimeFromPresentedMedia({
        mediaTime: 99,
        mediaStart: 10,
        sequenceStart: 3,
        sequenceEnd: 8,
        speed: 2,
    }), 8)
})

test("sequence終端を0秒素材を含めて判定する", () => {
    assert.equal(hasReachedPreviewEnd(5, 5), true)
    assert.equal(hasReachedPreviewEnd(0, 0), true)
    assert.equal(hasReachedPreviewEnd(4.99, 5), false)
})
