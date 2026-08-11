use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Mutex;

pub const FFMPEG_ARCHIVE_FILE: &str = "ffmpeg-N-125365-g9a01c1cb6a-win64-lgpl.zip";
pub const FFMPEG_ARCHIVE_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-06-30-13-34/ffmpeg-N-125365-g9a01c1cb6a-win64-lgpl.zip";
pub const FFMPEG_RELEASE_URL: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-06-30-13-34";
pub const FFMPEG_ARCHIVE_ENTRY: &str = "ffmpeg-N-125365-g9a01c1cb6a-win64-lgpl/bin/ffmpeg.exe";
pub const FFMPEG_ARCHIVE_BYTES: u64 = 145_265_304;
pub const FFMPEG_ARCHIVE_SHA256: &str =
    "75cb786fa14299eb1c1cacc2542a15c8da690e551ab41858383dc425c605b8ab";
pub const FFMPEG_EXE_BYTES: u64 = 112_961_536;
pub const FFMPEG_EXE_SHA256: &str =
    "b1ebb2a19864de271d8539cc15934ff31719d184d3cbbcdb50dd16d68aa5db64";

static DOWNLOAD_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegRuntimeStatus {
    pub state: String,
    pub source: String,
    pub bytes: u64,
    pub expected_bytes: u64,
    pub downloaded_bytes: u64,
    pub archive_name: String,
    pub archive_sha256: String,
    pub executable_sha256: String,
    pub download_url: String,
    pub release_url: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FfmpegRuntimeProgress {
    state: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    progress: f64,
    message: String,
}

fn download_lock() -> &'static Mutex<()> {
    DOWNLOAD_LOCK.get_or_init(|| Mutex::new(()))
}

fn runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("runtime").join("ffmpeg"))
        .map_err(|error| format!("動画エンジンの保存先を取得できません: {error}"))
}

fn downloaded_executable_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_dir(app)?.join("ffmpeg.exe"))
}

fn partial_executable_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_dir(app)?.join("ffmpeg.exe.part"))
}

fn partial_archive_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_dir(app)?.join(format!("{FFMPEG_ARCHIVE_FILE}.part")))
}

fn marker_path(executable: &Path) -> PathBuf {
    executable.with_extension("exe.sha256")
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn marker_is_fresh(executable: &Path) -> bool {
    let marker = marker_path(executable);
    let marker_matches = std::fs::read_to_string(&marker)
        .map(|value| value.trim().eq_ignore_ascii_case(FFMPEG_EXE_SHA256))
        .unwrap_or(false);
    if !marker_matches {
        return false;
    }
    let executable_modified =
        std::fs::metadata(executable).and_then(|metadata| metadata.modified());
    let marker_modified = std::fs::metadata(marker).and_then(|metadata| metadata.modified());
    matches!((executable_modified, marker_modified), (Ok(executable_time), Ok(marker_time)) if marker_time >= executable_time)
}

fn bundled_executable_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let names = ["ffmpeg.exe", "ffmpeg-x86_64-pc-windows-msvc.exe"];
    if let Ok(resource_dir) = app.path().resource_dir() {
        for name in names {
            for candidate in [
                resource_dir.join(name),
                resource_dir.join("binaries").join(name),
            ] {
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            for name in names {
                for candidate in [parent.join(name), parent.join("binaries").join(name)] {
                    if candidate.exists() {
                        return Some(candidate);
                    }
                }
            }
        }
    }
    None
}

fn development_executable_path() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    if let Ok(current_dir) = std::env::current_dir() {
        for ancestor in current_dir.ancestors() {
            let candidate = ancestor
                .join("src-tauri")
                .join("binaries")
                .join("ffmpeg-x86_64-pc-windows-msvc.exe");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let candidate = PathBuf::from(manifest_dir)
            .join("binaries")
            .join("ffmpeg-x86_64-pc-windows-msvc.exe");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

pub fn resolve_ffmpeg_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    downloaded_executable_path(app)
        .ok()
        .filter(|path| file_len(path) == FFMPEG_EXE_BYTES && marker_is_fresh(path))
        .or_else(|| bundled_executable_path(app).filter(|path| file_len(path) == FFMPEG_EXE_BYTES))
        .or_else(|| development_executable_path().filter(|path| file_len(path) == FFMPEG_EXE_BYTES))
}

pub fn ffmpeg_path_for_daemon(app: &tauri::AppHandle) -> Option<PathBuf> {
    resolve_ffmpeg_path(app).or_else(|| downloaded_executable_path(app).ok())
}

pub fn command(app: &tauri::AppHandle) -> Result<Command, String> {
    let path = resolve_ffmpeg_path(app).ok_or_else(|| {
        "動画エンジンの初回準備が必要です。表示された案内からFFmpegを取得してください。".to_string()
    })?;
    let mut command = Command::new(path);
    command.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x0800_0000);
    }
    Ok(command)
}

