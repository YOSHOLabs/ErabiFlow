#!/usr/bin/env python3
"""Summarize local highlight feedback JSONL without media access."""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.highlight_feedback import summarize_highlight_feedback


def read_events(paths: list[Path]) -> list[dict]:
    events: list[dict] = []
    for path in paths:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    events.append({"_invalid": True})
                    continue
                events.append(value if isinstance(value, dict) else {"_invalid": True})
    return events


def write_output(path: Path, rendered: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(rendered, encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize TateClip local highlight feedback")
    parser.add_argument("events", nargs="+", type=Path, help="events-v1 JSONL file(s)")
    parser.add_argument("--output", type=Path, help="optional summary JSON destination")
    args = parser.parse_args()

    summary = summarize_highlight_feedback(read_events(args.events))
    rendered = json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        write_output(args.output, rendered)
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
