"""
Whisper.cpp Transcriber Wrapper
openshortsのtranscribe_video()を独立モジュールとして切り出し。
チャンク単位の処理に対応するtimeオフセットパラメータ付き。
faster-whisper から whisper.cpp の subprocess 呼び出しに移行しました。
"""

import os
import sys
import subprocess
import tempfile
import re
import array
import difflib
import json
import math
import uuid
import wave
from typing import Optional, Callable, List, Tuple

from pipeline.game_glossary import apply_scoped_corrections, contains_glossary_term


class Transcriber:
    """
    whisper.cpp (whisper-cli.exe) を使用した文字起こしモジュール。
    Vulkan GPU対応 (RX 9070 XT想定)。
    """

    def __init__(
        self,
        model_size: str = "large-v3-turbo",
        device: Optional[str] = None,
        compute_type: Optional[str] = None,
        hardware_gpu: str = "CPU",
    ):
        self.model_size = model_size
        self.device = device or "gpu"
        self.hardware_gpu = hardware_gpu
        
        self.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.whisper_dir = self._resolve_whisper_dir()
        
        # GPUに応じて実行ファイルを切り替え
        exe_name = "whisper-cli.exe"
        if "NVIDIA" in self.hardware_gpu:
            if os.path.exists(os.path.join(self.whisper_dir, "whisper-cli-cuda.exe")):
                exe_name = "whisper-cli-cuda.exe"
        elif "AMD" in self.hardware_gpu or "Vulkan" in self.hardware_gpu:
            if os.path.exists(os.path.join(self.whisper_dir, "whisper-cli-vulkan.exe")):
                exe_name = "whisper-cli-vulkan.exe"
            
        self.exe_path = os.path.join(self.whisper_dir, exe_name)
        
        # モデルファイル名
        model_name = f"ggml-{self.model_size}.bin"
        model_override = os.environ.get("VFOCUS_WHISPER_MODEL_PATH", "").strip()
        self.model_path = os.path.abspath(model_override) if model_override else os.path.join(self.whisper_dir, model_name)
        self.vad_model_path = os.path.join(self.whisper_dir, "ggml-silero-v6.2.0.bin")

    def _resolve_whisper_dir(self) -> str:
        """whisper.cpp の配置場所を開発/配布の両方で解決する。"""
        candidates = []

        env_dir = os.environ.get("VFOCUS_WHISPER_DIR")
        if env_dir:
            candidates.append(env_dir)

        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidates.extend([
                os.path.join(meipass, "whisper-cpp"),
                os.path.join(os.path.dirname(meipass), "whisper-cpp"),
            ])

        cwd = os.getcwd()
        candidates.extend([
            os.path.join(self.base_dir, "whisper-cpp"),
            os.path.join(os.path.dirname(self.base_dir), "whisper-cpp"),
            os.path.join(cwd, "whisper-cpp"),
            os.path.join(os.path.dirname(cwd), "whisper-cpp"),
            os.path.join(os.path.dirname(os.path.dirname(cwd)), "python-sidecar", "whisper-cpp"),
        ])

        for candidate in candidates:
            if not candidate:
                continue
            candidate = os.path.abspath(candidate)
            if os.path.exists(os.path.join(candidate, "whisper-cli.exe")):
                return candidate

        return os.path.join(self.base_dir, "whisper-cpp")

    def unload_model(self):
        """
        サブプロセス呼び出しのため、明示的なメモリ解放は不要。
        （プロセス終了時に自動でOSが解放する）
        互換性のためにメソッドは残す。
        """
        pass

    def _parse_time(self, time_str: str) -> float:
        """HH:MM:SS.mmm を秒 (float) に変換"""
        try:
            parts = time_str.split(":")
            if len(parts) == 3:
                h, m, s = parts
                return int(h) * 3600 + int(m) * 60 + float(s)
            elif len(parts) == 2:
                m, s = parts
                return int(m) * 60 + float(s)
            else:
                return float(time_str)
        except Exception:
            return 0.0

    # =========================================================================
    # 音声アクティビティ検出 (VAD) — エネルギーベース
    # =========================================================================

    @staticmethod
    def _read_pcm16_mono_wav(wav_path: str) -> Tuple[bytes, int]:
        """WAVのチャンク構成に依存せず、16bit mono PCMデータを読み込む。"""
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

            return wav_file.readframes(frame_count), sample_rate

    @staticmethod
    def _wav_duration(wav_path: str) -> float:
        """WAV内のdataチャンクを正しく解釈して再生時間を返す。"""
        with wave.open(wav_path, "rb") as wav_file:
            sample_rate = wav_file.getframerate()
            if sample_rate <= 0:
                return 0.0
            return wav_file.getnframes() / sample_rate

    def _detect_speech_regions(
        self,
        wav_path: str,
        energy_threshold: Optional[float] = None,
        min_speech_duration: float = 0.2,
        min_silence_duration: float = 0.55,
        padding: float = 0.12,
        return_threshold: bool = False,
    ):
        """
        WAVファイルのRMSエネルギーを分析し、声がある区間を検出する。
        
        Args:
            wav_path: 16kHz mono PCM WAVファイルのパス
            energy_threshold: 無音判定の閾値。Noneなら音源ごとに自動推定
            min_speech_duration: 最小発話区間の長さ (秒)
            min_silence_duration: この秒数以上の無音で区間を分割する
            padding: 各発話区間の前後に追加する余裕 (秒)
        
        Returns:
            [(start_sec, end_sec), ...] 発話区間のリスト
        """
        pcm_bytes, sample_rate = self._read_pcm16_mono_wav(wav_path)
        num_samples = len(pcm_bytes) // 2
        
        if num_samples == 0:
            return ([], 0.0) if return_threshold else []
        
        # array.array で高速にPCMデータを読み込む（forループの数千倍速い）
        samples = array.array('h')
        samples.frombytes(pcm_bytes)
        
        # 50ms窓でRMSエネルギーを計算
        window_size = int(sample_rate * 0.05)  # 800 samples = 50ms
        num_windows = num_samples // window_size
        window_rms = []
        for w in range(num_windows):
            offset = w * window_size
            window_samples = samples[offset:offset + window_size]
            sum_sq = sum(s * s for s in window_samples)
            window_rms.append(math.sqrt(sum_sq / window_size) / 32768.0)

        if not window_rms:
            return ([], 0.0) if return_threshold else []

        if energy_threshold is None:
            sorted_rms = sorted(window_rms)

            def percentile(fraction: float) -> float:
                index = min(len(sorted_rms) - 1, int((len(sorted_rms) - 1) * fraction))
                return sorted_rms[index]

            noise_floor = percentile(0.20)
            active_level = percentile(0.90)
            dynamic_margin = max(0.0025, (active_level - noise_floor) * 0.25)
            energy_threshold = min(0.020, max(0.0025, noise_floor + dynamic_margin))

        is_speech = [rms > energy_threshold for rms in window_rms]
        
        # 発話フレームをマージして区間にする
        window_duration = 0.05  # 50ms
        total_duration = num_samples / sample_rate
        regions = []
        i = 0
        while i < len(is_speech):
            if is_speech[i]:
                start = i * window_duration
                # 発話の終わりを探す（min_silence_duration以上の無音で分割）
                j = i + 1
                silence_count = 0
                while j < len(is_speech):
                    if not is_speech[j]:
                        silence_count += 1
                        if silence_count * window_duration >= min_silence_duration:
                            break
                    else:
                        silence_count = 0
                    j += 1
                
                end = (j - silence_count) * window_duration
                
                # 最小発話時間を満たす場合のみ追加
                if (end - start) >= min_speech_duration:
                    padded_start = max(0.0, start - padding)
                    padded_end = min(total_duration, end + padding)
                    regions.append((padded_start, padded_end))
                
                i = j
            else:
                i += 1
        
        # 隣接する区間をマージ（パディングで重なった場合）
        if regions:
            merged = [regions[0]]
            for start, end in regions[1:]:
                if start <= merged[-1][1]:
                    merged[-1] = (merged[-1][0], max(merged[-1][1], end))
                else:
                    merged.append((start, end))
            regions = merged
        
        if return_threshold:
            return regions, energy_threshold
        return regions

    @staticmethod
    def _partition_speech_regions(
        regions: List[Tuple[float, float]],
        max_batch_duration: float = 90.0,
        split_overlap: float = 0.5,
    ) -> List[List[Tuple[float, float]]]:
        """発話区間を短いバッチへ分け、Whisperの長時間暴走を抑える。"""
        split_regions = []
        for region_start, region_end in regions:
            start = region_start
            while region_end - start > max_batch_duration:
                end = start + max_batch_duration
                split_regions.append((start, end))
                start = max(start, end - split_overlap)
            if region_end > start:
                split_regions.append((start, region_end))

        batches = []
        current_batch = []
        current_duration = 0.0
        for start, end in split_regions:
            duration = end - start
            if current_batch and current_duration + duration > max_batch_duration:
                batches.append(current_batch)
                current_batch = []
                current_duration = 0.0
            current_batch.append((start, end))
            current_duration += duration

        if current_batch:
            batches.append(current_batch)
        return batches

    @staticmethod
    def _transcription_batches_preserving_speech(_speech_regions: List[Tuple[float, float]]):
        """字幕欠落を避けるため、Whisperには削っていない音声を常に渡す。"""
        return [None]

    @staticmethod
    def _uncovered_speech_windows(
        speech_regions: List[Tuple[float, float]],
        segments: list,
        total_duration: float,
        *,
        max_count: int = 12,
        max_total_duration: float = 30.0,
    ) -> List[Tuple[float, float]]:
        """音声検出済みなのに字幕が十分重ならない区間だけを再解析対象にする。"""
        candidates = []
        accumulated_duration = 0.0
        for region_start, region_end in speech_regions:
            region_start = max(0.0, float(region_start))
            region_end = min(float(total_duration), float(region_end))
            region_duration = region_end - region_start
            if region_duration < 0.28:
                continue

            overlaps = []
            for segment in segments:
                overlap_start = max(region_start, float(segment.get("start", 0.0)) - 0.12)
                overlap_end = min(region_end, float(segment.get("end", 0.0)) + 0.12)
                if overlap_end > overlap_start:
                    overlaps.append((overlap_start, overlap_end))

            covered = 0.0
            if overlaps:
                overlaps.sort()
                merged_start, merged_end = overlaps[0]
                for start, end in overlaps[1:]:
                    if start <= merged_end:
                        merged_end = max(merged_end, end)
                    else:
                        covered += merged_end - merged_start
                        merged_start, merged_end = start, end
                covered += merged_end - merged_start

            # 短い区間は字幕が1つ重なれば十分。長い連続発話は半分以上が
            # 未カバーなら、同じ区間を再認識して既存字幕と後で重複排除する。
            coverage_ratio = covered / region_duration
            if covered > 0 and (region_duration < 1.2 or coverage_ratio >= 0.45):
                continue

            window = (
                round(max(0.0, region_start - 0.35), 3),
                round(min(float(total_duration), region_end + 0.35), 3),
            )
            window_duration = window[1] - window[0]
            if window_duration <= 0 or accumulated_duration + window_duration > max_total_duration:
                continue
            candidates.append(window)
            accumulated_duration += window_duration
            if len(candidates) >= max_count:
                break

        if not candidates:
            return []

        merged = [candidates[0]]
        for start, end in candidates[1:]:
            if start <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], end))
            else:
                merged.append((start, end))
        return merged

    def _extract_speech_only_wav(self, wav_path: str, regions: List[Tuple[float, float]], output_path: str) -> dict:
        """
        発話区間だけを切り出して連結した新しいWAVファイルを作成する。
        
        Returns:
            タイムスタンプのマッピング情報 {
                'regions': [(original_start, original_end, new_start, new_end), ...],
                'total_duration': float
            }
        """
        pcm_data, sample_rate = self._read_pcm16_mono_wav(wav_path)
        bytes_per_sample = 2  # 16bit mono
        
        extracted_pcm = bytearray()
        mapping = []
        new_offset = 0.0
        
        for orig_start, orig_end in regions:
            start_byte = int(orig_start * sample_rate) * bytes_per_sample
            end_byte = int(orig_end * sample_rate) * bytes_per_sample
            end_byte = min(end_byte, len(pcm_data))
            
            if start_byte >= end_byte:
                continue
            
            chunk = pcm_data[start_byte:end_byte]
            chunk_duration = len(chunk) / bytes_per_sample / sample_rate
            
            mapping.append((orig_start, orig_end, new_offset, new_offset + chunk_duration))
            extracted_pcm.extend(chunk)
            new_offset += chunk_duration
        
        if not extracted_pcm:
            # 全て空の場合は元のファイルをコピー
            import shutil
            shutil.copy2(wav_path, output_path)
            return {'regions': [], 'total_duration': 0.0}
        
        with wave.open(output_path, "wb") as output_wav:
            output_wav.setnchannels(1)
            output_wav.setsampwidth(bytes_per_sample)
            output_wav.setframerate(sample_rate)
            output_wav.writeframes(extracted_pcm)
        
        return {
            'regions': mapping,
            'total_duration': new_offset,
        }

    @staticmethod
    def _split_text_for_regions(text: str, weights: list) -> list:
        """連結音声を跨いだ字幕本文を、各発話区間の長さに応じて分配する。"""
        if len(weights) <= 1:
            return [text.strip()]

        characters = list(text.strip())
        if not characters:
            return [""] * len(weights)

        total_weight = max(0.001, sum(weights))
        result = []
        cursor = 0
        for index, weight in enumerate(weights):
            remaining_regions = len(weights) - index
            remaining_chars = len(characters) - cursor
            if index == len(weights) - 1:
                take = remaining_chars
            else:
                proportional = round(len(characters) * weight / total_weight)
                take = max(1, min(proportional, remaining_chars - (remaining_regions - 1)))
            result.append("".join(characters[cursor:cursor + take]).strip())
            cursor += take
        return result

    def _remap_timestamps(self, segments: list, mapping: dict) -> list:
        """
        Whisperの出力タイムスタンプを、元の音声ファイルのタイムスタンプに再マッピングする。
        
        VADで無音を除去した音声をWhisperに渡しているため、Whisperが出力するタイムスタンプは
        「無音除去後のタイムライン」上の値。これを「元の音声ファイルのタイムライン」に変換する。
        
        mapping['regions'] は [(orig_start, orig_end, new_start, new_end), ...] の形式で、
        各区間について「元の音声のどこからどこまで」が「新しい音声のどこからどこまで」に対応するかを示す。
        """
        regions = mapping['regions']
        if not regions:
            return segments
        
        remapped = []
        
        for seg in segments:
            new_start = float(seg['start'])
            new_end = max(new_start + 0.05, float(seg['end']))

            overlaps = []
            for orig_s, orig_e, map_s, map_e in regions:
                overlap_start = max(new_start, map_s)
                overlap_end = min(new_end, map_e)
                if overlap_end - overlap_start < 0.03:
                    continue
                overlaps.append({
                    'start': orig_s + (overlap_start - map_s),
                    'end': min(orig_e, orig_s + (overlap_end - map_s)),
                    'weight': overlap_end - overlap_start,
                })

            if not overlaps:
                # Whisperが連結音声の末尾を少し超えた場合は、最寄り区間へ収める。
                orig_s, orig_e, map_s, map_e = min(
                    regions,
                    key=lambda region: min(abs(new_start - region[2]), abs(new_start - region[3])),
                )
                start = max(orig_s, min(orig_e - 0.05, orig_s + max(0.0, new_start - map_s)))
                overlaps = [{
                    'start': start,
                    'end': min(orig_e, start + max(0.2, new_end - new_start)),
                    'weight': max(0.2, new_end - new_start),
                }]

            text_parts = self._split_text_for_regions(
                seg.get('text', ''),
                [overlap['weight'] for overlap in overlaps],
            )
            for overlap, text_part in zip(overlaps, text_parts):
                if not text_part:
                    continue
                remapped_segment = dict(seg)
                remapped_segment['text'] = text_part
                remapped_segment['start'] = round(overlap['start'], 3)
                remapped_segment['end'] = round(
                    max(overlap['start'] + 0.05, overlap['end']),
                    3,
                )
                remapped.append(remapped_segment)
        
        return remapped

    @classmethod
    def _align_segments_to_vad_regions(cls, segments: list, vad_regions: list) -> list:
        """Whisperの長く伸びた区間を、実際に重なるSilero発話区間へ収める。"""
        if not segments or not vad_regions:
            return segments

        normalized_regions = [
            (float(start), float(end))
            for start, end in vad_regions
            if float(end) > float(start)
        ]
        if not normalized_regions:
            return segments

        # whisper.cppのVAD出力は字幕の終了時刻が次の発話まで数十秒伸びることがある。
        # 終了時刻だけで近いVADを選ぶと、直前の短い発言が次の区間へ数秒飛ぶ。
        # 字幕区間と最も長く重なるVADを優先し、重なりがない場合だけ近傍へ退避する。
        fragments_by_region: dict[int, list] = {}
        minimum_region_index = 0
        for segment in segments:
            segment_start = float(segment.get("start", 0.0))
            segment_end = max(segment_start + 0.05, float(segment.get("end", segment_start + 0.05)))
            candidate_indices = list(range(minimum_region_index, len(normalized_regions)))
            overlaps = {
                index: max(
                    0.0,
                    min(segment_end, normalized_regions[index][1])
                    - max(segment_start, normalized_regions[index][0]),
                )
                for index in candidate_indices
            }
            best_overlap = max(overlaps.values(), default=0.0)
            if best_overlap >= 0.03:
                target_index = max(
                    candidate_indices,
                    key=lambda index: (
                        overlaps[index],
                        -abs(normalized_regions[index][0] - segment_start),
                        -index,
                    ),
                )
            else:
                target_index = min(
                    candidate_indices,
                    key=lambda index: (
                        abs(normalized_regions[index][0] - segment_start),
                        abs(normalized_regions[index][1] - segment_end),
                    ),
                )

            fragments_by_region.setdefault(target_index, []).append({
                **segment,
                "_vad_overlap": overlaps.get(target_index, 0.0),
            })
            minimum_region_index = target_index

        aligned = []
        for region_index in sorted(fragments_by_region):
            region_start, region_end = normalized_regions[region_index]
            fragments = sorted(
                fragments_by_region[region_index],
                key=lambda fragment: (float(fragment.get("start", 0.0)), float(fragment.get("end", 0.0))),
            )

            # 1字幕だけならVAD区間全体を使う。複数字幕が同じ発話内にある場合は
            # Whisperの境界をVAD内へクランプし、結合せず順番を保つ。
            if len(fragments) == 1:
                fragment = dict(fragments[0])
                fragment.pop("_vad_overlap", None)
                fragment["start"] = round(region_start, 3)
                fragment["end"] = round(region_end, 3)
                aligned.append(fragment)
                continue

            for fragment in fragments:
                overlap = float(fragment.pop("_vad_overlap", 0.0))
                if overlap >= 0.03:
                    start = max(region_start, float(fragment.get("start", region_start)))
                    end = min(region_end, float(fragment.get("end", region_end)))
                else:
                    start, end = region_start, region_end
                fragment["start"] = round(start, 3)
                fragment["end"] = round(max(start + 0.05, end), 3)
                aligned.append(fragment)
        return aligned

    @staticmethod
    def _normalize_text(text: str) -> str:
        return re.sub(r"[、。！？!?.,\s　]", "", text).lower()

    @classmethod
    def _is_known_hallucination(cls, text: str) -> bool:
        normalized = cls._normalize_text(text)
        hallucinations = [
            "ご視聴ありがとうございました",
            "ご視聴ありがとうございます",
            "視聴ありがとうございました",
            "ご覧いただきありがとうございました",
            "ご覧いただきありがとうございます",
            "チャンネル登録よろしくお願いします",
            "チャンネル登録",
            "高評価お願いします",
            "次の動画でお会いしましょう",
            "次回の動画でお会いしましょう",
            "また次の動画でお会いしましょう",
            "また次回の動画で",
            "字幕翻訳",
        ]
        return any(cls._normalize_text(phrase) in normalized for phrase in hallucinations)

    @staticmethod
    def _looks_repetitive(clean_text: str) -> bool:
        if len(clean_text) < 4:
            return False

        if re.search(r"(.{2,12}?)\1{3,}", clean_text):
            return True

        max_unit = min(12, len(clean_text) // 2)
        for unit_len in range(1, max_unit + 1):
            unit = clean_text[:unit_len]
            if not unit:
                continue
            repeats = 0
            cursor = 0
            while clean_text.startswith(unit, cursor):
                repeats += 1
                cursor += unit_len
            remainder = clean_text[cursor:]
            if repeats >= 4 and len(remainder) <= max(1, unit_len // 2):
                return True
            if unit_len >= 2 and repeats >= 3 and len(remainder) <= 1:
                return True

        return False

    @classmethod
    def _segment_rejection_reason(cls, segment: dict) -> Optional[str]:
        text = segment.get("text", "").strip()
        clean_text = cls._normalize_text(text)
        if not clean_text:
            return "empty"

        if cls._is_known_hallucination(text):
            return "known_hallucination"
        if text in {"音楽", "[音楽]", "(音楽)", "♪", "字幕:", "字幕 :"}:
            return "non_speech"
        if cls._looks_repetitive(clean_text):
            duration = max(0.2, float(segment.get("end", 0)) - float(segment.get("start", 0)))
            # 実況の「無理無理」「敵いる敵いる」は本物なので残す。
            # 長時間かつ長文の暴走だけをハルシネーションとして除外する。
            if duration >= 8.0 and len(clean_text) >= 24:
                return "repetition"

        return None

    @classmethod
    def _segment_review_flags(cls, segment: dict) -> list:
        """不確かな発言は削除せず、人間が確認できる形で残す。"""
        flags = list(segment.get("flags") or [])
        confidence = segment.get("confidence")
        if confidence is not None and confidence < 0.45:
            flags.extend(["low_confidence", "needs_review"])

        clean_text = cls._normalize_text(segment.get("text", ""))
        duration = max(0.2, float(segment.get("end", 0)) - float(segment.get("start", 0)))
        if len(clean_text) >= 8 and len(clean_text) / duration > 12.0:
            flags.append("needs_review")
        if cls._looks_repetitive(clean_text):
            flags.append("needs_review")
        return list(dict.fromkeys(flags))

    @classmethod
    def _filter_segments(cls, segments: list) -> Tuple[list, list]:
        accepted = []
        rejected = []
        for segment in segments:
            reason = cls._segment_rejection_reason(segment)
            if reason is None:
                candidate = dict(segment)
                flags = cls._segment_review_flags(candidate)
                if flags:
                    candidate["flags"] = flags
                accepted.append(candidate)
            else:
                rejected.append((segment, reason))
        return accepted, rejected

    @classmethod
    def _rescue_candidate_is_safe(cls, segment: dict) -> bool:
        """VAD感度を上げた救済結果から、ノイズ由来の短い幻覚を除く。"""
        clean_text = cls._normalize_text(segment.get("text", ""))
        if not clean_text:
            return False
        # 日本語1〜2文字はマイクノイズから頻出する。NT/CT/Bなどのゲーム用略語は残す。
        if len(clean_text) < 3 and not re.fullmatch(r"[a-z0-9]{2,}", clean_text):
            return False
        duration = float(segment.get("end", 0.0)) - float(segment.get("start", 0.0))
        if duration < 0.12:
            return False
        confidence = segment.get("confidence")
        if not isinstance(confidence, (int, float)) or float(confidence) < 0.55:
            return False
        if len(clean_text) / max(0.2, duration) > 12.0:
            return False
        return True

    @staticmethod
    def _combined_candidate(segments: list) -> Optional[dict]:
        text = "".join(str(segment.get("text") or "").strip() for segment in segments).strip()
        if not text:
            return None
        weighted_probability = 0.0
        total_weight = 0.0
        for segment in segments:
            confidence = segment.get("confidence")
            if not isinstance(confidence, (int, float)):
                continue
            weight = max(1.0, len(Transcriber._normalize_text(segment.get("text", ""))))
            weighted_probability += float(confidence) * weight
            total_weight += weight
        return {
            "text": text,
            "confidence": round(weighted_probability / total_weight, 4) if total_weight else None,
        }

    @classmethod
    def _refinement_targets(
        cls,
        segments: list,
        duration: float,
        *,
        confidence_threshold: float = 0.78,
        max_count: int = 12,
        max_padding: float = 2.0,
    ) -> list[dict]:
        """低信頼字幕と、隣の発言を巻き込まない再認識窓を返す。"""
        targets = []
        for index, segment in enumerate(segments):
            confidence = segment.get("confidence")
            if (
                len(targets) >= max_count
                or not isinstance(confidence, (int, float))
                or float(confidence) >= confidence_threshold
                or len(cls._normalize_text(segment.get("text", ""))) < 2
            ):
                continue

            segment_start = max(0.0, float(segment.get("start", 0.0)))
            segment_end = max(segment_start + 0.1, float(segment.get("end", segment_start + 0.1)))
            window_start = max(0.0, segment_start - max_padding)
            window_end = min(float(duration), segment_end + max_padding)

            if index > 0:
                previous_end = float(segments[index - 1].get("end", 0.0))
                window_start = max(window_start, min(segment_start, previous_end + 0.05))
            if index + 1 < len(segments):
                next_start = float(segments[index + 1].get("start", duration))
                window_end = min(window_end, max(segment_end, next_start - 0.05))

            if window_end - window_start < 0.15:
                continue
            targets.append({
                "index": index,
                "segment": segment,
                "window": (round(window_start, 3), round(window_end, 3)),
            })
        return targets

    @classmethod
    def _guided_candidate_for_window(
        cls,
        original: dict,
        guided_segments: list,
        window: tuple[float, float],
    ) -> Optional[dict]:
        """一括再認識結果から、対象字幕と時間的に対応する発言だけを選ぶ。"""
        original_start = float(original.get("start", 0.0))
        original_end = max(original_start + 0.05, float(original.get("end", original_start + 0.05)))
        window_start, window_end = window
        in_window = [
            segment
            for segment in guided_segments
            if float(segment.get("end", 0.0)) > window_start
            and float(segment.get("start", 0.0)) < window_end
        ]
        if not in_window:
            return None

        overlapping = [
            segment
            for segment in in_window
            if min(float(segment.get("end", 0.0)), original_end)
            - max(float(segment.get("start", 0.0)), original_start)
            >= 0.03
        ]
        if overlapping:
            return cls._combined_candidate(overlapping)

        original_center = (original_start + original_end) / 2.0
        nearest = min(
            in_window,
            key=lambda segment: abs(
                (float(segment.get("start", 0.0)) + float(segment.get("end", 0.0))) / 2.0
                - original_center
            ),
        )
        return cls._combined_candidate([nearest])

    @classmethod
    def _guided_candidate_is_safe(
        cls,
        original: dict,
        candidate: dict,
        glossary: Optional[dict],
    ) -> bool:
        """用語プロンプトに引っ張られただけの候補を採用しない。"""
        original_text = str(original.get("text") or "").strip()
        candidate_text = str(candidate.get("text") or "").strip()
        if not original_text or not candidate_text:
            return False

        original_clean = cls._normalize_text(original_text)
        candidate_clean = cls._normalize_text(candidate_text)
        if not original_clean or not candidate_clean:
            return False
        length_ratio = len(candidate_clean) / max(1, len(original_clean))
        if length_ratio < 0.45 or length_ratio > 2.2:
            return False

        original_confidence = original.get("confidence")
        candidate_confidence = candidate.get("confidence")
        if not isinstance(candidate_confidence, (int, float)):
            return False
        if isinstance(original_confidence, (int, float)):
            if float(candidate_confidence) < max(0.55, float(original_confidence) + 0.08):
                return False
        elif float(candidate_confidence) < 0.65:
            return False

        similarity = difflib.SequenceMatcher(None, original_clean, candidate_clean).ratio()
        if similarity >= 0.72:
            return True

        # 大きく異なる候補は、元字幕と候補の両方に同じゲーム用語がある時だけ許可する。
        return (
            similarity >= 0.35
            and contains_glossary_term(original_text, glossary)
            and contains_glossary_term(candidate_text, glossary)
        )

    @staticmethod
    def _segments_from_whisper_json(json_path: str) -> Tuple[list, Optional[str]]:
        # whisper.cppは日本語トークン境界で不完全なUTF-8片を含めることがある。
        # セグメント本文は保たれるため、不正なトークン片だけ置換して読む。
        with open(json_path, "r", encoding="utf-8", errors="replace") as json_file:
            payload = json.load(json_file)

        language = payload.get("result", {}).get("language")
        segments = []
        for item in payload.get("transcription", []):
            offsets = item.get("offsets", {})
            token_probabilities = []
            for token in item.get("tokens", []):
                token_text = token.get("text", "")
                if token_text.startswith("[_"):
                    continue
                probability = token.get("p")
                if isinstance(probability, (int, float)):
                    token_probabilities.append(float(probability))

            confidence = (
                sum(token_probabilities) / len(token_probabilities)
                if token_probabilities
                else None
            )
            segment = {
                "start": round(float(offsets.get("from", 0)) / 1000.0, 3),
                "end": round(float(offsets.get("to", 0)) / 1000.0, 3),
                "text": item.get("text", "").strip(),
            }
            if confidence is not None:
                segment["confidence"] = round(confidence, 4)
            segments.append(segment)
        return segments, language

    @classmethod
    def merge_transcript_results(cls, results: list) -> dict:
        """複数トラックの字幕を時刻順に統合し、同じ発言だけを除去する。"""
        candidates = []
        languages = []
        for result in results:
            track_index = result.get("track_index")
            if result.get("language"):
                languages.append(result["language"])
            for segment in result.get("segments", []):
                candidate = dict(segment)
                if track_index is not None:
                    candidate["source_track"] = track_index
                candidates.append(candidate)

        candidates.sort(key=lambda segment: (segment["start"], segment["end"]))
        merged = []
        for candidate in candidates:
            duplicate_index = None
            candidate_text = cls._normalize_text(candidate.get("text", ""))
            for index in range(len(merged) - 1, -1, -1):
                existing = merged[index]
                if candidate["start"] - existing["end"] > 1.0:
                    break
                existing_text = cls._normalize_text(existing.get("text", ""))
                temporal_match = (
                    min(candidate["end"], existing["end"])
                    - max(candidate["start"], existing["start"])
                    > 0
                    or abs(candidate["start"] - existing["start"]) <= 0.75
                )
                text_similarity = difflib.SequenceMatcher(
                    None,
                    candidate_text,
                    existing_text,
                ).ratio()
                containment_match = (
                    min(len(candidate_text), len(existing_text)) >= 3
                    and (
                        candidate_text in existing_text
                        or existing_text in candidate_text
                    )
                )
                if temporal_match and (text_similarity >= 0.82 or containment_match):
                    duplicate_index = index
                    break

            if duplicate_index is None:
                merged.append(candidate)
                continue

            existing = merged[duplicate_index]
            existing_confidence = existing.get("confidence", 0.0)
            candidate_confidence = candidate.get("confidence", 0.0)
            if candidate_confidence > existing_confidence:
                merged[duplicate_index] = candidate

        merged.sort(key=lambda segment: (segment["start"], segment["end"]))
        language = max(set(languages), key=languages.count) if languages else "ja"
        return {
            "text": " ".join(segment["text"] for segment in merged).strip(),
            "segments": merged,
            "language": language,
        }

    # =========================================================================
    # メインの文字起こし処理
    # =========================================================================

    def transcribe(
        self,
        media_path: str,
        time_offset: float = 0.0,
        language: Optional[str] = "auto",
        glossary: Optional[dict] = None,
        progress_callback: Optional[Callable[[int], None]] = None,
        cancel_check: Optional[Callable[[], None]] = None,
        translate_to_english: bool = False,
    ) -> dict:
        """
        動画/音声ファイルを文字起こし。

        Args:
            media_path: 動画または音声ファイルのパス (.wav, 16kHz, mono推奨)
            time_offset: チャンク処理時のタイムオフセット（秒）。
                         全タイムスタンプにこの値が加算される。
            language: 言語コード
            glossary: 確定したゲーム内だけで使う用語コンテキスト
            progress_callback: 進捗(%)を通知するコールバック
            cancel_check: キャンセル要求があれば例外を投げるコールバック
            translate_to_english: Whisperの翻訳モードで英語字幕を生成する

        Returns:
            {
                'text': str,
                'segments': [{'start': float, 'end': float, 'text': str}],
                'language': str
            }
        """
        if not os.path.exists(media_path):
            raise FileNotFoundError(f"ファイルが見つかりません: {media_path}")
        if not os.path.exists(self.exe_path):
            raise FileNotFoundError(f"whisper-cli.exeが見つかりません: {self.exe_path}")
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f"モデルファイルが見つかりません: {self.model_path}")

        if cancel_check:
            cancel_check()

        lang_code = "ja" if (not language or language == "auto") else language
        print(
            f"  文字起こし開始(whisper.cpp): {os.path.basename(media_path)} "
            f"(offset={time_offset:.1f}s) - Model: {self.model_size}"
        )

        speech_regions, vad_threshold = self._detect_speech_regions(
            media_path,
            return_threshold=True,
        )
        if cancel_check:
            cancel_check()
        total_file_duration = self._wav_duration(media_path)
        speech_duration = sum(e - s for s, e in speech_regions)

        if speech_regions:
            pct = (speech_duration / total_file_duration * 100) if total_file_duration > 0 else 0
            speech_batches = self._transcription_batches_preserving_speech(speech_regions)
            print(
                f"    VAD(参考): {len(speech_regions)}区間, 発話={speech_duration:.1f}s / "
                f"全体≈{total_file_duration:.1f}s ({pct:.0f}%), "
                f"自動閾値={vad_threshold:.4f}, Whisper=全音声",
                file=sys.stderr,
            )
        else:
            # VADが空でも元音声をWhisperへ渡し、小声の全欠落を防ぐ。
            speech_batches = [None]
            print(
                f"    VAD: 発話区間なし (自動閾値={vad_threshold:.4f}) "
                "— 元音声でフォールバック",
                file=sys.stderr,
            )

        segment_pattern = re.compile(r"\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)")
        progress_pattern = re.compile(r"progress\s*=\s*(\d+)%")
        native_vad_pattern = re.compile(
            r"VAD segment\s+\d+:\s+start\s*=\s*([0-9.]+),\s+end\s*=\s*([0-9.]+)",
            re.IGNORECASE,
        )
        detected_language = lang_code
        env = os.environ.copy()
        all_segments = []

        def run_whisper(
            input_path: str,
            batch_index: int,
            conservative: bool = False,
            initial_prompt: Optional[str] = None,
            max_context: int = 0,
            model_path: Optional[str] = None,
            emit_progress: bool = True,
            enable_vad: bool = True,
            vad_threshold: float = 0.35,
        ):
            output_prefix = os.path.join(
                tempfile.gettempdir(),
                f"vfocus_whisper_{os.getpid()}_{uuid.uuid4().hex}",
            )
            run_cmd = [
                self.exe_path,
                "-m", model_path or self.model_path,
                "-f", input_path,
                "-pp",
                "-l", lang_code,
                "-ojf",
                "-of", output_prefix,
            ]
            if translate_to_english:
                run_cmd.append("-tr")
            use_native_vad = enable_vad and os.path.exists(self.vad_model_path)
            if use_native_vad:
                run_cmd.extend([
                    "--vad",
                    "-vm", self.vad_model_path,
                    "-vt", f"{vad_threshold:.2f}",
                    "-vspd", "180",
                    "-vsd", "250",
                    "-vmsd", "15",
                    "-vp", "150",
                    "-vo", "0.20",
                ])
            if initial_prompt:
                run_cmd.extend([
                    "--prompt", initial_prompt,
                    "--carry-initial-prompt",
                    "--max-context", str(max(1, max_context or 64)),
                ])
            else:
                # 通常認識では前の誤認識を次窓へ伝播させない。
                run_cmd.extend(["--max-context", "0"])
            if conservative:
                run_cmd.extend([
                    "--entropy-thold", "2.4",
                    "--logprob-thold", "-1.1",
                    "--no-speech-thold", "0.70",
                    "--suppress-nst",
                ])
            else:
                run_cmd.extend([
                    # Whisper公式初期値。Silero VADが無音を除くため、ここで
                    # 低信頼な小声まで先に捨てない。
                    "--entropy-thold", "2.4",
                    "--logprob-thold", "-1.0",
                    "--no-speech-thold", "0.60",
                    "--suppress-nst",
                ])

            stdout_segments = []
            native_vad_regions = []
            run_language = detected_language
            proc = subprocess.Popen(
                run_cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding='utf-8',
                errors='replace',
                env=env,
            )

            try:
                for out_line in iter(proc.stdout.readline, ''):
                    if cancel_check:
                        cancel_check()
                    out_line = out_line.strip()
                    if not out_line:
                        continue

                    vad_match = native_vad_pattern.search(out_line)
                    if vad_match:
                        region = (float(vad_match.group(1)), float(vad_match.group(2)))
                        if not native_vad_regions or native_vad_regions[-1] != region:
                            native_vad_regions.append(region)

                    # プログレスのパース
                    prog_match = progress_pattern.search(out_line)
                    if prog_match and progress_callback and not conservative and emit_progress:
                        prog_val = int(prog_match.group(1))
                        overall = int(
                            ((batch_index + prog_val / 100.0) / len(speech_batches)) * 100
                        )
                        progress_callback(min(100, overall))
                        continue

                    seg_match = segment_pattern.search(out_line)
                    if seg_match:
                        start_str, end_str, seg_text = seg_match.groups()
                        seg_text = seg_text.strip()
                        if seg_text:
                            stdout_segments.append({
                                "start": round(self._parse_time(start_str), 3),
                                "end": round(self._parse_time(end_str), 3),
                                "text": seg_text,
                            })

                    if "auto-detected language:" in out_line.lower() or "detected language:" in out_line.lower():
                        lang_match = re.search(r"language:?\s+([a-zA-Z]+)", out_line, re.IGNORECASE)
                        if lang_match:
                            run_language = lang_match.group(1).lower()

                proc.wait()
            except Exception:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
                raise
            json_path = output_prefix + ".json"
            try:
                if os.path.exists(json_path):
                    json_segments, json_language = self._segments_from_whisper_json(json_path)
                    if json_language:
                        run_language = json_language
                    raw_segments = json_segments
                else:
                    raw_segments = stdout_segments
            finally:
                try:
                    os.remove(json_path)
                except OSError:
                    pass

            if native_vad_regions:
                raw_segments = self._align_segments_to_vad_regions(
                    raw_segments,
                    native_vad_regions,
                )
            accepted, rejected = self._filter_segments(raw_segments)
            return proc.returncode, accepted, rejected, run_language, native_vad_regions

        for batch_index, regions in enumerate(speech_batches):
            if cancel_check:
                cancel_check()
            input_path = media_path
            mapping = None
            temporary_input = None
            if regions is not None:
                temporary_input = os.path.join(
                    tempfile.gettempdir(),
                    f"vfocus_speech_{os.getpid()}_{uuid.uuid4().hex}.wav",
                )
                mapping = self._extract_speech_only_wav(
                    media_path,
                    regions,
                    temporary_input,
                )
                input_path = temporary_input

            try:
                returncode, batch_segments, rejected, run_language, _ = run_whisper(
                    input_path,
                    batch_index,
                )
                detected_language = run_language or detected_language

                retryable_reasons = {
                    "low_confidence",
                    "repetition",
                    "implausible_speed",
                }
                needs_retry = (
                    not batch_segments
                    and (
                        returncode != 0
                        or not rejected
                        or any(reason in retryable_reasons for _, reason in rejected)
                    )
                )
                if needs_retry:
                    print(
                        f"    Whisper再試行: batch {batch_index + 1}/{len(speech_batches)} "
                        f"(code={returncode}, rejected={len(rejected)})",
                        file=sys.stderr,
                    )
                    retry_code, retry_segments, _, retry_language, _ = run_whisper(
                        input_path,
                        batch_index,
                        conservative=True,
                    )
                    if retry_segments:
                        batch_segments = retry_segments
                        detected_language = retry_language or detected_language
                    elif returncode != 0 and retry_code != 0:
                        print(
                            f"    [WARN] Whisper再試行も失敗: code={retry_code}",
                            file=sys.stderr,
                        )

                if mapping and mapping.get("regions"):
                    batch_segments = self._remap_timestamps(batch_segments, mapping)

                # エネルギーVADでは声を検出したのに字幕が無い区間だけを救済する。
                # 通常より感度を上げたVADで短い対象音声だけを1回再解析する。
                # VADを完全に切るとマイクノイズから一文字字幕が増えるため無効化しない。
                rescue_windows = self._uncovered_speech_windows(
                    speech_regions,
                    batch_segments,
                    total_file_duration,
                )
                if rescue_windows:
                    rescue_path = os.path.join(
                        tempfile.gettempdir(),
                        f"vfocus_rescue_{os.getpid()}_{uuid.uuid4().hex}.wav",
                    )
                    try:
                        rescue_mapping = self._extract_speech_only_wav(
                            input_path,
                            rescue_windows,
                            rescue_path,
                        )
                        print(
                            f"    字幕欠落救済: {len(rescue_windows)}区間 / "
                            f"{rescue_mapping.get('total_duration', 0.0):.1f}秒を再解析",
                            file=sys.stderr,
                        )
                        _, rescued_segments, _, rescue_language, _ = run_whisper(
                            rescue_path,
                            batch_index,
                            emit_progress=False,
                            enable_vad=True,
                            vad_threshold=0.20,
                        )
                        detected_language = rescue_language or detected_language
                        if rescue_mapping.get("regions"):
                            rescued_segments = self._remap_timestamps(
                                rescued_segments,
                                rescue_mapping,
                            )
                        rescued_segments = [
                            segment
                            for segment in rescued_segments
                            if self._rescue_candidate_is_safe(segment)
                        ]
                        for rescued in rescued_segments:
                            flags = list(rescued.get("flags") or [])
                            flags.append("needs_review")
                            confidence = rescued.get("confidence")
                            if isinstance(confidence, (int, float)) and confidence < 0.45:
                                flags.append("possible_hallucination")
                            rescued["flags"] = list(dict.fromkeys(flags))
                            rescued["recognition_model"] = os.path.basename(self.model_path)

                        if rescued_segments:
                            batch_segments = self.merge_transcript_results([
                                {"segments": batch_segments, "language": detected_language},
                                {"segments": rescued_segments, "language": detected_language},
                            ])["segments"]
                    except Exception as exc:
                        print(f"    字幕欠落救済をスキップ: {exc}", file=sys.stderr)
                    finally:
                        try:
                            os.remove(rescue_path)
                        except OSError:
                            pass

                if (
                    glossary
                    and (glossary.get("glossary_applied") or glossary.get("exact_corrections"))
                    and batch_segments
                ):
                    original_batch_segments = []
                    for segment in batch_segments:
                        corrected_segment = dict(segment)
                        corrected_text, changed = apply_scoped_corrections(
                            corrected_segment.get("text", ""),
                            glossary,
                        )
                        if changed:
                            corrected_segment["original_text"] = corrected_segment.get("text", "")
                            corrected_segment["text"] = corrected_text
                            corrected_segment["refined_by_glossary"] = True
                        original_batch_segments.append(corrected_segment)
                    batch_segments = original_batch_segments

                    # 用語集は全文へ渡さず、不確かな字幕だけをまとめて再認識する。
                    # モデルの起動は1チャンクにつき最大1回で、通常認識と同じturboを使う。
                    prompt = str(glossary.get("prompt") or "").strip()
                    targets = self._refinement_targets(
                        batch_segments,
                        self._wav_duration(input_path),
                    ) if prompt else []
                    if targets:
                        clips_path = os.path.join(
                            tempfile.gettempdir(),
                            f"vfocus_refine_batch_{os.getpid()}_{uuid.uuid4().hex}.wav",
                        )
                        try:
                            windows = [target["window"] for target in targets]
                            refinement_mapping = self._extract_speech_only_wav(
                                input_path,
                                windows,
                                clips_path,
                            )
                            print(
                                f"    用語再判定: {len(targets)}字幕 / "
                                f"{refinement_mapping.get('total_duration', 0.0):.1f}秒をturboで一括処理",
                                file=sys.stderr,
                            )
                            _, guided_segments, _, _, _ = run_whisper(
                                clips_path,
                                batch_index,
                                initial_prompt=prompt,
                                max_context=64,
                                model_path=self.model_path,
                                emit_progress=False,
                            )
                            if refinement_mapping.get("regions"):
                                guided_segments = self._remap_timestamps(
                                    guided_segments,
                                    refinement_mapping,
                                )

                            for target in targets:
                                segment = batch_segments[target["index"]]
                                guided = self._guided_candidate_for_window(
                                    segment,
                                    guided_segments,
                                    target["window"],
                                )
                                if not guided:
                                    continue
                                guided_text, _ = apply_scoped_corrections(
                                    guided.get("text", ""),
                                    glossary,
                                )
                                guided["text"] = guided_text
                                if self._guided_candidate_is_safe(segment, guided, glossary):
                                    improved = dict(segment)
                                    improved.setdefault("original_text", segment.get("text", ""))
                                    improved["text"] = guided["text"]
                                    improved["confidence"] = guided["confidence"]
                                    improved["refined_by_glossary"] = True
                                    improved["recognition_model"] = os.path.basename(self.model_path)
                                    batch_segments[target["index"]] = improved
                        except Exception as exc:
                            print(f"    用語再判定をスキップ: {exc}", file=sys.stderr)
                        finally:
                            try:
                                os.remove(clips_path)
                            except OSError:
                                pass
                all_segments.extend(batch_segments)
            finally:
                if temporary_input:
                    try:
                        os.remove(temporary_input)
                    except OSError:
                        pass

        merged = self.merge_transcript_results([{
            "segments": all_segments,
            "language": detected_language,
        }])
        transcript_segments = merged["segments"]
        for segment in transcript_segments:
            segment["start"] = round(segment["start"] + time_offset, 3)
            segment["end"] = round(segment["end"] + time_offset, 3)

        print(
            f"   完了 文字起こし完了: {len(transcript_segments)}セグメント",
            file=sys.stderr,
        )
        return {
            "text": " ".join(segment["text"] for segment in transcript_segments).strip(),
            "segments": transcript_segments,
            "language": merged["language"],
            "glossary_refinements": sum(
                1 for segment in transcript_segments if segment.get("refined_by_glossary")
            ),
        }


# --- 単体テスト用 ---
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python transcriber.py <video_or_audio_path>")
        sys.exit(1)

    t = Transcriber()
    def print_progress(p):
        print(f"Progress: {p}%", end="\\r")
        
    result = t.transcribe(sys.argv[1], progress_callback=print_progress)

    print(f"\\n--- 結果 ---")
    print(f"言語: {result['language']}")
    print(f"テキスト: {result['text'][:200]}...")
    print(f"セグメント数: {len(result['segments'])}")

    if result['segments']:
        seg = result['segments'][0]
        print(f"最初のセグメント: [{seg['start']:.2f}s → {seg['end']:.2f}s] {seg['text']}")
