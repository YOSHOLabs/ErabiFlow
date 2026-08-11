"""FFmpeg の標準フィルターから軽量な音響・映像信号を抽出する。

このモジュールは追加の Python 数値計算依存を持たない。FFmpeg が一部の
フィルターを提供しない場合やメディアに対象ストリームがない場合は、利用可能な
信号だけを返し、既存の音声ベース解析を継続できるようにする。
"""

from __future__ import annotations

import math
import os
import re
import subprocess
import threading
from collections import deque
from typing import Callable, Optional


KEYFRAME_SAMPLING_THRESHOLD_SECONDS = 5.0 * 60.0


def should_sample_keyframes(video_duration: object) -> bool:
    """長尺入力ではdecoder側で非キーフレームを省き、全編decodeを避ける。"""
    try:
        duration = float(video_duration)
    except (TypeError, ValueError):
        return False
    return math.isfinite(duration) and duration >= KEYFRAME_SAMPLING_THRESHOLD_SECONDS


_PTS_TIME_RE = re.compile(r"(?:pts_time[:=])\s*([-+0-9.eE]+)")
_METADATA_RE = re.compile(r"^(lavfi\.[A-Za-z0-9_.]+)=([-+0-9.eE]+)$")
_AUDIO_KEYS = {"lavfi.r128.M", "lavfi.r128.S", "lavfi.r128.I"}
_VIDEO_KEYS = {
    "lavfi.scd.score",
    "lavfi.scd.time",
    "lavfi.scd.mafd",
    "lavfi.signalstats.YAVG",
    "lavfi.signalstats.YDIF",
    "lavfi.signalstats.SATAVG",
}


def _creation_flags() -> int:
    return subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def _finite_float(value: str) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


class _MetadataStreamParser:
    """FFmpeg metadata を逐次パースし、指定間隔で間引いて保持する。"""

    def __init__(
        self,
        sample_interval: float = 0.0,
        allowed_keys: Optional[set[str]] = None,
    ) -> None:
        self.frames: list[dict] = []
        self.current: Optional[dict] = None
        self.sample_interval = max(0.0, float(sample_interval))
        self.last_kept_time: Optional[float] = None
        self.allowed_keys = allowed_keys

    def _flush(self) -> None:
        if self.current is not None and isinstance(self.current.get("time"), float):
            time_value = float(self.current["time"])
            if (
                self.last_kept_time is None
                or time_value - self.last_kept_time >= self.sample_interval - 1e-6
            ):
                self.frames.append(self.current)
                self.last_kept_time = time_value
        self.current = None

    def feed_line(self, raw_line: str) -> None:
        line = raw_line.strip()
        pts_match = _PTS_TIME_RE.search(line)
        if pts_match:
            self._flush()
            time_value = _finite_float(pts_match.group(1))
            self.current = {"time": time_value} if time_value is not None else None
            return

        metadata_match = _METADATA_RE.match(line)
        if not metadata_match:
            return
        if self.allowed_keys is not None and metadata_match.group(1) not in self.allowed_keys:
            return
        value = _finite_float(metadata_match.group(2))
        if value is None:
            return
        if self.current is None:
            self.current = {"time": None}
        self.current[metadata_match.group(1)] = value

    def finish(self) -> list[dict]:
        self._flush()
        return self.frames


def parse_ffmpeg_metadata(output: str) -> list[dict]:
    """``metadata=print`` / ``ametadata=print`` の出力をフレーム単位にする。"""
    parser = _MetadataStreamParser()
    for raw_line in (output or "").splitlines():
        parser.feed_line(raw_line)
    return parser.finish()


