import sys
import unittest
from pathlib import Path


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from pipeline.highlight_scorer import HighlightScorer


def audio_result(duration=5.0):
    return {
        "energy_timeline": [],
        "pitch_timeline": [],
        "onsets": [],
        "high_energy_regions": [],
        "stats": {"duration": duration},
    }


def active_audio_result(
    duration=5.0,
    *,
    onsets=None,
    high_energy_regions=None,
    energy_timeline=None,
):
    return {
        "energy_timeline": energy_timeline or [],
        "pitch_timeline": [],
        "onsets": onsets or [],
        "high_energy_regions": high_energy_regions or [],
        "stats": {"duration": duration},
    }


class HighlightScorerTests(unittest.TestCase):
    def test_auto_language_uses_detected_japanese(self) -> None:
        transcript = {
            "language": "ja",
            "segments": [{"start": 0.0, "end": 2.0, "text": "うわ、やばい、ナイス！"}],
        }

        result = HighlightScorer().score(
            transcript,
            audio_result(),
            language="auto",
        )

        self.assertGreater(result[0]["score_breakdown"]["exclamation"], 0)
        self.assertIn("感嘆詞検出", result[0]["reasons"])

    def test_default_scorer_never_calls_external_sentiment_service(self) -> None:
        transcript = {
            "language": "ja",
            "segments": [{"start": 0.0, "end": 2.0, "text": "かなり緊迫した場面"}],
        }

        result = HighlightScorer().score(transcript, audio_result())

        self.assertEqual(result[0]["score_breakdown"]["sentiment"], 0.0)

    def test_routine_callouts_are_not_treated_as_exclamations(self) -> None:
        transcript = {
            "language": "ja",
            "segments": [{"start": 0.0, "end": 2.0, "text": "敵ここ、回復してカバー"}],
        }

        result = HighlightScorer().score(transcript, audio_result())

        self.assertEqual(result[0]["score_breakdown"]["exclamation"], 0.0)

    def test_injected_sentiment_analyzer_is_clamped_and_cached(self) -> None:
        calls = []

        def analyzer(text):
            calls.append(text)
            return 1.5

        scorer = HighlightScorer(sentiment_analyzer=analyzer)

        self.assertEqual(scorer._score_sentiment("ナイスプレイ"), 1.0)
        self.assertEqual(scorer._score_sentiment("ナイスプレイ"), 1.0)
        self.assertEqual(calls, ["ナイスプレイ"])

    def test_separated_voice_arousal_is_scored(self) -> None:
        transcript = {"language": "ja", "segments": []}
        voice_audio = active_audio_result(
            onsets=[1.5],
            high_energy_regions=[(1.0, 4.0, -5.0)],
            energy_timeline=[
                (0.0, -55.0),
                (1.0, -30.0),
                (2.0, -12.0),
                (3.0, -10.0),
                (4.0, -20.0),
            ],
        )

        result = HighlightScorer().score(
            transcript,
            audio_result(),
            voice_audio_result=voice_audio,
        )

        self.assertGreater(result[0]["score_breakdown"]["voice_arousal"], 0.5)
        self.assertIn("実況音声の高揚", result[0]["reasons"])

    def test_game_event_and_voice_reaction_are_scored_together(self) -> None:
        transcript = {"language": "ja", "segments": []}
        game_audio = active_audio_result(onsets=[1.0])
        voice_audio = active_audio_result(
            onsets=[1.6],
            energy_timeline=[(0.0, -50.0), (1.6, -20.0)],
        )

        result = HighlightScorer().score(
            transcript,
            game_audio,
            voice_audio_result=voice_audio,
        )

        self.assertEqual(result[0]["score_breakdown"]["reaction_coincidence"], 0.5)
        self.assertIn("ゲーム音と声の反応一致", result[0]["reasons"])
        self.assertEqual(result[0]["audio_peaks"], [1.0, 1.6])
        self.assertGreater(result[0]["score_axes"]["reaction"], 0.0)
        self.assertIn("separate_voice", result[0]["available_evidence"])

    def test_distant_voice_reaction_is_not_counted(self) -> None:
        scorer = HighlightScorer()

        score = scorer._score_reaction_coincidence(
            0.0,
            10.0,
            [1.0],
            [],
            [5.0],
            [],
        )

        self.assertEqual(score, 0.0)

    def test_video_normalization_boosts_only_a_clear_relative_outlier(self) -> None:
        scored = [
            {"start": 0.0, "end": 5.0, "excitement_score": 10.0, "reasons": []},
            {"start": 5.0, "end": 10.0, "excitement_score": 20.0, "reasons": []},
            {"start": 10.0, "end": 15.0, "excitement_score": 60.0, "reasons": []},
        ]

        normalized = HighlightScorer().normalize_video_scores(scored)

        self.assertEqual(normalized[0]["raw_excitement_score"], 60.0)
        self.assertEqual(normalized[0]["relative_percentile"], 100.0)
        self.assertGreater(normalized[0]["excitement_score"], 60.0)
        self.assertIn("動画内で相対的に突出", normalized[0]["reasons"])
        self.assertNotIn("raw_excitement_score", scored[0])

    def test_video_normalization_does_not_invent_signal_for_flat_scores(self) -> None:
        scored = [
            {"start": 0.0, "end": 5.0, "excitement_score": 10.0},
            {"start": 5.0, "end": 10.0, "excitement_score": 10.0},
        ]

        normalized = HighlightScorer().normalize_video_scores(scored)

        self.assertEqual([item["excitement_score"] for item in normalized], [10.0, 10.0])
        self.assertEqual([item["relative_percentile"] for item in normalized], [50.0, 50.0])

    def test_media_signals_enrich_event_axis_and_add_multiscale_scores(self) -> None:
        scored = [
            {
                "start": 0.0,
                "end": 5.0,
                "excitement_score": 20.0,
                "score_axes": {"event": 20.0, "reaction": 0.0, "clipability": 10.0, "confidence": 0.45},
                "reasons": [],
                "available_evidence": ["audio"],
            },
            {
                "start": 5.0,
                "end": 10.0,
                "excitement_score": 20.0,
                "score_axes": {"event": 20.0, "reaction": 0.0, "clipability": 10.0, "confidence": 0.45},
                "reasons": [],
                "available_evidence": ["audio"],
            },
            {
                "start": 10.0,
                "end": 15.0,
                "excitement_score": 20.0,
                "score_axes": {"event": 20.0, "reaction": 0.0, "clipability": 10.0, "confidence": 0.45},
                "reasons": [],
                "available_evidence": ["audio"],
            },
        ]
        signals = {
            "audio_loudness": [
                {"time": 2.0, "momentary": -35.0},
                {"time": 7.0, "momentary": -34.0},
                {"time": 12.0, "momentary": -8.0},
            ],
            "video_frames": [
                {"time": 2.0, "scene_score": 0.2, "luma": 45.0, "luma_diff": 1.0},
                {"time": 7.0, "scene_score": 0.3, "luma": 48.0, "luma_diff": 1.0},
                {"time": 12.0, "scene_score": 13.0, "luma": 210.0, "luma_diff": 30.0},
            ],
        }

        enriched = HighlightScorer().enrich_video_segments(scored, signals)
        standout = next(item for item in enriched if item["start"] == 10.0)

        self.assertGreater(standout["score_axes"]["event"], 20.0)
        self.assertIn("知覚音量が動画内で突出", standout["reasons"])
        self.assertIn("medium", standout["multiscale_scores"])
        self.assertIn("visual_change", standout["available_evidence"])
        self.assertTrue(all(item["excitement_score"] >= 20.0 for item in enriched))

    def test_flat_media_signals_do_not_create_relative_prominence(self) -> None:
        prominence = HighlightScorer()._robust_prominence([-20.0, -20.0, -20.0])

        self.assertEqual(prominence, [0.0, 0.0, 0.0])

    def test_peak_extraction_keeps_separate_events_and_context_boundaries(self) -> None:
        def segment(start, end, score):
            return {
                "start": start,
                "end": end,
                "excitement_score": score,
                "score_axes": {"event": score, "reaction": 20.0, "clipability": 50.0, "confidence": 0.8},
                "reasons": [f"peak-{start}"],
                "transcript_text": "",
                "audio_peaks": [start + 1.0],
            }

        scored = [
            segment(10.0, 15.0, 85.0),
            segment(12.5, 17.5, 60.0),
            segment(30.0, 35.0, 78.0),
            segment(32.5, 37.5, 55.0),
        ]
        transcript = [
            {"start": 8.0, "end": 10.5, "text": "来るぞ"},
            {"start": 16.0, "end": 18.0, "text": "やった"},
            {"start": 28.5, "end": 31.0, "text": "もう一回"},
        ]

        highlights = HighlightScorer().extract_peak_highlights(
            scored,
            threshold=25.0,
            max_clips=10,
            transcript_segments=transcript,
            video_duration=60.0,
        )

        self.assertEqual(len(highlights), 2)
        first = next(item for item in highlights if item["excitement_score"] == 85.0)
        self.assertLessEqual(first["start"], 8.0)
        self.assertGreaterEqual(first["end"], 18.0)
        self.assertIn("来るぞ", first["transcript_text"])
        self.assertLessEqual(first["end"] - first["start"], 45.0)

    def test_flat_high_score_band_becomes_one_candidate(self) -> None:
        scored = [
            {
                "start": index * 2.5,
                "end": index * 2.5 + 5.0,
                "excitement_score": 70.0,
                "score_axes": {"event": 70.0, "reaction": 20.0, "clipability": 50.0, "confidence": 0.8},
                "reasons": ["flat"],
            }
            for index in range(24)
        ]

        highlights = HighlightScorer().extract_peak_highlights(
            scored,
            threshold=25.0,
            max_clips=10,
            video_duration=70.0,
        )

        self.assertEqual(len(highlights), 1)

    def test_boundary_snap_keeps_speech_outside_default_roll(self) -> None:
        scored = [{
            "start": 10.0,
            "end": 15.0,
            "excitement_score": 80.0,
            "score_axes": {"event": 80.0, "reaction": 70.0, "clipability": 80.0, "confidence": 0.9},
            "reasons": ["peak"],
        }]
        transcript = [
            {"start": 6.0, "end": 10.5, "text": "前の文脈"},
            {"start": 14.0, "end": 21.0, "text": "後の反応"},
        ]

        highlight = HighlightScorer().extract_peak_highlights(
            scored,
            threshold=25.0,
            max_clips=1,
            transcript_segments=transcript,
            media_signals={"scene_changes": [9.0, 16.0]},
            video_duration=60.0,
        )[0]

        self.assertEqual(highlight["start"], 6.0)
        self.assertEqual(highlight["end"], 21.0)

    def test_candidate_at_video_end_backfills_minimum_duration(self) -> None:
        highlight = HighlightScorer().extract_peak_highlights(
            [{
                "start": 58.0,
                "end": 60.0,
                "excitement_score": 90.0,
                "score_axes": {
                    "event": 90.0,
                    "reaction": 80.0,
                    "clipability": 90.0,
                    "confidence": 0.95,
                },
                "reasons": ["ending peak"],
            }],
            threshold=25.0,
            max_clips=1,
            video_duration=60.0,
            min_duration=6.0,
        )[0]

        self.assertEqual(highlight["start"], 54.0)
        self.assertEqual(highlight["end"], 60.0)

    def test_low_confidence_single_signal_candidate_is_suppressed_but_strong_peak_remains(self) -> None:
        def candidate(start, score):
            return {
                "start": start,
                "end": start + 5.0,
                "excitement_score": score,
                "score_axes": {"event": 65.0, "reaction": 0.0, "clipability": 10.0, "confidence": 0.2},
                "media_breakdown": {"loudness_prominence": 0.0, "scene_change": 0.0, "visual_change": 0.0},
                "reasons": ["energy"],
                "transcript_text": "",
            }

        result = HighlightScorer().extract_peak_highlights(
            [candidate(0.0, 70.0), candidate(30.0, 90.0)],
            threshold=25.0,
            max_clips=5,
            video_duration=60.0,
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["excitement_score"], 90.0)
        self.assertGreaterEqual(result[0]["false_positive_risk"], 0.75)

    def test_all_low_confidence_single_signal_candidates_can_produce_no_highlight(self) -> None:
        result = HighlightScorer().extract_peak_highlights(
            [{
                "start": 0.0,
                "end": 5.0,
                "excitement_score": 70.0,
                "score_axes": {"event": 65.0, "reaction": 0.0, "clipability": 10.0, "confidence": 0.2},
                "media_breakdown": {"loudness_prominence": 0.0, "scene_change": 0.0, "visual_change": 0.0},
                "reasons": ["energy"],
                "transcript_text": "",
            }],
            threshold=25.0,
            max_clips=5,
            video_duration=60.0,
        )

        self.assertEqual(result, [])

    def test_diversity_prefers_a_different_category_and_time_bucket(self) -> None:
        candidates = [
            {"start": 5, "end": 15, "excitement_score": 90, "transcript_text": "勝った"},
            {"start": 18, "end": 28, "excitement_score": 89, "transcript_text": "また勝った"},
            {"start": 80, "end": 90, "excitement_score": 86, "transcript_text": "爆笑した"},
        ]

        selected = HighlightScorer._select_diverse_candidates(candidates, 2, 100)

        self.assertEqual([item["excitement_score"] for item in selected], [90, 86])
        self.assertEqual(selected[1]["candidate_category"], "comedy")

    def test_duration_variants_keep_words_that_cross_the_target_boundary(self) -> None:
        variants = HighlightScorer._duration_variants(
            20.0,
            [
                {"start": 13.0, "end": 15.0, "text": "前置き"},
                {"start": 28.0, "end": 31.0, "text": "リアクション"},
            ],
            100.0,
        )

        self.assertEqual(variants["15"], {"start": 13.0, "end": 31.0})
        self.assertEqual(variants["30"]["start"], 8.0)

    def test_linear_window_scores_match_brute_force(self) -> None:
        values = [0.1, 0.8, 0.2, 0.6]
        centers = [1.0, 3.5, 6.0, 8.5]
        actual = HighlightScorer()._window_peak_mean(values, centers, 3.0)
        expected = []
        for center in centers:
            neighbors = [value for value, other in zip(values, centers) if abs(other - center) <= 3.0]
            expected.append(max(neighbors) * 0.55 + (sum(neighbors) / len(neighbors)) * 0.45)

        for left, right in zip(actual, expected):
            self.assertAlmostEqual(left, right)

    def test_merge_preserves_reason_order_and_deduplicates_peaks(self) -> None:
        scored = [
            {
                "start": 0.0,
                "end": 5.0,
                "excitement_score": 80.0,
                "reasons": ["高音声エネルギー", "感嘆詞検出"],
                "transcript_text": "ナイス",
                "audio_peaks": [1.0, 2.0],
            },
            {
                "start": 4.0,
                "end": 9.0,
                "excitement_score": 70.0,
                "reasons": ["感嘆詞検出", "急激な音量変化"],
                "transcript_text": "ナイス いける",
                "audio_peaks": [2.0, 6.0],
            },
        ]

        merged = HighlightScorer().get_highlight_segments(scored, threshold=0)

        self.assertEqual(
            merged[0]["reasons"],
            ["高音声エネルギー", "感嘆詞検出", "急激な音量変化"],
        )
        self.assertEqual(merged[0]["transcript_text"], "ナイス いける")
        self.assertEqual(merged[0]["audio_peaks"], [1.0, 2.0, 6.0])


if __name__ == "__main__":
    unittest.main()
