"""Copy the exact Python and PyInstaller licenses used by a daemon build."""

from __future__ import annotations

import shutil
import sys
from importlib.metadata import distribution
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def runtime_license_sources() -> dict[str, Path]:
    python_license = Path(sys.base_prefix) / "LICENSE.txt"
    if not python_license.is_file():
        raise FileNotFoundError(f"Python LICENSE.txt was not found: {python_license}")
    sources = {
        "Python-LICENSE.txt": python_license,
    }
    distribution_licenses = [
        ("pyinstaller", "COPYING.txt", "PyInstaller-COPYING.txt"),
        ("pyinstaller-hooks-contrib", "LICENSE", "PyInstaller-Hooks-LICENSE.txt"),
        ("altgraph", "LICENSE", "altgraph-LICENSE.txt"),
        ("packaging", "LICENSE.APACHE", "packaging-Apache-2.0.txt"),
        ("packaging", "LICENSE.BSD", "packaging-BSD-2-Clause.txt"),
        ("pefile", "LICENSE", "pefile-LICENSE.txt"),
        ("pywin32-ctypes", "LICENSE.txt", "pywin32-ctypes-LICENSE.txt"),
        ("setuptools", "LICENSE", "setuptools-LICENSE.txt"),
    ]
    for distribution_name, source_name, output_name in distribution_licenses:
        package = distribution(distribution_name)
        license_path = next(
            (
                Path(package.locate_file(entry))
                for entry in (package.files or [])
                if entry.name == source_name
                and entry.parts
                and entry.parts[0].endswith("dist-info")
            ),
            None,
        )
        if license_path is None or not license_path.is_file():
            raise FileNotFoundError(
                f"{distribution_name} {source_name} was not found in the installed distribution."
            )
        sources[output_name] = license_path
    return sources


def copy_runtime_licenses(destination: Path) -> list[Path]:
    destination = destination.resolve()
    allowed_root = (ROOT / "dist" / "gemma_daemon").resolve()
    if destination != allowed_root and allowed_root not in destination.parents:
        raise ValueError(f"Refusing to write runtime licenses outside {allowed_root}: {destination}")
    destination.mkdir(parents=True, exist_ok=True)
    copied: list[Path] = []
    for output_name, source in runtime_license_sources().items():
        output = destination / output_name
        shutil.copy2(source, output)
        copied.append(output)
    return copied


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: copy_runtime_licenses.py <daemon-license-directory>")
    for path in copy_runtime_licenses(Path(sys.argv[1])):
        print(path)


if __name__ == "__main__":
    main()
