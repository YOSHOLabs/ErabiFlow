"""Cross-platform subprocess options shared by the packaged daemon."""

import os
import subprocess


def no_window_creation_flags() -> int:
    """Prevent console child processes from flashing a window on Windows."""
    if os.name != "nt":
        return 0
    return getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