def _run_ffmpeg_metadata(
    command: list[str],
    cancel_check: Optional[Callable[[], None]] = None,
    sample_interval: float = 0.0,
    allowed_keys: Optional[set[str]] = None,
) -> list[dict]:
    """metadata を逐次集約し、daemon stdin とメモリを占有せずに実行する。"""
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=_creation_flags(),
    )
    parser = _MetadataStreamParser(
        sample_interval=sample_interval,
        allowed_keys=allowed_keys,
    )
    stderr_tail: deque[str] = deque(maxlen=4)
    reader_errors: list[BaseException] = []

    def read_stdout() -> None:
        try:
            if process.stdout is not None:
                for line in process.stdout:
                    parser.feed_line(line)
        except BaseException as exc:
            reader_errors.append(exc)

    def read_stderr() -> None:
        try:
            if process.stderr is not None:
                for line in process.stderr:
                    stripped = line.strip()
                    if stripped:
                        stderr_tail.append(stripped)
        except BaseException as exc:
            reader_errors.append(exc)

    readers = [
        threading.Thread(target=read_stdout, daemon=True, name="media-metadata-stdout"),
        threading.Thread(target=read_stderr, daemon=True, name="media-metadata-stderr"),
    ]
    for reader in readers:
        reader.start()

    try:
        while process.poll() is None:
            if cancel_check is not None:
                cancel_check()
            try:
                process.wait(timeout=0.25)
            except subprocess.TimeoutExpired:
                pass
    except BaseException:
        if process.poll() is None:
            process.kill()
        process.wait()
        for reader in readers:
            reader.join(timeout=2.0)
        raise

    for reader in readers:
        reader.join(timeout=2.0)
    if any(reader.is_alive() for reader in readers):
        raise RuntimeError("FFmpeg metadata reader did not finish")
    if reader_errors:
        raise RuntimeError(f"FFmpeg metadata reader failed: {reader_errors[0]}")

    if process.returncode != 0:
        detail = " | ".join(stderr_tail)
        raise RuntimeError(detail or f"FFmpeg exited with code {process.returncode}")
    return parser.finish()


