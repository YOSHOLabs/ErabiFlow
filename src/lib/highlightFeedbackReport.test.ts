import assert from "node:assert/strict"
import test from "node:test"
import { createHighlightFeedbackCsv, serializeHighlightFeedbackSummary } from "./highlightFeedbackReport.ts"

const summary = {
    schemaVersion: 1 as const,
    validEventCount: 10,
    invalidLineCount: 0,
    shownCandidates: 4,
    adoptedCandidates: 1,
    rejectedCandidates: 1,
    exportedCandidates: 1,
    missedRanges: 2,
    uncoveredMissedRanges: 1,
    acceptedPerShown: 0.5,
    rejectionPerShown: 0.25,
    exportPerAccepted: 0.5,
    missedCoverage: 0.5,
    boundaryEdits: { sampleCount: 1, meanStartDeltaSeconds: 1.2, meanEndDeltaSeconds: 0.8 },
    categoryCounts: { comedy: 2 },
}

test("ローカル評価を内容データなしのJSONとCSVへ書き出す", () => {
    assert.equal(JSON.parse(serializeHighlightFeedbackSummary(summary)).missedRanges, 2)
    const csv = createHighlightFeedbackCsv(summary)
    assert.match(csv, /accepted_per_shown,0.5/)
    assert.match(csv, /category_comedy,2/)
    assert.doesNotMatch(csv, /subtitle|sourcePath|transcript/)
})
