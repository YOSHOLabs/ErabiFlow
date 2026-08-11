"""ハイライト候補を時間区間の正解データと比較する純粋ロジック。"""

from __future__ import annotations

from collections import defaultdict
import math
from typing import Iterable


def temporal_iou(first: dict, second: dict) -> float:
    try:
        first_start = float(first.get("start", 0.0))
        first_end = float(first.get("end", first_start))
        second_start = float(second.get("start", 0.0))
        second_end = float(second.get("end", second_start))
    except (TypeError, ValueError):
        return 0.0
    if not all(math.isfinite(value) for value in (first_start, first_end, second_start, second_end)):
        return 0.0
    if first_end <= first_start or second_end <= second_start:
        return 0.0

    intersection = max(0.0, min(first_end, second_end) - max(first_start, second_start))
    union = max(first_end, second_end) - min(first_start, second_start)
    return intersection / union if union > 0 else 0.0


def _valid_ranges(items: Iterable[dict], *, references: bool = False) -> list[dict]:
    result = []
    for item in items or []:
        if references and item.get("clip_worthy", item.get("clipWorthy", True)) is False:
            continue
        try:
            start = float(item.get("start", 0.0))
            end = float(item.get("end", start))
        except (TypeError, ValueError):
            continue
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            continue
        normalized = dict(item)
        normalized["start"] = start
        normalized["end"] = end
        raw_video_id = item.get("video_id", item.get("videoId"))
        normalized["video_id"] = str(raw_video_id).strip() if raw_video_id is not None else "__single__"
        if not normalized["video_id"]:
            normalized["video_id"] = "__single__"
        result.append(normalized)
    return result


def _prediction_score(item: dict) -> float:
    for key in ("excitement", "excitement_score", "score"):
        if key not in item or item[key] is None:
            continue
        try:
            value = float(item[key])
        except (TypeError, ValueError):
            continue
        if math.isfinite(value):
            return value
    return 0.0


def _optimal_matches(predictions: list[dict], references: list[dict], threshold: float) -> list[tuple]:
    """一致数を最大化し、その範囲でIoU合計が最大の1対1割当を返す。"""
    prediction_count = len(predictions)
    reference_count = len(references)
    source = 0
    prediction_offset = 1
    reference_offset = prediction_offset + prediction_count
    sink = reference_offset + reference_count
    graph: list[list[dict]] = [[] for _ in range(sink + 1)]

    def add_edge(start: int, end: int, capacity: int, cost: float, match=None) -> None:
        forward = {
            "to": end,
            "reverse": len(graph[end]),
            "capacity": capacity,
            "cost": cost,
            "match": match,
        }
        backward = {
            "to": start,
            "reverse": len(graph[start]),
            "capacity": 0,
            "cost": -cost,
            "match": None,
        }
        graph[start].append(forward)
        graph[end].append(backward)

    for prediction_index in range(prediction_count):
        add_edge(source, prediction_offset + prediction_index, 1, 0.0)
    for reference_index in range(reference_count):
        add_edge(reference_offset + reference_index, sink, 1, 0.0)
    for prediction_index, prediction in enumerate(predictions):
        for reference_index, reference in enumerate(references):
            overlap = temporal_iou(prediction, reference)
            if overlap >= threshold:
                # 2点の基礎利得で一致数を優先し、端数のIoUで同数時の品質を選ぶ。
                add_edge(
                    prediction_offset + prediction_index,
                    reference_offset + reference_index,
                    1,
                    -(2.0 + overlap),
                    (prediction_index, reference_index, overlap),
                )

    node_count = len(graph)
    while True:
        distances = [float("inf")] * node_count
        previous: list[tuple[int, int] | None] = [None] * node_count
        distances[source] = 0.0

        # 負コストの残余辺を含むため、各増加路はBellman-Fordで求める。
        for _ in range(node_count - 1):
            changed = False
            for node, edges in enumerate(graph):
                if distances[node] == float("inf"):
                    continue
                for edge_index, edge in enumerate(edges):
                    if edge["capacity"] <= 0:
                        continue
                    next_distance = distances[node] + edge["cost"]
                    if next_distance + 1e-12 < distances[edge["to"]]:
                        distances[edge["to"]] = next_distance
                        previous[edge["to"]] = (node, edge_index)
                        changed = True
            if not changed:
                break

        if previous[sink] is None:
            break
        node = sink
        while node != source:
            previous_node, edge_index = previous[node]
            edge = graph[previous_node][edge_index]
            edge["capacity"] -= 1
            graph[node][edge["reverse"]]["capacity"] += 1
            node = previous_node

    matches = []
    for prediction_index in range(prediction_count):
        node = prediction_offset + prediction_index
        for edge in graph[node]:
            if edge.get("match") is not None and edge["capacity"] == 0:
                matches.append(edge["match"])
    return matches