class MediaSignalAnalyzer:
    """知覚音量と低レート映像統計を、動画全体から一度だけ抽出する。"""

    def __init__(
        self,
        ffmpeg_path: Optional[str] = None,
        runner: Optional[Callable[[list[str], Optional[Callable[[], None]]], object]] = None,
        video_fps: float = 2.0,
    ) -> None:
        self.ffmpeg_path = ffmpeg_path or os.environ.get("VFOCUS_FFMPEG_PATH") or "ffmpeg"
        self.runner = runner
        self.video_fps = max(0.5, min(5.0, float(video_fps)))

    def analyze(
        self,
        media_path: str,
        cancel_check: Optional[Callable[[], None]] = None,
        progress_callback: Optional[Callable[[float, str], None]] = None,
        audio_track_indices: Optional[list[int]] = None,
        keyframes_only: bool = False,
    ) -> dict:
        if not os.path.exists(media_path):
            raise FileNotFoundError(f"ファイルが見つかりません: {media_path}")

        result = {
            "audio_loudness": [],
            "video_frames": [],
            "scene_changes": [],
            "available": {"audio_loudness": False, "visual": False},
            "video_sampling": "keyframes" if keyframes_only else f"{self.video_fps:g}fps",
            "warnings": [],
        }

        if progress_callback:
            progress_callback(0.0, "知覚音量を抽出中...")
        try:
            audio_output = self._metadata_output(
                self._audio_command(media_path, audio_track_indices or [0]),
                cancel_check,
                sample_interval=0.5,
                allowed_keys=_AUDIO_KEYS,
            )
            result["audio_loudness"] = self._audio_frames(audio_output)
            result["available"]["audio_loudness"] = bool(result["audio_loudness"])
        except Exception as exc:
            if cancel_check is not None:
                cancel_check()
            result["warnings"].append(
                f"知覚音量を取得できませんでした（{type(exc).__name__}）"
            )

        if progress_callback:
            progress_callback(0.5, "低レート映像信号を抽出中...")
        try:
            video_output = self._metadata_output(
                self._video_command(media_path, keyframes_only=keyframes_only),
                cancel_check,
                allowed_keys=_VIDEO_KEYS,
            )
            frames, scene_changes = self._video_frames(video_output)
            result["video_frames"] = frames
            result["scene_changes"] = scene_changes
            result["available"]["visual"] = bool(frames)
        except Exception as exc:
            if cancel_check is not None:
                cancel_check()
            result["warnings"].append(
                f"映像信号を取得できませんでした（{type(exc).__name__}）"
            )

        if progress_callback:
            progress_callback(1.0, "メディア信号の抽出完了")
        return result

    def _metadata_output(
        self,
        command: list[str],
        cancel_check: Optional[Callable[[], None]],
        sample_interval: float = 0.0,
        allowed_keys: Optional[set[str]] = None,
    ) -> object:
        if self.runner is not None:
            return self.runner(command, cancel_check)
        return _run_ffmpeg_metadata(
            command,
            cancel_check,
            sample_interval=sample_interval,
            allowed_keys=allowed_keys,
        )

    def _audio_command(self, media_path: str, audio_track_indices: list[int]) -> list[str]:
        tracks = list(dict.fromkeys(max(0, int(index)) for index in audio_track_indices)) or [0]
        command = [
            self.ffmpeg_path,
            "-hide_banner",
            "-nostdin",
            "-nostats",
            "-loglevel",
            "error",
            "-i",
            media_path,
            "-vn",
        ]

        loudness_filters = "ebur128=metadata=1,ametadata=mode=print:file=-"
        if len(tracks) == 1:
            command.extend(["-map", f"0:a:{tracks[0]}", "-af", loudness_filters])
        else:
            inputs = "".join(f"[0:a:{index}]" for index in tracks)
            command.extend([
                "-filter_complex",
                f"{inputs}amix=inputs={len(tracks)}:normalize=0,{loudness_filters}[loudness]",
                "-map",
                "[loudness]",
            ])
        command.extend(["-f", "null", "-"])
        return command

    def _video_command(self, media_path: str, keyframes_only: bool = False) -> list[str]:
        prefix = "" if keyframes_only else f"fps={self.video_fps:g},"
        filter_chain = (
            f"{prefix}scale=320:-2:flags=fast_bilinear,"
            "signalstats,scdet=t=10,metadata=mode=print:file=-"
        )
        command = [
            self.ffmpeg_path,
            "-hide_banner",
            "-nostdin",
            "-nostats",
            "-loglevel",
            "error",
        ]
        if keyframes_only:
            command.extend(["-skip_frame", "nokey"])
        command.extend([
            "-i", media_path,
            "-map",
            "0:v:0",
            "-an",
            "-vf",
            filter_chain,
            "-f",
            "null",
            "-",
        ])
        return command

    @staticmethod
    def _audio_frames(output: object) -> list[dict]:
        frames = []
        raw_frames = parse_ffmpeg_metadata(output) if isinstance(output, str) else list(output or [])
        for raw in raw_frames:
            momentary = raw.get("lavfi.r128.M")
            short_term = raw.get("lavfi.r128.S")
            integrated = raw.get("lavfi.r128.I")
            if not any(isinstance(value, float) for value in (momentary, short_term, integrated)):
                continue
            frames.append({
                "time": round(raw["time"], 3),
                "momentary": momentary,
                "short_term": short_term,
                "integrated": integrated,
            })
        return frames

    @staticmethod
    def _video_frames(output: object) -> tuple[list[dict], list[float]]:
        frames = []
        scene_changes = []
        raw_frames = parse_ffmpeg_metadata(output) if isinstance(output, str) else list(output or [])
        for raw in raw_frames:
            time_value = raw["time"]
            scene_score = raw.get("lavfi.scd.score")
            detected_time = raw.get("lavfi.scd.time")
            if isinstance(detected_time, float):
                scene_changes.append(round(detected_time, 3))
            elif isinstance(scene_score, float) and scene_score >= 10.0:
                scene_changes.append(round(time_value, 3))

            frame = {
                "time": round(time_value, 3),
                "scene_score": scene_score,
                "mafd": raw.get("lavfi.scd.mafd"),
                "luma": raw.get("lavfi.signalstats.YAVG"),
                "luma_diff": raw.get("lavfi.signalstats.YDIF"),
                "saturation": raw.get("lavfi.signalstats.SATAVG"),
            }
            if any(isinstance(value, float) for key, value in frame.items() if key != "time"):
                frames.append(frame)

        return frames, sorted(set(scene_changes))
