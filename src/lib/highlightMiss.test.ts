import assert from "node:assert/strict"
import test from "node:test"
import { missedHighlightRangeFromSequence, nearestHighlightIou, normalizeMissedHighlightRange, temporalIou } from "./highlightMiss.ts"

test("見逃し範囲は前後を入れ替えても動画内の有効範囲になる", () => {
    assert.deepEqual(normalizeMissedHighlightRange(18, 10, 20), { start: 10, end: 18 })
    assert.equal(normalizeMissedHighlightRange(10, 11, 20), null)
    assert.deepEqual(normalizeMissedHighlightRange(-5, 30, 20), { start: 0, end: 20 })
})

test("見逃し範囲と最も近いAI候補の時間IoUを返す", () => {
    const range = { start: 10, end: 20 }
    assert.equal(temporalIou(range, { start: 15, end: 25 }), 1 / 3)
    assert.equal(nearestHighlightIou(range, [
        { start: 0, end: 5, label: "a", reason: "", excitement: 1 },
        { start: 11, end: 19, label: "b", reason: "", excitement: 1 },
    ]), 0.8)
})

test("同じ編集クリップの終端はfallbackせず元動画区間へ変換する", () => {
    assert.deepEqual(missedHighlightRangeFromSequence([
        { id: "trimmed", mediaStart: 100, mediaEnd: 110 },
    ], 0, 10, 200), { start: 100, end: 110 })
})

test("Gapまたは別クリップをまたぐ見逃し範囲は単一の元動画区間にしない", () => {
    const clips = [
        { id: "later", mediaStart: 100, mediaEnd: 110 },
        { id: "gap", isGap: true, mediaStart: 3, mediaEnd: 0 },
        { id: "earlier", mediaStart: 10, mediaEnd: 20 },
    ]
    assert.equal(missedHighlightRangeFromSequence(clips, 2, 15, 200), null)
    assert.equal(missedHighlightRangeFromSequence(clips, 10.5, 12, 200), null)
})
