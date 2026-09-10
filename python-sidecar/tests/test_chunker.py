import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import Mock, patch


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from pipeline.chunker import Chunker, _parse_duration_from_ffmpeg_probe, _run_ffmpeg_probe


class ChunkerTrackClassificationTests(unittest.TestCase):
    def test_current_capture_shape_keeps_only_the_clear_mic_track(self) -> None:
        voice, game = Chunker._classify_audio_tracks({
            0: {"rms": 0.064, "silence_ratio": 0.477},
            1: {"rms": 0.059, "silence_ratio": 0.547},
            2: {"rms": 0.027, "silence_ratio": 0.853},
        })

        self.assertEqual(voice, [2])
        self.assertEqual(game, [0, 1])

    def test_similar_secondary_voice_track_is_kept_out_of_subtitles(self) -> None:
        voice, game = Chunker._classify_audio_tracks({
            0: {"rms": 0.020, "silence_ratio": 0.82},
            1: {"rms": 0.025, "silence_ratio": 0.75},
            2: {"rms": 0.070, "silence_ratio": 0.30},
        })

        self.assertEqual(voice, [0])
        self.assertEqual(game, [1, 2])

    def test_fallback_keeps_the_noisiest_track_for_game_audio(self) -> None:
        voice, game = Chunker._classify_audio_tracks({
            0: {"rms": 0.030, "silence_ratio": 0.60},
            1: {"rms": 0.040, "silence_ratio": 0.50},
            2: {"rms": 0.080, "silence_ratio": 0.40},
        })

        self.assertEqual(voice, [0])
        self.assertEqual(game, [1, 2])

    def test_completely_silent_track_is_not_selected_as_microphone(self) -> None:
        voice, game = Chunker._classify_audio_tracks({
            0: {"rms": 0.0, "silence_ratio": 1.0},
            1: {"rms": 0.020, "silence_ratio": 0.82},
            2: {"rms": 0.080, "silence_ratio": 0.30},
        })

        self.assertEqual(voice, [1])
        self.assertEqual(game, [0, 2])


class ChunkerMediaProbeTests(unittest.TestCase):
    @patch("pipeline.chunker.subprocess.run")
    def test_ffmpeg_probe_decodes_utf8_paths_on_windows(self, run: Mock) -> None:
        run.return_value = Mock(
            stdout="",
            stderr=(
                "Input #0, mov, from 'C:/動画/無音.mp4':\n"
                "  Duration: 00:00:12.03, start: 0.000000\n"
            ),
        )

        output = _run_ffmpeg_probe("C:/動画/無音.mp4")

        self.assertAlmostEqual(_parse_duration_from_ffmpeg_probe(output), 12.03)
        self.assertEqual(run.call_args.kwargs["encoding"], "utf-8")
        self.assertEqual(run.call_args.kwargs["errors"], "replace")

    @patch("pipeline.chunker._run_ffmpeg_probe")
    @patch.dict("os.environ", {"VFOCUS_FFMPEG_PATH": "ffmpeg.exe"}, clear=False)
    def test_managed_ffmpeg_reports_zero_audio_streams(self, probe: Mock) -> None:
        probe.return_value = (
            "Duration: 00:00:12.03\n"
            "Stream #0:0: Video: h264, 1080x1920\n"
        )

        chunker = Chunker()
        self.assertEqual(chunker._get_audio_stream_count("C:/動画/無音.mp4"), 0)
        self.assertEqual(chunker.detect_audio_tracks("C:/動画/無音.mp4"), {
            "voice_tracks": [],
            "game_tracks": [],
            "stream_count": 0,
            "track_stats": [],
        })

    def test_audio_less_video_gets_chunk_length_silence(self) -> None:
        chunker = Chunker()
        chunker._stream_count = 0
        chunk = {
            "index": 2,
            "start_time": 3.25,
            "end_time": 4.75,
        }

        with tempfile.TemporaryDirectory() as output_dir:
            output_path = chunker.extract_chunk_audio(
                "C:/動画/無音.mp4",
                chunk,
                output_dir,
                sample_rate=16000,
            )
            with wave.open(output_path, "rb") as wav_file:
                self.assertEqual(wav_file.getnchannels(), 1)
                self.assertEqual(wav_file.getsampwidth(), 2)
                self.assertEqual(wav_file.getframerate(), 16000)
                self.assertEqual(wav_file.getnframes(), 24000)
                self.assertEqual(wav_file.readframes(24000), b"\x00\x00" * 24000)

    @patch("pipeline.chunker.wave.open")
    def test_failed_silence_write_removes_partial_file(self, open_wave: Mock) -> None:
        class FailingWave:
            def __init__(self, path: str) -> None:
                self.path = path

            def __enter__(self):
                Path(self.path).write_bytes(b"partial")
                return self

            def __exit__(self, *_args) -> None:
                return None

            def setnchannels(self, _value: int) -> None:
                raise OSError("disk full")

        open_wave.side_effect = lambda path, _mode: FailingWave(path)
        with tempfile.TemporaryDirectory() as output_dir:
            with self.assertRaisesRegex(OSError, "disk full"):
                Chunker._create_silent_audio(
                    {"index": 0, "start_time": 0.0, "end_time": 1.0},
                    output_dir,
                    16000,
                )
            self.assertEqual(list(Path(output_dir).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
