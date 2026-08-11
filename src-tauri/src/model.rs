use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

pub const WHISPER_MODEL_FILE: &str = "ggml-large-v3-turbo.bin";
pub const WHISPER_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin";
pub const WHISPER_MODEL_BYTES: u64 = 1_624_555_275;
pub const WHISPER_MODEL_SHA256: &str =
    "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69";

static DOWNLOAD_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelStatus {
    pub state: String,
    pub source: String,
    pub bytes: u64,
    pub expected_bytes: u64,
    pub downloaded_bytes: u64,
    pub model_name: String,
    pub sha256: String,
    pub download_url: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WhisperModelProgress {
    state: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    progress: f64,
    message: String,
}

fn model_download_lock() -> &'static Mutex<()> {
    DOWNLOAD_LOCK.get_or_init(|| Mutex::new(()))
}

fn app_model_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("models").join("whisper"))
        .map_err(|error| format!("AIモデル保存先を取得できません: {error}"))
}

fn downloaded_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_model_dir(app)?.join(WHISPER_MODEL_FILE))
}

fn partial_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_model_dir(app)?.join(format!("{WHISPER_MODEL_FILE}.part")))
}

fn marker_path(model_path: &Path) -> PathBuf {
    model_path.with_extension("bin.sha256")
}

fn bundled_model_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let candidate = resource_dir.join("whisper-cpp").join(WHISPER_MODEL_FILE);
    candidate.exists().then_some(candidate)
}

fn valid_bundled_model_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    bundled_model_path(app).filter(|path| file_len(path) == WHISPER_MODEL_BYTES)
}

