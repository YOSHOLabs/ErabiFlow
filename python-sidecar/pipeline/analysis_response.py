"""Python engine の結果を daemon JSONL 契約へ変換する純粋ロジック。"""

from __future__ import annotations


def build_daemon_analysis_result(engine_result: dict, elapsed_sec: float) -> dict:
    cuts = list(engine_result.get("recommendedCuts") or [])
    segments = list(engine_result.get("segments") or [])
    game_context = engine_result.get("gameContext") or {}
    return {
        "status": engine_result.get("status", "success"),
        "highlights": cuts,
        "excitement_graph": list(engine_result.get("excitementGraph") or []),
        "segments": segments,
        "track_info": engine_result.get("trackInfo") or {},
        "game_context": game_context,
        "signal_summary": engine_result.get("signalSummary") or {},
        "transcript_text": " ".join(
            str(segment.get("text") or "")
            for segment in segments
            if isinstance(segment, dict)
        )[:2000],
        "agentThinking": engine_result.get("agentThinking", ""),
        "stats": {
            "highlights_found": len(cuts),
            "processing_time_sec": round(float(elapsed_sec), 1),
            "cache_hit": False,
            "glossary_refinements": int(game_context.get("refinementCount", 0)),
        },
    }
