"""
Highlight Scorer — 盛り上がりスコア統合
Whisperの文字起こしと音声エネルギーデータを統合してスコアリング。
"""

import bisect
import math
import re
from typing import Callable, Optional

from .highlight_signal_math import robust_prominence, values_in_range, window_peak_mean


# ゲーム実況で「盛り上がり」を示唆する日本語/英語キーワード
EXCLAMATION_PATTERNS_JA = [
    r'うわ', r'やば', r'すご', r'まじ', r'きた', r'おお', r'えっ',
    r'うそ', r'なに', r'つよ', r'こわ', r'やった', r'いけ',
    r'死んだ', r'たおし', r'勝った', r'負けた', r'クリア',
    # 通常の状況説明語（敵・ここ・回復等）は誤検出が多いため含めない。
    r'待て', r'落ち着', r'ダウン', r'ノック', r'倒し',
    r'やられ', r'逃げ', r'あぶな', r'ナイス', r'チャンピオン',
]
EXCLAMATION_PATTERNS_EN = [
    r'oh my', r'wow', r'no way', r'what', r'yes', r'let.s go',
    r'come on', r'damn', r'holy', r'insane', r'crazy', r'clutch',
    r'gg', r'kill', r'dead', r'win', r'lost', r'boss',
    r'knock', r'down', r'nice', r'clutch',
]


