/// daemon.rs — ローカル解析Pythonデーモンの非同期マネージャ (v2)
///
/// 改善点 (v2):
/// - スクリプトパスを実行ファイル位置から絶対解決
/// - __boot__ メッセージを待ってからManagerを返す
/// - stderr を蓄積して障害診断に利用
/// - Pythonプロセス死亡時に分かりやすいエラーを返す
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

#[cfg(windows)]
struct ProcessJob {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for ProcessJob {}
#[cfg(windows)]
unsafe impl Sync for ProcessJob {}

#[cfg(windows)]
impl ProcessJob {
    fn assign(process_id: u32) -> Result<Self, String> {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };

        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err(format!(
                    "Failed to create daemon Job Object: {}",
                    std::io::Error::last_os_error()
                ));
            }

            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of!(info).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                let error = std::io::Error::last_os_error();
                CloseHandle(job);
                return Err(format!("Failed to configure daemon Job Object: {error}"));
            }

            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, process_id);
            if process.is_null() {
                let error = std::io::Error::last_os_error();
                CloseHandle(job);
                return Err(format!(
                    "Failed to open daemon process for Job Object: {error}"
                ));
            }
            let assigned = AssignProcessToJobObject(job, process);
            let assign_error = std::io::Error::last_os_error();
            CloseHandle(process);
            if assigned == 0 {
                CloseHandle(job);
                return Err(format!(
                    "Failed to assign daemon to Job Object: {assign_error}"
                ));
            }

            Ok(Self { handle: job })
        }
    }

    fn terminate(&self) {
        unsafe {
            let _ = windows_sys::Win32::System::JobObjects::TerminateJobObject(self.handle, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe {
            let _ = windows_sys::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}

// ============================================================
// IPC プロトコル型定義
// ============================================================

#[derive(Serialize)]
struct DaemonRequest {
    id: String,
    cmd: String,
    params: serde_json::Value,
}

#[derive(Deserialize, Debug, Clone)]
struct DaemonMessage {
    id: String,
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(default)]
    data: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    progress: Option<f64>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DaemonResponse {
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DaemonProgressEvent {
    pub request_id: String,
    pub progress: f64,
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DaemonDiagnostics {
    pub alive: bool,
    pub pending_requests: usize,
    pub stderr_tail: Vec<String>,
    pub restart_count: usize,
    pub last_start_error: Option<String>,
}

// ============================================================
// DaemonManager
// ============================================================

#[derive(Debug, Clone)]
pub enum DaemonChannelMessage {
    Progress,
    Result(DaemonResponse),
}

type PendingMap = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<DaemonChannelMessage>>>>;

struct DaemonProcess {
    stdin_tx: mpsc::Sender<String>,
    pending: PendingMap,
    _child_handle: Arc<Mutex<Option<Child>>>,
    /// プロセスがまだ生きているかのフラグ
    alive: Arc<AtomicBool>,
    /// stderr の最終N行を保持（デバッグ用）
    stderr_buffer: Arc<Mutex<Vec<String>>>,
    #[cfg(windows)]
    _process_job: Arc<ProcessJob>,
}

/// アプリ全体で共有するデーモン監視マネージャ。
///
/// 実プロセスが予期せず終了した場合は、次のコマンド送信時に一度だけ
/// 再起動して、インストール直後の一時的な終了で解析不能にならないようにする。
#[derive(Clone)]
pub struct DaemonManager {
    process: Arc<Mutex<Option<Arc<DaemonProcess>>>>,
    restart_count: Arc<AtomicUsize>,
    last_start_error: Arc<Mutex<Option<String>>>,
}

/// デーモンの実行形態
enum DaemonMode {
    /// PyInstallerでビルド済みのexe（配布用）
    Executable(PathBuf),
    /// Pythonスクリプト直接実行（開発用）
    PythonScript(PathBuf),
}

/// デーモンの実行方法を解決する。
/// 優先順位: exe → python スクリプト
fn resolve_daemon_mode(app_handle: &tauri::AppHandle) -> Result<DaemonMode, String> {
    // --- 1. exe を探す (配布モード) ---

    // 1a. Tauri resource path (packaged app)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let resource_exe = resource_dir.join("gemma_daemon").join("gemma_daemon.exe");
        if resource_exe.exists() {
            log::info!("[daemon] Found resource exe: {}", resource_exe.display());
            return Ok(DaemonMode::Executable(resource_exe));
        }

        let resource_binaries_exe = resource_dir
            .join("binaries")
            .join("gemma_daemon-x86_64-pc-windows-msvc")
            .join("gemma_daemon.exe");
        if resource_binaries_exe.exists() {
            log::info!(
                "[daemon] Found resource binaries exe: {}",
                resource_binaries_exe.display()
            );
            return Ok(DaemonMode::Executable(resource_binaries_exe));
        }
    }

    // 1b. Tauriのsidecarパス (tauri.conf.json の externalBin で指定)
    if let Ok(exe) = std::env::current_exe() {
        let exe_dir = exe.parent().unwrap_or(std::path::Path::new("."));

        // Tauri sidecar: 実行ファイルと同じディレクトリに展開される
        let sidecar_exe = exe_dir.join("gemma_daemon").join("gemma_daemon.exe");
        if sidecar_exe.exists() {
            log::info!("[daemon] Found sidecar exe: {}", sidecar_exe.display());
            return Ok(DaemonMode::Executable(sidecar_exe));
        }

        // フォールバック: binaries/ 下
        let binaries_exe = exe_dir
            .join("binaries")
            .join("gemma_daemon-x86_64-pc-windows-msvc")
            .join("gemma_daemon.exe");
        if binaries_exe.exists() {
            log::info!("[daemon] Found binaries exe: {}", binaries_exe.display());
            return Ok(DaemonMode::Executable(binaries_exe));
        }
    }

    // --- 2. Python スクリプトを探す (開発モード) ---

    // 2a. CWDからの相対パス
    let from_cwd = std::env::current_dir()
        .unwrap_or_default()
        .join("python-sidecar")
        .join("gemma_daemon.py");
    if from_cwd.exists() {
        log::info!("[daemon] Dev mode: {}", from_cwd.display());
        return Ok(DaemonMode::PythonScript(from_cwd));
    }

    // 2b. 実行ファイルの祖先ディレクトリから探索
    if let Ok(exe) = std::env::current_exe() {
        for ancestor in exe.ancestors().skip(1) {
            let candidate = ancestor.join("python-sidecar").join("gemma_daemon.py");
            if candidate.exists() {
                log::info!("[daemon] Dev mode (ancestor): {}", candidate.display());
                return Ok(DaemonMode::PythonScript(candidate));
            }
        }
    }

    // 2c. CARGO_MANIFEST_DIR
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let from_manifest = PathBuf::from(&manifest_dir)
            .parent()
            .map(|p| p.join("python-sidecar").join("gemma_daemon.py"));
        if let Some(p) = from_manifest {
            if p.exists() {
                log::info!("[daemon] Dev mode (manifest): {}", p.display());
                return Ok(DaemonMode::PythonScript(p));
            }
        }
    }

    Err(format!(
        "gemma_daemon が見つかりません (exe/py 両方探索済み)。CWD={:?}, EXE={:?}",
        std::env::current_dir().ok(),
        std::env::current_exe().ok()
    ))
}

/// 実行ファイル/スクリプトの親ディレクトリを返す (CWDとして使用)
fn resolve_working_dir(mode: &DaemonMode) -> PathBuf {
    match mode {
        DaemonMode::Executable(path) | DaemonMode::PythonScript(path) => path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default()),
    }
}

/// whisper.cpp の配置場所を解決する。
///
/// 配布時は Tauri resource directory の `whisper-cpp/` を優先する。
/// 開発時はプロジェクト内 `python-sidecar/whisper-cpp/` を探す。
fn resolve_whisper_dir(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let candidate = resource_dir.join("whisper-cpp");
        if candidate.join("whisper-cli.exe").exists() {
            return Some(candidate);
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        for ancestor in current_dir.ancestors() {
            let candidate = ancestor.join("python-sidecar").join("whisper-cpp");
            if candidate.join("whisper-cli.exe").exists() {
                return Some(candidate);
            }
        }
    }

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let candidate = PathBuf::from(manifest_dir)
            .parent()
            .map(|p| p.join("python-sidecar").join("whisper-cpp"));
        if let Some(candidate) = candidate {
            if candidate.join("whisper-cli.exe").exists() {
                return Some(candidate);
            }
        }
    }

    None
}

impl DaemonProcess {
    /// デーモンプロセスを起動し、__boot__ 確認後に利用可能なプロセスを返す
    pub async fn spawn(app_handle: tauri::AppHandle) -> Result<Self, String> {
        let mode = resolve_daemon_mode(&app_handle)?;
        let working_dir = resolve_working_dir(&mode);
        let whisper_dir = resolve_whisper_dir(&app_handle);
        let whisper_model_path = crate::model::resolve_model_path_for_daemon(&app_handle);
        // 軽量版では初回セットアップ後に同じパスへFFmpegが配置される。
        // 起動時に未配置でも将来の保存先を渡しておけばdaemon再起動は不要。
        let ffmpeg_path = crate::ffmpeg_runtime::ffmpeg_path_for_daemon(&app_handle);

        log::info!(
            "Spawning gemma_daemon: mode={}, cwd={}, whisper_dir={}, whisper_model={}, ffmpeg_path={}",
            match &mode {
                DaemonMode::Executable(p) => format!("exe({})", p.display()),
                DaemonMode::PythonScript(p) => format!("python({})", p.display()),
            },
            working_dir.display(),
            whisper_dir
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "<not found>".to_string()),
            whisper_model_path
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "<not found>".to_string()),
            ffmpeg_path
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "<not found>".to_string())
        );

        let (stdin_tx, stdin_rx) = mpsc::channel::<String>(64);
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));
        let stderr_buffer: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        // デーモンモードに応じてコマンドを構築
        let mut cmd = match &mode {
            DaemonMode::Executable(exe_path) => {
                // PyInstaller exe: 直接実行
                Command::new(exe_path)
            }
            DaemonMode::PythonScript(script_path) => {
                // 開発モード: python で実行
                let mut c = Command::new("python");
                c.arg(script_path);
                c
            }
        };

        cmd.current_dir(&working_dir)
            .env("PYTHONUTF8", "1")
            .env("PYTHONUNBUFFERED", "1")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000);

        if let Some(whisper_dir) = whisper_dir {
            cmd.env("VFOCUS_WHISPER_DIR", whisper_dir);
        }
        if let Some(whisper_model_path) = whisper_model_path {
            cmd.env("VFOCUS_WHISPER_MODEL_PATH", whisper_model_path);
        }
        if let Some(ffmpeg_path) = ffmpeg_path {
            cmd.env("VFOCUS_FFMPEG_PATH", ffmpeg_path);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn gemma_daemon: {}", e))?;

        #[cfg(windows)]
        let process_job =
            Arc::new(ProcessJob::assign(child.id().ok_or_else(|| {
                "Failed to obtain gemma_daemon process id".to_string()
            })?)?);

        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture daemon stdout")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture daemon stderr")?;
        let stdin = child.stdin.take().ok_or("Failed to capture daemon stdin")?;

        let child_handle = Arc::new(Mutex::new(Some(child)));

        // ---- __boot__ 待ち用チャネル ----
        let (boot_tx, boot_rx) = oneshot::channel::<Result<(), String>>();
        let boot_tx = Arc::new(Mutex::new(Some(boot_tx)));

        // ---- stdout パーサータスク ----
        let pending_clone = pending.clone();
        let app_clone = app_handle.clone();
        let alive_clone = alive.clone();
        let boot_tx_clone = boot_tx.clone();
        #[cfg(windows)]
        let process_job_for_stdout = process_job.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }

                let msg: DaemonMessage = match serde_json::from_str(&line) {
                    Ok(m) => m,
                    Err(e) => {
                        log::warn!("daemon stdout parse error: {} — line: {}", e, line);
                        continue;
                    }
                };

                // __boot__ メッセージの処理
                if msg.id == "__boot__" {
                    log::info!("daemon boot confirmation received");
                    let mut guard = boot_tx_clone.lock().await;
                    if let Some(tx) = guard.take() {
                        let _ = tx.send(Ok(()));
                    }
                    continue;
                }

                match msg.msg_type.as_str() {
                    "progress" => {
                        let event = DaemonProgressEvent {
                            request_id: msg.id.clone(),
                            progress: msg.progress.unwrap_or(0.0),
                            message: msg.message.unwrap_or_default(),
                        };
                        let _ = app_clone.emit("daemon-progress", event.clone());
                        let map = pending_clone.lock().await;
                        if let Some(tx) = map.get(&msg.id) {
                            let _ = tx.send(DaemonChannelMessage::Progress);
                        }
                    }
                    "result" | "error" => {
                        let response = DaemonResponse {
                            data: msg.data,
                            error: msg.error,
                        };
                        let mut map = pending_clone.lock().await;
                        if let Some(tx) = map.remove(&msg.id) {
                            let _ = tx.send(DaemonChannelMessage::Result(response));
                        }
                    }
                    other => {
                        log::warn!("daemon: unknown message type: {}", other);
                    }
                }
            }

            log::error!("daemon stdout reader exited — process likely crashed");
            alive_clone.store(false, Ordering::SeqCst);
            #[cfg(windows)]
            process_job_for_stdout.terminate();

            // boot が未完了なら失敗を通知
            let mut guard = boot_tx_clone.lock().await;
            if let Some(tx) = guard.take() {
                let _ = tx.send(Err("Python daemon exited before boot".to_string()));
            }

            // 残っている pending リクエストにエラーを返す
            let mut map = pending_clone.lock().await;
            for (_, tx) in map.drain() {
                let _ = tx.send(DaemonChannelMessage::Result(DaemonResponse {
                    data: None,
                    error: Some("Daemon process exited unexpectedly".to_string()),
                }));
            }
        });

        // ---- stderr ログ転送 + バッファリングタスク ----
        let stderr_buf_clone = stderr_buffer.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::info!("[gemma_daemon stderr] {}", line);
                let mut buf = stderr_buf_clone.lock().await;
                buf.push(line);
                // 最新100行のみ保持
                if buf.len() > 100 {
                    let excess = buf.len() - 100;
                    buf.drain(..excess);
                }
            }
        });

        // ---- stdin ライタータスク ----
        let alive_clone2 = alive.clone();
        tokio::spawn(async move {
            let mut writer = stdin;
            let mut rx = stdin_rx;
            while let Some(line) = rx.recv().await {
                if let Err(e) = writer.write_all(line.as_bytes()).await {
                    log::error!("daemon stdin write error: {}", e);
                    break;
                }
                if let Err(e) = writer.write_all(b"\n").await {
                    log::error!("daemon stdin newline error: {}", e);
                    break;
                }
                if let Err(e) = writer.flush().await {
                    log::error!("daemon stdin flush error: {}", e);
                    break;
                }
            }
            log::info!("daemon stdin writer exited");
            alive_clone2.store(false, Ordering::SeqCst);
        });

        // ---- boot 完了待ち (最大10秒) ----
        let boot_result = tokio::time::timeout(std::time::Duration::from_secs(10), boot_rx)
            .await
            .map_err(|_| {
                "daemon boot timeout (10s). Check stderr or Python installation.".to_string()
            })?
            .map_err(|_| "boot channel dropped".to_string())?;

        // boot_result は Ok(()) か Err(msg)
        boot_result?;

        log::info!("Daemon process spawned and boot confirmed");

        Ok(Self {
            stdin_tx,
            pending,
            _child_handle: child_handle,
            alive,
            stderr_buffer,
            #[cfg(windows)]
            _process_job: process_job,
        })
    }

    /// コマンドを送信して結果を待つ
    async fn send(
        &self,
        cmd: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        // 生存チェック
        if !self.alive.load(Ordering::SeqCst) {
            let buf = self.stderr_buffer.lock().await;
            let last_lines = buf
                .iter()
                .rev()
                .take(10)
                .rev()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            return Err(format!(
                "Gemma daemon is not running. Last stderr:\n{}",
                if last_lines.is_empty() {
                    "(no output)".to_string()
                } else {
                    last_lines
                }
            ));
        }

        let id = uuid::Uuid::new_v4().to_string();

        let (tx, mut rx) = mpsc::unbounded_channel::<DaemonChannelMessage>();
        {
            let mut map = self.pending.lock().await;
            map.insert(id.clone(), tx);
        }

        let request = DaemonRequest {
            id: id.clone(),
            cmd: cmd.to_string(),
            params,
        };
        let json_line =
            serde_json::to_string(&request).map_err(|e| format!("Serialize error: {}", e))?;

        if self.stdin_tx.send(json_line).await.is_err() {
            // writer task の終了通知より先に送信失敗を観測する場合がある。
            // ここで死亡扱いにして、Manager が確実に一度だけ再起動できるようにする。
            self.alive.store(false, Ordering::SeqCst);
            self.pending.lock().await.remove(&id);
            return Err(
                "Failed to send to daemon (alive=false). The Python process may have crashed."
                    .to_string(),
            );
        }

        // 応答を待つ（ハートビート方式: 10分タイムアウト付き）
        let heartbeat_timeout = std::time::Duration::from_secs(600);

        loop {
            match tokio::time::timeout(heartbeat_timeout, rx.recv()).await {
                Ok(Some(DaemonChannelMessage::Progress)) => {
                    // progressが来る限り待機を継続
                    continue;
                }
                Ok(Some(DaemonChannelMessage::Result(response))) => {
                    if let Some(err) = response.error {
                        return Err(err);
                    }
                    return response
                        .data
                        .ok_or_else(|| "Daemon returned empty data".to_string());
                }
                Ok(None) => {
                    self.pending.lock().await.remove(&id);
                    return Err("Daemon response channel closed unexpectedly".to_string());
                }
                Err(_) => {
                    self.pending.lock().await.remove(&id);
                    self.terminate().await;
                    return Err("Daemon response timed out (No progress for 10m)".to_string());
                }
            }
        }
    }

    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    async fn pending_requests(&self) -> usize {
        self.pending.lock().await.len()
    }

    async fn stderr_tail(&self) -> Vec<String> {
        self.stderr_buffer
            .lock()
            .await
            .iter()
            .rev()
            .take(40)
            .rev()
            .cloned()
            .collect()
    }

    async fn terminate(&self) {
        self.alive.store(false, Ordering::SeqCst);
        #[cfg(windows)]
        self._process_job.terminate();
        let mut child = self._child_handle.lock().await;
        if let Some(child) = child.as_mut() {
            let _ = child.kill().await;
        }
    }

    /// グレースフルシャットダウン
    #[allow(dead_code)]
    async fn shutdown(&self) {
        log::info!("Sending shutdown command to daemon...");
        let _ = self.send("shutdown", serde_json::json!({})).await;
    }
}

