import os
import sys
import json
import time
import argparse
import gc

# ==============================================================
# 設定パラメータ
# ==============================================================
# Whisper の基本モデル設定
WHISPER_MODEL_SIZE = "large-v3-turbo"

SE_ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "se")

# ==============================================================
# ユーティリティ
# ==============================================================
def emit_progress(progress, message):
    print(f"PROGRESS:{progress}:{message}", file=sys.stderr, flush=True)

def cleanup_file(path):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        print(f"WARN: Failed to clean up {path}: {e}", file=sys.stderr, flush=True)

def _log(msg):
    print(f"[engine] {msg}", file=sys.stderr, flush=True)

def caption_end_time(start, end, text):
    """Whisperの長すぎる区間を、読めるが居座らない表示時間へ収める。"""
    import re
    clean_length = len(re.sub(r'[、。！？!?…\s]', '', text or ''))
    readable_duration = max(0.7, min(4.0, 0.8 + clean_length * 0.18))
    return max(start + 0.2, min(end, start + readable_duration))


def normalize_candidate_strategy(value) -> str:
    """評価ゲート未通過のpeak方式は明示指定時だけ有効にする。"""
    return 'peak' if str(value or '').strip().lower() == 'peak' else 'legacy'


def is_creator_only_candidate(index: int) -> bool:
    """Freeでレビューできる上位5件より後をCreator候補にする。"""
    return int(index) >= 5

# ==============================================================
# GPU自動検出
# ==============================================================
def detect_hardware_gpu():
    import subprocess
    try:
        if os.name == 'nt':
            output = subprocess.check_output(
                ["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"],
                stdin=subprocess.DEVNULL,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            ).upper()
            if "NVIDIA" in output:
                return "NVIDIA (CUDA)"
            elif "AMD" in output or "RADEON" in output:
                return "AMD (Vulkan)"
    except Exception as e:
        _log(f"GPU detection failed: {e}")
        pass
    return "CPU"