class HighlightScorer:
    """
    音声+テキストの複合スコアリングで盛り上がり区間を特定。

    基本スコア配分（利用可能な特徴だけで0-100へ正規化）:
        - 音声エネルギー閾値超え   → +25
        - onset密度が高い区間      → +15
        - 感嘆詞/叫び系ワード      → +15
        - 急激な音量変化 (ΔdB)     → +15
        - 無音→急激な音量上昇       → +10
        - 声のピッチ変動           → +10
        - 発話密度                 → +5
        - テキスト感情分析         → +5
        - 実況音声の高揚           → +20
        - ゲーム音と声の反応一致   → +15
    """

    def __init__(
        self,
        segment_duration: float = 5.0,
        segment_step: float = 2.5,
        energy_weight: float = 25.0,
        onset_weight: float = 15.0,
        exclamation_weight: float = 15.0,
        delta_db_weight: float = 15.0,
        silence_burst_weight: float = 10.0,
        pitch_weight: float = 10.0,
        speech_density_weight: float = 5.0,
        sentiment_weight: float = 5.0,
        voice_arousal_weight: float = 20.0,
        reaction_coincidence_weight: float = 15.0,
        sentiment_analyzer: Optional[Callable[[str], float]] = None,
    ):
        self.segment_duration = segment_duration
        self.segment_step = segment_step
        self.energy_weight = energy_weight
        self.onset_weight = onset_weight
        self.exclamation_weight = exclamation_weight
        self.delta_db_weight = delta_db_weight
        self.silence_burst_weight = silence_burst_weight
        self.pitch_weight = pitch_weight
        self.speech_density_weight = speech_density_weight
        self.sentiment_weight = sentiment_weight
        self.voice_arousal_weight = voice_arousal_weight
        self.reaction_coincidence_weight = reaction_coincidence_weight
        # 外部AIへの接続はスコアラーの責務にしない。Pro等で必要な場合だけ
        # 0.0〜1.0を返す関数を注入する。
        self.sentiment_analyzer = sentiment_analyzer
        self._sentiment_cache = {}

    def score(
        self,
        transcript_result: dict,
        audio_result: dict,
        language: Optional[str] = None,
        time_offset: float = 0.0,
        voice_audio_result: Optional[dict] = None,
    ) -> list:
        """
        文字起こし結果と音声解析結果を統合してセグメントごとのスコアを算出。

        Args:
            transcript_result: transcriber.pyの出力
            audio_result: ゲーム音に対するaudio_analysis.pyの出力
            language: 言語（None=自動判定）
            time_offset: チャンクの開始時間（秒）
            voice_audio_result: 分離された実況音声の解析結果。混合音声時はNone

        Returns:
            [{ start, end, excitement_score(0-100), reasons[], transcript_text, audio_peaks }]
        """
        lang = self._resolve_language(language, transcript_result)
        duration = audio_result['stats']['duration']
        energy_timeline = audio_result['energy_timeline']
        pitch_timeline = audio_result.get('pitch_timeline', [])
        onsets = audio_result['onsets']
        high_energy_regions = audio_result['high_energy_regions']
        has_voice_audio = voice_audio_result is not None
        voice_energy_timeline = (
            voice_audio_result.get('energy_timeline', []) if has_voice_audio else []
        )
        voice_onsets = voice_audio_result.get('onsets', []) if has_voice_audio else []
        voice_high_energy_regions = (
            voice_audio_result.get('high_energy_regions', []) if has_voice_audio else []
        )

        # スライディングウィンドウでセグメント作成
        segments = []
        t = time_offset
        while t + self.segment_duration <= time_offset + duration + self.segment_step:
            seg_start = t
            seg_end = min(t + self.segment_duration, time_offset + duration)
            if seg_end - seg_start < 1.0:
                break

            score_parts = {}

            # 1. 音声エネルギー閾値超え (+25)
            energy_score = self._score_energy(seg_start, seg_end, high_energy_regions)
            score_parts['energy'] = energy_score

            # 2. onset密度 (+15)
            onset_score = self._score_onsets(seg_start, seg_end, onsets)
            score_parts['onset'] = onset_score

            # 3. 感嘆詞/叫び系ワード (+15)
            text, excl_score = self._score_exclamations(seg_start, seg_end, transcript_result, lang)
            score_parts['exclamation'] = excl_score

            # 4. 急激な音量変化 ΔdB (+15)
            delta_score = self._score_delta_db(seg_start, seg_end, energy_timeline)
            score_parts['delta_db'] = delta_score

            # 5. 無音→急激な音量上昇 (+10)
            burst_score = self._score_silence_burst(seg_start, seg_end, energy_timeline)
            score_parts['silence_burst'] = burst_score

            # 6. 発話密度 (+5)
            density_score = self._score_speech_density(text, seg_end - seg_start)
            score_parts['speech_density'] = density_score

            # 7. ピッチ(f0)変動 (+10)
            pitch_score = self._score_pitch(seg_start, seg_end, pitch_timeline)
            score_parts['pitch'] = pitch_score

            # 8. 任意のテキスト感情分析 (+5)
            sentiment_score = self._score_sentiment(text)
            score_parts['sentiment'] = sentiment_score

            # 9. 分離された実況音声の高揚 (+20)
            voice_arousal_score = self._score_voice_arousal(
                seg_start,
                seg_end,
                voice_energy_timeline,
                voice_onsets,
                voice_high_energy_regions,
            )
            score_parts['voice_arousal'] = voice_arousal_score

            # 10. ゲーム音イベントと実況者の反応一致 (+15)
            reaction_score = self._score_reaction_coincidence(
                seg_start,
                seg_end,
                onsets,
                high_energy_regions,
                voice_onsets,
                voice_high_energy_regions,
            )
            score_parts['reaction_coincidence'] = reaction_score

            # 実際に利用可能な特徴だけを分母にし、0-100の尺度を維持する。
            # BETAで無効なpitchや未注入のsentimentが満点を下げないようにする。
            available_features = {
                'energy', 'onset', 'exclamation', 'delta_db',
                'silence_burst', 'speech_density',
            }
            if pitch_timeline:
                available_features.add('pitch')
            if self.sentiment_analyzer is not None:
                available_features.add('sentiment')
            if has_voice_audio:
                available_features.update({'voice_arousal', 'reaction_coincidence'})
            total = self._weighted_total(score_parts, available_features)
            score_axes, evidence = self._base_score_axes(
                score_parts,
                text=text,
                has_game_audio=bool(energy_timeline or onsets or high_energy_regions),
                has_voice_audio=has_voice_audio,
            )

            # 理由の生成
            reasons = []
            if score_parts['energy'] > 0.5:
                reasons.append("高音声エネルギー")
            if score_parts['onset'] > 0.5:
                reasons.append("高onset密度")
            if score_parts['exclamation'] > 0.3:
                reasons.append("感嘆詞検出")
            if score_parts['delta_db'] > 0.5:
                reasons.append("急激な音量変化")
            if score_parts['silence_burst'] > 0.5:
                reasons.append("無音からの爆発")
            if score_parts['speech_density'] > 0.6:
                reasons.append("高発話密度(早口/集中)")
            if score_parts['pitch'] > 0.5:
                reasons.append("声のピッチ急上昇")
            if score_parts['sentiment'] > 0.6:
                reasons.append("緊迫したテキスト内容")
            if score_parts['voice_arousal'] > 0.5:
                reasons.append("実況音声の高揚")
            if score_parts['reaction_coincidence'] > 0:
                reasons.append("ゲーム音と声の反応一致")

            # onset検出
            seg_onsets = [o for o in onsets if seg_start <= o <= seg_end]
            seg_voice_onsets = [o for o in voice_onsets if seg_start <= o <= seg_end]

            segments.append({
                'start': round(seg_start, 3),
                'end': round(seg_end, 3),
                'excitement_score': round(total, 1),
                'reasons': reasons,
                'transcript_text': text,
                'audio_peaks': sorted(set(seg_onsets + seg_voice_onsets)),
                'score_breakdown': {k: round(v, 3) for k, v in score_parts.items()},
                'score_axes': score_axes,
                'available_evidence': evidence,
            })

            t += self.segment_step

        # スコア降順でソート
        segments.sort(key=lambda s: s['excitement_score'], reverse=True)

        print(f"  スコアリング完了: {len(segments)}セグメント")
        if segments:
            print(f"   トップ: {segments[0]['excitement_score']}点 "
                  f"[{segments[0]['start']:.1f}s-{segments[0]['end']:.1f}s] "
                  f"{', '.join(segments[0]['reasons'])}")

        return segments

    @staticmethod
    def _base_score_axes(
        score_parts: dict,
        *,
        text: str,
        has_game_audio: bool,
        has_voice_audio: bool,
    ) -> tuple[dict, list[str]]:
        """旧特徴を、イベント・反応・クリップ適性・確信度へ分離する。"""
        event = (
            score_parts.get('energy', 0.0) * 0.30
            + score_parts.get('onset', 0.0) * 0.20
            + score_parts.get('delta_db', 0.0) * 0.30
            + score_parts.get('silence_burst', 0.0) * 0.20
        )

        if has_voice_audio:
            reaction = (
                score_parts.get('exclamation', 0.0) * 0.25
                + score_parts.get('speech_density', 0.0) * 0.10
                + score_parts.get('voice_arousal', 0.0) * 0.40
                + score_parts.get('reaction_coincidence', 0.0) * 0.25
            )
        else:
            # 混合音声では発話内容を弱い反応信号として扱う。
            reaction = (
                score_parts.get('exclamation', 0.0) * 0.75
                + score_parts.get('speech_density', 0.0) * 0.25
            )

        compact_text = re.sub(r'\s+', '', text or '')
        text_coverage = min(1.0, len(compact_text) / 12.0)
        agreement = min(event, reaction)
        clipability = min(
            1.0,
            max(event, reaction) * 0.45 + agreement * 0.25 + text_coverage * 0.30,
        )

        evidence = []
        confidence = 0.0
        if has_game_audio:
            evidence.append('audio')
            confidence += 0.45
        if compact_text:
            evidence.append('transcript')
            confidence += 0.25
        if has_voice_audio:
            evidence.append('separate_voice')
            confidence += 0.20

        return {
            'event': round(min(1.0, event) * 100.0, 1),
            'reaction': round(min(1.0, reaction) * 100.0, 1),
            'clipability': round(clipability * 100.0, 1),
            'confidence': round(min(1.0, confidence), 3),
        }, evidence

    @staticmethod
    def _robust_prominence(values: list[Optional[float]]) -> list[float]:
        return robust_prominence(values)

    @staticmethod
    def _window_peak_mean(
        values: list[float],
        centers: list[float],
        half_width: float,
    ) -> list[float]:
        return window_peak_mean(values, centers, half_width)

    @staticmethod
    def _values_in_range(
        items: list[dict],
        start: float,
        end: float,
        key: str,
        times: Optional[list[float]] = None,
    ) -> list[float]:
        return values_in_range(items, start, end, key, times)

    def enrich_video_segments(self, scored_segments: list, media_signals: Optional[dict] = None) -> list:
        """動画全体のロバスト統計と複数時間幅を4軸スコアへ反映する。"""
        if not scored_segments:
            return []

        result = [segment.copy() for segment in scored_segments]
        signals = media_signals or {}
        loudness_frames = sorted(
            (
                item for item in (signals.get('audio_loudness') or [])
                if isinstance(item, dict)
                and isinstance(item.get('time'), (int, float))
                and math.isfinite(float(item['time']))
            ),
            key=lambda item: float(item['time']),
        )
        video_frames = sorted(
            (
                item for item in (signals.get('video_frames') or [])
                if isinstance(item, dict)
                and isinstance(item.get('time'), (int, float))
                and math.isfinite(float(item['time']))
            ),
            key=lambda item: float(item['time']),
        )
        loudness_times = [float(item['time']) for item in loudness_frames]
        video_times = [float(item['time']) for item in video_frames]

        loudness_peaks: list[Optional[float]] = []
        scene_peaks: list[Optional[float]] = []
        luma_ranges: list[Optional[float]] = []
        luma_diff_peaks: list[Optional[float]] = []
        for segment in result:
            start = float(segment.get('start', 0.0))
            end = float(segment.get('end', start))
            momentary = self._values_in_range(
                loudness_frames, start, end, 'momentary', loudness_times
            )
            scene_scores = self._values_in_range(
                video_frames, start, end, 'scene_score', video_times
            )
            luma_values = self._values_in_range(
                video_frames, start, end, 'luma', video_times
            )
            luma_diffs = self._values_in_range(
                video_frames, start, end, 'luma_diff', video_times
            )
            loudness_peaks.append(max(momentary) if momentary else None)
            scene_peaks.append(max(scene_scores) if scene_scores else None)
            luma_ranges.append(max(luma_values) - min(luma_values) if len(luma_values) >= 2 else None)
            luma_diff_peaks.append(max(luma_diffs) if luma_diffs else None)

        loudness_prominence = self._robust_prominence(loudness_peaks)
        scene_prominence = self._robust_prominence(scene_peaks)
        luma_prominence = self._robust_prominence(luma_ranges)

        for index, segment in enumerate(result):
            axes = dict(segment.get('score_axes') or {})
            base_event = min(1.0, max(0.0, float(axes.get('event', 0.0)) / 100.0))
            base_reaction = min(1.0, max(0.0, float(axes.get('reaction', 0.0)) / 100.0))
            base_clipability = min(1.0, max(0.0, float(axes.get('clipability', 0.0)) / 100.0))
            confidence = min(1.0, max(0.0, float(axes.get('confidence', 0.0))))

            absolute_scene = min(1.0, max(0.0, float(scene_peaks[index] or 0.0) / 15.0))
            visual_change = min(
                1.0,
                max(
                    luma_prominence[index],
                    min(1.0, max(0.0, float(luma_diff_peaks[index] or 0.0) / 12.0)),
                ),
            )
            scene_signal = max(scene_prominence[index], absolute_scene)
            media_boost = (
                loudness_prominence[index] * 0.18
                + scene_signal * 0.18
                + visual_change * 0.06
            )
            event = min(1.0, base_event + (1.0 - base_event) * media_boost)

            media_breakdown = {
                'loudness_prominence': round(loudness_prominence[index], 3),
                'scene_change': round(scene_signal, 3),
                'visual_change': round(visual_change, 3),
            }
            segment['media_breakdown'] = media_breakdown
            segment['legacy_excitement_score'] = round(float(segment.get('excitement_score', 0.0)), 1)
            segment['_axis_units'] = {
                'event': event,
                'reaction': base_reaction,
                'clipability': base_clipability,
                'confidence': confidence,
            }

            evidence = list(segment.get('available_evidence') or [])
            reasons = list(segment.get('reasons') or [])
            if loudness_frames:
                evidence.append('perceptual_loudness')
                confidence += 0.05
            if video_frames:
                evidence.append('visual_change')
                confidence += 0.10
            if loudness_prominence[index] >= 0.55:
                reasons.append('知覚音量が動画内で突出')
            if scene_signal >= 0.65:
                reasons.append('大きな場面転換')
            if visual_change >= 0.65:
                reasons.append('映像変化が集中')
            segment['available_evidence'] = list(dict.fromkeys(evidence))
            segment['reasons'] = list(dict.fromkeys(reasons))
            segment['_axis_units']['confidence'] = min(1.0, confidence)

        ordered = sorted(result, key=lambda item: (float(item.get('start', 0.0)), float(item.get('end', 0.0))))
        centers = [
            (float(item.get('start', 0.0)) + float(item.get('end', 0.0))) / 2.0
            for item in ordered
        ]
        intensity = [
            max(item['_axis_units']['event'], item['_axis_units']['reaction'])
            for item in ordered
        ]
        scale_series = {
            label: self._window_peak_mean(intensity, centers, width / 2.0)
            for label, width in (('short', 3.0), ('medium', 8.0), ('long', 20.0))
        }
        for index, segment in enumerate(ordered):
            scale_scores = {
                label: values[index] for label, values in scale_series.items()
            }

            units = segment['_axis_units']
            event = units['event']
            reaction = units['reaction']
            context = (
                scale_scores['short'] * 0.45
                + scale_scores['medium'] * 0.35
                + scale_scores['long'] * 0.20
            )
            agreement = min(event, reaction)
            clipability = max(
                units['clipability'],
                context * 0.45 + max(event, reaction) * 0.30 + agreement * 0.25,
            )
            fused_score = (
                max(event, reaction) * 0.55
                + agreement * 0.20
                + clipability * 0.25
            )
            legacy_score = min(
                1.0,
                max(0.0, float(segment.get('legacy_excitement_score', 0.0)) / 100.0),
            )
            # 実動画での校正が蓄積するまでは旧尺度を下げず、新信号は上側への補正に限る。
            final_score = max(legacy_score, legacy_score * 0.60 + fused_score * 0.40)

            segment['score_axes'] = {
                'event': round(event * 100.0, 1),
                'reaction': round(reaction * 100.0, 1),
                'clipability': round(min(1.0, clipability) * 100.0, 1),
                'confidence': round(units['confidence'], 3),
            }
            segment['multiscale_scores'] = {
                key: round(value * 100.0, 1) for key, value in scale_scores.items()
            }
            segment['excitement_score'] = round(min(100.0, max(0.0, final_score * 100.0)), 1)

        for segment in ordered:
            segment.pop('_axis_units', None)

        return sorted(ordered, key=lambda item: float(item.get('excitement_score', 0.0)), reverse=True)

    def _weighted_total(self, score_parts: dict, available_features: set) -> float:
        """利用可能な特徴の重み合計を100点へ正規化する。"""
        weights = {
            'energy': self.energy_weight,
            'onset': self.onset_weight,
            'exclamation': self.exclamation_weight,
            'delta_db': self.delta_db_weight,
            'silence_burst': self.silence_burst_weight,
            'speech_density': self.speech_density_weight,
            'pitch': self.pitch_weight,
            'sentiment': self.sentiment_weight,
            'voice_arousal': self.voice_arousal_weight,
            'reaction_coincidence': self.reaction_coincidence_weight,
        }
        active_weight = sum(
            max(0.0, weights[name]) for name in available_features
        )
        if active_weight <= 0:
            return 0.0

        weighted_sum = sum(
            score_parts.get(name, 0.0) * max(0.0, weights[name])
            for name in available_features
        )
        return min(100.0, max(0.0, weighted_sum * 100.0 / active_weight))

    @staticmethod
    def _resolve_language(language, transcript_result) -> str:
        """auto/未指定時はWhisperが検出した言語を使う。"""
        requested = (language or '').strip().lower()
        if requested and requested != 'auto':
            return requested

        detected = str(transcript_result.get('language') or 'ja').strip().lower()
        return detected or 'ja'

    def _score_energy(self, start_t, end_t, high_energy_regions):
        """高エネルギー区間の重複を計算"""
        if not high_energy_regions:
            return 0

        total_overlap = 0.0
        for region in high_energy_regions:
            region_start, region_end = region[0], region[1]
            overlap_start = max(region_start, start_t)
            overlap_end = min(region_end, end_t)
            total_overlap += max(0.0, overlap_end - overlap_start)

        ratio = total_overlap / (end_t - start_t)
        return float(min(1.0, ratio * 2.0))

    def _score_onsets(self, start_t, end_t, onsets):
        """指定区間内のonset数をカウント"""
        if not onsets:
            return 0
        count = sum(1 for onset in onsets if start_t <= onset <= end_t)
        expected = (end_t - start_t) * 2.0  # 1秒あたり2回を基準
        ratio = count / max(1.0, expected)
        return float(min(1.0, ratio))

    def _score_exclamations(self, start, end, transcript, lang) -> tuple:
        """区間内テキストから感嘆詞を検出"""
        patterns = EXCLAMATION_PATTERNS_JA if lang.startswith('ja') else EXCLAMATION_PATTERNS_EN

        text_parts = []
        for seg in transcript.get('segments', []):
            if seg['end'] >= start and seg['start'] <= end:
                text_parts.append(seg['text'])

        text = ' '.join(text_parts)
        if not text:
            return '', 0.0

        combined_pattern = '|'.join(patterns)
        matches = list(re.finditer(combined_pattern, text, re.IGNORECASE))
        match_count = len(matches)
        
        return text, min(1.0, match_count / 3.0)

    def _score_delta_db(self, start_t, end_t, energy_timeline):
        """区間内の音量変化(ΔdB)の最大値を計算"""
        if not energy_timeline:
            return 0
        valid_dbs = [
            db for t, db in energy_timeline
            if start_t <= t <= end_t
        ]
        if len(valid_dbs) < 2:
            return 0

        max_db = max(valid_dbs)
        min_db = min(valid_dbs)
        delta = max_db - min_db
        
        ratio = delta / 20.0
        return float(min(1.0, ratio))

    def _score_silence_burst(self, start_t, end_t, energy_timeline):
        """無音からの急激な音量上昇を検出"""
        if not energy_timeline:
            return 0

        # 直前の1秒間の平均音量と、現在のセグメントの最大音量を比較する
        pre_dbs = [
            db for t, db in energy_timeline
            if start_t - 1.0 <= t < start_t
        ]
        seg_dbs = [
            db for t, db in energy_timeline
            if start_t <= t <= end_t
        ]
        if len(pre_dbs) == 0 or len(seg_dbs) == 0:
            return 0.0

        pre_mean = sum(pre_dbs) / len(pre_dbs)
        seg_max = max(seg_dbs)
        
        jump = seg_max - pre_mean
        
        if jump > 20.0:
            return 1.0
        elif jump > 10.0:
            return (jump - 10.0) / 10.0
        return 0.0

    def _score_speech_density(self, text: str, duration: float) -> float:
        """発話密度（文字数/秒）を計算"""
        if not text or duration <= 0:
            return 0.0
        # スペース等を除外した実質文字数
        import re
        chars = len(re.sub(r'\s+', '', text))
        density = chars / duration
        # 日本語の場合、5文字/秒 を基準とする
        ratio = density / 5.0
        return min(1.0, ratio)

    def _score_pitch(self, start_t, end_t, pitch_timeline) -> float:
        """声のピッチ変動（分散や急上昇）を計算"""
        if not pitch_timeline:
            return 0.0

        # 0.0 (unvoiced) を除外
        voiced_pitches = [
            pitch for t, pitch in pitch_timeline
            if start_t <= t <= end_t and pitch > 0
        ]
        if len(voiced_pitches) < 5:
            return 0.0

        mean_pitch = sum(voiced_pitches) / len(voiced_pitches)
        variance = sum((pitch - mean_pitch) ** 2 for pitch in voiced_pitches) / len(voiced_pitches)
        std_dev = variance ** 0.5
        max_pitch = max(voiced_pitches)
        
        # ピッチの分散(感情の揺れ)が 50Hz 以上、または ピッチ自体が 400Hz 以上なら加点
        score = 0.0
        if std_dev > 50:
            score += 0.5
        if max_pitch > 350:
            score += 0.5
            
        return min(1.0, score)

    def _score_voice_arousal(
        self,
        start_t,
        end_t,
        energy_timeline,
        onsets,
        high_energy_regions,
    ) -> float:
        """分離された実況音声の勢いを、音量・変化・立ち上がりから推定する。"""
        if not energy_timeline:
            return 0.0

        energy = self._score_energy(start_t, end_t, high_energy_regions)
        delta = self._score_delta_db(start_t, end_t, energy_timeline)
        burst = self._score_silence_burst(start_t, end_t, energy_timeline)
        onset = self._score_onsets(start_t, end_t, onsets)
        return min(1.0, energy * 0.40 + delta * 0.30 + burst * 0.20 + onset * 0.10)

    @staticmethod
    def _event_times(onsets, high_energy_regions) -> list:
        """onsetと高エネルギー区間の開始点を、近接重複を除いて統合する。"""
        raw_times = [float(onset) for onset in onsets]
        raw_times.extend(float(region[0]) for region in high_energy_regions if region)
        raw_times.sort()

        events = []
        for event_time in raw_times:
            if not events or event_time - events[-1] >= 0.20:
                events.append(event_time)
        return events

    def _score_reaction_coincidence(
        self,
        start_t,
        end_t,
        game_onsets,
        game_high_energy_regions,
        voice_onsets,
        voice_high_energy_regions,
    ) -> float:
        """ゲームイベント直前〜直後に起きた実況者の反応を評価する。"""
        if not voice_onsets and not voice_high_energy_regions:
            return 0.0

        game_events = self._event_times(game_onsets, game_high_energy_regions)
        voice_events = self._event_times(voice_onsets, voice_high_energy_regions)
        if not game_events or not voice_events:
            return 0.0

        pairs = 0
        used_game_events = set()
        for voice_time in voice_events:
            if not start_t <= voice_time <= end_t:
                continue

            # 典型的にはゲーム音の直後に声が出る。先行発声も0.5秒までは許容。
            candidates = [
                (abs(voice_time - game_time), index)
                for index, game_time in enumerate(game_events)
                if index not in used_game_events
                and start_t - 0.5 <= game_time <= end_t
                and voice_time - 1.5 <= game_time <= voice_time + 0.5
            ]
            if candidates:
                _, best_index = min(candidates)
                used_game_events.add(best_index)
                pairs += 1

        # 1組で中程度、2組以上で強い一致とみなす。
        return min(1.0, pairs / 2.0)

    def _score_sentiment(self, text: str) -> float:
        """注入された解析器による緊迫度・興奮度の判定（0.0〜1.0）。"""
        normalized_text = text.strip()
        if len(normalized_text) < 3 or self.sentiment_analyzer is None:
            return 0.0

        if normalized_text in self._sentiment_cache:
            return self._sentiment_cache[normalized_text]

        try:
            raw_score = float(self.sentiment_analyzer(normalized_text))
            score = min(1.0, max(0.0, raw_score))
        except (TypeError, ValueError, RuntimeError):
            score = 0.0

        self._sentiment_cache[normalized_text] = score
        return score

    def normalize_video_scores(
        self,
        scored_segments: list,
        relative_weight: float = 0.25,
        min_spread: float = 20.0,
    ) -> list:
        """動画内で相対的に珍しい区間を穏やかに加点する。

        絶対スコアを残したまま上位半分だけを相対順位で加点するため、
        静かな動画でも必ず高得点が生まれる、という順位変換の副作用を避ける。
        入力の辞書はコピーし、raw_excitement_scoreとrelative_percentileを残す。
        """
        if not scored_segments:
            return []

        result = [segment.copy() for segment in scored_segments]
        raw_scores = [
            min(100.0, max(0.0, float(segment.get('excitement_score', 0.0))))
            for segment in result
        ]
        sorted_scores = sorted(raw_scores)
        spread = sorted_scores[-1] - sorted_scores[0]
        blend = min(1.0, max(0.0, float(relative_weight)))
        if min_spread > 0:
            blend *= min(1.0, spread / min_spread)

        for segment, raw_score in zip(result, raw_scores):
            if spread <= 0 or len(sorted_scores) == 1:
                percentile = 50.0
            else:
                left = bisect.bisect_left(sorted_scores, raw_score)
                right = bisect.bisect_right(sorted_scores, raw_score)
                average_rank = (left + right - 1) / 2.0
                percentile = average_rank * 100.0 / (len(sorted_scores) - 1)

            upper_tail = max(0.0, (percentile - 50.0) * 2.0) / 100.0
            normalized = raw_score + (100.0 - raw_score) * blend * upper_tail
            segment['raw_excitement_score'] = round(raw_score, 1)
            segment['relative_percentile'] = round(percentile, 1)
            segment['excitement_score'] = round(min(100.0, normalized), 1)

            if upper_tail >= 0.5 and normalized - raw_score >= 5.0:
                reasons = list(segment.get('reasons', []))
                if "動画内で相対的に突出" not in reasons:
                    reasons.append("動画内で相対的に突出")
                segment['reasons'] = reasons

        result.sort(key=lambda segment: segment['excitement_score'], reverse=True)
        return result

    @staticmethod
    def _overlap_iou(first: dict, second: dict) -> float:
        intersection = max(
            0.0,
            min(float(first['end']), float(second['end']))
            - max(float(first['start']), float(second['start'])),
        )
        union = max(float(first['end']), float(second['end'])) - min(
            float(first['start']), float(second['start'])
        )
        return intersection / union if union > 0 else 0.0

    @staticmethod
    def _transcript_text_for_range(transcript_segments: list, start: float, end: float) -> str:
        texts = []
        for segment in transcript_segments:
            seg_start = float(segment.get('start', segment.get('startTime', 0.0)))
            seg_end = float(segment.get('end', segment.get('endTime', seg_start)))
            text = str(segment.get('text') or '').strip()
            if text and seg_end >= start and seg_start <= end:
                texts.append(text)
        return ' '.join(dict.fromkeys(texts))

    @staticmethod
    def _snap_candidate_boundaries(
        start: float,
        end: float,
        transcript_segments: list,
        scene_changes: list,
        *,
        pre_roll: float,
        post_roll: float,
    ) -> tuple[float, float]:
        desired_start = max(0.0, start - pre_roll)
        desired_end = end + post_roll

        preceding_scenes = [
            float(value) for value in scene_changes
            if isinstance(value, (int, float)) and desired_start <= float(value) <= start
        ]
        following_scenes = [
            float(value) for value in scene_changes
            if isinstance(value, (int, float)) and end <= float(value) <= desired_end
        ]
        if preceding_scenes:
            desired_start = max(preceding_scenes)
        if following_scenes:
            desired_end = min(following_scenes)

        before = []
        after = []
        for segment in transcript_segments:
            seg_start = float(segment.get('start', segment.get('startTime', 0.0)))
            seg_end = float(segment.get('end', segment.get('endTime', seg_start)))
            if seg_end >= desired_start and seg_start <= start:
                before.append((seg_end, seg_start))
            if seg_start <= desired_end and seg_end >= end:
                after.append((seg_start, seg_end))

        if before:
            # イベント直前の最後の発話を切らない。
            _, transcript_start = max(before)
            desired_start = min(desired_start, transcript_start)
        if after:
            # イベント直後に始まる最初の反応発話を最後まで含める。
            _, transcript_end = min(after)
            desired_end = max(desired_end, transcript_end)

        return max(0.0, desired_start), max(end, desired_end)

    @staticmethod
    def _candidate_category(candidate: dict) -> str:
        text = " ".join([
            str(candidate.get('transcript_text') or ''),
            " ".join(str(reason) for reason in (candidate.get('reasons') or [])),
        ]).lower()
        categories = (
            ('victory', ('勝', '達成', 'クリア', 'victory', 'win', 'champion')),
            ('failure', ('負け', '失敗', '死亡', 'やられ', 'lost', 'dead', 'failure')),
            ('comedy', ('笑', 'おもしろ', '爆笑', 'comedy', 'laugh')),
            ('surprise', ('驚', 'やば', 'まじ', 'うわ', 'surprise', 'wow', 'no way')),
            ('explanation', ('解説', '理由', 'ポイント', 'つまり', 'because', 'guide')),
        )
        for category, keywords in categories:
            if any(keyword in text for keyword in keywords):
                return category
        axes = candidate.get('score_axes') or {}
        if float(axes.get('reaction', 0.0)) >= float(axes.get('event', 0.0)):
            return 'reaction'
        if 'visual_change' in (candidate.get('available_evidence') or []):
            return 'visual'
        return 'event'

    @staticmethod
    def _false_positive_risk(candidate: dict) -> float:
        axes = candidate.get('score_axes') or {}
        media = candidate.get('media_breakdown') or {}
        event = float(axes.get('event', 0.0))
        reaction = float(axes.get('reaction', 0.0))
        clipability = float(axes.get('clipability', 0.0))
        confidence = float(axes.get('confidence', 0.0))
        transcript = str(candidate.get('transcript_text') or '').strip()
        loudness = float(media.get('loudness_prominence', 0.0))
        visual = max(
            float(media.get('scene_change', 0.0)),
            float(media.get('visual_change', 0.0)),
        )

        risk = 0.0
        if confidence < 0.45:
            risk += 0.30
        if reaction < 15.0 and not transcript:
            risk += 0.25
        if event >= 55.0 and reaction < 20.0 and loudness < 0.15 and visual < 0.15:
            risk += 0.30
        if clipability < 30.0:
            risk += 0.20
        if min(event, reaction) >= 45.0:
            risk -= 0.30
        return round(min(1.0, max(0.0, risk)), 3)

    @classmethod
    def _select_diverse_candidates(
        cls,
        candidates: list,
        max_clips: int,
        video_duration: Optional[float],
    ) -> list:
        if max_clips <= 0 or not candidates:
            return []
        pool = [candidate.copy() for candidate in candidates]
        duration = float(video_duration or max(float(item.get('end', 0.0)) for item in pool))
        duration = max(1.0, duration)
        selected = []
        category_counts: dict[str, int] = {}
        time_bucket_counts: dict[int, int] = {}
        while pool and len(selected) < max_clips:
            def adjusted(candidate):
                category = str(candidate.get('candidate_category') or cls._candidate_category(candidate))
                center = (float(candidate.get('start', 0.0)) + float(candidate.get('end', 0.0))) / 2.0
                bucket = min(2, max(0, int(center / duration * 3.0)))
                return (
                    float(candidate.get('excitement_score', 0.0))
                    - category_counts.get(category, 0) * 6.0
                    - time_bucket_counts.get(bucket, 0) * 3.0
                )

            best = max(pool, key=lambda item: (adjusted(item), float(item.get('excitement_score', 0.0))))
            pool.remove(best)
            category = cls._candidate_category(best)
            center = (float(best.get('start', 0.0)) + float(best.get('end', 0.0))) / 2.0
            bucket = min(2, max(0, int(center / duration * 3.0)))
            best['candidate_category'] = category
            category_counts[category] = category_counts.get(category, 0) + 1
            time_bucket_counts[bucket] = time_bucket_counts.get(bucket, 0) + 1
            selected.append(best)
        return selected

    @staticmethod
    def _duration_variants(
        peak_center: float,
        transcript_segments: list,
        video_duration: Optional[float],
    ) -> dict:
        duration = max(0.0, float(video_duration or 0.0))
        variants = {}
        for target in (15.0, 30.0, 60.0):
            start = max(0.0, peak_center - target * 0.40)
            end = start + target
            if duration > 0 and end > duration:
                end = duration
                start = max(0.0, end - target)
            for segment in transcript_segments:
                seg_start = float(segment.get('start', segment.get('startTime', 0.0)))
                seg_end = float(segment.get('end', segment.get('endTime', seg_start)))
                if seg_start < start < seg_end:
                    start = seg_start
                if seg_start < end < seg_end:
                    end = seg_end
            if duration > 0:
                end = min(duration, end)
            variants[str(int(target))] = {
                'start': round(max(0.0, start), 3),
                'end': round(max(start, end), 3),
            }
        return variants

    def extract_peak_highlights(
        self,
        scored_segments: list,
        *,
        threshold: float = 40.0,
        max_clips: int = 10,
        transcript_segments: Optional[list] = None,
        media_signals: Optional[dict] = None,
        video_duration: Optional[float] = None,
        min_peak_distance: float = 8.0,
        max_duration: float = 45.0,
        min_duration: float = 6.0,
        pre_roll: float = 2.5,
        post_roll: float = 4.0,
    ) -> list:
        """局所ピークを中心に、重複しない編集向け候補区間を作る。"""
        if not scored_segments or max_clips <= 0:
            return []

        transcript_segments = transcript_segments or []
        scene_changes = list((media_signals or {}).get('scene_changes') or [])
        ordered = sorted(
            (segment.copy() for segment in scored_segments),
            key=lambda item: (float(item.get('start', 0.0)), float(item.get('end', 0.0))),
        )
        eligible = [
            segment for segment in ordered
            if float(segment.get('excitement_score', 0.0)) >= float(threshold)
        ]
        if not eligible:
            return []

        peak_pool = []
        for index, segment in enumerate(eligible):
            score = float(segment.get('excitement_score', 0.0))
            center = (float(segment['start']) + float(segment['end'])) / 2.0
            previous_score = (
                float(eligible[index - 1].get('excitement_score', 0.0))
                if index > 0 and float(segment['start']) - float(eligible[index - 1]['end']) <= 3.0
                else float('-inf')
            )
            next_score = (
                float(eligible[index + 1].get('excitement_score', 0.0))
                if index + 1 < len(eligible)
                and float(eligible[index + 1]['start']) - float(segment['end']) <= 3.0
                else float('-inf')
            )
            # 上昇側を厳密比較し、平坦な高得点帯からは先頭の1点だけを選ぶ。
            if score > previous_score and score >= next_score:
                peak_pool.append((score, center, segment))

        # 平坦な高得点帯で局所ピークを拾えない場合も、最高点は必ず候補にする。
        if not peak_pool:
            best = max(eligible, key=lambda item: float(item.get('excitement_score', 0.0)))
            peak_pool.append((
                float(best.get('excitement_score', 0.0)),
                (float(best['start']) + float(best['end'])) / 2.0,
                best,
            ))

        selected_peaks = []
        candidate_budget = max(max_clips * 4, max_clips + 8)
        for score, center, segment in sorted(peak_pool, key=lambda item: (-item[0], item[1])):
            if any(abs(center - accepted_center) < min_peak_distance for _, accepted_center, _ in selected_peaks):
                continue
            selected_peaks.append((score, center, segment))
            if len(selected_peaks) >= candidate_budget:
                break

        candidates = []
        ordered_starts = [float(segment.get('start', 0.0)) for segment in ordered]
        max_segment_span = max(
            (max(0.0, float(segment.get('end', 0.0)) - float(segment.get('start', 0.0))) for segment in ordered),
            default=0.0,
        )
        for peak_score, peak_center, peak in selected_peaks:
            support_threshold = max(float(threshold) * 0.80, peak_score * 0.55)
            support_left = bisect.bisect_left(
                ordered_starts,
                peak_center - max_duration / 2.0 - max_segment_span,
            )
            support_right = bisect.bisect_right(
                ordered_starts,
                peak_center + max_duration / 2.0,
            )
            support = [
                segment for segment in ordered[support_left:support_right]
                if float(segment.get('excitement_score', 0.0)) >= support_threshold
                and float(segment['start']) <= peak_center + max_duration / 2.0
                and float(segment['end']) >= peak_center - max_duration / 2.0
            ]
            if not support:
                support = [peak]

            # ピークと重なる、または3秒以内で連続する支持区間だけを採用する。
            connected = [peak]
            connected_ids = {id(peak)}
            left_edge = float(peak['start'])
            right_edge = float(peak['end'])
            changed = True
            while changed:
                changed = False
                for segment in support:
                    if id(segment) in connected_ids:
                        continue
                    seg_start = float(segment['start'])
                    seg_end = float(segment['end'])
                    if seg_end >= left_edge - 3.0 and seg_start <= right_edge + 3.0:
                        connected.append(segment)
                        connected_ids.add(id(segment))
                        left_edge = min(left_edge, seg_start)
                        right_edge = max(right_edge, seg_end)
                        changed = True

            base_start = min(float(item['start']) for item in connected)
            base_end = max(float(item['end']) for item in connected)
            start, end = self._snap_candidate_boundaries(
                base_start,
                base_end,
                transcript_segments,
                scene_changes,
                pre_roll=pre_roll,
                post_roll=post_roll,
            )

            if video_duration is not None and math.isfinite(float(video_duration)):
                end = min(end, max(0.0, float(video_duration)))
            if end - start < min_duration:
                missing = min_duration - (end - start)
                start = max(0.0, start - missing * 0.40)
                end += missing * 0.60
                if video_duration is not None:
                    end = min(end, max(0.0, float(video_duration)))
                    if end - start < min_duration:
                        start = max(0.0, end - min_duration)
            if end - start > max_duration:
                start = max(0.0, peak_center - max_duration * 0.40)
                end = start + max_duration
                if video_duration is not None and end > float(video_duration):
                    end = float(video_duration)
                    start = max(0.0, end - max_duration)

            reasons = []
            audio_peaks = []
            for item in sorted(connected, key=lambda value: float(value['start'])):
                reasons.extend(item.get('reasons') or [])
                audio_peaks.extend(
                    value for value in (item.get('audio_peaks') or [])
                    if isinstance(value, (int, float)) and start <= float(value) <= end
                )

            transcript_text = self._transcript_text_for_range(transcript_segments, start, end)
            if not transcript_text:
                transcript_text = ' '.join(dict.fromkeys(
                    str(item.get('transcript_text') or '').strip()
                    for item in connected if str(item.get('transcript_text') or '').strip()
                ))

            candidate = {
                **peak,
                'start': round(start, 3),
                'end': round(max(start, end), 3),
                'excitement_score': round(peak_score, 1),
                'reasons': list(dict.fromkeys(reasons)),
                'transcript_text': transcript_text,
                'audio_peaks': sorted(set(float(value) for value in audio_peaks)),
            }
            candidates.append(candidate)

        # 拡張後に大きく重なる候補は、より高得点の一方だけを残す。
        deduplicated = []
        for candidate in sorted(candidates, key=lambda item: -float(item['excitement_score'])):
            candidate_duration = max(1e-6, float(candidate['end']) - float(candidate['start']))
            is_duplicate = False
            for accepted in deduplicated:
                intersection = max(
                    0.0,
                    min(float(candidate['end']), float(accepted['end']))
                    - max(float(candidate['start']), float(accepted['start'])),
                )
                accepted_duration = max(1e-6, float(accepted['end']) - float(accepted['start']))
                shorter_overlap = intersection / min(candidate_duration, accepted_duration)
                if self._overlap_iou(candidate, accepted) >= 0.55 or shorter_overlap >= 0.70:
                    is_duplicate = True
                    break
            if is_duplicate:
                continue
            deduplicated.append(candidate)

        screened = []
        for candidate in deduplicated:
            candidate['candidate_category'] = self._candidate_category(candidate)
            candidate['false_positive_risk'] = self._false_positive_risk(candidate)
            center = (float(candidate['start']) + float(candidate['end'])) / 2.0
            candidate['duration_variants'] = self._duration_variants(
                center,
                transcript_segments,
                video_duration,
            )
            # 信号がほぼ単独で、信頼度も低い候補だけを除外する。高得点候補は確認用に残す。
            if candidate['false_positive_risk'] < 0.75 or float(candidate['excitement_score']) >= 85.0:
                screened.append(candidate)
        return self._select_diverse_candidates(screened, max_clips, video_duration)

    def get_highlight_segments(
        self,
        scored_segments: list,
        threshold: float = 40.0,
        max_clips: int = 10,
        min_gap: float = 3.0,
        max_duration: float = 60.0,
    ) -> list:
        """
        スコア付きセグメントからハイライトクリップ候補を抽出。
        近接するセグメントはマージしてより長いクリップにする。
        max_duration を超える場合はマージしない。
        """
        candidates = [s for s in scored_segments if s['excitement_score'] >= threshold]

        if not candidates:
            return []

        # 時間順にソート
        candidates.sort(key=lambda s: s['start'])

        # 近接セグメントのマージ (max_duration制限付き)
        merged = [candidates[0].copy()]
        for seg in candidates[1:]:
            prev = merged[-1]
            would_be_duration = seg['end'] - prev['start']
            gap = seg['start'] - prev['end']

            if gap <= min_gap and would_be_duration <= max_duration:
                # マージ
                prev['end'] = seg['end']
                prev['excitement_score'] = max(prev['excitement_score'], seg['excitement_score'])
                prev['reasons'] = list(dict.fromkeys(prev['reasons'] + seg['reasons']))
                # transcript_textの重複除去
                existing_texts = set(prev.get('transcript_text', '').split(' '))
                new_texts = seg.get('transcript_text', '').split(' ')
                for t in new_texts:
                    if t and t not in existing_texts:
                        prev['transcript_text'] = f"{prev.get('transcript_text', '')} {t}".strip()
                        existing_texts.add(t)
                prev['audio_peaks'] = list(dict.fromkeys(prev['audio_peaks'] + seg['audio_peaks']))
            else:
                merged.append(seg.copy())

        # スコア順でトップN
        merged.sort(key=lambda s: s['excitement_score'], reverse=True)
        return merged[:max_clips]


if __name__ == "__main__":
    print("HighlightScorer: transcriber + audio_analysis の結果を渡して使用してください")