fn should_retry_after_exit(cmd: &str) -> bool {
    cmd == "health"
}

fn response_without_daemon(cmd: &str) -> Option<serde_json::Value> {
    (cmd == "cancel_analysis").then(|| {
        serde_json::json!({
            "status": "not_found",
            "cancelled": 0,
        })
    })
}

impl DaemonManager {
    /// Tauri state は同期的に登録し、実プロセスは非同期で起動する。
    /// これにより、起動処理中にコマンドが呼ばれても state 不在にはならない。
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            restart_count: Arc::new(AtomicUsize::new(0)),
            last_start_error: Arc::new(Mutex::new(None)),
        }
    }

    /// 起動時のウォームアップと、コマンド送信前の自動復旧で共用する。
    pub async fn start(&self, app_handle: &tauri::AppHandle) -> Result<(), String> {
        self.ensure_running(app_handle).await.map(|_| ())
    }

    async fn ensure_running(
        &self,
        app_handle: &tauri::AppHandle,
    ) -> Result<Arc<DaemonProcess>, String> {
        {
            let current = self.process.lock().await.clone();
            if let Some(process) = current {
                if process.is_alive() {
                    return Ok(process);
                }
            }
        }

        // 起動は直列化し、同時コマンドで複数daemonを生成しない。
        let mut slot = self.process.lock().await;
        if let Some(process) = slot.as_ref() {
            if process.is_alive() {
                return Ok(process.clone());
            }
            self.restart_count.fetch_add(1, Ordering::SeqCst);
            log::warn!("Gemma daemon is not alive; restarting it before the next command");
        }

        match DaemonProcess::spawn(app_handle.clone()).await {
            Ok(process) => {
                let process = Arc::new(process);
                *slot = Some(process.clone());
                *self.last_start_error.lock().await = None;
                Ok(process)
            }
            Err(error) => {
                *self.last_start_error.lock().await = Some(error.clone());
                Err(format!("Gemma daemonを起動できませんでした: {error}"))
            }
        }
    }

    /// コマンドを送信する。送信中にプロセスが終了した場合は、安全なコマンドに限り
    /// 新しいプロセスへ一度だけ再送する。
    pub async fn send(
        &self,
        app_handle: &tauri::AppHandle,
        cmd: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        if let Some(response) = response_without_daemon(cmd) {
            let current = self.process.lock().await.clone();
            if current.as_ref().is_none_or(|process| !process.is_alive()) {
                return Ok(response);
            }
        }

        let process = self.ensure_running(app_handle).await?;
        let result = process.send(cmd, params.clone()).await;
        if result.is_ok() || process.is_alive() || !should_retry_after_exit(cmd) {
            return result;
        }

        log::warn!("Gemma daemon exited while handling {cmd}; restarting once");
        let replacement = self.ensure_running(app_handle).await?;
        replacement.send(cmd, params).await
    }

    /// フロントエンドの診断表示・ログコピー用に、daemonの現在状態を返す。
    pub async fn diagnostics(&self) -> DaemonDiagnostics {
        let process = self.process.lock().await.clone();
        let (alive, pending_requests, mut stderr_tail) = if let Some(process) = process {
            (
                process.is_alive(),
                process.pending_requests().await,
                process.stderr_tail().await,
            )
        } else {
            (false, 0, Vec::new())
        };
        let last_start_error = self.last_start_error.lock().await.clone();
        if stderr_tail.is_empty() {
            if let Some(error) = last_start_error.as_ref() {
                stderr_tail.push(error.clone());
            }
        }

        DaemonDiagnostics {
            alive,
            pending_requests,
            stderr_tail,
            restart_count: self.restart_count.load(Ordering::SeqCst),
            last_start_error,
        }
    }

    /// グレースフルシャットダウン。終了処理のためだけに新規daemonは起動しない。
    #[allow(dead_code)]
    pub async fn shutdown(&self) {
        let process = self.process.lock().await.clone();
        if let Some(process) = process {
            process.shutdown().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{response_without_daemon, should_retry_after_exit};

    #[test]
    fn retries_health_after_an_unexpected_process_exit() {
        assert!(should_retry_after_exit("health"));
    }

    #[test]
    fn does_not_resend_stateful_work_after_an_unexpected_process_exit() {
        assert!(!should_retry_after_exit("analyze_highlights"));
        assert!(!should_retry_after_exit("shutdown"));
        assert!(!should_retry_after_exit("cancel_analysis"));
    }

    #[test]
    fn cancellation_without_a_daemon_does_not_start_a_new_process() {
        assert_eq!(
            response_without_daemon("cancel_analysis"),
            Some(serde_json::json!({ "status": "not_found", "cancelled": 0 }))
        );
        assert_eq!(response_without_daemon("health"), None);
        assert_eq!(response_without_daemon("analyze_highlights"), None);
    }

    #[cfg(windows)]
    #[test]
    fn process_job_terminates_the_daemon_descendant_tree() {
        use super::ProcessJob;
        use std::io::{BufRead, Write};
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
        };

        let script = "$null = [Console]::In.ReadLine(); \
            $child = Start-Process -FilePath ping.exe -ArgumentList '-t','127.0.0.1' -WindowStyle Hidden -PassThru; \
            [Console]::Out.WriteLine($child.Id); [Console]::Out.Flush(); Start-Sleep -Seconds 60";
        let mut parent = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", script])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn job test parent");
        let job = ProcessJob::assign(parent.id()).expect("assign job test parent");

        parent
            .stdin
            .as_mut()
            .expect("parent stdin")
            .write_all(b"go\n")
            .expect("release parent");
        let mut child_pid_line = String::new();
        std::io::BufReader::new(parent.stdout.take().expect("parent stdout"))
            .read_line(&mut child_pid_line)
            .expect("read descendant pid");
        let child_pid: u32 = child_pid_line.trim().parse().expect("valid descendant pid");

        unsafe {
            let child_handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, child_pid);
            assert!(!child_handle.is_null(), "open descendant process");
            job.terminate();
            assert_eq!(
                WaitForSingleObject(child_handle, 5_000),
                WAIT_OBJECT_0,
                "job termination must stop the descendant process"
            );
            CloseHandle(child_handle);
        }
        parent.wait().expect("wait for terminated job parent");
    }
}
