"""Audit declared dependency licenses for the public Windows source tree."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import re
import subprocess
from collections import Counter
from hashlib import sha256
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ALLOWED_LICENSE_IDS = {
    "0BSD",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSL-1.0",
    "CC-BY-4.0",
    "CC0-1.0",
    "ISC",
    "MIT",
    "MIT-0",
    "MPL-2.0",
    "Unicode-3.0",
    "Unlicense",
    "Zlib",
}
EXPRESSION_WORDS = {"AND", "OR", "WITH"}
PYTHON_LICENSE_OVERRIDES = {
    "pyinstaller": "GPL-2.0-or-later WITH PyInstaller-Bootloader-Exception",
    "pyinstaller-hooks-contrib": "GPL-2.0-or-later AND Apache-2.0",
}
PYTHON_SPECIAL_IDS = {
    "GPL-2.0-or-later",
    "PyInstaller-Bootloader-Exception",
}


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def license_ids(expression: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[A-Za-z0-9][A-Za-z0-9.+-]*", expression)
        if token.upper() not in EXPRESSION_WORDS
    }


def package_entry(ecosystem: str, name: str, version: str, license_expression: str) -> dict[str, str]:
    return {
        "ecosystem": ecosystem,
        "name": name,
        "version": version,
        "license": license_expression,
    }


def npm_packages() -> list[dict[str, str]]:
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    result = []
    for package_path, metadata in lock.get("packages", {}).items():
        if not package_path.startswith("node_modules/"):
            continue
        name = package_path.removeprefix("node_modules/")
        expression = metadata.get("license")
        if not isinstance(expression, str) or not expression.strip():
            expression = "MISSING"
        result.append(package_entry("npm", name, str(metadata.get("version", "")), expression))
    return result


def cargo_packages() -> list[dict[str, str]]:
    raw = subprocess.check_output(
        [
            "cargo",
            "metadata",
            "--manifest-path",
            str(ROOT / "src-tauri" / "Cargo.toml"),
            "--format-version",
            "1",
            "--locked",
            "--filter-platform",
            "x86_64-pc-windows-msvc",
        ],
        cwd=ROOT,
    )
    metadata = json.loads(raw.decode("utf-8"))
    packages = {item["id"]: item for item in metadata["packages"]}
    nodes = {item["id"]: item for item in metadata["resolve"]["nodes"]}
    pending = [metadata["resolve"]["root"]]
    visited: set[str] = set()
    result = []
    while pending:
        package_id = pending.pop()
        if package_id in visited:
            continue
        visited.add(package_id)
        pending.extend(dependency["pkg"] for dependency in nodes[package_id]["deps"])
        package = packages[package_id]
        if package["name"] == "app":
            continue
        expression = package.get("license")
        if not expression and package.get("license_file"):
            license_file = Path(package["manifest_path"]).parent / package["license_file"]
            if license_file.is_file():
                expression = "LicenseRef-File"
        result.append(package_entry("cargo", package["name"], package["version"], expression or "MISSING"))
    return result


def locked_python_versions() -> dict[str, str]:
    result = {}
    for line in (ROOT / "python-sidecar" / "requirements.txt").read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Za-z0-9_.-]+)==([^\s\\]+)", line.strip())
        if match:
            result[match.group(1).lower().replace("_", "-")] = match.group(2)
    return result


def python_packages() -> list[dict[str, str]]:
    result = []
    for name, locked_version in sorted(locked_python_versions().items()):
        package = importlib.metadata.distribution(name)
        if package.version != locked_version:
            raise RuntimeError(f"Python package version mismatch: {name} {package.version} != {locked_version}")
        normalized_name = name.lower().replace("_", "-")
        expression = PYTHON_LICENSE_OVERRIDES.get(normalized_name)
        if not expression:
            expression = package.metadata.get("License-Expression") or package.metadata.get("License")
        if not expression:
            expression = "MISSING"
        result.append(package_entry("python", normalized_name, package.version, expression))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--report",
        default="release/dependency-license-audit.local.json",
        help="report path inside the repository's release directory",
    )
    args = parser.parse_args()
    report_path = (ROOT / args.report).resolve()
    release_root = (ROOT / "release").resolve()
    if report_path.parent != release_root:
        raise SystemExit(f"report must be written directly under {release_root}")

    entries = sorted(npm_packages() + cargo_packages() + python_packages(), key=lambda item: (
        item["ecosystem"], item["name"].lower(), item["version"]
    ))
    failures = []
    summary: Counter[str] = Counter()
    for entry in entries:
        expression = entry["license"]
        summary[expression] += 1
        if expression == "MISSING":
            failures.append(f"missing license: {entry['ecosystem']} {entry['name']} {entry['version']}")
            continue
        identifiers = license_ids(expression)
        allowed = ALLOWED_LICENSE_IDS | (PYTHON_SPECIAL_IDS if entry["ecosystem"] == "python" else set())
        unknown = sorted(identifiers - allowed - {"LicenseRef-File"})
        if unknown:
            failures.append(
                f"unreviewed license identifiers {unknown}: {entry['ecosystem']} {entry['name']} {entry['version']} ({expression})"
            )

    report = {
        "schemaVersion": 1,
        "status": "success" if not failures else "failed",
        "target": "windows-x64",
        "inputs": {
            "packageLockSha256": digest(ROOT / "package-lock.json"),
            "cargoLockSha256": digest(ROOT / "src-tauri" / "Cargo.lock"),
            "pythonRequirementsSha256": digest(ROOT / "python-sidecar" / "requirements.txt"),
        },
        "packageCounts": dict(sorted(Counter(item["ecosystem"] for item in entries).items())),
        "licenseExpressionCounts": dict(sorted(summary.items())),
        "failures": failures,
        "packages": entries,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if failures:
        print("DEPENDENCY LICENSE AUDIT: FAIL")
        for failure in failures:
            print(f"- {failure}")
        raise SystemExit(1)
    print("DEPENDENCY LICENSE AUDIT: PASS")
    print(f"Packages reviewed: {len(entries)}")
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()
