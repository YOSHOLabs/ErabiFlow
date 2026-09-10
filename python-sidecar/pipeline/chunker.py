"""
Chunker — 5分チャンク分割
長時間動画（1時間程度）を5分ごとにチャンク分割して処理するための管理モジュール。
実際のファイル分割は行わず、タイムレンジ情報を管理する。
音声はチャンクごとに切り出し可能。
"""

import os
import sys
import subprocess
import tempfile
import wave
import re


FFPROBE_TIMEOUT_SEC = 30
FFMPEG_SAMPLE_TIMEOUT_SEC = 60
FFMPEG_EXTRACT_TIMEOUT_SEC = 180


def _subprocess_creationflags() -> int:
    return subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def _ffmpeg_cmd() -> str:
    return os.environ.get("VFOCUS_FFMPEG_PATH") or "ffmpeg"


def _ffprobe_cmd() -> str:
    return os.environ.get("VFOCUS_FFPROBE_PATH") or "ffprobe"


def _run_ffmpeg_probe(video_path: str) -> str:
    """ffmpeg -i のstderrからメディア情報を取得する。"""
    result = subprocess.run(
        [_ffmpeg_cmd(), "-hide_banner", "-i", video_path],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=FFPROBE_TIMEOUT_SEC,
        creationflags=_subprocess_creationflags(),
    )
    return f"{result.stdout}\n{result.stderr}"


def _parse_duration_from_ffmpeg_probe(probe_text: str) -> float:
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", probe_text)
    if not match:
        raise ValueError("ffmpeg probe output did not contain Duration")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


