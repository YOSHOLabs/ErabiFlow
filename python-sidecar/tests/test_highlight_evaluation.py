import sys
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from pipeline.highlight_evaluation import compare_highlight_methods, evaluate_highlights, temporal_iou
from tools.compare_highlight_runs import main as compare_highlight_runs_main


class HighlightEvaluationTests(unittest.TestCase):
    def test_cli_defaults_require_three_videos_and_ten_references(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline_path = root / "baseline.json"
            candidate_path = root / "candidate.json"
            references_path = root / "references.json"
            output_path = root / "result.json"
            baseline_path.write_text("[]", encoding="utf-8")

            def run(reference_count: int, video_count: int) -> tuple[int, dict]:
                references = [
                    {
                        "video_id": f"video-{index % video_count}",
                        "start": float(index * 20),
                        "end": float(index * 20 + 10),
                    }
                    for index in range(reference_count)
                ]
                references_path.write_text(json.dumps(references), encoding="utf-8")
                candidate_path.write_text(json.dumps(references), encoding="utf-8")
                argv = [
                    "compare_highlight_runs.py",
                    "--baseline", str(baseline_path),
                    "--candidate", str(candidate_path),
                    "--references", str(references_path),
                    "--output", str(output_path),
                ]
                with patch.object(sys, "argv", argv):
                    exit_code = compare_highlight_runs_main()
                return exit_code, json.loads(output_path.read_text(encoding="utf-8"))

            insufficient_exit, insufficient = run(9, 2)
            self.assertEqual(insufficient_exit, 2)
            self.assertEqual(insufficient["release_gate"]["status"], "insufficient_data")
            self.assertEqual(insufficient["release_gate"]["data_requirements"]["reference_count"]["minimum"], 10)
            self.assertEqual(insufficient["release_gate"]["data_requirements"]["video_count"]["minimum"], 3)

            sufficient_exit, sufficient = run(10, 3)
            self.assertEqual(sufficient_exit, 0)
            self.assertEqual(sufficient["release_gate"]["status"], "passed")

    def test_compare_uses_default_top_k_when_empty(self):
        result = compare_highlight_methods([], [], [], top_ks=())

        self.assertIn("5", result["baseline"]["top_k"])
        self.assertIn("10", result["candidate"]["top_k"])
        self.assertFalse(result["release_gate"]["passed"])
        self.assertEqual(result["release_gate"]["status"], "insufficient_data")

    def test_temporal_iou_handles_partial_overlap(self) -> None:
        self.assertAlmostEqual(
            temporal_iou({"start": 0.0, "end": 10.0}, {"start": 5.0, "end": 15.0}),
            1.0 / 3.0,
        )

    def test_non_finite_ranges_and_scores_are_ignored(self) -> None:
        predictions = [
            {"start": float("nan"), "end": 10.0, "score": 100},
            {"start": 0.0, "end": float("inf"), "score": 100},
            {"start": 20.0, "end": 30.0, "score": float("nan")},
            {"start": 0.0, "end": 10.0, "score": 1.0},
        ]

        metrics = evaluate_highlights(
            predictions,
            [{"start": 0.0, "end": 10.0}],
            top_ks=(1,),
        )

        self.assertEqual(metrics["prediction_count"], 2)
        self.assertEqual(metrics["top_k"]["1"]["matched"], 1)
        self.assertEqual(
            temporal_iou(
                {"start": 0.0, "end": float("inf")},
                {"start": 0.0, "end": 10.0},
            ),
            0.0,
        )

    def test_evaluation_reports_top_k_and_boundary_error(self) -> None:
        predictions = [
            {"start": 9.0, "end": 21.0, "excitement": 90},
            {"start": 40.0, "end": 50.0, "excitement": 80},
            {"start": 70.0, "end": 80.0, "excitement": 10},
        ]
        references = [
            {"start": 10.0, "end": 20.0},
            {"start": 39.0, "end": 51.0},
        ]

        metrics = evaluate_highlights(predictions, references, top_ks=(1, 2))

        self.assertEqual(metrics["top_k"]["1"]["matched"], 1)
        self.assertEqual(metrics["top_k"]["2"]["recall"], 1.0)
        self.assertEqual(metrics["boundary_mae_sec"], {"start": 1.0, "end": 1.0})

    def test_non_clip_worthy_reference_is_excluded(self) -> None:
        metrics = evaluate_highlights(
            [{"start": 0.0, "end": 10.0, "score": 1.0}],
            [{"start": 0.0, "end": 10.0, "clip_worthy": False}],
        )

        self.assertEqual(metrics["reference_count"], 0)
        self.assertEqual(metrics["top_k"]["5"]["recall"], 0.0)

    def test_matching_maximizes_count_before_iou(self) -> None:
        metrics = evaluate_highlights(
            [
                {"start": 0.0, "end": 14.0, "excitement_score": 90},
                {"start": 0.0, "end": 7.0, "excitement_score": 80},
            ],
            [
                {"start": 0.0, "end": 10.0},
                {"start": 8.0, "end": 18.0},
            ],
            top_ks=(2,),
            iou_threshold=0.3,
        )

        self.assertEqual(metrics["top_k"]["2"]["matched"], 2)
        self.assertEqual(metrics["top_k"]["2"]["recall"], 1.0)

    def test_prediction_sorting_uses_available_score_key(self) -> None:
        metrics = evaluate_highlights(
            [
                {"start": 20.0, "end": 30.0, "excitement_score": 10},
                {"start": 0.0, "end": 10.0, "excitement_score": 90},
            ],
            [{"start": 0.0, "end": 10.0}],
            top_ks=(1,),
        )

        self.assertEqual(metrics["top_k"]["1"]["matched"], 1)

    def test_ranges_from_different_videos_never_match(self) -> None:
        metrics = evaluate_highlights(
            [{"video_id": "video-a", "start": 0.0, "end": 10.0, "score": 1.0}],
            [{"video_id": "video-b", "start": 0.0, "end": 10.0}],
            top_ks=(1,),
        )

        self.assertEqual(metrics["matched_count"], 0)
        self.assertEqual(metrics["video_count"], 1)

    def test_method_comparison_reports_deltas_resources_and_release_gate(self) -> None:
        references = [{"start": 10.0, "end": 20.0}]
        comparison = compare_highlight_methods(
            [{"start": 0.0, "end": 5.0, "score": 90}],
            [{"start": 10.0, "end": 20.0, "score": 90}],
            references,
            top_ks=(1,),
            baseline_resources={"processing_time_sec": 10},
            candidate_resources={"processing_time_sec": 12},
        )

        self.assertTrue(comparison["release_gate"]["passed"])
        self.assertGreater(comparison["delta"]["top_recall"], 0)
        self.assertEqual(comparison["resources"]["candidate"]["processing_time_sec"], 12)


if __name__ == "__main__":
    unittest.main()
