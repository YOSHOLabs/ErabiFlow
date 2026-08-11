from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


SIDE_CAR_ROOT = Path(__file__).resolve().parents[1]
if str(SIDE_CAR_ROOT) not in sys.path:
    sys.path.insert(0, str(SIDE_CAR_ROOT))

from copy_runtime_licenses import copy_runtime_licenses, runtime_license_sources


class RuntimeLicenseTests(unittest.TestCase):
    def test_build_environment_exposes_required_license_files(self) -> None:
        sources = runtime_license_sources()
        self.assertEqual(
            set(sources),
            {
                "Python-LICENSE.txt",
                "PyInstaller-COPYING.txt",
                "PyInstaller-Hooks-LICENSE.txt",
                "altgraph-LICENSE.txt",
                "packaging-Apache-2.0.txt",
                "packaging-BSD-2-Clause.txt",
                "pefile-LICENSE.txt",
                "pywin32-ctypes-LICENSE.txt",
                "setuptools-LICENSE.txt",
            },
        )
        for path in sources.values():
            self.assertTrue(path.is_file())
            self.assertGreater(path.stat().st_size, 1000)

    def test_refuses_destination_outside_daemon_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(ValueError):
                copy_runtime_licenses(Path(temp_dir) / "licenses")


if __name__ == "__main__":
    unittest.main()
