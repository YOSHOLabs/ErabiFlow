"""Generate a deterministic license-text bundle for packaged TateClip builds."""

from __future__ import annotations

import importlib.metadata
import json
import re
import subprocess
from collections import defaultdict
from hashlib import sha256
from pathlib import Path

from dependency_license_audit import ROOT, cargo_packages, digest, locked_python_versions, npm_packages, python_packages


OUTPUT = ROOT / "src-tauri" / "resources" / "licenses" / "DEPENDENCY_LICENSES.generated.txt"
LICENSE_NAME = re.compile(r"^(license|licence|copying|notice|unlicense|copyright)(?:[._-].*)?$", re.I)


def normalized_text(path: Path) -> str | None:
    if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(encoding="latin-1")
    return text.replace("\r\n", "\n").replace("\r", "\n").strip() + "\n"


def add_text(
    collected: dict[str, str],
    users: dict[str, set[str]],
    path: Path,
    package_label: str,
) -> None:
    text = normalized_text(path)
    if not text:
        return
    text_hash = sha256(text.encode("utf-8")).hexdigest()
    collected[text_hash] = text
    users[text_hash].add(f"{package_label} ({path.name})")


def npm_license_texts(collected: dict[str, str], users: dict[str, set[str]]) -> None:
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    for package_path, metadata in lock.get("packages", {}).items():
        if not package_path.startswith("node_modules/"):
            continue
        package_root = ROOT / package_path
        if not package_root.is_dir():
            continue  # Optional packages for other operating systems are not installed on Windows.
        label = f"npm {package_path.removeprefix('node_modules/')}@{metadata.get('version', '')}"
        for candidate in sorted(package_root.iterdir(), key=lambda item: item.name.lower()):
            if candidate.is_file() and LICENSE_NAME.match(candidate.name):
                add_text(collected, users, candidate, label)


def cargo_metadata() -> tuple[dict, list[dict[str, str]]]:
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
    selected = []
    while pending:
        package_id = pending.pop()
        if package_id in visited:
            continue
        visited.add(package_id)
        pending.extend(dependency["pkg"] for dependency in nodes[package_id]["deps"])
        package = packages[package_id]
        if package["name"] != "app":
            selected.append(package)
    return metadata, selected


def cargo_license_texts(collected: dict[str, str], users: dict[str, set[str]]) -> None:
    _, packages = cargo_metadata()
    for package in packages:
        package_root = Path(package["manifest_path"]).parent
        label = f"cargo {package['name']}@{package['version']}"
        candidates = {
            candidate.resolve()
            for candidate in package_root.iterdir()
            if candidate.is_file() and LICENSE_NAME.match(candidate.name)
        }
        if package.get("license_file"):
            candidates.add((package_root / package["license_file"]).resolve())
        for candidate in sorted(candidates, key=lambda item: item.name.lower()):
            add_text(collected, users, candidate, label)


def python_license_texts(collected: dict[str, str], users: dict[str, set[str]]) -> None:
    for name, locked_version in sorted(locked_python_versions().items()):
        package = importlib.metadata.distribution(name)
        if package.version != locked_version:
            raise RuntimeError(f"Python package version mismatch: {name} {package.version} != {locked_version}")
        label = f"python {name}@{locked_version}"
        for entry in package.files or []:
            if (
                entry.parts
                and entry.parts[0].endswith("dist-info")
                and LICENSE_NAME.match(entry.name)
            ):
                add_text(collected, users, Path(package.locate_file(entry)), label)


def main() -> None:
    expected_output_root = (ROOT / "src-tauri" / "resources" / "licenses").resolve()
    if OUTPUT.resolve().parent != expected_output_root:
        raise SystemExit("dependency license bundle output escaped the approved resource directory")

    entries = sorted(npm_packages() + cargo_packages() + python_packages(), key=lambda item: (
        item["ecosystem"], item["name"].lower(), item["version"]
    ))
    collected: dict[str, str] = {}
    users: dict[str, set[str]] = defaultdict(set)
    npm_license_texts(collected, users)
    cargo_license_texts(collected, users)
    python_license_texts(collected, users)
    if not collected:
        raise SystemExit("no dependency license texts were collected")

    lines = [
        "TateClip Dependency License Bundle",
        "==================================",
        "",
        "This generated file accompanies packaged builds. It lists the exact Windows",
        "dependency graph and preserves license/notice texts found in installed packages.",
        "The package inventory is intentionally over-inclusive of build dependencies.",
        "",
        f"package-lock.json SHA-256: {digest(ROOT / 'package-lock.json')}",
        f"Cargo.lock SHA-256: {digest(ROOT / 'src-tauri' / 'Cargo.lock')}",
        f"requirements.txt SHA-256: {digest(ROOT / 'python-sidecar' / 'requirements.txt')}",
        "",
        "Package inventory",
        "-----------------",
    ]
    lines.extend(
        f"{entry['ecosystem']} | {entry['name']} | {entry['version']} | {entry['license']}"
        for entry in entries
    )
    lines.extend(["", "Collected license and notice texts", "----------------------------------", ""])
    for text_hash in sorted(collected):
        lines.append(f"SHA-256: {text_hash}")
        lines.append("Packages/files:")
        lines.extend(f"- {label}" for label in sorted(users[text_hash], key=str.lower))
        lines.extend(["", collected[text_hash].rstrip(), "", "=" * 78, ""])

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    print(f"Dependency license bundle: {OUTPUT}")
    print(f"Packages listed: {len(entries)}; unique license texts: {len(collected)}")


if __name__ == "__main__":
    main()