pub async fn output<I, S>(app: &tauri::AppHandle, args: I) -> Result<std::process::Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut command = command(app)?;
    command.args(args);
    command
        .output()
        .await
        .map_err(|error| format!("FFmpegを開始できません: {error}"))
}

fn hash_file(path: &Path, label: &str) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("{label}を開けません: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("{label}を検証できません: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn verify_downloaded_executable(path: PathBuf) -> Result<bool, String> {
    if file_len(&path) != FFMPEG_EXE_BYTES {
        return Ok(false);
    }
    if marker_is_fresh(&path) {
        return Ok(true);
    }
    let verify_path = path.clone();
    let hash = tokio::task::spawn_blocking(move || hash_file(&verify_path, "FFmpeg"))
        .await
        .map_err(|error| format!("FFmpeg検証タスクが失敗しました: {error}"))??;
    if hash != FFMPEG_EXE_SHA256 {
        return Ok(false);
    }
    std::fs::write(marker_path(&path), format!("{FFMPEG_EXE_SHA256}\n"))
        .map_err(|error| format!("FFmpeg検証記録を保存できません: {error}"))?;
    Ok(true)
}

fn ready_status(source: &str, message: &str) -> FfmpegRuntimeStatus {
    FfmpegRuntimeStatus {
        state: "ready".to_string(),
        source: source.to_string(),
        bytes: FFMPEG_EXE_BYTES,
        expected_bytes: FFMPEG_ARCHIVE_BYTES,
        downloaded_bytes: FFMPEG_ARCHIVE_BYTES,
        archive_name: FFMPEG_ARCHIVE_FILE.to_string(),
        archive_sha256: FFMPEG_ARCHIVE_SHA256.to_string(),
        executable_sha256: FFMPEG_EXE_SHA256.to_string(),
        download_url: FFMPEG_ARCHIVE_URL.to_string(),
        release_url: FFMPEG_RELEASE_URL.to_string(),
        message: message.to_string(),
    }
}

fn base_status(state: &str, bytes: u64, downloaded: u64, message: &str) -> FfmpegRuntimeStatus {
    FfmpegRuntimeStatus {
        state: state.to_string(),
        source: "downloaded".to_string(),
        bytes,
        expected_bytes: FFMPEG_ARCHIVE_BYTES,
        downloaded_bytes: downloaded,
        archive_name: FFMPEG_ARCHIVE_FILE.to_string(),
        archive_sha256: FFMPEG_ARCHIVE_SHA256.to_string(),
        executable_sha256: FFMPEG_EXE_SHA256.to_string(),
        download_url: FFMPEG_ARCHIVE_URL.to_string(),
        release_url: FFMPEG_RELEASE_URL.to_string(),
        message: message.to_string(),
    }
}

async fn current_status(
    app: &tauri::AppHandle,
    verify_downloaded: bool,
) -> Result<FfmpegRuntimeStatus, String> {
    let downloaded = downloaded_executable_path(app)?;
    if downloaded.exists() {
        let bytes = file_len(&downloaded);
        if bytes == FFMPEG_EXE_BYTES
            && (!verify_downloaded || verify_downloaded_executable(downloaded.clone()).await?)
        {
            return Ok(ready_status("downloaded", "動画エンジンは準備済みです。"));
        }
        return Ok(base_status(
            "corrupt",
            bytes,
            0,
            "動画エンジンが破損しています。削除して再取得してください。",
        ));
    }

    if let Some(path) = bundled_executable_path(app) {
        if file_len(&path) == FFMPEG_EXE_BYTES {
            return Ok(ready_status(
                "bundled",
                "動画エンジンはアプリに同梱されています。",
            ));
        }
    }
    if let Some(path) = development_executable_path() {
        if file_len(&path) == FFMPEG_EXE_BYTES {
            return Ok(ready_status(
                "development",
                "開発用の動画エンジンを使用します。",
            ));
        }
    }

    let partial = partial_archive_path(app)?;
    let downloaded_bytes = file_len(&partial).min(FFMPEG_ARCHIVE_BYTES);
    Ok(base_status(
        if downloaded_bytes > 0 {
            "paused"
        } else {
            "missing"
        },
        0,
        downloaded_bytes,
        if downloaded_bytes > 0 {
            "動画エンジンの取得は中断されています。続きから再開できます。"
        } else {
            "動画の読み込み・編集・書き出しには動画エンジンの初回準備が必要です。"
        },
    ))
}

fn emit_progress(app: &tauri::AppHandle, state: &str, downloaded: u64, message: &str) {
    let progress = downloaded as f64 / FFMPEG_ARCHIVE_BYTES as f64;
    let _ = app.emit(
        "ffmpeg-runtime-progress",
        FfmpegRuntimeProgress {
            state: state.to_string(),
            downloaded_bytes: downloaded,
            total_bytes: FFMPEG_ARCHIVE_BYTES,
            progress: progress.clamp(0.0, 1.0),
            message: message.to_string(),
        },
    );
}

fn extract_archive_entry(
    archive_path: &Path,
    output_path: &Path,
    entry_name: &str,
    expected_bytes: u64,
) -> Result<(), String> {
    let archive_file =
        File::open(archive_path).map_err(|error| format!("FFmpeg公式ZIPを開けません: {error}"))?;
    let mut archive = zip::ZipArchive::new(archive_file)
        .map_err(|error| format!("FFmpeg公式ZIPを読み取れません: {error}"))?;
    let mut entry = archive
        .by_name(entry_name)
        .map_err(|error| format!("FFmpeg公式ZIPに実行ファイルがありません: {error}"))?;
    if entry.size() != expected_bytes {
        return Err(format!(
            "FFmpeg実行ファイルのサイズが公式値と一致しません: {} bytes",
            entry.size()
        ));
    }
    let mut output = File::create(output_path)
        .map_err(|error| format!("FFmpeg実行ファイルを作成できません: {error}"))?;
    std::io::copy(&mut entry, &mut output)
        .map_err(|error| format!("FFmpeg実行ファイルを展開できません: {error}"))?;
    output
        .flush()
        .map_err(|error| format!("FFmpeg実行ファイルを保存できません: {error}"))?;
    output
        .sync_all()
        .map_err(|error| format!("FFmpeg実行ファイルを確定できません: {error}"))?;
    Ok(())
}

fn extract_executable(archive_path: &Path, output_path: &Path) -> Result<(), String> {
    extract_archive_entry(
        archive_path,
        output_path,
        FFMPEG_ARCHIVE_ENTRY,
        FFMPEG_EXE_BYTES,
    )
}

#[tauri::command]
pub async fn get_ffmpeg_runtime_status(
    app: tauri::AppHandle,
) -> Result<FfmpegRuntimeStatus, String> {
    current_status(&app, true).await
}

#[tauri::command]
pub async fn download_ffmpeg_runtime(app: tauri::AppHandle) -> Result<FfmpegRuntimeStatus, String> {
    let _guard = download_lock()
        .try_lock()
        .map_err(|_| "動画エンジンは既に取得中です".to_string())?;
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);

    let existing = current_status(&app, true).await?;
    if existing.state == "ready" {
        return Ok(existing);
    }
    let directory = runtime_dir(&app)?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("動画エンジン保存先を作成できません: {error}"))?;
    let final_path = downloaded_executable_path(&app)?;
    let partial_executable = partial_executable_path(&app)?;
    let partial_archive = partial_archive_path(&app)?;
    for path in [&final_path, &partial_executable] {
        if path.exists() {
            tokio::fs::remove_file(path)
                .await
                .map_err(|error| format!("破損した動画エンジンを削除できません: {error}"))?;
        }
    }
    let marker = marker_path(&final_path);
    if marker.exists() {
        let _ = tokio::fs::remove_file(marker).await;
    }

    let mut start = file_len(&partial_archive);
    if start > FFMPEG_ARCHIVE_BYTES {
        tokio::fs::remove_file(&partial_archive)
            .await
            .map_err(|error| format!("不正な一時ZIPを削除できません: {error}"))?;
        start = 0;
    }
    // 受信完了直後にアプリが終了しても、次回は再ダウンロードせず検証から再開する。
    let downloaded = if start == FFMPEG_ARCHIVE_BYTES {
        start
    } else {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .user_agent("TateClip/0.1 ffmpeg-downloader")
            .build()
            .map_err(|error| format!("動画エンジン取得クライアントを作成できません: {error}"))?;
        emit_progress(
            &app,
            "downloading",
            start,
            "動画エンジンを公式配布元から取得中...",
        );
        let mut request = client.get(FFMPEG_ARCHIVE_URL);
        if start > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={start}-"));
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("動画エンジンの取得を開始できません: {error}"))?;
        let status = response.status();
        let append = start > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
        if !status.is_success() {
            return Err(format!("FFmpeg公式配布元がHTTP {status}を返しました"));
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
            .open(&partial_archive)
            .await
            .map_err(|error| format!("動画エンジン一時ZIPを開けません: {error}"))?;
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
                return Err("動画エンジンの取得を中断しました".to_string());
            }
            let chunk =
                chunk.map_err(|error| format!("動画エンジンの受信に失敗しました: {error}"))?;
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            if downloaded > FFMPEG_ARCHIVE_BYTES {
                drop(file);
                let _ = tokio::fs::remove_file(&partial_archive).await;
                return Err("FFmpeg公式ZIPの受信サイズが公式値を超えました".to_string());
            }
            file.write_all(&chunk)
                .await
                .map_err(|error| format!("動画エンジンを保存できません: {error}"))?;
            if downloaded.saturating_sub(last_emitted) >= 2 * 1024 * 1024
                || downloaded == FFMPEG_ARCHIVE_BYTES
            {
                emit_progress(
                    &app,
                    "downloading",
                    downloaded,
                    "動画エンジンを公式配布元から取得中...",
                );
                last_emitted = downloaded;
            }
        }
        file.flush()
            .await
            .map_err(|error| format!("動画エンジンを保存できません: {error}"))?;
        drop(file);

        if downloaded != FFMPEG_ARCHIVE_BYTES {
            emit_progress(
                &app,
                "paused",
                downloaded,
                "取得が途中で終了しました。再実行すると続きから再開します。",
            );
            return Err(format!(
            "FFmpeg公式ZIPが途中までしか取得できませんでした ({downloaded}/{FFMPEG_ARCHIVE_BYTES} bytes)"
        ));
        }
        downloaded
    };

    emit_progress(&app, "verifying", downloaded, "公式ZIPのSHA-256を検証中...");
    let archive_for_hash = partial_archive.clone();
    let archive_hash =
        tokio::task::spawn_blocking(move || hash_file(&archive_for_hash, "FFmpeg公式ZIP"))
            .await
            .map_err(|error| format!("FFmpeg ZIP検証タスクが失敗しました: {error}"))??;
    if archive_hash != FFMPEG_ARCHIVE_SHA256 {
        let _ = tokio::fs::remove_file(&partial_archive).await;
        emit_progress(&app, "corrupt", 0, "SHA-256が一致しないZIPを削除しました。");
        return Err(format!(
            "FFmpeg公式ZIPのSHA-256が一致しません: {archive_hash}"
        ));
    }

    emit_progress(
        &app,
        "extracting",
        downloaded,
        "検証済みZIPから動画エンジンを展開中...",
    );
    let archive_for_extract = partial_archive.clone();
    let executable_for_extract = partial_executable.clone();
    tokio::task::spawn_blocking(move || {
        extract_executable(&archive_for_extract, &executable_for_extract)
    })
    .await
    .map_err(|error| format!("FFmpeg展開タスクが失敗しました: {error}"))??;
    let executable_for_hash = partial_executable.clone();
    let executable_hash =
        tokio::task::spawn_blocking(move || hash_file(&executable_for_hash, "FFmpeg"))
            .await
            .map_err(|error| format!("FFmpeg検証タスクが失敗しました: {error}"))??;
    if file_len(&partial_executable) != FFMPEG_EXE_BYTES || executable_hash != FFMPEG_EXE_SHA256 {
        let _ = tokio::fs::remove_file(&partial_archive).await;
        let _ = tokio::fs::remove_file(&partial_executable).await;
        emit_progress(
            &app,
            "corrupt",
            0,
            "展開後のFFmpegが一致しないため削除しました。",
        );
        return Err(format!(
            "展開後FFmpegのSHA-256が一致しません: {executable_hash}"
        ));
    }

    tokio::fs::rename(&partial_executable, &final_path)
        .await
        .map_err(|error| format!("検証済みFFmpegを確定できません: {error}"))?;
    tokio::fs::write(marker_path(&final_path), format!("{FFMPEG_EXE_SHA256}\n"))
        .await
        .map_err(|error| format!("FFmpeg検証記録を保存できません: {error}"))?;
    let _ = tokio::fs::remove_file(&partial_archive).await;
    emit_progress(
        &app,
        "ready",
        FFMPEG_ARCHIVE_BYTES,
        "動画エンジンの準備が完了しました。",
    );
    current_status(&app, false).await
}

