"""
gemma_daemon.py — TateClip ローカル解析常駐デーモン

起動時にモデルをロードし、stdin から JSON Lines コマンドを受信して
stdout に JSON Lines で応答を返す常駐プロセス。

プロトコル:
  → stdin:   {"id":"<uuid>","cmd":"<command>","params":{...}}
  ← stdout:  {"id":"<uuid>","type":"progress","progress":0.5,"message":"..."}
  ← stdout:  {"id":"<uuid>","type":"result","data":{...}}
  ← stdout:  {"id":"<uuid>","type":"error","error":"..."}

コマンド一覧:
  - analyze_highlights: 音声+映像のマルチモーダル解析 → 推奨カット生成
  - cancel_analysis: 実行中解析へのキャンセル要求
  - health:       ヘルスチェック（エンジンの状態確認）
  - shutdown:     グレースフルシャットダウン
"""

import sys
import json
import traceback
import os
import hashlib
import threading

# ====================================================================
# ログ用ヘルパー（stderr のみ — stdout は IPC 専用）
# ====================================================================
_ipc_stdout = sys.stdout
try:
    _ipc_stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.stdout = sys.stderr
_send_lock = threading.Lock()

def log(msg: str):
    print(f"[gemma_daemon] {msg}", file=sys.stderr, flush=True)

def send(obj: dict):
    """stdout に JSON Line を送出する"""
    with _send_lock:
        print(json.dumps(obj, ensure_ascii=False), file=_ipc_stdout, flush=True)

def send_progress(req_id: str, progress: float, message: str):
    send({"id": req_id, "type": "progress", "progress": progress, "message": message})

def send_result(req_id: str, data: dict):
    send({"id": req_id, "type": "result", "data": data})

def send_error(req_id: str, error: str):
    send({"id": req_id, "type": "error", "error": error})


# ====================================================================
# 解析結果キャッシュ
# ====================================================================

# 4軸スコア・メディア信号・ピーク境界・誤検出抑制・尺候補を含まない旧解析結果を破棄する。
ANALYSIS_CACHE_VERSION = 15


def _highlight_candidate_strategy(params: dict) -> str:
    from gemma_engine import normalize_candidate_strategy

    requested = str(
        params.get("candidate_strategy")
        or os.environ.get("VFOCUS_HIGHLIGHT_CANDIDATES")
        or "legacy"
    ).strip().lower()
    return normalize_candidate_strategy(requested)


def _analysis_cache_root() -> str:
    """解析結果キャッシュの保存先を返す。"""
    configured = os.environ.get("VFOCUS_CACHE_DIR")
    if configured:
        root = configured
    elif os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        root = os.path.join(base, "TateClip", "analysis-cache")
    else:
        root = os.path.join(os.path.expanduser("~"), ".cache", "tateclip", "analysis-cache")

    os.makedirs(root, exist_ok=True)
    return root


def _analysis_cache_key(video_path: str, params: dict) -> str:
    """動画指紋 + 解析パラメータから安定したキャッシュキーを作る。"""
    stat = os.stat(video_path)
    relevant_params = {
        "chunk_size": params.get("chunk_size", 300),
        "threshold": params.get("threshold", 30.0),
        "max_clips": params.get("max_clips", 10),
        "language": params.get("language", None),
        "translate_to_english": bool(params.get("translate_to_english", False)),
        "game_id": params.get("game_id", "auto"),
        "candidate_strategy": _highlight_candidate_strategy(params),
        "subtitle_corrections_digest": hashlib.sha256(
            json.dumps(
                params.get("subtitle_corrections") or [],
                sort_keys=True,
                ensure_ascii=False,
            ).encode("utf-8")
        ).hexdigest(),
    }
    fingerprint = {
        "version": ANALYSIS_CACHE_VERSION,
        "path": os.path.abspath(video_path),
        "size": stat.st_size,
        "mtime_ns": getattr(stat, "st_mtime_ns", int(stat.st_mtime * 1_000_000_000)),
        "params": relevant_params,
    }
    raw = json.dumps(fingerprint, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _analysis_cache_path(video_path: str, params: dict) -> str:
    return os.path.join(_analysis_cache_root(), f"{_analysis_cache_key(video_path, params)}.json")


def _load_analysis_cache(video_path: str, params: dict):
    try:
        path = _analysis_cache_path(video_path, params)
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if payload.get("version") != ANALYSIS_CACHE_VERSION:
            return None
        result = payload.get("result")
        if not isinstance(result, dict):
            return None
        return result
    except Exception as e:
        log(f"Analysis cache read skipped: {e}")
        return None


def _save_analysis_cache(video_path: str, params: dict, result: dict):
    try:
        path = _analysis_cache_path(video_path, params)
        payload = {
            "version": ANALYSIS_CACHE_VERSION,
            "result": result,
        }
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp_path, path)
    except Exception as e:
        log(f"Analysis cache write skipped: {e}")


