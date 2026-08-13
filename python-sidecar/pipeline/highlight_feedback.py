"""Privacy-preserving aggregation for ErabiFlow's local highlight feedback JSONL."""

from __future__ import annotations

from collections import Counter, defaultdict
import math
from typing import Any, Iterable


ALLOWED_ACTIONS = {
    "shown",
    "previewed",
    "adopted",
    "unadopted",
    "queued",
    "dequeued",
    "trimmed",
    "rejected",
    "restored",
    "missed",
    "exported",
}
MISSED_CATEGORIES = {"victory", "failure", "surprise", "comedy", "explanation", "other"}
FORBIDDEN_CONTENT_KEYS = {
    "sourcePath",
    "videoPath",
    "inputPath",
    "outputPath",
    "subtitle",
    "transcript",
    "label",
    "reason",
    "text",
}


def _read_range(event: dict[str, Any], key: str) -> tuple[float, float] | None:
    value = event.get(key)
    if not isinstance(value, dict):
        return None
    try:
        start = float(value["start"])
        end = float(value["end"])
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start:
        return None
    return start, end


def summarize_highlight_feedback(events: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate behavior without reading or emitting any media content."""
    action_counts: Counter[str] = Counter()
    candidates_by_action: dict[str, set[str]] = defaultdict(set)
    invalid_count = 0

    normalized_with_order: list[tuple[int, dict[str, Any]]] = []
    for input_order, event in enumerate(events):
        if not isinstance(event, dict):
            invalid_count += 1
            continue
        if FORBIDDEN_CONTENT_KEYS.intersection(event):
            invalid_count += 1
            continue
        action = event.get("action")
        if event.get("schemaVersion") != 1 or action not in ALLOWED_ACTIONS:
            invalid_count += 1
            continue
        if action == "missed" and (
            event.get("category") not in MISSED_CATEGORIES
            or _read_range(event, "currentRange") is None
        ):
            invalid_count += 1
            continue
        normalized_with_order.append((input_order, event))

    normalized = [event for _, event in sorted(
        normalized_with_order,
        key=lambda item: (str(item[1].get("occurredAt") or ""), item[0]),
    )]
    clip_to_candidate: dict[str, str] = {}
    candidate_initial: dict[str, tuple[float, float]] = {}
    candidate_current: dict[str, tuple[float, float]] = {}
    boundary_candidates: set[str] = set()
    final_state: dict[str, str] = {}
    missed_categories: Counter[str] = Counter()
    missed_ranges = 0
    uncovered_missed_ranges = 0

    for event in normalized:
        action = str(event["action"])
        action_counts[action] += 1
        if action == "missed":
            category = event.get("category")
            current_range = _read_range(event, "currentRange")
            nearest_iou = event.get("nearestCandidateIou", 0.0)
            if category not in MISSED_CATEGORIES or current_range is None:
                continue
            try:
                nearest_iou = float(nearest_iou)
            except (TypeError, ValueError):
                nearest_iou = 0.0
            missed_ranges += 1
            missed_categories[str(category)] += 1
            if not math.isfinite(nearest_iou) or nearest_iou < 0.3:
                uncovered_missed_ranges += 1
            continue
        candidate_id = event.get("candidateId")
        clip_id = event.get("clipId")
        if action == "adopted" and isinstance(candidate_id, str) and isinstance(clip_id, str):
            clip_to_candidate[clip_id] = candidate_id
        if not isinstance(candidate_id, str):
            candidate_id = clip_to_candidate.get(clip_id) if isinstance(clip_id, str) else None
        if not candidate_id:
            continue

        candidates_by_action[action].add(candidate_id)
        initial = _read_range(event, "initialRange")
        if initial is not None and candidate_id not in candidate_initial:
            candidate_initial[candidate_id] = initial
        if action in {"trimmed", "exported"}:
            current = _read_range(event, "currentRange")
            if current is not None:
                candidate_current[candidate_id] = current
                boundary_candidates.add(candidate_id)

        if action == "shown":
            final_state.setdefault(candidate_id, "shown")
        elif action == "restored":
            final_state[candidate_id] = "shown"
        elif action == "adopted":
            final_state[candidate_id] = "adopted"
        elif action in {"unadopted", "rejected"}:
            final_state[candidate_id] = "rejected"
        elif action == "exported":
            final_state[candidate_id] = "exported"

    boundary_deltas = []
    for candidate_id in boundary_candidates:
        initial = candidate_initial.get(candidate_id)
        current = candidate_current.get(candidate_id)
        if initial is None or current is None or final_state.get(candidate_id) == "rejected":
            continue
        boundary_deltas.append((abs(current[0] - initial[0]), abs(current[1] - initial[1])))

    shown_candidates = candidates_by_action["shown"]
    shown = len(shown_candidates)
    final_adopted = {candidate for candidate, state in final_state.items() if state == "adopted"}
    final_rejected = {candidate for candidate, state in final_state.items() if state == "rejected"}
    final_exported = {candidate for candidate, state in final_state.items() if state == "exported"}
    final_undecided = shown_candidates - final_adopted - final_rejected - final_exported
    accepted = final_adopted | final_exported
    accepted_from_shown = accepted & shown_candidates
    rejected_from_shown = final_rejected & shown_candidates
    mean_start_delta = sum(item[0] for item in boundary_deltas) / len(boundary_deltas) if boundary_deltas else 0.0
    mean_end_delta = sum(item[1] for item in boundary_deltas) / len(boundary_deltas) if boundary_deltas else 0.0

    return {
        "schemaVersion": 1,
        "validEventCount": len(normalized),
        "invalidEventCount": invalid_count,
        "actionCounts": dict(sorted(action_counts.items())),
        "uniqueCandidates": {
            "shown": shown,
            "previewed": len(candidates_by_action["previewed"]),
        },
        "finalDecisions": {
            "adopted": len(final_adopted),
            "rejected": len(final_rejected),
            "exported": len(final_exported),
            "undecided": len(final_undecided),
        },
        "everActions": {
            "adopted": len(candidates_by_action["adopted"]),
            "rejected": len(candidates_by_action["rejected"] | candidates_by_action["unadopted"]),
            "exported": len(candidates_by_action["exported"]),
        },
        "rates": {
            "acceptedPerShown": round(len(accepted_from_shown) / shown, 4) if shown else None,
            "rejectionPerShown": round(len(rejected_from_shown) / shown, 4) if shown else None,
            "exportPerAccepted": round(len(final_exported) / len(accepted), 4) if accepted else None,
        },
        "boundaryEdits": {
            "sampleCount": len(boundary_deltas),
            "meanAbsoluteStartDeltaSeconds": round(mean_start_delta, 3),
            "meanAbsoluteEndDeltaSeconds": round(mean_end_delta, 3),
        },
        "missedHighlights": {
            "count": missed_ranges,
            "uncoveredCount": uncovered_missed_ranges,
            "coverage": round((missed_ranges - uncovered_missed_ranges) / missed_ranges, 4) if missed_ranges else None,
            "categories": dict(sorted(missed_categories.items())),
        },
    }
