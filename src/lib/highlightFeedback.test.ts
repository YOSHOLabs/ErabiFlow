import test from "node:test"
import assert from "node:assert/strict"
import { createHighlightFeedbackEvent, shouldRecordHighlightShown } from "./highlightFeedbackEvent.ts"

test("Freeのロック候補をshownとして数えずCreatorで利用可能になってから数える", () => {
    const creatorCandidate = { isProRequired: true }

    assert.equal(shouldRecordHighlightShown(creatorCandidate, false), false)
    assert.equal(shouldRecordHighlightShown(creatorCandidate, true), true)
    assert.equal(shouldRecordHighlightShown({}, false), true)
})

test("編集学習イベントは非コンテンツ項目だけを保持し、範囲とスコアを正規化する", () => {
        const event = createHighlightFeedbackEvent({
            action: "trimmed",
            eventId: "event-1",
            occurredAt: "2026-08-03T00:00:00.000Z",
            analysisId: "analysis-1",
            candidateId: "analysis-1:candidate:2",
            clipId: "clip-1",
            candidateIndex: 2,
            analysisMode: "fast",
            initialRange: { start: -1, end: 4.1238 },
            currentRange: { start: 8, end: 7 },
            scoreDetails: { event: 120, reaction: -2, clipability: 82.5, confidence: 2 },
        })

        assert.deepEqual(event, {
            schemaVersion: 1,
            eventId: "event-1",
            occurredAt: "2026-08-03T00:00:00.000Z",
            action: "trimmed",
            analysisId: "analysis-1",
            candidateId: "analysis-1:candidate:2",
            clipId: "clip-1",
            candidateIndex: 2,
            analysisMode: "fast",
            initialRange: { start: 0, end: 4.124 },
            currentRange: { start: 8, end: 8 },
            scoreDetails: { event: 100, reaction: 0, clipability: 82.5, confidence: 1 },
        })
        assert.doesNotMatch(JSON.stringify(event), /path|subtitle|label|reason|transcript/i)
})

test("編集学習イベントは不正な候補番号を落とし非有限数を正規化する", () => {
        const event = createHighlightFeedbackEvent({
            action: "shown",
            eventId: "event-2",
            occurredAt: "2026-08-03T00:00:00.000Z",
            candidateIndex: -1,
            currentRange: { start: Number.NaN, end: Number.POSITIVE_INFINITY },
        })
        assert.equal(event.candidateIndex, undefined)
        assert.deepEqual(event.currentRange, { start: 0, end: 0 })
})

test("見逃しイベントはカテゴリと最寄り候補IoUだけを安全に保持する", () => {
        const event = createHighlightFeedbackEvent({
            action: "missed",
            eventId: "event-missed",
            occurredAt: "2026-08-03T00:00:00.000Z",
            analysisId: "analysis-1",
            currentRange: { start: 42.1237, end: 57.9874 },
            category: "comedy",
            nearestCandidateIou: 1.8,
        })

        assert.deepEqual(event.currentRange, { start: 42.124, end: 57.987 })
        assert.equal(event.category, "comedy")
        assert.equal(event.nearestCandidateIou, 1)
        assert.doesNotMatch(JSON.stringify(event), /path|subtitle|label|reason|transcript/i)
})
