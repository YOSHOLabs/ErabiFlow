import sys
import unittest
from pathlib import Path


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from pipeline.analysis_response import build_daemon_analysis_result


class AnalysisResponseTests(unittest.TestCase):
    def test_maps_new_signal_and_score_fields_without_renaming_cut_entries(self) -> None:
        score_details = {
            "event": 80.0,
            "reaction": 70.0,
            "clipability": 75.0,
            "confidence": 0.8,
        }
        result = build_daemon_analysis_result({
            "status": "success",
            "recommendedCuts": [{
                "start": 1.0,
                "end": 8.0,
                "scoreDetails": score_details,
                "evidence": ["audio", "visual_change"],
            }],
            "segments": [{"text": "テスト"}],
            "signalSummary": {
                "perceptualLoudness": True,
                "visualChange": False,
                "warnings": ["映像信号を取得できませんでした（RuntimeError）"],
            },
        }, 1.26)

        self.assertEqual(result["highlights"][0]["scoreDetails"], score_details)
        self.assertTrue(result["signal_summary"]["perceptualLoudness"])
        self.assertEqual(result["transcript_text"], "テスト")
        self.assertEqual(result["stats"]["processing_time_sec"], 1.3)

    def test_old_engine_response_keeps_optional_fields_empty(self) -> None:
        result = build_daemon_analysis_result({"recommendedCuts": [], "segments": []}, 0)

        self.assertEqual(result["signal_summary"], {})
        self.assertEqual(result["highlights"], [])


if __name__ == "__main__":
    unittest.main()
