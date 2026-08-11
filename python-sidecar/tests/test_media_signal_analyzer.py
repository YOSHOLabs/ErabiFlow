import sys
import unittest
from pathlib import Path


SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from pipeline.media_signal_analyzer import (
    MediaSignalAnalyzer,
    parse_ffmpeg_metadata,
    should_sample_keyframes,
)


AUDIO_METADATA = """
frame:0 pts:0 pts_time:0
lavfi.r128.M=-31.2
lavfi.r128.S=-32.0
frame:1 pts:100 pts_time:0.1
lavfi.r128.M=-12.5
lavfi.r128.S=-20.0
"""

VIDEO_METADATA = """
frame:0 pts:0 pts_time:0
lavfi.signalstats.YAVG=40.0
lavfi.signalstats.YDIF=1.0
lavfi.scd.mafd=0.2
lavfi.scd.score=0.1
frame:1 pts:1 pts_time:0.5
lavfi.signalstats.YAVG=190.0
lavfi.signalstats.YDIF=24.0
lavfi.scd.mafd=18.0
lavfi.scd.score=12.0
lavfi.scd.time=0.5
"""


class MediaSignalAnalyzerTests(unittest.TestCase):
    def test_keyframe_sampling_starts_at_five_minutes(self) -> None:
        self.assertFalse(should_sample_keyframes(299.999))
        self.assertTrue(should_sample_keyframes(300.0))
        self.assertFalse(should_sample_keyframes(float("nan")))

    def test_metadata_parser_groups_values_by_frame(self) -> None:
        frames = parse_ffmpeg_metadata(AUDIO_METADATA)

        self.assertEqual(len(frames), 2)
        self.assertEqual(frames[0]["time"], 0.0)
        self.assertEqual(frames[1]["lavfi.r128.M"], -12.5)

    def test_analyzer_extracts_audio_and_visual_signals(self) -> None:
        commands = []

        def runner(command, _cancel_check):
            commands.append(command)
            return AUDIO_METADATA if "-af" in command else VIDEO_METADATA

        analyzer = MediaSignalAnalyzer(ffmpeg_path="managed-ffmpeg", runner=runner)
        result = analyzer.analyze(str(Path(__file__)), audio_track_indices=[2])

        self.assertTrue(result["available"]["audio_loudness"])
        self.assertTrue(result["available"]["visual"])
        self.assertEqual(result["audio_loudness"][1]["momentary"], -12.5)
        self.assertEqual(result["video_frames"][1]["scene_score"], 12.0)
        self.assertEqual(result["scene_changes"], [0.5])
        self.assertEqual(result["video_sampling"], "2fps")
        self.assertIn("-nostdin", commands[0])
        self.assertEqual(commands[0][commands[0].index("-map") + 1], "0:a:2")
        self.assertTrue(any("ebur128=metadata=1" in value for value in commands[0]))
        self.assertTrue(any("scdet=t=10" in value for value in commands[1]))

    def test_missing_video_filter_does_not_discard_audio_signal(self) -> None:
        def runner(command, _cancel_check):
            if "-vf" in command:
                raise RuntimeError("video stream not found")
            return AUDIO_METADATA

        result = MediaSignalAnalyzer(runner=runner).analyze(str(Path(__file__)))

        self.assertTrue(result["available"]["audio_loudness"])
        self.assertFalse(result["available"]["visual"])
        self.assertEqual(len(result["warnings"]), 1)
        self.assertNotIn(str(Path(__file__)), result["warnings"][0])

    def test_multiple_game_tracks_are_mixed_for_loudness(self) -> None:
        command = MediaSignalAnalyzer(ffmpeg_path="ffmpeg")._audio_command(
            "video.mp4",
            [1, 3],
        )
        filter_graph = command[command.index("-filter_complex") + 1]

        self.assertIn("[0:a:1][0:a:3]", filter_graph)
        self.assertIn("amix=inputs=2", filter_graph)
        self.assertEqual(command[command.index("-map") + 1], "[loudness]")

    def test_long_video_mode_scans_keyframes_without_fps_duplication(self) -> None:
        command = MediaSignalAnalyzer(ffmpeg_path="ffmpeg")._video_command(
            "video.mp4",
            keyframes_only=True,
        )
        filter_graph = command[command.index("-vf") + 1]

        self.assertEqual(command[command.index("-skip_frame") + 1], "nokey")
        self.assertNotIn("fps=", filter_graph)


if __name__ == "__main__":
    unittest.main()
