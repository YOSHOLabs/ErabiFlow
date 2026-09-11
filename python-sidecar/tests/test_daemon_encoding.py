import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


class DaemonEncodingTests(unittest.TestCase):
    def test_utf8_jsonl_is_independent_of_windows_stdio_encoding(self):
        daemon = Path(__file__).resolve().parents[1] / "gemma_daemon.py"
        request_id = "日本語 sample"
        payload = json.dumps(
            {"id": request_id, "cmd": "shutdown", "params": {}},
            ensure_ascii=False,
        ).encode("utf-8") + b"\n"
        result = subprocess.run(
            [sys.executable, str(daemon)],
            input=payload,
            capture_output=True,
            timeout=15,
            env={**os.environ, "PYTHONIOENCODING": "cp932", "PYTHONUTF8": "0"},
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))
        messages = [json.loads(line) for line in result.stdout.decode("utf-8").splitlines()]
        self.assertEqual(messages[-1]["id"], request_id)
        self.assertEqual(messages[-1]["data"]["status"], "shutdown")
