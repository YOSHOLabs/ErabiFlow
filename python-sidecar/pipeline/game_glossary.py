"""ゲームごとに閉じた字幕用語コンテキスト。

用語集は通常の文字起こしへ常時注入しない。ファイル名またはユーザー指定で
ゲームが確定した場合に限り、低信頼字幕の再判定と既知表記の正規化に使う。
"""

from __future__ import annotations

import os
import re
import json
from pathlib import Path
from typing import Iterable, Optional


def _load_glossaries() -> dict:
    """配布版でも更新しやすいJSON用語集を読み込む。"""
    glossary_dir = Path(__file__).resolve().parent / "glossaries"
    loaded = {}
    for path in sorted(glossary_dir.glob("*.json")):
        try:
            with path.open("r", encoding="utf-8") as source:
                config = json.load(source)
            game_id = str(config.get("id") or path.stem).strip().casefold()
            if game_id and isinstance(config.get("terms"), list):
                loaded[game_id] = config
        except (OSError, ValueError, TypeError) as exc:
            print(f"[Game Glossary] {path.name} could not be loaded: {exc}")
    return loaded


GAME_GLOSSARIES = _load_glossaries()


def _normalize(value: object) -> str:
    return re.sub(r"[\s\-_、。！？!?.,]", "", str(value or "")).casefold()


def _auto_detect_game(video_path: str) -> Optional[str]:
    stem = os.path.splitext(os.path.basename(video_path or ""))[0].casefold()
    for game_id, config in GAME_GLOSSARIES.items():
        def alias_matches(alias: object) -> bool:
            value = str(alias).casefold()
            if not value:
                return False
            if value.isascii() and value.replace(" ", "").isalnum():
                return bool(re.search(rf"(?<![a-z0-9]){re.escape(value)}(?![a-z0-9])", stem))
            return value in stem

        if any(alias_matches(alias) for alias in config.get("aliases", ())):
            return game_id
    return None


def _matching_corrections(
    corrections: Iterable[dict],
    *,
    video_path: str,
    game_id: Optional[str],
) -> list[dict]:
    source = os.path.normcase(os.path.abspath(video_path or ""))
    matched = []
    for correction in corrections or ():
        if not isinstance(correction, dict):
            continue
        scope = str(correction.get("scope") or "project")
        if scope == "game" and game_id:
            if str(correction.get("game_id") or "").casefold() == game_id.casefold():
                matched.append(correction)
        elif scope == "project":
            correction_source = os.path.normcase(os.path.abspath(str(correction.get("source_path") or "")))
            if correction_source and correction_source == source:
                matched.append(correction)
    return matched


def _learned_variants(corrections: Iterable[dict], terms: list[dict]) -> dict[str, str]:
    """安全に局所化でき、既存の正式用語へ着地する修正だけを別文でも再利用する。"""
    canonical_by_normalized = {
        _normalize(term.get("canonical")): str(term.get("canonical") or "").strip()
        for term in terms
        if _normalize(term.get("canonical"))
    }
    learned = {}
    for correction in corrections or ():
        original = str(correction.get("original") or "").strip()
        corrected = str(correction.get("corrected") or "").strip()
        if not original or not corrected:
            continue

        # 修正後の文中に既存の正式用語が明示されている場合、その前後を固定して
        # 同じ位置にあった誤認識だけを別名として学習する。
        learned_from_term = False
        for canonical in canonical_by_normalized.values():
            match = re.search(re.escape(canonical), corrected, flags=re.IGNORECASE)
            if not match:
                continue
            fixed_prefix = corrected[:match.start()]
            fixed_suffix = corrected[match.end():]
            if not original.startswith(fixed_prefix):
                continue
            if fixed_suffix and not original.endswith(fixed_suffix):
                continue
            variant_end = len(original) - len(fixed_suffix) if fixed_suffix else len(original)
            variant = original[len(fixed_prefix):variant_end].strip(" 、。！？!?.,")
            if (
                2 <= len(_normalize(variant)) <= 20
                and _normalize(variant) != _normalize(canonical)
            ):
                learned[variant] = canonical
                learned_from_term = True
                break
        if learned_from_term:
            continue

        prefix = 0
        limit = min(len(original), len(corrected))
        while prefix < limit and original[prefix] == corrected[prefix]:
            prefix += 1
        suffix = 0
        while (
            suffix < len(original) - prefix
            and suffix < len(corrected) - prefix
            and original[-(suffix + 1)] == corrected[-(suffix + 1)]
        ):
            suffix += 1

        original_end = len(original) - suffix if suffix else len(original)
        corrected_end = len(corrected) - suffix if suffix else len(corrected)
        variant = original[prefix:original_end].strip(" 、。！？!?.,")
        replacement = corrected[prefix:corrected_end].strip(" 、。！？!?.,")
        canonical = canonical_by_normalized.get(_normalize(replacement))
        if (
            canonical
            and 2 <= len(_normalize(variant)) <= 20
            and _normalize(variant) != _normalize(canonical)
        ):
            learned[variant] = canonical
    return learned


