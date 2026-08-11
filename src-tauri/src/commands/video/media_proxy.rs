use serde::Serialize;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::Manager;

use super::probe::get_video_info_inner;
use crate::path_security::ensure_asset_path_allowed;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProxyResult {
    pub path: String,
    pub bytes: u64,
    pub reused: bool,
}

fn media_proxy_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("プロキシ保存先を確認できません: {error}"))?
        .join("media-proxies");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("プロキシ保存先を作成できません: {error}"))?;
    Ok(directory)
}

pub(super) fn media_proxy_file_name(
    input_path: &Path,
    bytes: u64,
    modified_millis: u128,
) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    input_path
        .to_string_lossy()
        .to_lowercase()
        .hash(&mut hasher);
    bytes.hash(&mut hasher);
    modified_millis.hash(&mut hasher);
    format!("tateclip-proxy-{:016x}.mp4", hasher.finish())
}

fn media_proxy_path(app: &tauri::AppHandle, input_path: &Path) -> Result<PathBuf, String> {
    let metadata = std::fs::metadata(input_path)
        .map_err(|error| format!("プロキシ元の動画を確認できません: {error}"))?;
    if !metadata.is_file() {
        return Err("プロキシ元としてファイルを選択してください".to_string());
    }
    let modified_millis = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_millis())
        .unwrap_or(0);
    Ok(media_proxy_dir(app)?.join(media_proxy_file_name(
        input_path,
        metadata.len(),
        modified_millis,
    )))
}

fn ensure_managed_proxy_path(app: &tauri::AppHandle, proxy_path: &str) -> Result<PathBuf, String> {
    let directory = media_proxy_dir(app)?;
    let candidate = PathBuf::from(proxy_path);
    let safe_name = candidate
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.starts_with("tateclip-proxy-") && name.ends_with(".mp4"));
    if !candidate.is_absolute() || candidate.parent() != Some(directory.as_path()) || !safe_name {
        return Err("TateClipが管理するプロキシだけを削除できます".to_string());
    }
    Ok(candidate)
}

pub(super) fn media_proxy_args(input_path: &str, output_path: &Path) -> Vec<String> {
    [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input_path,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        "scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v",
        "libopenh264",
        "-b:v",
        "2M",
        "-maxrate",
        "3M",
        "-bufsize",
        "6M",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
    ]
    .into_iter()
    .map(String::from)
    .chain(std::iter::once(output_path.to_string_lossy().into_owned()))
    .collect()
}

async fn validate_proxy_output(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let metadata =
        std::fs::metadata(path).map_err(|error| format!("プロキシを確認できません: {error}"))?;
    if metadata.len() < 1024 {
        return Err("プロキシが空です".to_string());
    }
    let info = get_video_info_inner(app, path).await?;
    if info.duration <= 0.0 || info.width == 0 || info.height == 0 {
        return Err("プロキシに有効な映像がありません".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn generate_media_proxy(
    app: tauri::AppHandle,
    input_path: String,
) -> Result<MediaProxyResult, String> {
    ensure_asset_path_allowed(&app, &input_path, "プロキシ元動画")?;
    let input = PathBuf::from(&input_path);
    let proxy_path = media_proxy_path(&app, &input)?;

    if std::fs::metadata(&proxy_path).is_ok_and(|metadata| metadata.len() > 10_000)
        && validate_proxy_output(&app, &proxy_path.to_string_lossy())
            .await
            .is_ok()
    {
        let bytes = std::fs::metadata(&proxy_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        return Ok(MediaProxyResult {
            path: proxy_path.to_string_lossy().into_owned(),
            bytes,
            reused: true,
        });
    }

    let temp_path = proxy_path.with_file_name(format!(
        "{}.partial.mp4",
        proxy_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("tateclip-proxy")
    ));
    let _ = std::fs::remove_file(&temp_path);

    let mut command = crate::ffmpeg_runtime::command(&app)?;
    command.args(media_proxy_args(&input_path, &temp_path));
    let output = command
        .output()
        .await
        .map_err(|error| format!("プロキシ生成を開始できません: {error}"))?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&temp_path);
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!("プロキシ生成に失敗しました: {}", detail.trim()));
    }

    validate_proxy_output(&app, &temp_path.to_string_lossy())
        .await
        .map_err(|error| {
            let _ = std::fs::remove_file(&temp_path);
            format!("生成したプロキシを確認できません: {error}")
        })?;
    let _ = std::fs::remove_file(&proxy_path);
    std::fs::rename(&temp_path, &proxy_path)
        .map_err(|error| format!("プロキシを保存できません: {error}"))?;
    let bytes = std::fs::metadata(&proxy_path)
        .map_err(|error| format!("保存したプロキシを確認できません: {error}"))?
        .len();

    Ok(MediaProxyResult {
        path: proxy_path.to_string_lossy().into_owned(),
        bytes,
        reused: false,
    })
}

#[tauri::command]
pub async fn remove_media_proxy(app: tauri::AppHandle, proxy_path: String) -> Result<(), String> {
    let candidate = ensure_managed_proxy_path(&app, &proxy_path)?;
    match tokio::fs::remove_file(candidate).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("プロキシを削除できません: {error}")),
    }
}
