import array
import os
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from pipeline.transcriber import Transcriber


def write_wav_with_metadata(path: Path, pcm_data: bytes, sample_rate: int = 16_000) -> None:
    """dataより前に任意チャンクを含む、FFmpeg出力に近いWAVを作る。"""
    fmt_data = struct.pack(
        "<HHIIHH",
        1,
        1,
        sample_rate,
        sample_rate * 2,
        2,
        16,
    )
    metadata = b"encoder=unit-test"

    def chunk(chunk_id: bytes, data: bytes) -> bytes:
        padding = b"\0" if len(data) % 2 else b""
        return chunk_id + struct.pack("<I", len(data)) + data + padding

    body = b"WAVE" + chunk(b"fmt ", fmt_data) + chunk(b"LIST", metadata) + chunk(b"data", pcm_data)
    path.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)


class TranscriberWavTests(unittest.TestCase):
    def test_downloaded_model_path_override_is_used(self) -> None:
        model_path = Path(tempfile.gettempdir()) / "tateclip-models" / "ggml-large-v3-turbo.bin"
        with patch.dict(os.environ, {"VFOCUS_WHISPER_MODEL_PATH": str(model_path)}):
            transcriber = Transcriber()

        self.assertEqual(transcriber.model_path, str(model_path.resolve()))

    def test_metadata_chunk_does_not_corrupt_duration_or_vad(self) -> None:
        sample_rate = 16_000
        silence = array.array("h", [0] * sample_rate)
        speech = array.array("h", [12_000] * sample_rate)
        pcm_data = (silence + speech + silence).tobytes()

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "metadata.wav"
            output_path = Path(temp_dir) / "speech.wav"
            write_wav_with_metadata(input_path, pcm_data, sample_rate)

            transcriber = Transcriber()
            self.assertAlmostEqual(transcriber._wav_duration(str(input_path)), 3.0, places=3)

            regions = transcriber._detect_speech_regions(
                str(input_path),
                min_silence_duration=0.2,
                padding=0.0,
            )
            self.assertEqual(len(regions), 1)
            self.assertAlmostEqual(regions[0][0], 1.0, delta=0.05)
            self.assertAlmostEqual(regions[0][1], 2.0, delta=0.05)

            mapping = transcriber._extract_speech_only_wav(
                str(input_path),
                regions,
                str(output_path),
            )
            detected_duration = regions[0][1] - regions[0][0]
            self.assertAlmostEqual(
                mapping["total_duration"],
                detected_duration,
                places=3,
            )
            with wave.open(str(output_path), "rb") as output_wav:
                self.assertEqual(output_wav.getframerate(), sample_rate)
                self.assertEqual(output_wav.getnchannels(), 1)
                self.assertEqual(output_wav.getsampwidth(), 2)
                self.assertAlmostEqual(
                    output_wav.getnframes() / output_wav.getframerate(),
                    detected_duration,
                    places=3,
                )

    def test_adaptive_vad_detects_quiet_speech(self) -> None:
        sample_rate = 16_000
        silence = array.array("h", [0] * sample_rate)
        quiet_speech = array.array("h", [250] * sample_rate)

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "quiet.wav"
            write_wav_with_metadata(
                input_path,
                (silence + quiet_speech + silence).tobytes(),
                sample_rate,
            )

            regions, threshold = Transcriber()._detect_speech_regions(
                str(input_path),
                min_silence_duration=0.2,
                padding=0.0,
                return_threshold=True,
            )

            self.assertLess(threshold, 0.01)
            self.assertEqual(len(regions), 1)
            self.assertAlmostEqual(regions[0][0], 1.0, delta=0.05)

    def test_long_speech_is_partitioned_into_bounded_batches(self) -> None:
        batches = Transcriber._partition_speech_regions(
            [(0.0, 130.0), (200.0, 230.0)],
            max_batch_duration=90.0,
        )

        self.assertEqual(len(batches), 2)
        for batch in batches:
            self.assertLessEqual(sum(end - start for start, end in batch), 90.0)

    def test_transcription_keeps_full_audio_even_when_vad_finds_only_part(self) -> None:
        batches = Transcriber._transcription_batches_preserving_speech([
            (1.0, 2.0),
            (8.0, 9.0),
        ])

        self.assertEqual(batches, [None])

    def test_only_uncovered_speech_regions_are_selected_for_rescue(self) -> None:
        windows = Transcriber._uncovered_speech_windows(
            [(1.0, 2.0), (5.0, 6.0), (10.0, 14.0)],
            [
                {"start": 1.1, "end": 1.9, "text": "認識済み"},
                {"start": 10.1, "end": 10.5, "text": "一部だけ"},
            ],
            20.0,
        )

        self.assertEqual(windows, [(4.65, 6.35), (9.65, 14.35)])

    def test_rescue_windows_are_bounded_to_avoid_full_second_pass(self) -> None:
        regions = [(float(index), float(index) + 0.5) for index in range(0, 100, 2)]
        windows = Transcriber._uncovered_speech_windows(
            regions,
            [],
            120.0,
            max_count=4,
            max_total_duration=5.0,
        )

        self.assertLessEqual(len(windows), 4)
        self.assertLessEqual(sum(end - start for start, end in windows), 5.0)

    def test_duplicate_tracks_keep_the_higher_confidence_caption(self) -> None:
        merged = Transcriber.merge_transcript_results([
            {
                "track_index": 1,
                "language": "ja",
                "segments": [{
                    "start": 10.0,
                    "end": 11.5,
                    "text": "これはテストです",
                    "confidence": 0.55,
                }],
            },
            {
                "track_index": 2,
                "language": "ja",
                "segments": [{
                    "start": 10.1,
                    "end": 11.6,
                    "text": "これはテストです。",
                    "confidence": 0.91,
                }],
            },
        ])

        self.assertEqual(len(merged["segments"]), 1)
        self.assertEqual(merged["segments"][0]["source_track"], 2)
        self.assertEqual(merged["segments"][0]["confidence"], 0.91)

    def test_caption_spanning_vad_regions_does_not_fill_the_silence_gap(self) -> None:
        transcriber = Transcriber()
        remapped = transcriber._remap_timestamps(
            [{
                "start": 0.5,
                "end": 3.5,
                "text": "最初の発言次の発言",
                "confidence": 0.8,
            }],
            {
                "regions": [
                    (10.0, 12.0, 0.0, 2.0),
                    (20.0, 22.0, 2.0, 4.0),
                ]
            },
        )

        self.assertEqual(len(remapped), 2)
        self.assertAlmostEqual(remapped[0]["start"], 10.5)
        self.assertAlmostEqual(remapped[0]["end"], 12.0)
        self.assertAlmostEqual(remapped[1]["start"], 20.0)
        self.assertAlmostEqual(remapped[1]["end"], 21.5)
        self.assertLess(remapped[0]["end"], remapped[1]["start"])
        self.assertEqual("".join(item["text"] for item in remapped), "最初の発言次の発言")

    def test_native_vad_regions_replace_accumulated_whisper_timestamps(self) -> None:
        aligned = Transcriber._align_segments_to_vad_regions(
            [
                {"start": 15.34, "end": 16.67, "text": "はぁ"},
                {"start": 16.67, "end": 18.26, "text": "ナイスします"},
                {"start": 18.26, "end": 46.52, "text": "ビーサイファー"},
            ],
            [
                (15.34, 16.09),
                (17.26, 18.33),
                (45.90, 46.52),
            ],
        )

        self.assertEqual(
            [(item["start"], item["end"]) for item in aligned],
            [(15.34, 16.09), (17.26, 18.33), (45.9, 46.52)],
        )

    def test_unrecognized_vad_region_does_not_receive_split_caption_text(self) -> None:
        aligned = Transcriber._align_segments_to_vad_regions(
            [
                {
                    "start": 10.0,
                    "end": 10.5,
                    "text": "最初",
                    "confidence": 0.8,
                },
                {
                    "start": 20.5,
                    "end": 30.5,
                    "text": "最後",
                    "confidence": 0.9,
                },
            ],
            [(10.0, 10.5), (20.0, 20.5), (30.0, 30.5)],
        )

        self.assertEqual(
            [(item["start"], item["end"], item["text"]) for item in aligned],
            [(10.0, 10.5, "最初"), (30.0, 30.5, "最後")],
        )

    def test_vad_alignment_uses_overlap_instead_of_moving_short_caption_forward(self) -> None:
        aligned = Transcriber._align_segments_to_vad_regions(
            [
                {"start": 6.35, "end": 8.16, "text": "スカイバン"},
                {"start": 8.16, "end": 8.87, "text": "さっさっさっ"},
                {"start": 8.87, "end": 43.73, "text": "バグは何?"},
                {"start": 43.73, "end": 48.36, "text": "ドローンのやつは"},
                {"start": 48.36, "end": 48.87, "text": "あれ?"},
                {"start": 48.87, "end": 49.22, "text": "ん?"},
                {"start": 49.22, "end": 51.26, "text": "バグってなかった"},
                {"start": 51.26, "end": 59.51, "text": "あれやば"},
            ],
            [
                (6.35, 7.06),
                (8.14, 8.89),
                (39.08, 40.31),
                (47.15, 48.98),
                (48.98, 50.49),
                (58.19, 59.51),
            ],
        )

        self.assertEqual(
            [(item["start"], item["end"], item["text"]) for item in aligned],
            [
                (6.35, 7.06, "スカイバン"),
                (8.14, 8.89, "さっさっさっ"),
                (39.08, 40.31, "バグは何?"),
                (47.15, 48.36, "ドローンのやつは"),
                (48.36, 48.87, "あれ?"),
                (48.98, 49.22, "ん?"),
                (49.22, 50.49, "バグってなかった"),
                (58.19, 59.51, "あれやば"),
            ],
        )

    def test_rescue_rejects_short_noise_but_keeps_words_and_game_abbreviations(self) -> None:
        self.assertFalse(Transcriber._rescue_candidate_is_safe({
            "start": 1.0,
            "end": 1.05,
            "text": "お",
            "confidence": 0.95,
        }))
        self.assertFalse(Transcriber._rescue_candidate_is_safe({
            "start": 2.0,
            "end": 3.0,
            "text": "付き",
            "confidence": 0.90,
        }))
        self.assertTrue(Transcriber._rescue_candidate_is_safe({
            "start": 4.0,
            "end": 4.8,
            "text": "ナイス",
            "confidence": 0.80,
        }))
        self.assertTrue(Transcriber._rescue_candidate_is_safe({
            "start": 5.0,
            "end": 5.5,
            "text": "NT",
            "confidence": 0.75,
        }))

    def test_overlapping_rescue_caption_deduplicates_when_one_text_contains_the_other(self) -> None:
        merged = Transcriber.merge_transcript_results([
            {
                "language": "ja",
                "segments": [{
                    "start": 39.08,
                    "end": 40.31,
                    "text": "バグは何?",
                    "confidence": 0.68,
                }],
            },
            {
                "language": "ja",
                "segments": [{
                    "start": 38.67,
                    "end": 40.54,
                    "text": "そのバグは何?",
                    "confidence": 0.79,
                }],
            },
        ])

        self.assertEqual(len(merged["segments"]), 1)
        self.assertEqual(merged["segments"][0]["text"], "そのバグは何?")

    def test_hallucinations_are_rejected_but_low_confidence_speech_is_kept_for_review(self) -> None:
        accepted, rejected = Transcriber._filter_segments([
            {
                "start": 0.0,
                "end": 1.0,
                "text": "ご視聴ありがとうございました",
                "confidence": 0.90,
            },
            {
                "start": 2.0,
                "end": 3.0,
                "text": "聞こえるかな",
                "confidence": 0.10,
            },
            {
                "start": 4.0,
                "end": 5.5,
                "text": "ここに敵がいる",
                "confidence": 0.80,
            },
            {
                "start": 6.0,
                "end": 7.0,
                "text": "次の動画でお会いしましょう",
                "confidence": 0.95,
            },
            {
                "start": 8.0,
                "end": 9.0,
                "text": "敵いる敵いる敵いる",
                "confidence": 0.90,
            },
            {
                "start": 10.0,
                "end": 20.0,
                "text": "音楽",
                "confidence": 0.90,
            },
            {
                "start": 20.0,
                "end": 40.0,
                "text": "テストテストテストテストテストテストテストテストテストテスト",
                "confidence": 0.90,
            },
        ])

        self.assertEqual(
            [segment["text"] for segment in accepted],
            ["聞こえるかな", "ここに敵がいる", "敵いる敵いる敵いる"],
        )
        self.assertIn("needs_review", accepted[0]["flags"])
        self.assertIn("needs_review", accepted[2]["flags"])
        self.assertEqual(
            [reason for _, reason in rejected],
            ["known_hallucination", "known_hallucination", "non_speech", "repetition"],
        )

    def test_whisper_json_tolerates_invalid_token_utf8(self) -> None:
        payload = (
            b'{"result":{"language":"ja"},"transcription":[{'
            b'"offsets":{"from":1000,"to":2000},"text":"valid",'
            b'"tokens":[{"text":"\xff","p":0.8}]}]}'
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            json_path = Path(temp_dir) / "whisper.json"
            json_path.write_bytes(payload)
            segments, language = Transcriber._segments_from_whisper_json(str(json_path))

        self.assertEqual(language, "ja")
        self.assertEqual(segments[0]["text"], "valid")
        self.assertEqual(segments[0]["confidence"], 0.8)

    def test_guided_candidate_requires_confidence_gain_and_text_agreement(self) -> None:
        glossary = {
            "terms": [
                {"canonical": "Bサイファー", "variants": ["ビーサイファー", "B-Cypher"]},
            ],
        }
        original = {"text": "Bサイファー", "confidence": 0.60}

        self.assertTrue(Transcriber._guided_candidate_is_safe(
            original,
            {"text": "Bサイファー", "confidence": 0.82},
            glossary,
        ))
        self.assertFalse(Transcriber._guided_candidate_is_safe(
            original,
            {"text": "Bサイファー", "confidence": 0.64},
            glossary,
        ))
        self.assertFalse(Transcriber._guided_candidate_is_safe(
            original,
            {"text": "全然違う長い文章です", "confidence": 0.99},
            glossary,
        ))

    def test_refinement_windows_use_context_without_neighboring_captions(self) -> None:
        segments = [
            {"start": 1.0, "end": 2.0, "text": "前", "confidence": 0.95},
            {"start": 3.0, "end": 4.0, "text": "対象字幕", "confidence": 0.60},
            {"start": 4.5, "end": 5.0, "text": "後", "confidence": 0.95},
        ]

        targets = Transcriber._refinement_targets(segments, 10.0)

        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0]["index"], 1)
        self.assertEqual(targets[0]["window"], (2.05, 4.45))

    def test_guided_candidate_is_selected_by_original_timing(self) -> None:
        original = {"start": 10.0, "end": 11.0, "text": "ビーサイファー", "confidence": 0.5}
        guided_segments = [
            {"start": 8.5, "end": 9.2, "text": "前の発言", "confidence": 0.9},
            {"start": 10.1, "end": 10.9, "text": "Bサイファー", "confidence": 0.9},
        ]

        candidate = Transcriber._guided_candidate_for_window(
            original,
            guided_segments,
            (8.0, 12.0),
        )

        self.assertIsNotNone(candidate)
        self.assertEqual(candidate["text"], "Bサイファー")


if __name__ == "__main__":
    unittest.main()