def evaluate_highlights(
    predictions: Iterable[dict],
    references: Iterable[dict],
    *,
    top_ks: tuple[int, ...] = (5, 10),
    iou_threshold: float = 0.30,
) -> dict:
    """Top-K精度・再現率、区間IoU、開始終了誤差を返す。"""
    normalized_predictions = _valid_ranges(predictions)
    normalized_references = _valid_ranges(references, references=True)
    threshold = min(1.0, max(0.0, float(iou_threshold)))
    prediction_groups: dict[str, list[dict]] = defaultdict(list)
    reference_groups: dict[str, list[dict]] = defaultdict(list)
    for prediction in normalized_predictions:
        prediction_groups[prediction["video_id"]].append(prediction)
    for reference in normalized_references:
        reference_groups[reference["video_id"]].append(reference)
    for values in prediction_groups.values():
        values.sort(key=_prediction_score, reverse=True)
    video_ids = set(prediction_groups) | set(reference_groups)

    top_k_metrics = {}
    for top_k in sorted(set(max(1, int(value)) for value in top_ks)):
        matched = 0
        denominator = 0
        for video_id in video_ids:
            selected = prediction_groups[video_id][:top_k]
            denominator += len(selected)
            matched += len(_optimal_matches(selected, reference_groups[video_id], threshold))
        top_k_metrics[str(top_k)] = {
            "matched": matched,
            "precision": round(matched / denominator, 4) if denominator else 0.0,
            "recall": round(matched / len(normalized_references), 4)
            if normalized_references else 0.0,
        }

    overlaps = []
    start_errors = []
    end_errors = []
    best_ious = []
    for video_id in video_ids:
        video_predictions = prediction_groups[video_id]
        video_references = reference_groups[video_id]
        for prediction_index, reference_index, overlap in _optimal_matches(
            video_predictions,
            video_references,
            threshold,
        ):
            prediction = video_predictions[prediction_index]
            reference = video_references[reference_index]
            overlaps.append(overlap)
            start_errors.append(abs(prediction["start"] - reference["start"]))
            end_errors.append(abs(prediction["end"] - reference["end"]))
        best_ious.extend(
            max((temporal_iou(reference, prediction) for prediction in video_predictions), default=0.0)
            for reference in video_references
        )
    return {
        "prediction_count": len(normalized_predictions),
        "reference_count": len(normalized_references),
        "video_count": len({item["video_id"] for item in normalized_references}),
        "iou_threshold": threshold,
        "top_k": top_k_metrics,
        "matched_count": len(overlaps),
        "mean_matched_iou": round(sum(overlaps) / len(overlaps), 4) if overlaps else 0.0,
        "mean_best_reference_iou": round(sum(best_ious) / len(best_ious), 4) if best_ious else 0.0,
        "boundary_mae_sec": {
            "start": round(sum(start_errors) / len(start_errors), 3) if start_errors else None,
            "end": round(sum(end_errors) / len(end_errors), 3) if end_errors else None,
        },
    }


def compare_highlight_methods(
    baseline_predictions: Iterable[dict],
    candidate_predictions: Iterable[dict],
    references: Iterable[dict],
    *,
    top_ks: tuple[int, ...] = (5, 10),
    iou_threshold: float = 0.30,
    baseline_resources: dict | None = None,
    candidate_resources: dict | None = None,
    min_reference_count: int = 1,
    min_video_count: int = 1,
) -> dict:
    """同じ正解区間に対する新旧方式を比較し、既定値変更の安全判定を返す。"""
    normalized_top_ks = tuple(sorted(set(max(1, int(value)) for value in top_ks))) or (5, 10)
    reference_list = list(references)
    baseline = evaluate_highlights(
        baseline_predictions,
        reference_list,
        top_ks=normalized_top_ks,
        iou_threshold=iou_threshold,
    )
    candidate = evaluate_highlights(
        candidate_predictions,
        reference_list,
        top_ks=normalized_top_ks,
        iou_threshold=iou_threshold,
    )
    precision_key = str(min(normalized_top_ks))
    recall_key = str(max(normalized_top_ks))

    def boundary(metric: dict, side: str) -> float:
        value = metric["boundary_mae_sec"][side]
        return float(value) if value is not None else float("inf")

    checks = {
        "candidate_has_matches": candidate["matched_count"] > 0,
        "top_precision_not_lower": candidate["top_k"][precision_key]["precision"] >= baseline["top_k"][precision_key]["precision"],
        "top_recall_not_lower": candidate["top_k"][recall_key]["recall"] >= baseline["top_k"][recall_key]["recall"],
        "mean_reference_iou_not_lower": candidate["mean_best_reference_iou"] >= baseline["mean_best_reference_iou"],
        "start_boundary_not_worse": boundary(candidate, "start") <= boundary(baseline, "start"),
        "end_boundary_not_worse": boundary(candidate, "end") <= boundary(baseline, "end"),
    }
    data_requirements = {
        "reference_count": {
            "minimum": max(1, int(min_reference_count)),
            "observed": candidate["reference_count"],
            "satisfied": candidate["reference_count"] >= max(1, int(min_reference_count)),
        },
        "video_count": {
            "minimum": max(1, int(min_video_count)),
            "observed": candidate["video_count"],
            "satisfied": candidate["video_count"] >= max(1, int(min_video_count)),
        },
    }
    sufficient_data = all(item["satisfied"] for item in data_requirements.values())
    passed = sufficient_data and all(checks.values())
    return {
        "baseline": baseline,
        "candidate": candidate,
        "delta": {
            "top_precision": round(candidate["top_k"][precision_key]["precision"] - baseline["top_k"][precision_key]["precision"], 4),
            "top_recall": round(candidate["top_k"][recall_key]["recall"] - baseline["top_k"][recall_key]["recall"], 4),
            "mean_best_reference_iou": round(candidate["mean_best_reference_iou"] - baseline["mean_best_reference_iou"], 4),
        },
        "resources": {
            "baseline": baseline_resources or {},
            "candidate": candidate_resources or {},
        },
        "release_gate": {
            "passed": passed,
            "status": "passed" if passed else "failed" if sufficient_data else "insufficient_data",
            "data_requirements": data_requirements,
            "checks": checks,
        },
    }