# ====================================================================
# エンジンの遅延ロード (gemma_engine.py を再利用)
# ====================================================================
_engine = None
_device = None


class AnalysisCancelled(Exception):
    """ユーザー操作で解析がキャンセルされたことを表す内部例外。"""


_analysis_jobs = {}
_analysis_jobs_lock = threading.Lock()


def _register_analysis_job(req_id: str, params: dict, cancel_event: threading.Event):
    with _analysis_jobs_lock:
        _analysis_jobs[req_id] = {
            "cancel_event": cancel_event,
            "client_job_id": params.get("client_job_id"),
        }


def _unregister_analysis_job(req_id: str):
    with _analysis_jobs_lock:
        _analysis_jobs.pop(req_id, None)


def _cancel_matching_analysis(client_job_id=None) -> int:
    cancelled = 0
    with _analysis_jobs_lock:
        for job in _analysis_jobs.values():
            if client_job_id and job.get("client_job_id") != client_job_id:
                continue
            job["cancel_event"].set()
            cancelled += 1
    return cancelled


def _raise_if_cancelled(cancel_event: threading.Event):
    if cancel_event.is_set():
        raise AnalysisCancelled("解析をキャンセルしました")

def get_engine(gpu_type="CPU"):
    """ローカル解析エンジンをシングルトンで返す。"""
    global _engine, _device
    if _engine is None:
        log(f"Initializing analysis engine (first call, gpu_type={gpu_type})...")
        
        # PyTorchの依存を排除したため、そのままエンジンを起動します

                    
        from gemma_engine import LocalAnalysisEngine
        _engine = LocalAnalysisEngine(gpu_type=gpu_type)
        _device = "local-analysis"
        log("Local analysis engine ready")
    return _engine


# ====================================================================
# コマンドハンドラ
# ====================================================================



def handle_health(req_id: str, _params: dict):
    global _engine, _device
    
    # エンジン未ロード時のフォールバック用として一時的に呼び出し
    hardware_gpu = "CPU"
    if _engine:
        hardware_gpu = _engine.hardware_gpu_string
    else:
        try:
            from gemma_engine import detect_hardware_gpu
            hardware_gpu = detect_hardware_gpu()
        except Exception:
            pass

    send_result(req_id, {
        "status": "healthy",
        "engine_loaded": _engine is not None,
        "device": _device or "not_initialized",
        "hardware_gpu": hardware_gpu
    })


