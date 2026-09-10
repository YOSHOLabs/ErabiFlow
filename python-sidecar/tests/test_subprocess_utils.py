import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from pipeline.subprocess_utils import no_window_creation_flags


class SubprocessUtilsTests(unittest.TestCase):
    def test_windows_children_are_created_without_a_console_window(self) -> None:
        with (
            patch("pipeline.subprocess_utils.os.name", "nt"),
            patch.object(subprocess, "CREATE_NO_WINDOW", 0x08000000, create=True),
        ):
            self.assertEqual(no_window_creation_flags(), 0x08000000)

    def test_non_windows_children_do_not_receive_windows_flags(self) -> None:
        with patch("pipeline.subprocess_utils.os.name", "posix"):
            self.assertEqual(no_window_creation_flags(), 0)