def resolve_game_glossary(
    video_path: str,
    requested_game_id: Optional[str] = "auto",
    corrections: Optional[Iterable[dict]] = None,
) -> dict:
    """解析対象に適用するゲームコンテキストを返す。

    ``none`` は明示的に無効、``auto`` はファイル名の明示的なゲーム名だけを
    採用する。曖昧な推測は行わない。
    """
    requested = str(requested_game_id or "auto").strip().casefold()
    detected_id = None
    source = "none"
    if requested in {"", "auto"}:
        detected_id = _auto_detect_game(video_path)
        source = "filename" if detected_id else "none"
    elif requested not in {"none", "off", "disabled"} and requested in GAME_GLOSSARIES:
        detected_id = requested
        source = "manual"

    config = GAME_GLOSSARIES.get(detected_id or "")
    terms = list(config.get("terms", ())) if config else []
    learned = _matching_corrections(
        corrections or (),
        video_path=video_path,
        game_id=detected_id,
    )
    exact_corrections = {
        _normalize(item.get("original")): str(item.get("corrected") or "").strip()
        for item in learned
        if _normalize(item.get("original")) and str(item.get("corrected") or "").strip()
    }
    learned_variants = _learned_variants(learned, terms)
    prompt_terms = list(dict.fromkeys(str(term["canonical"]) for term in terms))

    return {
        "requested_id": requested or "auto",
        "detected_id": detected_id,
        "label": config.get("label") if config else None,
        "source": source,
        "glossary_applied": bool(config),
        "terms": terms,
        "prompt_terms": prompt_terms,
        "prompt": (
            f"これは{config['label']}の日本語ゲーム実況の字幕です。"
            f"用語: {'、'.join(prompt_terms)}。"
            if config and prompt_terms
            else ""
        ),
        "exact_corrections": exact_corrections,
        "learned_correction_count": len(exact_corrections),
        "learned_variants": learned_variants,
        "learned_variant_count": len(learned_variants),
    }


def _replace_variant(text: str, variant: object, canonical: str) -> str:
    value = str(variant or "")
    if not value:
        return text
    escaped = re.escape(value)
    if value.isascii() and any(character.isalnum() for character in value):
        pattern = rf"(?<![A-Za-z0-9]){escaped}(?![A-Za-z0-9])"
    elif re.fullmatch(r"[ァ-ヶー]+", value):
        # 短いカタカナ別名で「アドバイス」など別の単語を壊さない。
        pattern = rf"(?<![ァ-ヶー]){escaped}(?![ァ-ヶー])"
    else:
        pattern = escaped
    return re.sub(pattern, lambda _match: canonical, text, flags=re.IGNORECASE)


def apply_scoped_corrections(text: str, glossary: Optional[dict]) -> tuple[str, bool]:
    """確定したゲーム内だけで、既知の表記揺れと完全一致修正を適用する。"""
    original = str(text or "")
    if not glossary:
        return original, False

    exact = glossary.get("exact_corrections") or {}
    exact_match = exact.get(_normalize(original))
    if exact_match:
        return str(exact_match), str(exact_match) != original

    if not glossary.get("glossary_applied"):
        return original, False

    corrected = original
    for variant, canonical in (glossary.get("learned_variants") or {}).items():
        corrected = _replace_variant(corrected, variant, str(canonical))

    # 長い表記から置換し、サイファーより先にBサイファーを確定させる。
    terms = sorted(
        glossary.get("terms") or [],
        key=lambda item: max([len(str(item.get("canonical") or "")), *[len(str(v)) for v in item.get("variants", ())]]),
        reverse=True,
    )
    for term in terms:
        canonical = str(term.get("canonical") or "")
        for variant in term.get("variants", ()):
            if not variant:
                continue
            corrected = _replace_variant(corrected, variant, canonical)

    corrected = re.sub(r"(?i)\bB[-\s]*サイファー", "Bサイファー", corrected)
    return corrected, corrected != original


def contains_glossary_term(text: str, glossary: Optional[dict]) -> bool:
    normalized = _normalize(text)
    if not normalized or not glossary:
        return False
    return any(
        _normalize(term.get("canonical")) in normalized
        for term in glossary.get("terms") or []
        if _normalize(term.get("canonical"))
    )