class Chunker:
    """
    長時間動画をチャンクに分割。
    チャンク境界の前後にオーバーラップを持たせて境界跨ぎを防止。
    複数音声トラックがある場合、声トラック/ゲーム音トラックを自動判別する。
    """

    def __init__(
        self,
        chunk_duration: float = 300.0,  # 5分
        overlap: float = 2.0,           # 境界前後2秒のオーバーラップ
    ):
        self.chunk_duration = chunk_duration
        self.overlap = overlap
        # detect_audio_tracks() の結果をキャッシュ
        self._voice_tracks = None
        self._game_tracks = None
        self._stream_count = None
        self._track_stats = None

    @staticmethod
    def _classify_audio_tracks(track_stats: dict) -> tuple:
        """字幕用の主マイクを1本だけ選び、残りをゲーム音として扱う。

        複数の「声らしい」トラックをすべて文字起こしすると、ゲーム内VCや
        Discordまで字幕化される。発話のない時間が多く、かつ完全な無音では
        ないトラックを主マイクとして選ぶ。
        """
        if not track_stats:
            return [], []

        active_tracks = [
            (idx, stats)
            for idx, stats in track_stats.items()
            if float(stats.get('rms') or 0.0) >= 0.001
        ]
        candidates = active_tracks or list(track_stats.items())
        primary_idx, _ = max(
            candidates,
            key=lambda item: (
                float(item[1].get('silence_ratio') or 0.0),
                float(item[1].get('rms') or 0.0),
            ),
        )

        voice_tracks = [primary_idx]
        game_tracks = [idx for idx in track_stats if idx != primary_idx]
        return voice_tracks, game_tracks

    def get_chunks(self, video_path: str) -> list:
        """
        動画のチャンク情報を生成。

        Args:
            video_path: 動画ファイルパス

        Returns:
            [{
                'index': int,
                'start_time': float,
                'end_time': float,
                'effective_start': float,  # オーバーラップ除外後の実効開始
                'effective_end': float,    # オーバーラップ除外後の実効終了
            }]
        """
        duration = self._get_duration(video_path)
        print(f"  チャンク分割: 総時間={duration:.1f}s, チャンクサイズ={self.chunk_duration}s")

        chunks = []
        index = 0
        t = 0.0

        while t < duration:
            chunk_start = max(0.0, t - self.overlap) if index > 0 else 0.0
            chunk_end = min(t + self.chunk_duration + self.overlap, duration)
            effective_start = t
            effective_end = min(t + self.chunk_duration, duration)

            chunks.append({
                'index': index,
                'start_time': round(chunk_start, 3),
                'end_time': round(chunk_end, 3),
                'effective_start': round(effective_start, 3),
                'effective_end': round(effective_end, 3),
            })

            t += self.chunk_duration
            index += 1

        print(f"   完了 {len(chunks)}チャンク生成 (オーバーラップ={self.overlap}s)")
        return chunks

    # =========================================================================
    # 音声トラック判別
    # =========================================================================

    def _get_audio_stream_count(self, video_path: str) -> int:
        """ffprobeで音声トラック数を取得"""
        cmd = [
            _ffprobe_cmd(), "-v", "error", "-select_streams", "a",
            "-show_entries", "stream=index", "-of", "csv=p=0", video_path
        ]
        try:
            if os.environ.get("VFOCUS_FFMPEG_PATH") and not os.environ.get("VFOCUS_FFPROBE_PATH"):
                probe_text = _run_ffmpeg_probe(video_path)
                return len(re.findall(r"Stream #\d+:\d+[^\n]*Audio:", probe_text))

            res = subprocess.run(
                cmd,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                check=True,
                timeout=FFPROBE_TIMEOUT_SEC,
                creationflags=_subprocess_creationflags(),
            )
            return len([line for line in res.stdout.strip().split('\n') if line])
        except Exception:
            return 1

    def detect_audio_tracks(self, video_path: str, transcriber=None) -> dict:
        """
        動画の音声トラックを分析し、声トラックとゲーム音トラックを判別する。
        
        動画内の3地点から各10秒のRMSエネルギーと無音率を計測し、
        無音率が高いトラック = 声（マイク/Discord）、
        無音率が低いトラック = ゲーム音（常時BGMが鳴っている）と判定する。
        
        Whisperを使わないため高速（数秒で完了）。
        
        Args:
            video_path: 動画ファイルパス
            transcriber: 未使用（互換性のために残す）
        
        Returns:
            {
                'voice_tracks': [int],   # 声が入っているトラックのインデックス (0-based)
                'game_tracks': [int],    # ゲーム音のトラックのインデックス (0-based)
                'stream_count': int,     # 総トラック数
            }
        """
        import struct
        
        # キャッシュがあればそれを返す
        if self._voice_tracks is not None:
            return {
                'voice_tracks': self._voice_tracks,
                'game_tracks': self._game_tracks,
                'stream_count': self._stream_count,
                'track_stats': self._track_stats or [],
            }

        stream_count = self._get_audio_stream_count(video_path)
        self._stream_count = stream_count

        if stream_count == 0:
            self._voice_tracks = []
            self._game_tracks = []
            self._track_stats = []
            print("  [トラック判別] 音声トラックなし", file=sys.stderr)
            return {
                'voice_tracks': [],
                'game_tracks': [],
                'stream_count': 0,
                'track_stats': [],
            }
        
        # トラックが1つだけなら判別不要
        if stream_count == 1:
            self._voice_tracks = [0]
            self._game_tracks = []
            self._track_stats = [{
                'track': 0,
                'role': 'voice',
                'rms': None,
                'silence_ratio': None,
            }]
            print(f"  [トラック判別] 音声トラック: 1本 → 判別スキップ", file=sys.stderr)
            return {
                'voice_tracks': [0],
                'game_tracks': [],
                'stream_count': 1,
                'track_stats': self._track_stats,
            }

        print(f"  [トラック判別] {stream_count}本の音声トラックを検出。RMSエネルギー分析開始...", file=sys.stderr)
        
        # 動画の前半・中央・後半を均等に確認し、冒頭30秒だけの偏りを避ける。
        track_stats = {}  # {track_idx: {'rms': float, 'silence_ratio': float}}
        tmp_dir = tempfile.gettempdir()
        try:
            media_duration = self._get_duration(video_path)
        except Exception:
            media_duration = 0.0
        sample_duration = min(10.0, media_duration) if media_duration > 0 else 10.0
        if media_duration > sample_duration:
            sample_starts = sorted({
                round(
                    max(0.0, min(media_duration - sample_duration, media_duration * fraction - sample_duration / 2)),
                    3,
                )
                for fraction in (0.15, 0.50, 0.85)
            })
        else:
            sample_starts = [0.0]

        for track_idx in range(stream_count):
            sample_paths = []
            try:
                pcm_data = bytearray()
                for sample_index, sample_start in enumerate(sample_starts):
                    sample_path = os.path.join(
                        tmp_dir,
                        f"_track_rms_{os.getpid()}_{track_idx}_{sample_index}.wav",
                    )
                    sample_paths.append(sample_path)
                    cmd = [
                        _ffmpeg_cmd(), "-y",
                        "-ss", str(sample_start),
                        "-t", str(sample_duration),
                        "-i", video_path,
                        "-map", f"0:a:{track_idx}",
                        "-vn",
                        "-acodec", "pcm_s16le",
                        "-ar", "16000",
                        "-ac", "1",
                        sample_path,
                    ]
                    subprocess.run(
                        cmd,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.PIPE,
                        check=True,
                        timeout=FFMPEG_SAMPLE_TIMEOUT_SEC,
                        creationflags=_subprocess_creationflags(),
                    )
                    with wave.open(sample_path, "rb") as wav_file:
                        pcm_data.extend(wav_file.readframes(wav_file.getnframes()))

                num_samples = len(pcm_data) // 2
                
                if num_samples > 0:
                    sum_sq = 0.0
                    silent_count = 0
                    silence_threshold = 0.01  # -40dB相当
                    
                    for i in range(0, len(pcm_data) - 1, 2):
                        sample = struct.unpack_from('<h', pcm_data, i)[0] / 32768.0
                        sum_sq += sample * sample
                        if abs(sample) < silence_threshold:
                            silent_count += 1
                    
                    rms = (sum_sq / num_samples) ** 0.5
                    silence_ratio = silent_count / num_samples
                else:
                    rms = 0.0
                    silence_ratio = 1.0
                
                track_stats[track_idx] = {
                    'rms': rms,
                    'silence_ratio': silence_ratio,
                }
                print(
                    f"    トラック {track_idx}: RMS={rms:.6f}, "
                    f"無音率={silence_ratio:.1%} ({len(sample_starts)}区間)",
                    file=sys.stderr,
                )
                    
            except Exception as e:
                print(f"    トラック {track_idx}: 分析失敗 ({e})", file=sys.stderr)
                track_stats[track_idx] = {'rms': 0.0, 'silence_ratio': 1.0}
            finally:
                for sample_path in sample_paths:
                    try:
                        if os.path.exists(sample_path):
                            os.remove(sample_path)
                    except OSError:
                        pass
        
        # 判定ロジック:
        # ゲーム音 = 常時BGMが鳴っている → 無音率が低い（常に音が出ている）
        # マイク/Discord = 喋る時だけ音が出る → 無音率が高い
        # 閾値: 無音率 70% 以上なら声トラック
        voice_tracks, game_tracks = self._classify_audio_tracks(track_stats)
        
        self._voice_tracks = voice_tracks
        self._game_tracks = game_tracks
        self._track_stats = [
            {
                'track': idx,
                'role': 'voice' if idx in voice_tracks else 'game',
                'rms': round(float(stats.get('rms', 0.0)), 6),
                'silence_ratio': round(float(stats.get('silence_ratio', 0.0)), 4),
            }
            for idx, stats in sorted(track_stats.items())
        ]
        
        print(f"  [トラック判別] 結果: 声トラック={voice_tracks}, ゲーム音トラック={game_tracks}", file=sys.stderr)
        
        return {
            'voice_tracks': voice_tracks,
            'game_tracks': game_tracks,
            'stream_count': stream_count,
            'track_stats': self._track_stats,
        }

    # =========================================================================
    # 音声抽出
    # =========================================================================

    def _extract_tracks(
        self,
        video_path: str,
        chunk: dict,
        output_dir: str,
        track_indices: list,
        sample_rate: int = 16000,
        suffix: str = "",
    ) -> str:
        """
        指定されたトラックの音声をWAVとして切り出す。
        複数トラックが指定された場合はamixでミックスダウンする。
        """
        import uuid
        uid = uuid.uuid4().hex[:8]
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(
            output_dir,
            f"chunk_{uid}_{chunk['index']:03d}{suffix}.wav"
        )

        cmd = [
            _ffmpeg_cmd(), "-y",
            "-ss", str(chunk['start_time']),
            "-to", str(chunk['end_time']),
            "-i", video_path,
            "-vn",
        ]

        if len(track_indices) == 1:
            # 単一トラック: -map で直接指定
            cmd.extend(["-map", f"0:a:{track_indices[0]}"])
        elif len(track_indices) > 1:
            # 複数トラック: amix でミックス
            # normalize=0 で音量の自動正規化を無効化（amixはデフォルトで各入力を1/Nに下げる）
            filter_inputs = "".join([f"[0:a:{i}]" for i in track_indices])
            cmd.extend([
                "-filter_complex",
                f"{filter_inputs}amix=inputs={len(track_indices)}:duration=longest:dropout_transition=0:normalize=0"
            ])

        cmd.extend([
            "-acodec", "pcm_s16le",
            "-ar", str(sample_rate),
            "-ac", "1",
            output_path,
        ])

        subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            check=True,
            timeout=FFMPEG_EXTRACT_TIMEOUT_SEC,
            creationflags=_subprocess_creationflags(),
        )

        return output_path

    @staticmethod
    def _create_silent_audio(
        chunk: dict,
        output_dir: str,
        sample_rate: int,
    ) -> str:
        """音声トラックがない動画用に、同じ長さの無音WAVを生成する。"""
        import uuid

        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(
            output_dir,
            f"chunk_{uuid.uuid4().hex[:8]}_{chunk['index']:03d}_silent.wav",
        )
        duration = max(0.0, float(chunk['end_time']) - float(chunk['start_time']))
        remaining_frames = max(1, int(round(duration * sample_rate)))
        silence_block = b"\x00\x00" * min(sample_rate, remaining_frames)

        try:
            with wave.open(output_path, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(sample_rate)
                while remaining_frames > 0:
                    block_frames = min(remaining_frames, len(silence_block) // 2)
                    wav_file.writeframesraw(silence_block[:block_frames * 2])
                    remaining_frames -= block_frames
        except Exception:
            try:
                if os.path.exists(output_path):
                    os.remove(output_path)
            except OSError:
                pass
            raise

        return output_path

    def extract_chunk_audio(
        self,
        video_path: str,
        chunk: dict,
        output_dir: str,
        sample_rate: int = 16000,
        track_type: str = "voice",
    ) -> str:
        """
        チャンクの音声をWAVファイルとして切り出し。
        
        Args:
            video_path: 元動画のパス
            chunk: get_chunks()の要素
            output_dir: 出力先ディレクトリ
            sample_rate: サンプリングレート
            track_type: "voice" = 声トラックのみ, "game" = ゲーム音トラックのみ, "all" = 全トラックミックス
        
        Returns:
            出力WAVファイルのパス
        """
        stream_count = self._stream_count if self._stream_count is not None else self._get_audio_stream_count(video_path)

        if stream_count == 0:
            return self._create_silent_audio(chunk, output_dir, sample_rate)
        
        # トラックが1本のみの場合はそのまま抽出
        if stream_count == 1:
            return self._extract_tracks(video_path, chunk, output_dir, [0], sample_rate)
        
        # トラック判別結果に基づいて抽出対象を決定
        if track_type == "voice" and self._voice_tracks:
            tracks = self._voice_tracks
            suffix = "_voice"
        elif track_type == "game" and self._game_tracks:
            tracks = self._game_tracks
            suffix = "_game"
        else:
            # フォールバック: 全トラックをミックス
            tracks = list(range(stream_count))
            suffix = "_all"
        
        return self._extract_tracks(video_path, chunk, output_dir, tracks, sample_rate, suffix)

    def extract_chunk_track_audio(
        self,
        video_path: str,
        chunk: dict,
        output_dir: str,
        track_index: int,
        sample_rate: int = 16000,
    ) -> str:
        """指定した1トラックだけを文字起こし用WAVとして抽出する。"""
        return self._extract_tracks(
            video_path,
            chunk,
            output_dir,
            [track_index],
            sample_rate,
            f"_track_{track_index}",
        )

    def _get_duration(self, video_path: str) -> float:
        """FFprobeで動画の長さを取得"""
        cmd = [
            _ffprobe_cmd(),
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            video_path,
        ]
        if os.environ.get("VFOCUS_FFMPEG_PATH") and not os.environ.get("VFOCUS_FFPROBE_PATH"):
            return _parse_duration_from_ffmpeg_probe(_run_ffmpeg_probe(video_path))

        result = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=True,
            timeout=FFPROBE_TIMEOUT_SEC,
            creationflags=_subprocess_creationflags(),
        )
        return float(result.stdout.strip())


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python chunker.py <video_path>")
        sys.exit(1)
    c = Chunker()
    chunks = c.get_chunks(sys.argv[1])
    for ch in chunks:
        print(f"  Chunk {ch['index']}: {ch['start_time']:.1f}s - {ch['end_time']:.1f}s "
              f"(effective: {ch['effective_start']:.1f}s - {ch['effective_end']:.1f}s)")