def _run_analyze_highlights(req_id: str, params: dict, cancel_event: threading.Event):
    """
    ゲーム実況ハイライト分析 — openshortsパイプライン統合

    TateClipの候補レビューUI用にAgentHighlight[]形式で結果を返す。
    """
    import time as _time
    t_start = _time.time()

    video_path = params.get("video_path")
    try:
        if not video_path:
            send_error(req_id, "Missing required param: video_path")
            return

        chunk_size = params.get("chunk_size", 300)
        threshold = params.get("threshold", 30.0)
        max_clips = params.get("max_clips", 10)
        language = params.get("language", None)
        gpu_type = params.get("gpu_type", "CPU")
        force_reanalyze = params.get("force_reanalyze", False)
        game_id = params.get("game_id", "auto")
        subtitle_corrections = params.get("subtitle_corrections") or []
        translate_to_english = bool(params.get("translate_to_english", False))
        candidate_strategy = _highlight_candidate_strategy(params)

        def _log(msg):
            import sys
            print(f"[gemma_daemon] {msg}", file=sys.stderr, flush=True)

        send_progress(req_id, 0.0, f"ハイライト分析を開始... (GPU: {gpu_type})")
        _raise_if_cancelled(cancel_event)

        if not force_reanalyze:
            cached = _load_analysis_cache(video_path, params)
            if cached is not None:
                cached_stats = cached.setdefault("stats", {})
                cached_stats["cache_hit"] = True
                send_progress(req_id, 0.95, "前回の解析結果キャッシュを復元しました")
                send_result(req_id, cached)
                return

        engine = get_engine(gpu_type=gpu_type)

        def on_progress(p: float, msg: str):
            _raise_if_cancelled(cancel_event)
            send_progress(req_id, p, msg)

        def cancel_check():
            _raise_if_cancelled(cancel_event)

        # 統合されたエンジンパイプラインを呼び出し
        result_json_str = engine.analyze_highlights_pipeline(
            audio_path=video_path,
            video_path=video_path,
            progress_callback=on_progress,
            cancel_check=cancel_check,
            chunk_size=chunk_size,
            threshold=threshold,
            max_clips=max_clips,
            language=language,
            game_id=game_id,
            subtitle_corrections=subtitle_corrections,
            translate_to_english=translate_to_english,
            candidate_strategy=candidate_strategy,
        )
        
        # camelCaseで返ってくるデータをsnake_case（既存の期待値）にマッピング
        import json
        res = json.loads(result_json_str)
        
        elapsed = _time.time() - t_start
        send_progress(req_id, 0.95, f"完了！ ({elapsed:.1f}秒)")
        
        from pipeline.analysis_response import build_daemon_analysis_result
        result = build_daemon_analysis_result(res, elapsed)
        _save_analysis_cache(video_path, params, result)
        send_result(req_id, result)
    except AnalysisCancelled as e:
        send_progress(req_id, 1.0, "解析をキャンセルしました")
        send_error(req_id, str(e))
    except Exception as e:
        import traceback
        _log(f"Error in handle_analyze_highlights: {traceback.format_exc()}")
        send_error(req_id, f"解析中にエラーが発生しました: {str(e)}")
    finally:
        _unregister_analysis_job(req_id)


def handle_analyze_highlights(req_id: str, params: dict):
    """解析をバックグラウンドで開始し、daemonメインループはcancel/healthを受け続ける。"""
    cancel_event = threading.Event()
    _register_analysis_job(req_id, params, cancel_event)
    worker = threading.Thread(
        target=_run_analyze_highlights,
        args=(req_id, params, cancel_event),
        daemon=True,
        name=f"analysis-{req_id[:8]}",
    )
    worker.start()


def handle_cancel_analysis(req_id: str, params: dict):
    client_job_id = params.get("client_job_id")
    cancelled = _cancel_matching_analysis(client_job_id=client_job_id)
    send_result(req_id, {
        "status": "cancel_requested" if cancelled > 0 else "not_found",
        "cancelled": cancelled,
    })



# ====================================================================
# ハンドラマッピングとメインループ
# ====================================================================

HANDLERS = {
    "health": handle_health,
    "analyze_highlights": handle_analyze_highlights,
    "cancel_analysis": handle_cancel_analysis,
}


def main():
    log("Daemon starting — waiting for commands on stdin...")

    # デーモン起動完了合図
    send({"id": "__boot__", "type": "result", "data": {"status": "ready"}})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        # コマンドのパース
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            log(f"Invalid JSON received: {e}")
            send({"id": "?", "type": "error", "error": f"Invalid JSON: {e}"})
            continue

        req_id = msg.get("id", "unknown")
        cmd = msg.get("cmd", "")
        params = msg.get("params", {})

        if cmd != "health":
            log(f"Received cmd={cmd} id={req_id}")

        # シャットダウン
        if cmd == "shutdown":
            log("Shutdown requested, exiting gracefully...")
            send_result(req_id, {"status": "shutdown"})
            break

        # コマンドディスパッチ
        handler = HANDLERS.get(cmd)
        if handler is None:
            send_error(req_id, f"Unknown command: {cmd}")
            continue

        try:
            handler(req_id, params)
        except Exception as e:
            tb = traceback.format_exc()
            log(f"Handler error for cmd={cmd}: {tb}")
            send_error(req_id, str(e))

    log("Daemon exited.")


if __name__ == "__main__":
    main()
