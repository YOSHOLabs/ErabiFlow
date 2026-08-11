"""
Audio Analysis Module (stdlib-first)
RMSエネルギー解析 + 簡易onset検出。

BETA配布では PyInstaller 版 daemon で librosa/numpy の import が長時間
止まるケースがあったため、標準ライブラリ中心の軽量実装にしている。
"""

import array
import math
import os
import subprocess
import tempfile
import wave


class AudioAnalyzer:
    """標準ライブラリ中心の軽量音声エネルギー解析"""

    def __init__(self, hop_length=512, sample_rate=22050, onset_delta=0.2):
        self.hop_length = hop_length
        self.sample_rate = sample_rate
        self.onset_delta = onset_delta

    def analyze(self, media_path: str, time_offset: float = 0.0) -> dict:
        """音声エネルギーを解析。Returns: {energy_timeline, onsets, high_energy_regions, stats}"""
        if not os.path.exists(media_path):
            raise FileNotFoundError(f"ファイルが見つかりません: {media_path}")

        print(f"  音声解析開始: {os.path.basename(media_path)} (offset={time_offset:.1f}s)")
        wav_path, cleanup_path = self._ensure_pcm16_mono_wav(media_path)
        try:
            samples, sr = self._read_pcm16_mono_wav(wav_path)
        finally:
            if cleanup_path:
                try:
                    os.remove(cleanup_path)
                except OSError:
                    pass

        duration = len(samples) / sr if sr > 0 else 0.0

        # 1. RMSエネルギー → dB変換
        # hop_length は従来互換の粒度として扱う。短すぎる場合でも50ms窓で平滑化。
        window_size = max(1, int(sr * 0.05))
        hop_size = max(1, min(self.hop_length, window_size))
        times = []
        rms_db = []
        for start in range(0, len(samples), hop_size):
            window = samples[start:start + window_size]
            if not window:
                continue
            sum_sq = 0
            for sample in window:
                sum_sq += sample * sample
            rms = math.sqrt(sum_sq / len(window)) / 32768.0
            db = 20.0 * math.log10(max(rms, 1e-4))
            times.append(start / sr)
            rms_db.append(max(-80.0, min(0.0, db)))

        energy_timeline = [
            (round(float(t) + time_offset, 3), round(float(db), 2))
            for t, db in zip(times, rms_db)
        ]

        # 2. 簡易onset検出: 直前窓からの急なdB上昇を拾う
        onsets = []
        last_onset_t = -999.0
        valid_db_for_onset = [db for db in rms_db if db > -80.0]
        mean_db_for_onset = (
            sum(valid_db_for_onset) / len(valid_db_for_onset)
            if valid_db_for_onset else -80.0
        )
        for idx in range(1, len(rms_db)):
            t = times[idx]
            rise = rms_db[idx] - rms_db[idx - 1]
            if (
                rise >= 8.0
                and rms_db[idx] >= mean_db_for_onset + 3.0
                and t - last_onset_t >= 0.12
            ):
                onsets.append(round(float(t) + time_offset, 3))
                last_onset_t = t

        # 3. 高エネルギー区間
        valid_db = [db for db in rms_db if db > -80.0]
        if len(valid_db) == 0:
            # 完全無音動画のフォールバック
            mean_db = -80.0
            max_db = -80.0
            dynamic_threshold = -20.0
            high_energy_regions = []
        else:
            mean_db = float(sum(valid_db) / len(valid_db))
            max_db = float(max(rms_db))
            dynamic_threshold = mean_db + (max_db - mean_db) * 0.4
            high_energy_regions = self._find_high_energy_regions(times, rms_db, dynamic_threshold, time_offset)

        stats = {
            'mean_db': round(mean_db, 2), 'max_db': round(max_db, 2),
            'min_db': round(float(min(rms_db)) if rms_db else -80.0, 2),
            'onset_count': len(onsets), 'duration': round(duration, 2),
            'dynamic_threshold_db': round(dynamic_threshold, 2),
        }
        
        # 4. ピッチ抽出はBETAでは安定性優先で省略。
        # scorer側は空配列を許容し、ピッチ加点だけ0になる。
        pitch_timeline = []

        print(f"   完了 解析完了: {len(onsets)} onsets, {len(high_energy_regions)} high-energy区間")
        return {'energy_timeline': energy_timeline, 'onsets': onsets,
                'high_energy_regions': high_energy_regions, 'stats': stats,
                'pitch_timeline': pitch_timeline}

    def _ensure_pcm16_mono_wav(self, media_path: str):
        """WAVでなければffmpegで16bit mono PCM WAVへ変換する。"""
        try:
            with wave.open(media_path, "rb") as wav_file:
                if (
                    wav_file.getcomptype() == "NONE"
                    and wav_file.getnchannels() == 1
                    and wav_file.getsampwidth() == 2
                ):
                    return media_path, None
        except Exception:
            pass

        fd, wav_path = tempfile.mkstemp(prefix="vfocus_audio_", suffix=".wav")
        os.close(fd)
        ffmpeg = os.environ.get("VFOCUS_FFMPEG_PATH") or "ffmpeg"
        cmd = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            media_path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(self.sample_rate),
            "-acodec",
            "pcm_s16le",
            wav_path,
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        return wav_path, wav_path

    def _read_pcm16_mono_wav(self, wav_path: str):
        """16bit mono PCM WAVをarray.arrayで読む。"""
        with wave.open(wav_path, "rb") as wav_file:
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            frame_count = wav_file.getnframes()
            compression = wav_file.getcomptype()
            if compression != "NONE":
                raise ValueError(f"非圧縮PCM WAVではありません: {compression}")
            if channels != 1 or sample_width != 2:
                raise ValueError(
                    f"16bit mono WAVが必要です: channels={channels}, "
                    f"sample_width={sample_width}"
                )
            samples = array.array("h")
            samples.frombytes(wav_file.readframes(frame_count))
            return samples, sample_rate

    def _find_high_energy_regions(self, times, rms_db, threshold_db, time_offset,
                                   min_duration=0.5, merge_gap=1.0):
        """閾値超えRMS区間を特定・マージ"""
        above = [db >= threshold_db for db in rms_db]
        regions = []
        region_start = None
        peak_db = float("-inf")

        for i, (t, is_above) in enumerate(zip(times, above)):
            if is_above:
                if region_start is None:
                    region_start = t
                peak_db = max(peak_db, rms_db[i])
            else:
                if region_start is not None:
                    if t - region_start >= min_duration:
                        regions.append((round(float(region_start)+time_offset,3),
                                        round(float(t)+time_offset,3), round(float(peak_db),2)))
                    region_start = None
                    peak_db = float("-inf")

        if region_start is not None:
            end_t = times[-1] if len(times) > 0 else region_start
            if end_t - region_start >= min_duration:
                regions.append((round(float(region_start)+time_offset,3),
                                round(float(end_t)+time_offset,3), round(float(peak_db),2)))

        # マージ
        if len(regions) < 2:
            return regions
        merged = [regions[0]]
        for start, end, pk in regions[1:]:
            ps, pe, ppk = merged[-1]
            if start - pe <= merge_gap:
                merged[-1] = (ps, end, max(ppk, pk))
            else:
                merged.append((start, end, pk))
        return merged



    def get_onset_density(self, onsets: list, window_size=5.0, step=1.0) -> list:
        """onset密度をスライディングウィンドウで計算"""
        if not onsets:
            return []
        density = []
        t = onsets[0]
        while t <= onsets[-1]:
            count = sum(1 for onset in onsets if t - window_size/2 <= onset <= t + window_size/2)
            density.append((round(t, 3), round(float(count)/window_size, 3)))
            t += step
        return density


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python audio_analysis.py <path>")
        sys.exit(1)
    a = AudioAnalyzer()
    r = a.analyze(sys.argv[1])
    print(f"Stats: {r['stats']}")
    print(f"Onsets: {r['onsets'][:10]}")
    print(f"HighE: {r['high_energy_regions'][:5]}")
