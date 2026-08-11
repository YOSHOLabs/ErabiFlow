import sys
import unittest
from pathlib import Path


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from pipeline.game_glossary import apply_scoped_corrections, resolve_game_glossary


class GameGlossaryTests(unittest.TestCase):
    def test_auto_detection_only_activates_matching_game(self) -> None:
        valorant = resolve_game_glossary(r"C:\Videos\VALORANT - match.mp4")
        unknown = resolve_game_glossary(r"C:\Videos\another-game.mp4")

        self.assertEqual(valorant["detected_id"], "valorant")
        self.assertTrue(valorant["glossary_applied"])
        self.assertIsNone(unknown["detected_id"])
        self.assertFalse(unknown["glossary_applied"])
        self.assertFalse(
            resolve_game_glossary(r"C:\Videos\notvalorant-related.mp4")["glossary_applied"]
        )

    def test_explicit_none_never_uses_filename_glossary(self) -> None:
        glossary = resolve_game_glossary(
            r"C:\Videos\VALORANT - match.mp4",
            requested_game_id="none",
        )
        self.assertFalse(glossary["glossary_applied"])

    def test_variants_are_corrected_only_inside_matching_scope(self) -> None:
        active = resolve_game_glossary(r"C:\Videos\VALORANT - match.mp4")
        inactive = resolve_game_glossary(r"C:\Videos\other.mp4")

        self.assertEqual(apply_scoped_corrections("B-Cypher", active), ("Bサイファー", True))
        self.assertEqual(apply_scoped_corrections("B-Cypher", inactive), ("B-Cypher", False))

    def test_catalog_contains_current_agents_maps_and_weapons(self) -> None:
        glossary = resolve_game_glossary(r"C:\Videos\VALORANT - match.mp4")
        canonicals = {term["canonical"] for term in glossary["terms"]}

        self.assertTrue({"ヴィトー", "ミクス", "サイファー"}.issubset(canonicals))
        self.assertTrue({"サミット", "カロード", "アビス"}.issubset(canonicals))
        self.assertTrue({"バンディット", "アウトロー", "ヴァンダル"}.issubset(canonicals))

    def test_ascii_variant_replacement_respects_word_boundaries(self) -> None:
        glossary = resolve_game_glossary(r"C:\Videos\VALORANT - match.mp4")

        self.assertEqual(apply_scoped_corrections("SageとVandal", glossary)[0], "セージとヴァンダル")
        self.assertEqual(apply_scoped_corrections("message", glossary), ("message", False))
        self.assertEqual(apply_scoped_corrections("アドバイス", glossary), ("アドバイス", False))
        self.assertEqual(apply_scoped_corrections("ゲッコー", glossary), ("ゲッコー", False))

    def test_learned_correction_is_scoped_to_game_or_project(self) -> None:
        corrections = [
            {
                "scope": "game",
                "game_id": "valorant",
                "original": "スミット",
                "corrected": "スモーク",
            },
            {
                "scope": "project",
                "source_path": r"C:\Videos\other.mp4",
                "original": "てすと",
                "corrected": "テスト",
            },
        ]
        valorant = resolve_game_glossary(
            r"C:\Videos\VALORANT - match.mp4",
            corrections=corrections,
        )
        other = resolve_game_glossary(
            r"C:\Videos\other.mp4",
            requested_game_id="none",
            corrections=corrections,
        )

        self.assertEqual(apply_scoped_corrections("スミット", valorant), ("スモーク", True))
        # ゲーム用語なしでも、この素材だけの修正履歴は安全に再利用できる。
        self.assertEqual(apply_scoped_corrections("てすと", other), ("テスト", True))

    def test_localized_edit_learns_known_term_variant_for_other_sentences(self) -> None:
        glossary = resolve_game_glossary(
            r"C:\Videos\VALORANT - match.mp4",
            corrections=[{
                "scope": "game",
                "game_id": "valorant",
                "original": "スミット入れる",
                "corrected": "スモーク入れる",
            }],
        )

        self.assertEqual(glossary["learned_variant_count"], 1)
        self.assertEqual(
            apply_scoped_corrections("ここにスミットお願い", glossary),
            ("ここにスモークお願い", True),
        )

    def test_sentence_edits_are_not_promoted_to_unknown_terms(self) -> None:
        glossary = resolve_game_glossary(
            r"C:\Videos\VALORANT - match.mp4",
            corrections=[{
                "scope": "game",
                "game_id": "valorant",
                "original": "今日は右に行こう",
                "corrected": "今日は左に行こう",
            }],
        )

        self.assertEqual(glossary["learned_variant_count"], 0)
        self.assertEqual(
            apply_scoped_corrections("次も右に行こう", glossary),
            ("次も右に行こう", False),
        )


if __name__ == "__main__":
    unittest.main()
