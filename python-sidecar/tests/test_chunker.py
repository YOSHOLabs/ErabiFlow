import sys
import unittest
from pathlib import Path


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from pipeline.chunker import Chunker


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


if __name__ == "__main__":
    unittest.main()
