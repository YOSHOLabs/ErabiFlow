"""同じ実動画ラベルに対する旧方式と新方式を比較するローカルCLI。"""

import argparse
import json
import sys
from pathlib import Path


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from pipeline.highlight_evaluation import compare_highlight_methods


def _load_ranges(path: Path, keys: tuple[str, ...]) -> list:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload
    for key in keys:
        if isinstance(payload, dict) and isinstance(payload.get(key), list):
            return payload[key]
    raise ValueError(f"区間配列が見つかりません: {path}")


def _load_optional(path: Path | None) -> dict:
    if path is None:
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, dict) else {}


def main() -> int:
    parser = argparse.ArgumentParser(description="ErabiFlowハイライト検出の新旧比較")
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--references", required=True, type=Path)
    parser.add_argument("--baseline-resources", type=Path)
    parser.add_argument("--candidate-resources", type=Path)
    parser.add_argument("--iou", type=float, default=0.30)
    parser.add_argument("--top-k", type=int, nargs="+", default=[5, 10])
    parser.add_argument("--min-references", type=int, default=10)
    parser.add_argument("--min-videos", type=int, default=3)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    comparison = compare_highlight_methods(
        _load_ranges(args.baseline, ("highlights", "recommendedCuts", "predictions")),
        _load_ranges(args.candidate, ("highlights", "recommendedCuts", "predictions")),
        _load_ranges(args.references, ("highlights", "references")),
        top_ks=tuple(args.top_k),
        iou_threshold=args.iou,
        baseline_resources=_load_optional(args.baseline_resources),
        candidate_resources=_load_optional(args.candidate_resources),
        min_reference_count=args.min_references,
        min_video_count=args.min_videos,
    )
    rendered = json.dumps(comparison, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0 if comparison["release_gate"]["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