fn development_model_path() -> Option<PathBuf> {
    if let Ok(current_dir) = std::env::current_dir() {
        for ancestor in current_dir.ancestors() {
            let candidate = ancestor
                .join("python-sidecar")
                .join("whisper-cpp")
                .join(WHISPER_MODEL_FILE);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let candidate = PathBuf::from(manifest_dir).parent().map(|parent| {
            parent
                .join("python-sidecar")
                .join("whisper-cpp")
                .join(WHISPER_MODEL_FILE)
        });
        if let Some(candidate) = candidate {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn resolve_model_path_for_daemon(app: &tauri::AppHandle) -> Option<PathBuf> {
    valid_bundled_model_path(app)
        .or_else(|| {
            if cfg!(debug_assertions) {
                development_model_path()
            } else {
                None
            }
        })
        .or_else(|| downloaded_model_path(app).ok())
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn ready_status(source: &str, message: &str) -> WhisperModelStatus {
    WhisperModelStatus {
        state: "ready".to_string(),
        source: source.to_string(),
        bytes: WHISPER_MODEL_BYTES,
        expected_bytes: WHISPER_MODEL_BYTES,
        downloaded_bytes: WHISPER_MODEL_BYTES,
        model_name: WHISPER_MODEL_FILE.to_string(),
        sha256: WHISPER_MODEL_SHA256.to_string(),
        download_url: WHISPER_MODEL_URL.to_string(),
        message: message.to_string(),
    }
}

fn base_status(
    state: &str,
    source: &str,
    bytes: u64,
    downloaded: u64,
    message: &str,
) -> WhisperModelStatus {
    WhisperModelStatus {
        state: state.to_string(),
        source: source.to_string(),
        bytes,
        expected_bytes: WHISPER_MODEL_BYTES,
        downloaded_bytes: downloaded,
        model_name: WHISPER_MODEL_FILE.to_string(),
        sha256: WHISPER_MODEL_SHA256.to_string(),
        download_url: WHISPER_MODEL_URL.to_string(),
        message: message.to_string(),
    }
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("AIモデルを開けません: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("AIモデルを検証できません: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn verify_downloaded_model(path: PathBuf) -> Result<bool, String> {
    if file_len(&path) != WHISPER_MODEL_BYTES {
        return Ok(false);
    }
    let marker = marker_path(&path);
    let marker_matches = std::fs::read_to_string(&marker)
        .map(|value| value.trim().eq_ignore_ascii_case(WHISPER_MODEL_SHA256))
        .unwrap_or(false);
    if marker_matches {
        let model_modified = std::fs::metadata(&path).and_then(|metadata| metadata.modified());
        let marker_modified = std::fs::metadata(&marker).and_then(|metadata| metadata.modified());
        if matches!((model_modified, marker_modified), (Ok(model_time), Ok(marker_time)) if marker_time >= model_time)
        {
            return Ok(true);
        }
    }
    let verify_path = path.clone();
    let hash = tokio::task::spawn_blocking(move || hash_file(&verify_path))
        .await
        .map_err(|error| format!("AIモデル検証タスクが失敗しました: {error}"))??;
    if hash != WHISPER_MODEL_SHA256 {
        return Ok(false);
    }
    std::fs::write(marker, format!("{WHISPER_MODEL_SHA256}\n"))
        .map_err(|error| format!("AIモデル検証記録を保存できません: {error}"))?;
    Ok(true)
}

async fn current_status(
    app: &tauri::AppHandle,
    verify_downloaded: bool,
) -> Result<WhisperModelStatus, String> {
    let corrupt_bundled_bytes = if let Some(path) = bundled_model_path(app) {
        let bytes = file_len(&path);
        if bytes == WHISPER_MODEL_BYTES {
            return Ok(ready_status(
                "bundled",
                "字幕モデルはアプリに同梱されています。",
            ));
        }
        Some(bytes)
    } else {
        None
    };

    if cfg!(debug_assertions) {
        if let Some(path) = development_model_path() {
            let bytes = file_len(&path);
            if bytes == WHISPER_MODEL_BYTES {
                return Ok(ready_status(
                    "development",
                    "開発用字幕モデルを使用します。",
                ));
            }
        }
    }

    let model_path = downloaded_model_path(app)?;
    if model_path.exists() {
        let bytes = file_len(&model_path);
        if bytes == WHISPER_MODEL_BYTES
            && (!verify_downloaded || verify_downloaded_model(model_path.clone()).await?)
        {
            return Ok(ready_status("downloaded", "字幕モデルは準備済みです。"));
        }
        return Ok(base_status(
            "corrupt",
            "downloaded",
            bytes,
            0,
            "字幕モデルが破損しています。削除して再取得してください。",
        ));
    }

    if let Some(bytes) = corrupt_bundled_bytes {
        return Ok(base_status(
            "corrupt",
            "bundled",
            bytes,
            0,
            "同梱字幕モデルが破損しています。字幕モデルを再取得するか、アプリを再インストールしてください。",
        ));
    }

    let partial = partial_model_path(app)?;
    let downloaded = file_len(&partial).min(WHISPER_MODEL_BYTES);
    Ok(base_status(
        if downloaded > 0 { "paused" } else { "missing" },
        "downloaded",
        0,
        downloaded,
        if downloaded > 0 {
            "字幕モデルの取得は中断されています。続きから再開できます。"
        } else {
            "AI字幕を使うには字幕モデルの取得が必要です。"
        },
    ))
}

fn emit_progress(app: &tauri::AppHandle, state: &str, downloaded: u64, message: &str) {
    let progress = if WHISPER_MODEL_BYTES == 0 {
        0.0
    } else {
        downloaded as f64 / WHISPER_MODEL_BYTES as f64
    };
    let _ = app.emit(
        "whisper-model-progress",
        WhisperModelProgress {
            state: state.to_string(),
            downloaded_bytes: downloaded,
            total_bytes: WHISPER_MODEL_BYTES,
            progress: progress.clamp(0.0, 1.0),
            message: message.to_string(),
        },
    );
}

#[tauri::command]
pub async fn get_whisper_model_status(app: tauri::AppHandle) -> Result<WhisperModelStatus, String> {
    current_status(&app, true).await
}

#[tauri::command]
pub async fn download_whisper_model(app: tauri::AppHandle) -> Result<WhisperModelStatus, String> {
    let _guard = model_download_lock()
        .try_lock()
        .map_err(|_| "字幕モデルは既に取得中です".to_string())?;
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);

    let existing = current_status(&app, true).await?;
    if existing.state == "ready" {
        return Ok(existing);
    }
    let model_dir = app_model_dir(&app)?;
    tokio::fs::create_dir_all(&model_dir)
        .await
        .map_err(|error| format!("AIモデル保存先を作成できません: {error}"))?;
    let final_path = downloaded_model_path(&app)?;
    let partial_path = partial_model_path(&app)?;
    if final_path.exists() {
        tokio::fs::remove_file(&final_path)
            .await
            .map_err(|error| format!("破損したAIモデルを削除できません: {error}"))?;
        let _ = tokio::fs::remove_file(marker_path(&final_path)).await;
    }

    let mut start = file_len(&partial_path);
    if start > WHISPER_MODEL_BYTES {
        tokio::fs::remove_file(&partial_path)
            .await
            .map_err(|error| format!("不正な一時モデルを削除できません: {error}"))?;
        start = 0;
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .user_agent("TateClip/0.1 model-downloader")
        .build()
        .map_err(|error| format!("AIモデル取得クライアントを作成できません: {error}"))?;
    emit_progress(&app, "downloading", start, "字幕モデルを取得中...");
    let mut request = client.get(WHISPER_MODEL_URL);
    if start > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={start}-"));
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("字幕モデルの取得を開始できません: {error}"))?;
    let status = response.status();
    let append = start > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
    if !status.is_success() {
        return Err(format!("字幕モデル配布元がHTTP {status}を返しました"));
    }
    if start > 0 && !append {
        start = 0;
    }

    let mut options = tokio::fs::OpenOptions::new();
    options.create(true).write(true);
    if append {
        options.append(true);
    } else {
        options.truncate(true);
    }
    let mut file = options
        .open(&partial_path)
        .await
        .map_err(|error| format!("AIモデル一時ファイルを開けません: {error}"))?;
    let mut downloaded = start;
    let mut last_emitted = start;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            file.flush().await.ok();
            emit_progress(
                &app,
                "paused",
                downloaded,
                "取得を中断しました。次回は続きから再開できます。",
            );
            return Err("字幕モデルの取得を中断しました".to_string());
        }
        let chunk = chunk.map_err(|error| format!("字幕モデルの受信に失敗しました: {error}"))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > WHISPER_MODEL_BYTES {
            drop(file);
            let _ = tokio::fs::remove_file(&partial_path).await;
            return Err("字幕モデルの受信サイズが公式値を超えました".to_string());
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("字幕モデルを保存できません: {error}"))?;
        if downloaded.saturating_sub(last_emitted) >= 2 * 1024 * 1024
            || downloaded == WHISPER_MODEL_BYTES
        {
            emit_progress(&app, "downloading", downloaded, "字幕モデルを取得中...");
            last_emitted = downloaded;
        }
    }
    file.flush()
        .await
        .map_err(|error| format!("字幕モデルを保存できません: {error}"))?;
    drop(file);

    if downloaded != WHISPER_MODEL_BYTES {
        emit_progress(
            &app,
            "paused",
            downloaded,
            "取得が途中で終了しました。再実行すると続きから再開します。",
        );
        return Err(format!(
            "字幕モデルが途中までしか取得できませんでした ({downloaded}/{WHISPER_MODEL_BYTES} bytes)"
        ));
    }

    emit_progress(
        &app,
        "verifying",
        downloaded,
        "字幕モデルのSHA-256を検証中...",
    );
    let verify_path = partial_path.clone();
    let hash = tokio::task::spawn_blocking(move || hash_file(&verify_path))
        .await
        .map_err(|error| format!("AIモデル検証タスクが失敗しました: {error}"))??;
    if hash != WHISPER_MODEL_SHA256 {
        let _ = tokio::fs::remove_file(&partial_path).await;
        emit_progress(
            &app,
            "corrupt",
            0,
            "SHA-256が一致しないため破損ファイルを削除しました。",
        );
        return Err(format!("字幕モデルのSHA-256が公式値と一致しません: {hash}"));
    }

    tokio::fs::rename(&partial_path, &final_path)
        .await
        .map_err(|error| format!("検証済みAIモデルを確定できません: {error}"))?;
    tokio::fs::write(
        marker_path(&final_path),
        format!("{WHISPER_MODEL_SHA256}\n"),
    )
    .await
    .map_err(|error| format!("AIモデル検証記録を保存できません: {error}"))?;
    emit_progress(
        &app,
        "ready",
        WHISPER_MODEL_BYTES,
        "字幕モデルの準備が完了しました。",
    );
    current_status(&app, false).await
}

#[tauri::command]
pub async fn cancel_whisper_model_download() -> Result<(), String> {
    CANCEL_DOWNLOAD.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn remove_downloaded_whisper_model(
    app: tauri::AppHandle,
) -> Result<WhisperModelStatus, String> {
    CANCEL_DOWNLOAD.store(true, Ordering::SeqCst);
    let _guard = model_download_lock().lock().await;
    if valid_bundled_model_path(&app).is_some() {
        return Err("同梱版の字幕モデルはアプリのアンインストールで削除してください".to_string());
    }
    for path in [downloaded_model_path(&app)?, partial_model_path(&app)?] {
        if path.exists() {
            tokio::fs::remove_file(&path)
                .await
                .map_err(|error| format!("AIモデルを削除できません: {error}"))?;
        }
        let marker = marker_path(&path);
        if marker.exists() {
            let _ = tokio::fs::remove_file(marker).await;
        }
    }
    current_status(&app, false).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_model_constants_are_pinned() {
        assert_eq!(WHISPER_MODEL_FILE, "ggml-large-v3-turbo.bin");
        assert_eq!(WHISPER_MODEL_BYTES, 1_624_555_275);
        assert_eq!(WHISPER_MODEL_SHA256.len(), 64);
        assert!(WHISPER_MODEL_URL.starts_with("https://huggingface.co/ggerganov/whisper.cpp/"));
    }

    #[test]
    fn marker_path_does_not_replace_the_model_file() {
        let path = PathBuf::from(r"C:\models\ggml-large-v3-turbo.bin");
        assert_eq!(
            marker_path(&path),
            PathBuf::from(r"C:\models\ggml-large-v3-turbo.bin.sha256")
        );
    }

    #[test]
    fn sha256_verification_uses_file_bytes() {
        let path = std::env::temp_dir().join(format!(
            "tateclip-model-hash-{}-{}.bin",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        std::fs::write(&path, b"abc").expect("write hash fixture");
        let result = hash_file(&path).expect("hash fixture");
        let _ = std::fs::remove_file(&path);
        assert_eq!(
            result,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
