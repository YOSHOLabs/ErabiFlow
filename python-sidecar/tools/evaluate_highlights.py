"""保存した解析結果と正解区間JSONを比較する開発用CLI。"""

import argparse
import json
import sys
from pathlib import Path


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from pipeline.highlight_evaluation import evaluate_highlights


def _load_ranges(path: Path, keys: tuple[str, ...]) -> list:
    with path.open("r", encoding="utf-8") as source:
        payload = json.load(source)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return value
    raise ValueError(f"区間配列が見つかりません: {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="TateClipハイライト候補の時間区間評価")
    parser.add_argument("--predictions", required=True, type=Path)
    parser.add_argument("--references", required=True, type=Path)
    parser.add_argument("--iou", type=float, default=0.30)
    parser.add_argument("--top-k", type=int, nargs="+", default=[5, 10])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    predictions = _load_ranges(args.predictions, ("highlights", "recommendedCuts", "predictions"))
    references = _load_ranges(args.references, ("highlights", "references"))
    metrics = evaluate_highlights(
        predictions,
        references,
        top_ks=tuple(args.top_k),
        iou_threshold=args.iou,
    )
    rendered = json.dumps(metrics, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