# ==============================================================
# ローカル解析エンジン
# ==============================================================
class LocalAnalysisEngine:
    def __init__(self, gpu_type="CPU"):
        self._whisper_model = None
        self._se_catalog = None
        self.hardware_gpu_string = detect_hardware_gpu()
        global WHISPER_MODEL_SIZE
        
        self.device = "cpu"
        self.compute_type = "int8"
        
        if gpu_type in ("NVIDIA", "AMD"):
            self.device = "gpu"
            self.compute_type = "float16"
            _log(f"GPU selected via gpu_type={gpu_type}. Using {self.device} with {self.compute_type}.")


    # ==========================================================
    # analyze_highlights_pipeline: 統合パイプライン (pipeline/ ベース)
    # ==========================================================
    def analyze_highlights_pipeline(self, audio_path: str, video_path: str = None, progress_callback=None, **kwargs):
        def _progress(p, msg):
            if progress_callback: progress_callback(p, msg)
            else: emit_progress(p, msg)

        _log(f"=== analyze_highlights_pipeline START ===")
        _progress(0.05, "パイプライン初期化...")

        # --- Import pipeline modules ---
        _progress(0.051, "パイプライン部品を読み込み中 (chunker)...")
        from pipeline.chunker import Chunker
        _progress(0.052, "パイプライン部品を読み込み中 (tempfile)...")
        import tempfile

        chunk_size = kwargs.get('chunk_size', 300)
        threshold = kwargs.get('threshold', 25.0)
        max_clips = kwargs.get('max_clips', 10)
        language = kwargs.get('language', 'auto')
        requested_game_id = kwargs.get('game_id', 'auto')
        subtitle_corrections = kwargs.get('subtitle_corrections') or []
        translate_to_english = bool(kwargs.get('translate_to_english', False))
        candidate_strategy = normalize_candidate_strategy(kwargs.get('candidate_strategy'))
        cancel_check = kwargs.get('cancel_check')

        def _check_cancel():
            if cancel_check:
                cancel_check()

        _check_cancel()
        _progress(0.055, "チャンク分割中...")
        chunker = Chunker(chunk_duration=chunk_size)
        
        target_path = video_path if (video_path and os.path.exists(video_path)) else audio_path
        from pipeline.game_glossary import resolve_game_glossary
        game_glossary = resolve_game_glossary(
            target_path,
            requested_game_id=requested_game_id,
            corrections=subtitle_corrections,
        )
        if game_glossary.get('glossary_applied'):
            _log(
                f"[Game Glossary] {game_glossary.get('label')} "
                f"source={game_glossary.get('source')} terms={len(game_glossary.get('terms') or [])}"
            )
        else:
            _log("[Game Glossary] disabled (game not confirmed)")
        chunks = chunker.get_chunks(target_path)
        video_duration = chunks[-1]['effective_end'] if chunks else 0
        _check_cancel()
        _progress(0.06, f"チャンク分割完了 ({len(chunks)}チャンク)")

        # whisper.cpp は Vulkan が使えれば自動でGPUを使用するため、
        # 常に large-v3-turbo モデルを使用する
        actual_model_size = "large-v3-turbo"
        
        _log(f"[Whisper] Selected Model Size: {actual_model_size}")

        _progress(0.061, "Whisperモジュール準備中...")
        from pipeline.transcriber import Transcriber
        transcriber = Transcriber(model_size=actual_model_size, device=self.device, compute_type=self.compute_type, hardware_gpu=self.hardware_gpu_string)

        _progress(0.064, "音声解析モジュール準備中...")
        from pipeline.audio_analysis import AudioAnalyzer
        audio_analyzer = AudioAnalyzer()

        _progress(0.067, "スコアリングモジュール準備中...")
        from pipeline.highlight_scorer import HighlightScorer
        scorer = HighlightScorer()

        _progress(0.078, "解析モジュール準備完了")

        # --- 音声トラック自動判別 ---
        _progress(0.08, "音声トラックを判別中 (声 vs ゲーム音)...")
        track_info = chunker.detect_audio_tracks(target_path, transcriber)
        _check_cancel()
        _log(f"[Track Detection] 声トラック={track_info['voice_tracks']}, ゲーム音トラック={track_info['game_tracks']}, 総トラック数={track_info['stream_count']}")
        has_separate_tracks = track_info['stream_count'] > 1 and len(track_info['game_tracks']) > 0

        media_signals = {
            "audio_loudness": [],
            "video_frames": [],
            "scene_changes": [],
            "available": {"audio_loudness": False, "visual": False},
            "warnings": [],
        }
        try:
            _progress(0.083, "知覚音量と映像変化を軽量スキャン中...")
            from pipeline.media_signal_analyzer import MediaSignalAnalyzer, should_sample_keyframes
            loudness_tracks = track_info['game_tracks'] if has_separate_tracks else [0]
            media_signals = MediaSignalAnalyzer().analyze(
                target_path,
                cancel_check=_check_cancel,
                progress_callback=lambda fraction, message: _progress(
                    0.083 + 0.015 * fraction,
                    message,
                ),
                audio_track_indices=loudness_tracks,
                keyframes_only=should_sample_keyframes(video_duration),
            )
            for warning in media_signals.get("warnings", []):
                _log(f"[Media Signals] {warning}")
        except Exception as exc:
            _check_cancel()
            _log(f"[Media Signals] 軽量スキャンをスキップ ({type(exc).__name__})")
        _check_cancel()

        all_transcript_segments = []
        all_scored_segments = []
        all_energy_timeline = []
        all_high_energy_regions = []  # 全チャンクの高エネルギー区間を統合
        all_audio_stats = {}  # 最後のチャンクの統計情報を保持
        full_text = ""

        import concurrent.futures

        # ゲーム音と実況音声は独立した軽量解析なので、分離トラック時は並列化する。
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            for i, chunk in enumerate(chunks):
                _check_cancel()
                chunk_progress = 0.1 + (0.5 * i / len(chunks))
                _progress(chunk_progress, f"Chunk {i+1}/{len(chunks)} 処理中 (文字起こし + 音声解析 並列実行)...")

                voice_audio_paths = []
                if has_separate_tracks:
                    # 声候補を混ぜず、各トラックを個別にWhisperへ渡す。
                    for track_index in track_info['voice_tracks']:
                        voice_audio_paths.append((
                            track_index,
                            chunker.extract_chunk_track_audio(
                                target_path,
                                chunk,
                                tempfile.gettempdir(),
                                track_index=track_index,
                                sample_rate=16000,
                            ),
                        ))
                    game_audio_path = chunker.extract_chunk_audio(
                        target_path, chunk, tempfile.gettempdir(), sample_rate=16000, track_type="game"
                    )
                else:
                    shared_audio_path = chunker.extract_chunk_audio(
                        target_path, chunk, tempfile.gettempdir(), sample_rate=16000, track_type="all"
                    )
                    voice_audio_paths = [(0, shared_audio_path)]
                    game_audio_path = shared_audio_path

                future_audio = executor.submit(
                    audio_analyzer.analyze,
                    game_audio_path, time_offset=chunk['start_time']
                )
                future_voice_audio = None
                if has_separate_tracks and voice_audio_paths:
                    future_voice_audio = executor.submit(
                        audio_analyzer.analyze,
                        voice_audio_paths[0][1],
                        time_offset=chunk['start_time'],
                    )

                track_transcripts = []
                audio = None
                voice_audio = None
                try:
                    track_count = max(1, len(voice_audio_paths))
                    for track_position, (track_index, voice_audio_path) in enumerate(voice_audio_paths):
                        _check_cancel()
                        def whisper_progress(p_val: int, position=track_position, index=track_index):
                            _check_cancel()
                            track_fraction = (position + p_val / 100.0) / track_count
                            current_p = chunk_progress + (0.1 / len(chunks)) * track_fraction
                            _progress(
                                current_p,
                                f"Chunk {i+1}/{len(chunks)} Track {index} "
                                f"文字起こし ({p_val}%)",
                            )

                        track_result = transcriber.transcribe(
                            voice_audio_path,
                            time_offset=chunk['start_time'],
                            language=language,
                            glossary=game_glossary,
                            progress_callback=whisper_progress,
                            cancel_check=_check_cancel,
                            translate_to_english=translate_to_english,
                        )
                        track_result['track_index'] = track_index
                        track_transcripts.append(track_result)

                    transcript = transcriber.merge_transcript_results(track_transcripts)
                    audio = future_audio.result()
                    if future_voice_audio is not None:
                        try:
                            voice_audio = future_voice_audio.result()
                        except Exception as exc:
                            # 声の追加特徴だけの失敗で、従来の解析全体を止めない。
                            _log(f"[Voice Analysis] 音響解析をスキップ: {exc}")
                finally:
                    if audio is None:
                        try:
                            audio = future_audio.result()
                        except Exception:
                            pass
                    if voice_audio is None and future_voice_audio is not None:
                        try:
                            voice_audio = future_voice_audio.result()
                        except Exception:
                            pass
                    cleanup_paths = {path for _, path in voice_audio_paths}
                    cleanup_paths.add(game_audio_path)
                    for cleanup_path in cleanup_paths:
                        cleanup_file(cleanup_path)

                # オーバーラップによる重複を防ぐため、effective_start ～ effective_end の範囲のセグメントのみ抽出
                eff_start = chunk.get('effective_start', 0)
                eff_end = chunk.get('effective_end', float('inf'))
                
                for s in transcript.get('segments', []):
                    # セグメントの中間点が有効範囲内にあるか判定
                    mid_time = (s['start'] + s['end']) / 2.0
                    if eff_start <= mid_time < eff_end:
                        all_transcript_segments.append(s)
                        full_text += s.get('text', '') + " "


                all_energy_timeline.extend(audio.get('energy_timeline', []))
                all_high_energy_regions.extend(audio.get('high_energy_regions', []))
                all_audio_stats = audio.get('stats', {})

                _progress(chunk_progress + 0.2 / len(chunks), f"Chunk {i+1}/{len(chunks)} 処理中 (スコアリング)...")

                # スコアリング
                _check_cancel()
                scored = scorer.score(
                    transcript,
                    audio,
                    voice_audio_result=voice_audio,
                    language=language,
                    time_offset=chunk['start_time'],
                )
                # チャンクのオーバーラップ部分で同じ候補が二重登録されないようにする。
                all_scored_segments.extend(
                    segment for segment in scored
                    if eff_start <= (segment['start'] + segment['end']) / 2.0 < eff_end
                )

        _progress(0.65, "ハイライト候補を抽出中...")
        _check_cancel()
        duration_minutes = video_duration / 60.0
        dynamic_max_clips = max(max_clips, int(max_clips * (duration_minutes / 5.0)))

        # 旧特徴を4軸へ整理し、動画全体の知覚音量・映像変化・複数時間幅を融合する。
        all_scored_segments = scorer.enrich_video_segments(
            all_scored_segments,
            media_signals=media_signals,
        )
        # 絶対点を残しながら、動画全体で明確に突出した区間だけを穏やかに加点する。
        all_scored_segments = scorer.normalize_video_scores(all_scored_segments)

        if candidate_strategy == 'legacy':
            highlights = scorer.get_highlight_segments(
                all_scored_segments,
                threshold=threshold,
                max_clips=dynamic_max_clips,
            )
        else:
            highlights = scorer.extract_peak_highlights(
                all_scored_segments,
                threshold=threshold,
                max_clips=dynamic_max_clips,
                transcript_segments=all_transcript_segments,
                media_signals=media_signals,
                video_duration=video_duration,
            )

        # VRAM解放
        transcriber.unload_model()

        _progress(0.95, "結果を整形中...")

        # 多様性順で選んだ候補を表示スコア順へ戻してから、Free/Creator境界を確定する。
        highlights.sort(key=lambda item: float(item.get('excitement_score', 0)), reverse=True)

        # 最終出力用
        final_cuts = []
        for i, h in enumerate(highlights):
            transcript = h.get('transcript_text', '').strip()
            
            label = transcript[:50] or 'Highlight'
                
            entry = {
                "start": h['start'],
                "end": h['end'],
                "label": label,
                "reason": ', '.join(h.get('reasons', [])),
                "excitement": int(h.get('excitement_score', 0)),
                "scoreDetails": h.get('score_axes', {}),
                "evidence": h.get('available_evidence', []),
                "category": h.get('candidate_category'),
                "falsePositiveRisk": h.get('false_positive_risk'),
                "durationVariants": h.get('duration_variants') or scorer._duration_variants(
                    (float(h['start']) + float(h['end'])) / 2.0,
                    all_transcript_segments,
                    video_duration,
                ),
            }
            if h.get('narration'):
                entry["narration"] = h['narration']
                
            # Freeで扱える上位5件より後はCreator版ロック
            if is_creator_only_candidate(i):
                entry["isProRequired"] = True
                
            final_cuts.append(entry)
            
        import re
        meaningful_short_words = {"はい", "よし", "いく", "だめ", "いい", "うん", "うむ", "やば", "まじ"}

        segments_for_frontend = []
        seg_idx = 0
        for seg in all_transcript_segments:
            text = seg.get('text', '').strip()
            
            # Issue 3: 以前は2文字以下のカナをハルシネーション対策で弾いていたが、
            # VAD実装により本物の発言しか来なくなったので、フィルターを緩和。
            # ただし1文字だけの無意味なノイズ（「あ」「ん」のみ等）は弾く。
            clean_text = re.sub(r'[、。！？\s]', '', text)
            if len(clean_text) <= 1:
                is_kana_only = bool(re.match(r'^[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FFー]+$', clean_text))
                if is_kana_only and clean_text not in meaningful_short_words:
                    continue  # Skip meaningless 1-char kana word
            
            # --- ハルシネーション（AIの幻覚・暴走）フィルター ---
            # 1. 文字（ひらがな、カタカナ、漢字、英数字）が含まれていない（記号や♪のみ）場合は除外
            if not re.search(r'[a-zA-Z0-9ぁ-んァ-ヶ亜-熙]', text):
                continue
                
            # 2. 定番の無音時ハルシネーションフレーズ
            hallucination_phrases = [
                "ご視聴ありがとう", "チャンネル登録", "高評価", 
                "次の動画でお会いしましょう", "次回の動画でお会いしましょう",
                "また次の動画で", "また次回の動画で",
                "thank you for watching", "subscribe", "thanks for"
            ]
            is_hallucination = False
            for hp in hallucination_phrases:
                if hp in text.lower():
                    # 前後に少しゴミがついているだけの場合はハルシネーションとみなす
                    if len(clean_text) < len(hp) + 15:
                        is_hallucination = True
                        break
            if is_hallucination:
                continue
                
            # 3. 謎の記号や単語の異常な連続（ループバグ）を除外
            # 例: [音楽], (笑) などの環境音タグのみの場合
            if re.match(r'^[\(\[\【].*?[\)\]\】]$', clean_text):
                continue
                
            # 実況では「無理無理」「敵いる敵いる」が本物なので、短い反復は残す。
            # 長時間・長文の暴走だけはTranscriber側で既に除外している。
            # 記号の異常な連続
            if re.search(r'([^\w\sぁ-んァ-ヶ亜-熙])\1{4,}', text):
                continue
            # ----------------------------------------------
            
            orig_end = seg.get('end', 0)
            orig_start = seg.get('start', 0)

            # 連結音声ではWhisperの終了時刻が発話より長く伸びることがある。
            # 読める時間を確保しつつ、次の発話まで字幕が居座らないよう上限を設ける。
            actual_end = caption_end_time(orig_start, orig_end, text)
            confidence = seg.get('confidence')
            source_track = seg.get('source_track', seg.get('track_index'))
            flags = list(seg.get('flags') or [])
            if isinstance(confidence, (int, float)) and confidence < 0.45:
                flags.extend(["low_confidence", "needs_review"])
            flags = list(dict.fromkeys(flags))

            segment_for_frontend = {
                "id": f"seg_{seg_idx}",
                "text": text,
                "startTime": orig_start,
                "endTime": actual_end,
                "emotion": "neutral",
            }
            if isinstance(confidence, (int, float)):
                segment_for_frontend["confidence"] = round(float(confidence), 4)
            if isinstance(source_track, int):
                segment_for_frontend["sourceTrack"] = source_track
            if flags:
                segment_for_frontend["flags"] = flags
            if seg.get('refined_by_glossary'):
                segment_for_frontend["refinedByGlossary"] = True
                segment_for_frontend["originalText"] = seg.get('original_text', '')
            if seg.get('recognition_model'):
                segment_for_frontend["recognitionModel"] = seg['recognition_model']

            segments_for_frontend.append(segment_for_frontend)
            seg_idx += 1

        excitement_graph = []
        if all_scored_segments:
            sorted_segs = sorted(all_scored_segments, key=lambda s: s['start'])
            total_dur = sorted_segs[-1]['end'] if sorted_segs else 0
            for t in range(int(total_dur) + 1):
                matching = [s for s in sorted_segs if s['start'] <= t <= s['end']]
                if matching:
                    excitement_graph.append(int(max(s.get('excitement_score', 0) for s in matching)))
                else:
                    excitement_graph.append(0)

        json_output = {
            "status": "success",
            "agentThinking": (
                "音響イベント・実況反応・クリップ適性を分離し、局所ピークから編集向け候補を提案しました。"
                if candidate_strategy == 'peak'
                else "4軸スコアを使い、互換候補結合で編集向け候補を提案しました。"
            ),
            "excitementGraph": excitement_graph,
            "recommendedCuts": final_cuts,
            "segments": segments_for_frontend,
            "trackInfo": track_info,
            "signalSummary": {
                "perceptualLoudness": bool(
                    (media_signals.get("available") or {}).get("audio_loudness")
                ),
                "visualChange": bool(
                    (media_signals.get("available") or {}).get("visual")
                ),
                "sceneChangeCount": len(media_signals.get("scene_changes") or []),
                "visualSampling": media_signals.get("video_sampling"),
                "candidateStrategy": candidate_strategy,
                "warnings": list(media_signals.get("warnings") or []),
            },
            "gameContext": {
                "requestedId": game_glossary.get("requested_id", "auto"),
                "detectedId": game_glossary.get("detected_id"),
                "label": game_glossary.get("label"),
                "source": game_glossary.get("source", "none"),
                "glossaryApplied": bool(game_glossary.get("glossary_applied")),
                "refinementCount": sum(
                    1 for segment in all_transcript_segments
                    if segment.get("refined_by_glossary")
                ),
                "learnedCorrectionCount": game_glossary.get("learned_correction_count", 0),
            },
        }

        # audio_path と video_path が同一の場合（analyze_highlights 経由）は削除しない
        if audio_path != video_path:
            cleanup_file(audio_path)
        _progress(1.0, "解析完了")
        gc.collect()

        return json.dumps(json_output, ensure_ascii=False)

# ==============================================================
# メイン エントリーポイント
# ==============================================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TateClip Local Analysis Engine")
    parser.add_argument("command", choices=["init", "plan_edit"])
    parser.add_argument("--input", type=str)
    parser.add_argument("--video", type=str, default="")
    parser.add_argument("--gpu-type", type=str, default="CPU")

    args = parser.parse_args()
    engine = LocalAnalysisEngine(gpu_type=args.gpu_type)
    
    if args.command == "init":
        print(json.dumps({"status": "ready", "device": "local-analysis"}))
    elif args.command == "plan_edit":
        if not args.input: sys.exit(1)
        res_json = engine.analyze_highlights_pipeline(args.input, args.video)
        print(res_json)