#[tauri::command]
pub async fn cancel_ffmpeg_runtime_download() -> Result<(), String> {
    CANCEL_DOWNLOAD.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn remove_downloaded_ffmpeg_runtime(
    app: tauri::AppHandle,
) -> Result<FfmpegRuntimeStatus, String> {
    CANCEL_DOWNLOAD.store(true, Ordering::SeqCst);
    let _guard = download_lock().lock().await;
    if bundled_executable_path(&app)
        .filter(|path| file_len(path) == FFMPEG_EXE_BYTES)
        .is_some()
    {
        return Err("同梱版の動画エンジンはアプリのアンインストールで削除してください".to_string());
    }
    for path in [
        downloaded_executable_path(&app)?,
        partial_executable_path(&app)?,
        partial_archive_path(&app)?,
    ] {
        if path.exists() {
            tokio::fs::remove_file(&path)
                .await
                .map_err(|error| format!("動画エンジンを削除できません: {error}"))?;
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
    use zip::write::SimpleFileOptions;

    #[test]
    fn official_artifact_constants_are_locked() {
        assert_eq!(FFMPEG_ARCHIVE_BYTES, 145_265_304);
        assert_eq!(FFMPEG_EXE_BYTES, 112_961_536);
        assert_eq!(FFMPEG_ARCHIVE_SHA256.len(), 64);
        assert_eq!(FFMPEG_EXE_SHA256.len(), 64);
        assert!(FFMPEG_ARCHIVE_URL.contains("autobuild-2026-06-30-13-34"));
        assert!(FFMPEG_ARCHIVE_ENTRY.ends_with("/bin/ffmpeg.exe"));
    }

    #[test]
    fn extracts_only_the_named_verified_zip_entry() {
        let directory =
            std::env::temp_dir().join(format!("vfocus-ffmpeg-zip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).expect("create fixture directory");
        let archive_path = directory.join("fixture.zip");
        let output_path = directory.join("ffmpeg.exe.part");
        let payload = b"verified-ffmpeg-fixture";

        let archive_file = File::create(&archive_path).expect("create fixture archive");
        let mut writer = zip::ZipWriter::new(archive_file);
        writer
            .start_file(
                "fixed/bin/ffmpeg.exe",
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )
            .expect("start fixture entry");
        writer.write_all(payload).expect("write fixture entry");
        writer.finish().expect("finish fixture archive");

        extract_archive_entry(
            &archive_path,
            &output_path,
            "fixed/bin/ffmpeg.exe",
            payload.len() as u64,
        )
        .expect("extract fixture entry");
        assert_eq!(std::fs::read(&output_path).expect("read output"), payload);

        std::fs::remove_file(&output_path).expect("remove output");
        std::fs::remove_file(&archive_path).expect("remove archive");
        std::fs::remove_dir(&directory).expect("remove fixture directory");
    }
}
