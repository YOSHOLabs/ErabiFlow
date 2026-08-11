import assert from "node:assert/strict"
import test from "node:test"
import {
    highlightCandidateClipPrefix,
    highlightCandidateId,
    isHighlightCandidateClipId,
    parseHighlightCandidateClipId,
} from "./highlightCandidateClip.ts"

test("AI候補クリップは解析と候補番号を含む専用IDで識別する", () => {
    assert.equal(highlightCandidateId("analysis-1", 2), "analysis-1:candidate:2")
    assert.equal(highlightCandidateClipPrefix("analysis-1", 2), "analysis-1:candidate:2:clip:")
    assert.equal(isHighlightCandidateClipId("analysis-1:candidate:2:clip:uuid", "analysis-1", 2), true)
    assert.deepEqual(parseHighlightCandidateClipId("analysis-1:candidate:2:clip:uuid"), {
        analysisId: "analysis-1",
        candidateId: "analysis-1:candidate:2",
        candidateIndex: 2,
    })
})

test("同じ時間範囲を持ち得る手動クリップや別候補をAI候補として扱わない", () => {
    assert.equal(isHighlightCandidateClipId("manual-clip", "analysis-1", 2), false)
    assert.equal(isHighlightCandidateClipId("analysis-1:candidate:1:clip:uuid", "analysis-1", 2), false)
    assert.equal(isHighlightCandidateClipId("analysis-2:candidate:2:clip:uuid", "analysis-1", 2), false)
    assert.equal(parseHighlightCandidateClipId("manual-clip"), null)
})
