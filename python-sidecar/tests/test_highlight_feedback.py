import unittest

from pipeline.highlight_feedback import summarize_highlight_feedback


class HighlightFeedbackSummaryTests(unittest.TestCase):
    def test_summarizes_candidate_funnel_and_clip_link_without_content(self):
        events = [
            {
                "schemaVersion": 1,
                "action": "shown",
                "candidateId": "a:candidate:0",
                "initialRange": {"start": 10, "end": 20},
            },
            {"schemaVersion": 1, "action": "previewed", "candidateId": "a:candidate:0"},
            {
                "schemaVersion": 1,
                "action": "adopted",
                "candidateId": "a:candidate:0",
                "clipId": "clip-1",
            },
            {
                "schemaVersion": 1,
                "action": "trimmed",
                "candidateId": "a:candidate:0",
                "initialRange": {"start": 10, "end": 20},
                "currentRange": {"start": 11.5, "end": 19},
            },
            {"schemaVersion": 1, "action": "exported", "clipId": "clip-1"},
        ]

        summary = summarize_highlight_feedback(events)

        self.assertEqual(summary["validEventCount"], 5)
        self.assertEqual(summary["finalDecisions"]["exported"], 1)
        self.assertEqual(summary["rates"]["acceptedPerShown"], 1.0)
        self.assertEqual(summary["rates"]["exportPerAccepted"], 1.0)
        self.assertEqual(summary["boundaryEdits"]["meanAbsoluteStartDeltaSeconds"], 1.5)
        self.assertEqual(summary["boundaryEdits"]["meanAbsoluteEndDeltaSeconds"], 1.0)

    def test_rejects_unknown_or_content_bearing_records(self):
        summary = summarize_highlight_feedback([
            {"schemaVersion": 1, "action": "shown", "candidateId": "safe"},
            {"schemaVersion": 1, "action": "shown", "sourcePath": "private.mp4"},
            {"schemaVersion": 2, "action": "shown"},
            {"schemaVersion": 1, "action": "unknown"},
        ])
        self.assertEqual(summary["validEventCount"], 1)
        self.assertEqual(summary["invalidEventCount"], 3)

    def test_uses_original_ai_range_and_only_the_latest_boundary(self):
        events = [
            {
                "schemaVersion": 1,
                "occurredAt": "2026-08-03T00:00:00Z",
                "action": "shown",
                "candidateId": "a:candidate:0",
                "initialRange": {"start": 10, "end": 20},
            },
            {
                "schemaVersion": 1,
                "occurredAt": "2026-08-03T00:00:01Z",
                "action": "adopted",
                "candidateId": "a:candidate:0",
                "clipId": "clip-1",
            },
            {
                "schemaVersion": 1,
                "occurredAt": "2026-08-03T00:00:02Z",
                "action": "trimmed",
                "candidateId": "a:candidate:0",
                "initialRange": {"start": 11, "end": 19},
                "currentRange": {"start": 12, "end": 22},
            },
            {
                "schemaVersion": 1,
                "occurredAt": "2026-08-03T00:00:03Z",
                "action": "exported",
                "clipId": "clip-1",
                "currentRange": {"start": 13, "end": 21},
            },
        ]
        summary = summarize_highlight_feedback(events)
        self.assertEqual(summary["boundaryEdits"]["sampleCount"], 1)
        self.assertEqual(summary["boundaryEdits"]["meanAbsoluteStartDeltaSeconds"], 3.0)
        self.assertEqual(summary["boundaryEdits"]["meanAbsoluteEndDeltaSeconds"], 1.0)

    def test_restored_candidate_is_not_counted_as_a_final_rejection(self):
        events = [
            {"schemaVersion": 1, "action": "shown", "candidateId": "safe"},
            {"schemaVersion": 1, "action": "rejected", "candidateId": "safe"},
            {"schemaVersion": 1, "action": "restored", "candidateId": "safe"},
        ]
        summary = summarize_highlight_feedback(events)
        self.assertEqual(summary["finalDecisions"]["rejected"], 0)
        self.assertEqual(summary["finalDecisions"]["undecided"], 1)

    def test_orphan_decisions_do_not_raise_shown_rates_above_one(self):
        summary = summarize_highlight_feedback([
            {"schemaVersion": 1, "action": "shown", "candidateId": "shown"},
            {"schemaVersion": 1, "action": "adopted", "candidateId": "shown"},
            {"schemaVersion": 1, "action": "adopted", "candidateId": "orphan-adopted"},
            {"schemaVersion": 1, "action": "rejected", "candidateId": "orphan-rejected"},
        ])

        self.assertEqual(summary["finalDecisions"]["adopted"], 2)
        self.assertEqual(summary["finalDecisions"]["rejected"], 1)
        self.assertEqual(summary["rates"]["acceptedPerShown"], 1.0)
        self.assertEqual(summary["rates"]["rejectionPerShown"], 0.0)

    def test_counts_manual_misses_and_candidate_coverage_without_content(self):
        summary = summarize_highlight_feedback([
            {
                "schemaVersion": 1,
                "action": "missed",
                "category": "comedy",
                "currentRange": {"start": 20, "end": 30},
                "nearestCandidateIou": 0.1,
            },
            {
                "schemaVersion": 1,
                "action": "missed",
                "category": "victory",
                "currentRange": {"start": 40, "end": 50},
                "nearestCandidateIou": 0.7,
            },
        ])

        self.assertEqual(summary["missedHighlights"]["count"], 2)
        self.assertEqual(summary["missedHighlights"]["uncoveredCount"], 1)
        self.assertEqual(summary["missedHighlights"]["coverage"], 0.5)
        self.assertEqual(summary["missedHighlights"]["categories"]["comedy"], 1)


if __name__ == "__main__":
    unittest.main()
