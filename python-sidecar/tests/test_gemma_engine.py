import sys
import unittest
from pathlib import Path


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from gemma_engine import caption_end_time, is_creator_only_candidate, normalize_candidate_strategy


class CaptionTimingTests(unittest.TestCase):
    def test_candidate_strategy_requires_explicit_peak_opt_in(self) -> None:
        self.assertEqual(normalize_candidate_strategy(None), "legacy")
        self.assertEqual(normalize_candidate_strategy("unexpected"), "legacy")
        self.assertEqual(normalize_candidate_strategy("PEAK"), "peak")

    def test_free_candidate_boundary_matches_top_five_contract(self) -> None:
        self.assertFalse(is_creator_only_candidate(4))
        self.assertTrue(is_creator_only_candidate(5))

    def test_short_caption_does_not_remain_for_a_long_whisper_segment(self) -> None:
        self.assertAlmostEqual(caption_end_time(10.0, 18.0, "スパイ"), 11.34)

    def test_real_short_segment_keeps_its_detected_end(self) -> None:
        self.assertAlmostEqual(caption_end_time(2.0, 2.8, "ナイス"), 2.8)

    def test_minimum_display_time_is_preserved(self) -> None:
        self.assertAlmostEqual(caption_end_time(3.0, 3.05, "はい"), 3.2)


if __name__ == "__main__":
    unittest.main()
