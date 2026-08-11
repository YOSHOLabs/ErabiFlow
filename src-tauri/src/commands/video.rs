use crate::ffmpeg::builder::{build_commentary_filter, FilterParams, TextStyle};
use crate::ffmpeg::encoder::EncoderConfig;
use crate::ffmpeg::runner::{emit_progress, run_ffmpeg_with_progress};
use crate::path_security::{ensure_asset_path_allowed, ensure_derived_output_path};
use crate::{
    AvatarParams, BgmParams, ClipParams, DuckingParams, OverlayImageParams, ProcessParams,
    SeParams, SubtitleParams, TextParams, TextSegment, TrackMediaClipParams, VideoInfo,
};
/// commands/video.rs — 動画関連の Tauri コマンド
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

pub(crate) mod media_proxy;
mod probe;
#[cfg(test)]
use media_proxy::{media_proxy_args, media_proxy_file_name};
use probe::{
    get_video_info_inner, parse_render_progress, probe_contains_video_stream, probe_video,
};

// ============================================================
// 動画情報取得ヘルパー
// ============================================================

fn png_sequence_files(pattern: &str) -> Result<Vec<(u32, PathBuf)>, String> {
    let path = Path::new(pattern);
    let parent = path
        .parent()
        .ok_or_else(|| "PNG連番の保存先を確認できません".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "PNG連番のファイル名を確認できません".to_string())?;
    let (placeholder, width) = if file_name.contains("%05d") {
        ("%05d", 5usize)
    } else if file_name.contains("%06d") {
        ("%06d", 6usize)
    } else {
        return Err("PNG連番の番号プレースホルダーが不正です".to_string());
    };
    let (prefix, suffix) = file_name.split_once(placeholder).unwrap();
    let mut files = Vec::new();
    for entry in std::fs::read_dir(parent)
        .map_err(|error| format!("PNG連番の保存先を確認できません: {error}"))?
    {
        let entry = entry.map_err(|error| format!("PNG連番を確認できません: {error}"))?;
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some(number) = png_sequence_number(&name, prefix, suffix, width) else {
            continue;
        };
        if let Ok(index) = number.parse::<u32>() {
            files.push((index, entry_path));
        }
    }
    files.sort_by_key(|(index, _)| *index);
    Ok(files)
}

fn png_path_component_matches(actual: &str, expected: &str) -> bool {
    #[cfg(windows)]
    {
        actual.to_lowercase() == expected.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        actual == expected
    }
}

fn png_sequence_number<'a>(
    name: &'a str,
    prefix: &str,
    suffix: &str,
    width: usize,
) -> Option<&'a str> {
    for (start, _) in name.char_indices() {
        let end = start.checked_add(width)?;
        let Some(number) = name.get(start..end) else {
            continue;
        };
        if !number.bytes().all(|value| value.is_ascii_digit()) {
            continue;
        }
        let Some(actual_prefix) = name.get(..start) else {
            continue;
        };
        let Some(actual_suffix) = name.get(end..) else {
            continue;
        };
        if png_path_component_matches(actual_prefix, prefix)
            && png_path_component_matches(actual_suffix, suffix)
        {
            return Some(number);
        }
    }
    None
}

fn validate_png_sequence(pattern: &str, expected_duration: f64, fps: f64) -> Result<(), String> {
    let files = png_sequence_files(pattern)?;
    let expected_frames = (expected_duration.max(0.001) * fps.clamp(1.0, 120.0))
        .round()
        .max(1.0) as usize;
    if files.len().abs_diff(expected_frames) > 1 {
        return Err(format!(
            "PNG連番の枚数が期待値と一致しません（{}枚 / 期待{}枚）",
            files.len(),
            expected_frames
        ));
    }
    if files.first().map(|value| value.0) != Some(1)
        || files.windows(2).any(|pair| pair[1].0 != pair[0].0 + 1)
    {
        return Err("PNG連番の番号に欠落があります".to_string());
    }
    for (_, path) in &files {
        let mut header = [0_u8; 24];
        let mut file = File::open(path)
            .map_err(|error| format!("PNG連番を開けません ({}): {error}", path.display()))?;
        file.read_exact(&mut header)
            .map_err(|error| format!("PNG連番が不完全です ({}): {error}", path.display()))?;
        if header[..8] != [137, 80, 78, 71, 13, 10, 26, 10]
            || &header[12..16] != b"IHDR"
            || u32::from_be_bytes(header[16..20].try_into().unwrap()) == 0
            || u32::from_be_bytes(header[20..24].try_into().unwrap()) == 0
        {
            return Err(format!(
                "PNG連番の画像ヘッダーが不正です: {}",
                path.display()
            ));
        }
    }
    Ok(())
}

struct OutputPathLock {
    file: Option<File>,
    path: PathBuf,
}

impl OutputPathLock {
    fn acquire(output: &Path) -> Result<(Self, String), String> {
        let parent = output
            .parent()
            .ok_or_else(|| "書き出し先フォルダーを確認できません".to_string())?;
        let canonical_parent = std::fs::canonicalize(parent)
            .map_err(|error| format!("書き出し先フォルダーを正規化できません: {error}"))?;
        let file_name = output
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "書き出しファイル名を確認できません".to_string())?;
        #[cfg(windows)]
        let normalized_identity = file_name.to_lowercase();
        #[cfg(not(windows))]
        let normalized_identity = file_name.to_string();
        let mut digest = Sha256::new();
        digest.update(normalized_identity.as_bytes());
        let key = format!("{:x}", digest.finalize());
        let path = canonical_parent.join(format!(".tateclip-export-{key}.lock"));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(windows)]
        options.share_mode(0);
        #[cfg(not(windows))]
        options.create_new(true);
        let mut file = options.open(&path).map_err(|error| {
            format!(
                "同じ書き出し先が別のTateClipで使用中です。完了後にもう一度お試しください: {error}"
            )
        })?;
        let _ = file.set_len(0);
        let _ = writeln!(file, "pid={}", std::process::id());
        let _ = file.sync_all();
        Ok((
            Self {
                file: Some(file),
                path,
            },
            key,
        ))
    }
}

impl Drop for OutputPathLock {
    fn drop(&mut self) {
        self.file.take();
        if let Err(error) = std::fs::remove_file(&self.path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!(
                    "書き出しロックファイルを削除できませんでした ({}): {}",
                    self.path.display(),
                    error
                );
            }
        }
    }
}

const PNG_TRANSACTION_STATE_FILE: &str = "transaction.state";
const PNG_TRANSACTION_STATE_TEMP_FILE: &str = "transaction.state.tmp";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PngTransactionJournal {
    state: String,
    old_files: Vec<String>,
    installed_files: Vec<String>,
}

fn png_backup_prefix(lock_key: &str) -> String {
    format!(".tateclip-png-backup-{lock_key}-")
}

fn write_png_transaction_state(
    directory: &Path,
    journal: &PngTransactionJournal,
) -> Result<(), String> {
    let path = directory.join(PNG_TRANSACTION_STATE_FILE);
    let temp_path = directory.join(PNG_TRANSACTION_STATE_TEMP_FILE);
    let bytes = serde_json::to_vec(journal)
        .map_err(|error| format!("PNG連番の復旧記録を変換できません: {error}"))?;
    let mut file = File::create(&temp_path)
        .map_err(|error| format!("PNG連番の復旧記録を作成できません: {error}"))?;
    file.write_all(&bytes)
        .map_err(|error| format!("PNG連番の復旧記録を書き込めません: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("PNG連番の復旧記録を確定できません: {error}"))?;
    drop(file);
    crate::atomic_file::replace_file(&temp_path, &path)
        .map_err(|error| format!("PNG連番の復旧記録を置換できません: {error}"))
}

fn backup_payload_files(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(directory)
        .map_err(|error| format!("PNG連番の退避内容を確認できません: {error}"))?
    {
        let path = entry
            .map_err(|error| format!("PNG連番の退避内容を確認できません: {error}"))?
            .path();
        if path.is_file()
            && !matches!(
                path.file_name().and_then(|value| value.to_str()),
                Some(PNG_TRANSACTION_STATE_FILE | PNG_TRANSACTION_STATE_TEMP_FILE)
            )
        {
            files.push(path);
        }
    }
    Ok(files)
}

fn restore_png_backups(backups: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    let mut failures = Vec::new();
    for (backup, original) in backups.iter().rev() {
        if let Err(error) = std::fs::rename(backup, original) {
            failures.push(format!(
                "{} -> {}: {}",
                backup.display(),
                original.display(),
                error
            ));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn remove_installed_png_files(installed: &[PathBuf]) -> Result<(), String> {
    let mut failures = Vec::new();
    for path in installed.iter().rev() {
        if let Err(error) = std::fs::remove_file(path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                failures.push(format!("{}: {}", path.display(), error));
            }
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn png_backup_pairs(directory: &Path, parent: &Path) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    Ok(backup_payload_files(directory)?
        .into_iter()
        .filter_map(|backup| {
            let name = backup.file_name()?.to_owned();
            Some((backup, parent.join(name)))
        })
        .collect())
}

fn rollback_png_install(
    backup_directory: &Path,
    journal: &mut PngTransactionJournal,
    installed: &[PathBuf],
    backups: &[(PathBuf, PathBuf)],
) -> Result<(), String> {
    journal.state = "rollback_failed".to_string();
    write_png_transaction_state(backup_directory, journal)?;

    let remove_error = remove_installed_png_files(installed).err();
    let restore_error = restore_png_backups(backups).err();
    match (remove_error, restore_error) {
        (None, None) => Ok(()),
        (remove, restore) => Err([remove, restore]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("; ")),
    }
}

fn recover_failed_png_rollback(
    final_output: &Path,
    parent: &Path,
    directory: &Path,
    journal: &PngTransactionJournal,
) -> Result<(), String> {
    let backups = png_backup_pairs(directory, parent)?;
    let remaining_backup_names = backups
        .iter()
        .filter_map(|(backup, _)| backup.file_name()?.to_str().map(str::to_owned))
        .collect::<std::collections::HashSet<_>>();
    let old_names = journal
        .old_files
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let pattern = final_output.to_string_lossy();
    let unsafe_current_files = png_sequence_files(&pattern)?
        .into_iter()
        .map(|(_, path)| path)
        .filter(|path| {
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                return false;
            };
            remaining_backup_names.contains(name) || !old_names.contains(name)
        })
        .collect::<Vec<_>>();
    remove_installed_png_files(&unsafe_current_files).map_err(|error| {
        format!(
            "中断したPNGロールバックを継続できません。退避データを保持しました ({}): {error}",
            directory.display()
        )
    })?;
    restore_png_backups(&backups).map_err(|error| {
        format!(
            "中断したPNGロールバックを復元できません。退避データを保持しました ({}): {error}",
            directory.display()
        )
    })
}

fn recover_interrupted_png_transactions(final_output: &Path, lock_key: &str) -> Result<(), String> {
    let parent = final_output
        .parent()
        .ok_or_else(|| "PNG連番の保存先を確認できません".to_string())?;
    let prefix = png_backup_prefix(lock_key);
    let mut recovery_directories = Vec::new();
    for entry in std::fs::read_dir(parent)
        .map_err(|error| format!("PNG連番の保存先を確認できません: {error}"))?
    {
        let path = entry
            .map_err(|error| format!("PNG連番の保存先を確認できません: {error}"))?
            .path();
        if path.is_dir()
            && path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.starts_with(&prefix))
        {
            recovery_directories.push(path);
        }
    }

    for directory in recovery_directories {
        let state_path = directory.join(PNG_TRANSACTION_STATE_FILE);
        let mut journal: PngTransactionJournal = match std::fs::read(&state_path) {
            Ok(value) => serde_json::from_slice(&value).map_err(|error| {
                format!(
                    "PNG連番の復旧記録が破損しています。退避データを保持しました ({}): {error}",
                    directory.display()
                )
            })?,
            Err(error) if backup_payload_files(&directory)?.is_empty() => {
                std::fs::remove_dir_all(&directory).map_err(|remove_error| {
                    format!(
                        "空のPNG復旧フォルダーを削除できません ({}): {remove_error}",
                        directory.display()
                    )
                })?;
                continue;
            }
            Err(error) => {
                return Err(format!(
                    "PNG連番の復旧記録を読めません。退避データを保持しました ({}): {error}",
                    directory.display()
                ));
            }
        };

        match journal.state.as_str() {
            "backing_up" => {
                let backups = png_backup_pairs(&directory, parent)?;
                restore_png_backups(&backups).map_err(|error| {
                    format!(
                        "中断したPNG連番を復元できません。退避データを保持しました ({}): {error}",
                        directory.display()
                    )
                })?;
            }
            "installing" => {
                let pattern = final_output.to_string_lossy();
                let installed = png_sequence_files(&pattern)?
                    .into_iter()
                    .map(|(_, path)| path)
                    .collect::<Vec<_>>();
                journal.state = "rollback_failed".to_string();
                journal.installed_files = installed
                    .iter()
                    .filter_map(|path| path.file_name()?.to_str().map(str::to_owned))
                    .collect();
                write_png_transaction_state(&directory, &journal)?;
                recover_failed_png_rollback(final_output, parent, &directory, &journal)?;
            }
            "rollback_failed" => {
                recover_failed_png_rollback(final_output, parent, &directory, &journal)?;
            }
            "installed" => {}
            other => {
                return Err(format!(
                    "PNG連番の復旧状態が不正です。退避データを保持しました ({} / {})",
                    directory.display(),
                    other
                ));
            }
        }
        std::fs::remove_dir_all(&directory).map_err(|error| {
            format!(
                "PNG連番の復旧後に退避フォルダーを削除できません ({}): {error}",
                directory.display()
            )
        })?;
    }
    Ok(())
}

struct RenderOutputTransaction {
    final_output: PathBuf,
    staged_output: PathBuf,
    stage_directory: Option<PathBuf>,
    export_format: String,
    _output_lock: OutputPathLock,
    output_lock_key: String,
    committed: bool,
}

impl RenderOutputTransaction {
    fn new(params: &ProcessParams) -> Result<Self, String> {
        let final_output = PathBuf::from(&params.output_path);
        let parent = final_output
            .parent()
            .ok_or_else(|| "書き出し先フォルダーを確認できません".to_string())?;
        let file_name = final_output
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "書き出しファイル名を確認できません".to_string())?;
        let (output_lock, output_lock_key) = OutputPathLock::acquire(&final_output)?;
        if params.export_format == "png_sequence" {
            recover_interrupted_png_transactions(&final_output, &output_lock_key)?;
        }
        let id = uuid::Uuid::new_v4();

        let (staged_output, stage_directory) = if params.export_format == "png_sequence" {
            let directory = parent.join(format!(".tateclip-render-{id}"));
            std::fs::create_dir(&directory)
                .map_err(|error| format!("PNG連番の一時フォルダーを作成できません: {error}"))?;
            (directory.join(file_name), Some(directory))
        } else {
            let extension = final_output
                .extension()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "書き出し形式を確認できません".to_string())?;
            let stem = final_output
                .file_stem()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "書き出しファイル名を確認できません".to_string())?;
            (
                parent.join(format!(".{stem}.tateclip-render-{id}.partial.{extension}")),
                None,
            )
        };

        Ok(Self {
            final_output,
            staged_output,
            stage_directory,
            export_format: params.export_format.clone(),
            _output_lock: output_lock,
            output_lock_key,
            committed: false,
        })
    }

    fn staged_params(&self, params: &ProcessParams) -> ProcessParams {
        let mut staged = params.clone();
        staged.output_path = self.staged_output.to_string_lossy().into_owned();
        staged
    }

    fn commit(mut self) -> Result<(), String> {
        if self.export_format == "png_sequence" {
            self.commit_png_sequence()?;
        } else {
            crate::atomic_file::replace_file(&self.staged_output, &self.final_output)?;
        }
        self.committed = true;
        self.cleanup_staging();
        Ok(())
    }

    fn commit_png_sequence(&self) -> Result<(), String> {
        let staged_pattern = self.staged_output.to_string_lossy();
        let staged_files = png_sequence_files(&staged_pattern)?;
        if staged_files.is_empty() {
            return Err("置換するPNG連番がありません".to_string());
        }
        let final_pattern = self.final_output.to_string_lossy();
        let existing_files = png_sequence_files(&final_pattern)?;
        let parent = self
            .final_output
            .parent()
            .ok_or_else(|| "PNG連番の保存先を確認できません".to_string())?;
        let backup_directory = parent.join(format!(
            "{}{}",
            png_backup_prefix(&self.output_lock_key),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&backup_directory)
            .map_err(|error| format!("既存PNG連番の退避先を作成できません: {error}"))?;
        let mut journal = PngTransactionJournal {
            state: "backing_up".to_string(),
            old_files: existing_files
                .iter()
                .filter_map(|(_, path)| path.file_name()?.to_str().map(str::to_owned))
                .collect(),
            installed_files: Vec::new(),
        };
        write_png_transaction_state(&backup_directory, &journal)?;

        let mut backups: Vec<(PathBuf, PathBuf)> = Vec::new();
        for (_, existing) in existing_files {
            let Some(name) = existing.file_name() else {
                continue;
            };
            let backup = backup_directory.join(name);
            if let Err(error) = std::fs::rename(&existing, &backup) {
                if let Err(restore_error) = restore_png_backups(&backups) {
                    return Err(format!(
                        "既存PNG連番を退避できず、復元にも失敗しました。退避データを保持しました ({}): {error}; {restore_error}",
                        backup_directory.display()
                    ));
                }
                let _ = std::fs::remove_dir_all(&backup_directory);
                return Err(format!("既存PNG連番を安全に退避できません: {error}"));
            }
            backups.push((backup, existing));
        }
        journal.state = "installing".to_string();
        if let Err(error) = write_png_transaction_state(&backup_directory, &journal) {
            if let Err(restore_error) = restore_png_backups(&backups) {
                return Err(format!(
                    "PNG連番の復旧記録を更新できず、旧連番の復元にも失敗しました。退避データを保持しました ({}): {error}; {restore_error}",
                    backup_directory.display()
                ));
            }
            let _ = std::fs::remove_dir_all(&backup_directory);
            return Err(error);
        }

        let mut installed = Vec::new();
        for (_, staged) in staged_files {
            let Some(name) = staged.file_name() else {
                continue;
            };
            let destination = parent.join(name);
            if let Err(error) = std::fs::rename(&staged, &destination) {
                if let Err(rollback_error) =
                    rollback_png_install(&backup_directory, &mut journal, &installed, &backups)
                {
                    return Err(format!(
                        "検証済みPNG連番を保存できず、完全なロールバックにも失敗しました。退避データを保持しました ({}): {error}; {rollback_error}",
                        backup_directory.display()
                    ));
                }
                let _ = std::fs::remove_dir_all(&backup_directory);
                return Err(format!("検証済みPNG連番を保存できません: {error}"));
            }
            installed.push(destination);
            journal
                .installed_files
                .push(name.to_string_lossy().into_owned());
            if let Err(error) = write_png_transaction_state(&backup_directory, &journal) {
                if let Err(rollback_error) =
                    rollback_png_install(&backup_directory, &mut journal, &installed, &backups)
                {
                    return Err(format!(
                        "PNG連番の復旧記録を更新できず、完全なロールバックにも失敗しました。退避データを保持しました ({}): {error}; {rollback_error}",
                        backup_directory.display()
                    ));
                }
                let _ = std::fs::remove_dir_all(&backup_directory);
                return Err(error);
            }
        }

        journal.state = "installed".to_string();
        if let Err(error) = write_png_transaction_state(&backup_directory, &journal) {
            if let Err(rollback_error) =
                rollback_png_install(&backup_directory, &mut journal, &installed, &backups)
            {
                return Err(format!(
                    "PNG連番の確定記録に失敗し、完全なロールバックにも失敗しました。退避データを保持しました ({}): {error}; {rollback_error}",
                    backup_directory.display()
                ));
            }
            let _ = std::fs::remove_dir_all(&backup_directory);
            return Err(error);
        }

        if let Err(error) = std::fs::remove_dir_all(&backup_directory) {
            log::warn!(
                "置換後のPNG退避ファイルを削除できませんでした ({}): {}",
                backup_directory.display(),
                error
            );
        }
        Ok(())
    }

    fn cleanup_staging(&self) {
        if let Some(directory) = self.stage_directory.as_ref() {
            let _ = std::fs::remove_dir_all(directory);
        } else {
            let _ = std::fs::remove_file(&self.staged_output);
        }
    }
}

impl Drop for RenderOutputTransaction {
    fn drop(&mut self) {
        if !self.committed {
            self.cleanup_staging();
        }
    }
}

/// FFmpegの終了コードだけに頼らず、全映像デコード・期待尺・期待フレーム数を確認する。
async fn validate_rendered_output(
    app: &tauri::AppHandle,
    params: &ProcessParams,
    expected_duration: f64,
) -> Result<(), String> {
    if params.export_format == "png_sequence" {
        validate_png_sequence(&params.output_path, expected_duration, params.output_fps)?;
        let first_index = png_sequence_files(&params.output_path)?
            .first()
            .map(|(index, _)| *index)
            .unwrap_or(1);
        let args = vec![
            "-v".to_string(),
            "error".to_string(),
            "-start_number".to_string(),
            first_index.to_string(),
            "-i".to_string(),
            params.output_path.clone(),
            "-f".to_string(),
            "null".to_string(),
            "-".to_string(),
        ];
        let decoded = crate::ffmpeg_runtime::output(app, args).await?;
        if !decoded.status.success() {
            return Err(format!(
                "PNG連番を最後までデコードできません: {}",
                String::from_utf8_lossy(&decoded.stderr)
            ));
        }
        return Ok(());
    }
    let path = &params.output_path;
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("書き出しファイルを確認できません: {}", e))?;
    if metadata.len() < 1024 {
        return Err("書き出しファイルが空です".to_string());
    }

    let probe = probe_video(app, path).await?;
    if !probe_contains_video_stream(&probe) {
        return Err("書き出し結果に映像ストリームがありません（音声のみの出力）".to_string());
    }

    let output = crate::ffmpeg_runtime::output(
        app,
        [
            "-v",
            "error",
            "-i",
            path,
            "-map",
            "0:v:0",
            "-an",
            "-progress",
            "pipe:1",
            "-nostats",
            "-f",
            "null",
            "-",
        ],
    )
    .await
    .map_err(|e| format!("書き出し映像の検証を開始できません: {}", e))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "書き出し映像を最後まで読み込めません: {}",
            detail.trim()
        ));
    }

    let progress = String::from_utf8_lossy(&output.stdout);
    let (frames, decoded_duration, ended) = parse_render_progress(&progress);
    let duration_tolerance = 0.5_f64.max(2.0 / params.output_fps.clamp(1.0, 120.0));
    let minimum_frames = (expected_duration.max(0.001) * params.output_fps.clamp(1.0, 120.0) * 0.90)
        .floor()
        .max(1.0) as u64;
    if !ended
        || frames < minimum_frames
        || decoded_duration + duration_tolerance < expected_duration
    {
        return Err(format!(
            "書き出し映像が予定より短いです（{frames}フレーム、{decoded_duration:.3}秒 / 期待{expected_duration:.3}秒）"
        ));
    }

    Ok(())
}

async fn validate_render_attempt(
    app: &tauri::AppHandle,
    params: &ProcessParams,
    expected_duration: f64,
    result: Result<(), String>,
) -> Result<(), String> {
    let checked = match result {
        Ok(()) => validate_rendered_output(app, params, expected_duration)
            .await
            .map_err(|error| format!("FFmpegは終了しましたが出力検証に失敗しました: {}", error)),
        Err(error) => Err(error),
    };

    if checked.is_err() {
        remove_failed_render_output(params);
    }
    checked
}

fn remove_failed_render_output(params: &ProcessParams) {
    if params.export_format == "png_sequence" {
        if let Ok(files) = png_sequence_files(&params.output_path) {
            for (_, path) in files {
                match std::fs::remove_file(&path) {
                    Ok(()) => log::warn!("不完全なPNG連番を削除しました: {}", path.display()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => log::warn!(
                        "不完全なPNGを削除できませんでした ({}): {}",
                        path.display(),
                        error
                    ),
                }
            }
        }
        return;
    }
    let output_path = &params.output_path;
    match std::fs::remove_file(output_path) {
        Ok(()) => log::warn!("不完全な書き出しファイルを削除しました: {}", output_path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => log::warn!(
            "不完全な書き出しファイルを削除できませんでした ({}): {}",
            output_path,
            error
        ),
    }
}

// ============================================================
// 統一 FFmpeg 引数ビルダー
// ============================================================

#[derive(Debug, Clone)]
struct PlannedTextLayer {
    content: String,
    x: u32,
    y: u32,
    font: String,
    color: String,
    size: u32,
    stroke_color: String,
    stroke_width: u32,
    shadow_color: String,
    shadow_blur: u32,
    start_time: f64,
    end_time: Option<f64>,
}

#[derive(Debug, Clone)]
struct PlannedWatermarkLayer {
    text: String,
    font: String,
    color: String,
    size: u32,
    opacity: f64,
    position: String,
}

#[derive(Debug, Clone)]
struct PlannedSubtitleLayer {
    segments: Vec<TextSegment>,
    font: String,
    color: String,
    size: u32,
    stroke_color: String,
    stroke_width: u32,
    shadow_color: String,
    shadow_blur: u32,
    y: f64,
    emphasis_mode: String,
    emphasis_color: String,
}

#[derive(Debug, Clone)]
struct PlannedAvatarInput {
    path: String,
    x: u32,
    y: u32,
    scale: f64,
}

#[derive(Debug, Clone)]
struct PlannedBgmInput {
    index: usize,
    path: String,
    source_start: f64,
    timeline_start: f64,
    timeline_end: Option<f64>,
    volume: f64,
}

#[derive(Debug, Clone)]
struct PlannedSeInput {
    index: usize,
    path: String,
    volume: f64,
    trigger_time: f64,
}

#[derive(Debug, Clone)]
struct PlannedOverlayImageInput {
    index: usize,
    path: String,
    x: u32,
    y: u32,
    scale: f64,
    start_time: f64,
    end_time: f64,
}

#[derive(Debug, Clone)]
struct PlannedTrackMediaClipInput {
    index: usize,
    clip: TrackMediaClipParams,
}

#[derive(Debug, Clone)]
struct PlannedDucking {
    enabled: bool,
    main_voice: f64,
    bgm: f64,
    se: f64,
}

#[derive(Debug, Clone)]
struct RenderExecutionPlan {
    source_path: String,
    layout_kind: String,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
    crop_data: Option<String>,
    game_y: Option<u32>,
    game_scale: f64,
    clips: Vec<ClipParams>,
    title: Option<PlannedTextLayer>,
    watermark: Option<PlannedWatermarkLayer>,
    subtitles: Option<PlannedSubtitleLayer>,
    avatar: Option<PlannedAvatarInput>,
    bgm: Option<PlannedBgmInput>,
    se_slots: Vec<PlannedSeInput>,
    overlay_images: Vec<PlannedOverlayImageInput>,
    track_clips: Vec<PlannedTrackMediaClipInput>,
    ducking: PlannedDucking,
}

fn text_layer_from_legacy(text: &TextParams) -> PlannedTextLayer {
    PlannedTextLayer {
        content: text.content.clone().unwrap_or_default(),
        x: text.x.unwrap_or(540),
        y: text.y.unwrap_or(115),
        font: text.font.clone().unwrap_or_else(|| "Arial".to_string()),
        color: text.color.clone().unwrap_or_else(|| "#FFFFFF".to_string()),
        size: text.size.unwrap_or(44),
        stroke_color: text
            .stroke_color
            .clone()
            .unwrap_or_else(|| "#000000".to_string()),
        stroke_width: text.stroke_width.unwrap_or(3),
        shadow_color: text
            .shadow_color
            .clone()
            .unwrap_or_else(|| "black".to_string()),
        shadow_blur: text.shadow_blur.unwrap_or(0),
        start_time: text.start_time.unwrap_or(0.0),
        end_time: text.end_time,
    }
}

fn subtitle_layer_from_legacy(subtitle: &SubtitleParams) -> PlannedSubtitleLayer {
    PlannedSubtitleLayer {
        segments: subtitle.segments.clone().unwrap_or_default(),
        font: subtitle.font.clone().unwrap_or_else(|| "Arial".to_string()),
        color: subtitle
            .color
            .clone()
            .unwrap_or_else(|| "#FFFFFF".to_string()),
        size: subtitle.size.unwrap_or(44),
        stroke_color: subtitle
            .stroke_color
            .clone()
            .unwrap_or_else(|| "#000000".to_string()),
        stroke_width: subtitle.stroke_width.unwrap_or(3),
        shadow_color: subtitle
            .shadow_color
            .clone()
            .unwrap_or_else(|| "black".to_string()),
        shadow_blur: subtitle.shadow_blur.unwrap_or(0),
        y: subtitle.y.unwrap_or(0.85),
        emphasis_mode: subtitle
            .emphasis_mode
            .clone()
            .unwrap_or_else(|| "none".to_string()),
        emphasis_color: subtitle
            .emphasis_color
            .clone()
            .unwrap_or_else(|| "#FDE047".to_string()),
    }
}

fn build_render_execution_plan(p: &ProcessParams) -> RenderExecutionPlan {
    if let Some(spec) = p.render_spec.as_ref() {
        let mut next_index: usize = 1;

        let avatar = spec.layers.avatar.as_ref().map(|avatar| {
            next_index += 1;
            PlannedAvatarInput {
                path: avatar.path.clone(),
                x: avatar.x,
                y: avatar.y,
                scale: avatar.scale,
            }
        });

        let bgm = spec.layers.bgm.as_ref().map(|bgm| {
            let index = next_index;
            next_index += 1;
            PlannedBgmInput {
                index,
                path: bgm.path.clone(),
                source_start: bgm.trim_start,
                timeline_start: bgm.timeline_start,
                timeline_end: bgm.timeline_end,
                volume: bgm.volume,
            }
        });

        let se_slots = spec
            .layers
            .se
            .iter()
            .map(|se| {
                let index = next_index;
                next_index += 1;
                PlannedSeInput {
                    index,
                    path: se.path.clone(),
                    volume: se.volume,
                    trigger_time: se.trigger_time,
                }
            })
            .collect();

        let overlay_images = spec
            .layers
            .images
            .iter()
            .map(|image| {
                let index = next_index;
                next_index += 1;
                PlannedOverlayImageInput {
                    index,
                    path: image.path.clone(),
                    x: (image.position.x * spec.canvas.width as f64).round() as u32,
                    y: (image.position.y * spec.canvas.height as f64).round() as u32,
                    scale: image.scale,
                    start_time: image.start_time,
                    end_time: image.end_time,
                }
            })
            .collect();

        let track_clips = spec
            .layers
            .track_clips
            .iter()
            .cloned()
            .map(|clip| {
                let index = next_index;
                next_index += 1;
                PlannedTrackMediaClipInput { index, clip }
            })
            .collect();

        return RenderExecutionPlan {
            source_path: spec.source.path.clone(),
            layout_kind: spec.layout.kind.clone(),
            trim_start: None,
            trim_duration: None,
            crop_data: spec.layout.crop_data.clone(),
            game_y: Some(spec.layout.game_y),
            game_scale: spec.layout.game_scale,
            clips: spec
                .sequence
                .clips
                .iter()
                .map(|clip| {
                    let transform = clip.transform.as_ref();
                    ClipParams {
                        is_gap: clip.is_gap,
                        start: clip.media_start,
                        end: clip.media_end,
                        speed: clip.speed,
                        volume: clip.volume,
                        muted: clip.muted,
                        position_x: transform.and_then(|value| value.position_x),
                        position_y: transform.and_then(|value| value.position_y),
                        scale: transform.and_then(|value| value.scale),
                        rotation: transform.and_then(|value| value.rotation),
                        flip_horizontal: transform.and_then(|value| value.flip_horizontal),
                        flip_vertical: transform.and_then(|value| value.flip_vertical),
                        opacity: transform.and_then(|value| value.opacity),
                        keyframes: clip.keyframes.clone(),
                        transition_in: clip.transition_in.clone(),
                        transition_out: clip.transition_out.clone(),
                        motion_preset: clip.motion_preset.clone(),
                        color: clip.color.clone(),
                        effects: clip.effects.clone(),
                        speed_curve: clip.speed_curve.clone(),
                        reverse: clip.reverse,
                        freeze_frame: clip.freeze_frame,
                        freeze_duration: clip.freeze_duration,
                        audio_effects: clip.audio_effects.clone(),
                    }
                })
                .collect(),
            title: spec.layers.title.as_ref().map(|title| PlannedTextLayer {
                content: title.text.clone(),
                x: title.x,
                y: title.y,
                font: title.font.clone(),
                color: title.color.clone(),
                size: title.size,
                stroke_color: title.stroke_color.clone(),
                stroke_width: title.stroke_width,
                shadow_color: title.shadow_color.clone(),
                shadow_blur: title.shadow_blur,
                start_time: title.start_time,
                end_time: title.end_time,
            }),
            watermark: spec
                .layers
                .watermark
                .as_ref()
                .map(|watermark| PlannedWatermarkLayer {
                    text: watermark.text.clone(),
                    font: watermark.font.clone(),
                    color: watermark.color.clone(),
                    size: watermark.size.clamp(12, 96),
                    opacity: watermark.opacity.clamp(0.05, 1.0),
                    position: watermark.position.clone(),
                }),
            subtitles: spec
                .layers
                .subtitles
                .as_ref()
                .map(|subtitle| PlannedSubtitleLayer {
                    segments: subtitle.segments.clone(),
                    font: subtitle.font.clone(),
                    color: subtitle.color.clone(),
                    size: subtitle.size,
                    stroke_color: subtitle.stroke_color.clone(),
                    stroke_width: subtitle.stroke_width,
                    shadow_color: subtitle.shadow_color.clone(),
                    shadow_blur: subtitle.shadow_blur,
                    y: subtitle.y,
                    emphasis_mode: subtitle.emphasis_mode.clone(),
                    emphasis_color: subtitle.emphasis_color.clone(),
                }),
            avatar,
            bgm,
            se_slots,
            overlay_images,
            track_clips,
            ducking: PlannedDucking {
                enabled: spec.audio.ducking.enabled,
                main_voice: spec.audio.ducking.main_voice,
                bgm: spec.audio.ducking.bgm,
                se: spec.audio.ducking.se,
            },
        };
    }

    let mut next_index: usize = 1;

    let avatar = p.avatar.as_ref().map(|avatar| {
        next_index += 1;
        PlannedAvatarInput {
            path: avatar.path.clone(),
            x: avatar.x.unwrap_or(540),
            y: avatar.y.unwrap_or(1498),
            scale: avatar.scale.unwrap_or(1.0),
        }
    });

    let bgm = p.bgm.as_ref().map(|bgm| {
        let index = next_index;
        next_index += 1;
        PlannedBgmInput {
            index,
            path: bgm.path.clone(),
            source_start: bgm.start.unwrap_or(0.0),
            timeline_start: bgm.timeline_start.unwrap_or(0.0),
            timeline_end: bgm.timeline_end,
            volume: bgm.volume.unwrap_or(0.5),
        }
    });

    let se_slots = p
        .se_slots
        .as_ref()
        .map(|slots| {
            slots
                .iter()
                .map(|se| {
                    let index = next_index;
                    next_index += 1;
                    PlannedSeInput {
                        index,
                        path: se.path.clone(),
                        volume: se.volume.unwrap_or(0.8),
                        trigger_time: se.trigger_time.unwrap_or(0.0),
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let overlay_images = p
        .overlay_images
        .as_ref()
        .map(|images| {
            images
                .iter()
                .map(|image| {
                    let index = next_index;
                    next_index += 1;
                    PlannedOverlayImageInput {
                        index,
                        path: image.path.clone(),
                        x: image.x.unwrap_or(540),
                        y: image.y.unwrap_or(960),
                        scale: image.scale.unwrap_or(0.3),
                        start_time: image.start_time.unwrap_or(0.0),
                        end_time: image.end_time.unwrap_or(9999.0),
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let track_clips = p
        .track_clips
        .as_ref()
        .map(|clips| {
            clips
                .iter()
                .cloned()
                .map(|clip| {
                    let index = next_index;
                    next_index += 1;
                    PlannedTrackMediaClipInput { index, clip }
                })
                .collect()
        })
        .unwrap_or_default();

    let ducking = p.ducking.as_ref();

    RenderExecutionPlan {
        source_path: p.input_path.clone(),
        layout_kind: p.layout.clone(),
        trim_start: p.trim_start,
        trim_duration: p.trim_duration,
        crop_data: p.crop_data.clone(),
        game_y: p.game_y,
        game_scale: p.game_scale.unwrap_or(1.0),
        clips: p.clips.clone().unwrap_or_default(),
        title: p.text.as_ref().map(text_layer_from_legacy),
        watermark: None,
        subtitles: p.subtitle.as_ref().map(subtitle_layer_from_legacy),
        avatar,
        bgm,
        se_slots,
        overlay_images,
        track_clips,
        ducking: PlannedDucking {
            enabled: ducking.and_then(|d| d.enabled).unwrap_or(false),
            main_voice: ducking.and_then(|d| d.main_voice).unwrap_or(1.0),
            bgm: ducking.and_then(|d| d.bgm).unwrap_or(0.15),
            se: ducking.and_then(|d| d.se).unwrap_or(1.0),
        },
    }
}

/// filter_complex の結果（filter文字列, v_map, a_map）と ProcessParams から
/// FFmpeg のコマンドライン引数を組み立てる。
/// commentary / center 共通で使用する。
fn build_ffmpeg_args(
    p: &ProcessParams,
    plan: &RenderExecutionPlan,
    filter_script: Option<&str>,
    v_map: &str,
    a_map: &str,
    encoder: &EncoderConfig,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".to_string()];

    // --- 入力オプション ---

    // メイン動画トリム開始
    if let Some(ss) = plan.trim_start {
        if ss > 0.0 {
            args.push("-ss".to_string());
            args.push(format!("{:.3}", ss));
        }
    }

    // メイン動画入力
    args.push("-i".to_string());
    args.push(plan.source_path.clone());

    // アバター入力 (commentary のみ)
    if let Some(ref av) = plan.avatar {
        args.push("-i".to_string());
        args.push(av.path.clone());
    }

    // BGM入力 (-ss はBGM素材内の読み始め。タイムライン位置はフィルターで遅延する)
    if let Some(ref bgm) = plan.bgm {
        args.push("-ss".to_string());
        args.push(bgm.source_start.to_string());
        args.push("-i".to_string());
        args.push(bgm.path.clone());
    }

    // SE入力
    for se in &plan.se_slots {
        args.push("-i".to_string());
        args.push(se.path.clone());
    }

    // 画像オーバーレイ入力
    for img in &plan.overlay_images {
        args.push("-i".to_string());
        args.push(img.path.clone());
    }

    for track_clip in &plan.track_clips {
        args.push("-i".to_string());
        args.push(track_clip.clip.path.clone());
    }

    // トリム長
    if let Some(dur) = plan.trim_duration {
        if dur > 0.0 {
            args.push("-t".to_string());
            args.push(format!("{:.3}", dur));
        }
    }

    // --- フィルタ + マッピング ---

    if let Some(filter_script) = filter_script {
        // Current bundled FFmpeg removed the deprecated
        // -filter_complex_script option. The generic -/option form reads the
        // option value from a file without placing the graph on Windows' command line.
        args.push("-/filter_complex".to_string());
        args.push(filter_script.to_string());
    }

    if !v_map.is_empty() {
        args.push("-map".to_string());
        args.push(v_map.to_string());
    }

    let image_only = p.export_format == "gif" || p.export_format == "png_sequence";
    if !image_only {
        args.push("-map".to_string());
        args.push(a_map.to_string());
    }

    // --- エンコーダ ---

    let codec = match p.export_format.as_str() {
        "gif" => "gif",
        "png_sequence" => "png",
        _ if p.video_codec == "h265" => match encoder.codec {
            "h264_nvenc" => "hevc_nvenc",
            "h264_amf" => "hevc_amf",
            "h264_mf" => "hevc_mf",
            _ => "libkvazaar",
        },
        _ => encoder.codec,
    };
    args.push("-c:v".to_string());
    args.push(codec.to_string());
    if !image_only && p.video_codec == "h264" {
        args.extend(encoder.extra_args.clone());
    }
    args.extend([
        "-s".to_string(),
        format!(
            "{}x{}",
            p.output_width.clamp(128, 7680) / 2 * 2,
            p.output_height.clamp(128, 7680) / 2 * 2
        ),
    ]);
    args.extend([
        "-r".to_string(),
        format!("{:.3}", p.output_fps.clamp(1.0, 120.0)),
    ]);
    if !image_only {
        args.extend([
            "-b:v".to_string(),
            format!("{}k", p.video_bitrate_kbps.clamp(256, 100_000)),
        ]);
    }

    // 音声コーデック: フィルタグラフ経由なら再エンコード必須
    let needs_audio_encode = a_map.starts_with('[');
    let audio_codec = if needs_audio_encode { "aac" } else { "copy" };

    if !image_only {
        args.extend([
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-c:a".to_string(),
            audio_codec.to_string(),
        ]);
        if p.export_format == "mp4" || p.export_format == "mov" {
            args.extend(["-movflags".to_string(), "+faststart".to_string()]);
        }
        if p.video_codec == "h265" && (p.export_format == "mp4" || p.export_format == "mov") {
            args.extend(["-tag:v".to_string(), "hvc1".to_string()]);
        }
    } else if p.export_format == "png_sequence" {
        args.extend([
            "-f".to_string(),
            "image2".to_string(),
            "-start_number".to_string(),
            "1".to_string(),
        ]);
    }
    args.extend([
        "-progress".to_string(),
        "pipe:1".to_string(),
        p.output_path.clone(),
    ]);

    args
}

/// RenderExecutionPlan からレイアウトに応じた filter + args を構築する
fn make_ffmpeg_args(
    p: &ProcessParams,
    encoder: &EncoderConfig,
    main_has_audio: bool,
    timeline_duration: f64,
    source_fps: f64,
) -> Result<Vec<String>, String> {
    let plan = build_render_execution_plan(p);
    let bgm_index = plan.bgm.as_ref().map(|bgm| bgm.index);
    let bgm_volume = plan.bgm.as_ref().map(|bgm| bgm.volume).unwrap_or(0.5);

    {
        let title = plan.title.as_ref();

        let header_style = TextStyle {
            font: title.map(|t| t.font.as_str()).unwrap_or("Arial"),
            color: title.map(|t| t.color.as_str()).unwrap_or("#FFFFFF"),
            size: title.map(|t| t.size).unwrap_or(44),
            stroke_color: title.map(|t| t.stroke_color.as_str()).unwrap_or("#000000"),
            stroke_width: title.map(|t| t.stroke_width).unwrap_or(3),
            shadow_color: title.map(|t| t.shadow_color.as_str()).unwrap_or("black"),
            shadow_blur: title.map(|t| t.shadow_blur).unwrap_or(0),
        };

        let watermark = plan.watermark.as_ref();
        let watermark_style = TextStyle {
            font: watermark
                .map(|value| value.font.as_str())
                .unwrap_or("Arial"),
            color: watermark
                .map(|value| value.color.as_str())
                .unwrap_or("#FFFFFF"),
            size: watermark.map(|value| value.size).unwrap_or(28),
            stroke_color: "#000000",
            stroke_width: 1,
            shadow_color: "black",
            shadow_blur: 2,
        };

        // ASS ファイル生成（字幕がある場合のみ）
        let (ass_file, ass_fonts_dir) = if let Some(subtitle) = plan.subtitles.as_ref() {
            if subtitle.segments.is_empty() {
                (None, None)
            } else {
                let ass_path = generated_ass_path(&p.output_path);
                let subtitle_text = subtitle
                    .segments
                    .iter()
                    .map(|segment| segment.text.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                let resolved_font =
                    crate::font::resolve_font_reference(&subtitle.font, &subtitle_text);
                let mut render_segments = subtitle.segments.clone();
                let mut individual_fonts_dir = None;
                for segment in &mut render_segments {
                    let Some(style) = segment.style_override.as_mut() else {
                        continue;
                    };
                    let Some(font_reference) = style.font.clone() else {
                        continue;
                    };
                    let segment_font =
                        crate::font::resolve_font_reference(&font_reference, &segment.text);
                    style.font = Some(segment_font.family);
                    if crate::font::is_font_path(&font_reference) {
                        individual_fonts_dir = std::path::Path::new(&segment_font.path)
                            .parent()
                            .map(|path| path.to_string_lossy().into_owned());
                    }
                }
                let ass_style = crate::ffmpeg::ass::build_ass_style_from_params(
                    &resolved_font.family,
                    &subtitle.color,
                    subtitle.size,
                    &subtitle.stroke_color,
                    subtitle.stroke_width,
                    &subtitle.shadow_color,
                    subtitle.shadow_blur,
                    subtitle.y,
                    1920,
                    resolved_font.is_bold,
                    &subtitle.emphasis_mode,
                    &subtitle.emphasis_color,
                );
                match crate::ffmpeg::ass::generate_ass_file(
                    &render_segments,
                    &ass_style,
                    &ass_path,
                    1080,
                    1920,
                ) {
                    Ok(()) => {
                        let fonts_dir = individual_fonts_dir.or_else(|| {
                            std::path::Path::new(&resolved_font.path)
                                .parent()
                                .map(|path| path.to_string_lossy().into_owned())
                        });
                        (Some(ass_path), fonts_dir)
                    }
                    Err(e) => {
                        log::error!("ASS file generation failed: {}", e);
                        (None, None)
                    }
                }
            }
        } else {
            (None, None)
        };

        let avatar_ref = plan.avatar.as_ref();

        let fp = FilterParams {
            output_width: p.output_width,
            output_height: p.output_height,
            header_text: title.map(|t| t.content.as_str()).unwrap_or(""),
            header_style,
            header_x: title.map(|t| t.x).unwrap_or(540),
            header_y: title.map(|t| t.y).unwrap_or(115),
            header_start_time: title.map(|t| t.start_time).unwrap_or(0.0),
            header_end_time: title.and_then(|t| t.end_time),
            watermark_text: watermark.map(|value| value.text.as_str()).unwrap_or(""),
            watermark_style,
            watermark_position: watermark
                .map(|value| value.position.as_str())
                .unwrap_or("bottom-right"),
            watermark_opacity: watermark.map(|value| value.opacity).unwrap_or(0.55),
            has_avatar: avatar_ref.is_some(),
            avatar_x: avatar_ref.map(|a| a.x).unwrap_or(540),
            avatar_y: avatar_ref.map(|a| a.y).unwrap_or(1498),
            avatar_scale: avatar_ref.map(|a| a.scale).unwrap_or(1.0),
            game_y: plan.game_y,
            game_scale: plan.game_scale,
            layout_kind: &plan.layout_kind,
            crop_data: plan.crop_data.as_deref(),
            ass_file,
            ass_fonts_dir,
            clips: plan.clips.clone(),
            main_has_audio,
            timeline_duration,
            source_fps,
            bgm_index,
            bgm_volume,
            bgm_timeline_start: plan
                .bgm
                .as_ref()
                .map(|bgm| bgm.timeline_start)
                .unwrap_or(0.0),
            bgm_duration: plan.bgm.as_ref().and_then(|bgm| {
                bgm.timeline_end
                    .map(|end| (end - bgm.timeline_start).max(0.0))
            }),
            se_slots: plan
                .se_slots
                .iter()
                .map(|se| (se.index, se.volume, se.trigger_time))
                .collect(),
            overlay_images: plan
                .overlay_images
                .iter()
                .map(|image| {
                    (
                        image.index,
                        image.x,
                        image.y,
                        image.scale,
                        image.start_time,
                        image.end_time,
                    )
                })
                .collect(),
            track_clips: plan
                .track_clips
                .iter()
                .map(|planned| crate::ffmpeg::builder::TrackClipFilterParams {
                    input_index: planned.index,
                    kind: planned.clip.kind.clone(),
                    timeline_start: planned.clip.timeline_start,
                    timeline_end: planned.clip.timeline_end,
                    source_start: planned.clip.source_start,
                    source_end: planned.clip.source_end,
                    source_fps: planned.clip.source_fps.unwrap_or(30.0),
                    volume: planned.clip.volume,
                    muted: planned.clip.muted,
                    has_audio: planned.clip.has_audio,
                    track_order: planned.clip.track_order,
                    render_video: planned.clip.render_video,
                    render_audio: planned.clip.render_audio,
                    position_x: planned.clip.transform.position_x.unwrap_or(0.0),
                    position_y: planned.clip.transform.position_y.unwrap_or(0.0),
                    scale: planned.clip.transform.scale.unwrap_or(1.0),
                    rotation: planned.clip.transform.rotation.unwrap_or(0.0),
                    flip_horizontal: planned.clip.transform.flip_horizontal.unwrap_or(false),
                    flip_vertical: planned.clip.transform.flip_vertical.unwrap_or(false),
                    opacity: planned.clip.transform.opacity.unwrap_or(1.0),
                    keyframes: planned.clip.keyframes.clone(),
                    transition_in: planned.clip.transition_in.clone(),
                    transition_out: planned.clip.transition_out.clone(),
                    motion_preset: planned.clip.motion_preset.clone(),
                    color: planned.clip.color.clone(),
                    effects: planned.clip.effects.clone(),
                    speed: planned.clip.speed.unwrap_or(1.0).clamp(0.25, 4.0),
                    speed_curve: planned.clip.speed_curve.clone(),
                    reverse: planned.clip.reverse,
                    freeze_frame: planned.clip.freeze_frame,
                    audio_effects: planned.clip.audio_effects.clone(),
                })
                .collect(),
            ducking_enabled: plan.ducking.enabled,
            ducking_main_voice: plan.ducking.main_voice,
            ducking_bgm: plan.ducking.bgm,
            ducking_se: plan.ducking.se,
        };

        let (filter, v_map, a_map) = build_commentary_filter(&fp);
        log::info!("Shared {} layout filter length: {}", p.layout, filter.len());
        let filter_script = if filter.is_empty() {
            None
        } else {
            Some(write_generated_filter_script(&p.output_path, &filter)?)
        };
        Ok(build_ffmpeg_args(
            p,
            &plan,
            filter_script.as_deref(),
            &v_map,
            &a_map,
            encoder,
        ))
    }
}

fn generated_ass_path(output_path: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    output_path.hash(&mut hasher);
    std::env::temp_dir()
        .join(format!(
            "vfocus-subtitles-{}-{:016x}.ass",
            std::process::id(),
            hasher.finish()
        ))
        .to_string_lossy()
        .to_string()
}

fn cleanup_generated_ass(output_path: &str) {
    let path = generated_ass_path(output_path);
    match std::fs::remove_file(&path) {
        Ok(()) => log::debug!("Removed temporary subtitle file: {}", path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => log::warn!(
            "Could not remove temporary subtitle file {}: {}",
            path,
            error
        ),
    }
}

fn generated_filter_script_path(output_path: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    output_path.hash(&mut hasher);
    std::env::temp_dir()
        .join(format!(
            "vfocus-filter-{}-{:016x}.txt",
            std::process::id(),
            hasher.finish()
        ))
        .to_string_lossy()
        .to_string()
}

fn write_generated_filter_script(output_path: &str, filter: &str) -> Result<String, String> {
    let final_path = PathBuf::from(generated_filter_script_path(output_path));
    let temp_path = final_path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = File::create(&temp_path)
            .map_err(|error| format!("FFmpegフィルター一時ファイルを作成できません: {error}"))?;
        file.write_all(filter.as_bytes())
            .map_err(|error| format!("FFmpegフィルター一時ファイルを書き込めません: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("FFmpegフィルター一時ファイルを確定できません: {error}"))?;
        drop(file);
        crate::atomic_file::replace_file(&temp_path, &final_path)
            .map_err(|error| format!("FFmpegフィルター一時ファイルを置換できません: {error}"))?;
        Ok(final_path.to_string_lossy().into_owned())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    result
}

fn cleanup_generated_filter_script(output_path: &str) {
    let path = generated_filter_script_path(output_path);
    match std::fs::remove_file(&path) {
        Ok(()) => log::debug!("Removed temporary filter file: {}", path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => log::warn!("Could not remove temporary filter file {}: {}", path, error),
    }
}

fn cleanup_generated_render_files(output_path: &str) {
    cleanup_generated_ass(output_path);
    cleanup_generated_filter_script(output_path);
}

fn expected_output_duration(p: &ProcessParams, source_duration: f64) -> f64 {
    if let Some(clips) = p.clips.as_ref().filter(|clips| !clips.is_empty()) {
        let duration: f64 = clips
            .iter()
            .map(|clip| {
                if clip.is_gap.unwrap_or(false) {
                    clip.start.max(0.0)
                } else if clip.freeze_frame.is_some() {
                    clip.freeze_duration.unwrap_or(2.0).clamp(0.1, 30.0)
                } else {
                    let source_duration = (clip.end - clip.start).max(0.0);
                    let fallback = clip.speed.unwrap_or(1.0).clamp(0.25, 4.0);
                    let mut points: Vec<(f64, f64)> = clip
                        .speed_curve
                        .iter()
                        .filter(|point| point.position.is_finite() && point.speed.is_finite())
                        .map(|point| (point.position.clamp(0.0, 1.0), point.speed.clamp(0.25, 4.0)))
                        .collect();
                    points.sort_by(|a, b| a.0.total_cmp(&b.0));
                    if points.is_empty() {
                        source_duration / fallback
                    } else {
                        if points[0].0 > 0.0 {
                            points.insert(0, (0.0, fallback));
                        }
                        if points.last().is_some_and(|point| point.0 < 1.0) {
                            points.push((1.0, points.last().unwrap().1));
                        }
                        points
                            .windows(2)
                            .map(|window| {
                                let share = (window[1].0 - window[0].0).max(0.0);
                                let speed = ((window[0].1 + window[1].1) / 2.0).clamp(0.25, 4.0);
                                source_duration * share / speed
                            })
                            .sum()
                    }
                }
            })
            .sum();
        if duration > 0.0 {
            return duration;
        }
    }

    p.trim_duration
        .filter(|duration| duration.is_finite() && *duration > 0.0)
        .unwrap_or(source_duration.max(0.0))
}

fn validate_source_clip_ranges(p: &ProcessParams, source_duration: f64) -> Result<(), String> {
    if !source_duration.is_finite() || source_duration <= 0.0 {
        return Err("元動画の尺を確認できないため、KEEP区間を検証できません".to_string());
    }
    for (index, clip) in p.clips.as_deref().unwrap_or_default().iter().enumerate() {
        if clip.is_gap.unwrap_or(false) {
            if !clip.start.is_finite() || clip.start <= 0.0 {
                return Err(format!("Gap #{} の長さが不正です", index + 1));
            }
            continue;
        }
        if !clip.start.is_finite()
            || !clip.end.is_finite()
            || clip.start < 0.0
            || clip.end <= clip.start
            || clip.end > source_duration + 0.001
        {
            return Err(format!(
                "KEEP区間 #{} が元動画の範囲外です（{:.3}–{:.3}秒 / 元動画 {:.3}秒）",
                index + 1,
                clip.start,
                clip.end,
                source_duration
            ));
        }
    }
    Ok(())
}

fn is_filter_graph_failure(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    [
        "error parsing filter",
        "error parsing a filter",
        "no such filter",
        "filter not found",
        "error initializing complex filters",
        "error reinitializing filters",
        "failed to configure output pad",
        "error applying option",
        "option not found",
        "matches no streams",
        "does not contain any stream",
        "cannot find a matching stream",
        "stream specifier",
        "invalid file index",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
}

fn approx_eq(a: f64, b: f64) -> bool {
    (a - b).abs() <= 0.001
}

fn keyframe_bounds(property: &str) -> Option<(f64, f64)> {
    match property {
        "positionX" | "positionY" => Some((-1.0, 1.0)),
        "scale" => Some((0.1, 3.0)),
        "rotation" => Some((-180.0, 180.0)),
        "opacity" => Some((0.0, 1.0)),
        "volume" => Some((0.0, 2.0)),
        _ => None,
    }
}

fn validate_keyframes(keyframes: &[crate::ClipKeyframe], label: &str) -> Result<(), String> {
    for (index, keyframe) in keyframes.iter().enumerate() {
        let Some((minimum, maximum)) = keyframe_bounds(&keyframe.property) else {
            return Err(format!(
                "{label}のキーフレーム#{}に未対応プロパティがあります",
                index + 1
            ));
        };
        if !keyframe.time.is_finite() || keyframe.time < 0.0 || !keyframe.value.is_finite() {
            return Err(format!(
                "{label}のキーフレーム#{}に無効な数値があります",
                index + 1
            ));
        }
        if !(minimum..=maximum).contains(&keyframe.value) {
            return Err(format!(
                "{label}の{}キーフレーム値は{minimum}～{maximum}の範囲で指定してください",
                keyframe.property
            ));
        }
        if keyframe.interpolation != "linear" && keyframe.interpolation != "hold" {
            return Err(format!("{label}のキーフレーム補間方式が不正です"));
        }
    }
    Ok(())
}

fn validate_render_spec_params(p: &ProcessParams) -> Result<(), String> {
    for (index, clip) in p.clips.as_deref().unwrap_or_default().iter().enumerate() {
        validate_keyframes(&clip.keyframes, &format!("メインクリップ#{}", index + 1))?;
    }
    for (index, clip) in p
        .track_clips
        .as_deref()
        .unwrap_or_default()
        .iter()
        .enumerate()
    {
        validate_keyframes(&clip.keyframes, &format!("追加トラック#{}", index + 1))?;
    }
    let Some(spec) = p.render_spec.as_ref() else {
        return Ok(());
    };
    for (index, clip) in spec.sequence.clips.iter().enumerate() {
        validate_keyframes(
            &clip.keyframes,
            &format!("RenderSpecメインクリップ#{}", index + 1),
        )?;
    }
    for (index, clip) in spec.layers.track_clips.iter().enumerate() {
        validate_keyframes(
            &clip.keyframes,
            &format!("RenderSpec追加トラック#{}", index + 1),
        )?;
    }

    if spec.version != 1 && spec.version != 2 {
        return Err(format!("Unsupported RenderSpec version: {}", spec.version));
    }
    let canvas_valid = if spec.layout.kind == "source" {
        spec.canvas.width >= 2 && spec.canvas.height >= 2 && !spec.canvas.aspect.trim().is_empty()
    } else {
        spec.canvas.width == 1080 && spec.canvas.height == 1920 && spec.canvas.aspect == "9:16"
    };
    if !canvas_valid {
        return Err(format!(
            "RenderSpec canvas mismatch: {}x{} {}",
            spec.canvas.width, spec.canvas.height, spec.canvas.aspect
        ));
    }
    if spec.source.path != p.input_path {
        return Err("RenderSpec source.path does not match inputPath".to_string());
    }
    if spec.layout.kind != p.layout {
        return Err("RenderSpec layout.kind does not match layout".to_string());
    }
    if Some(spec.layout.game_y) != p.game_y {
        return Err("RenderSpec layout.gameY does not match gameY".to_string());
    }
    if !approx_eq(spec.layout.game_scale, p.game_scale.unwrap_or(1.0)) {
        return Err("RenderSpec layout.gameScale does not match gameScale".to_string());
    }
    if spec.layout.crop_data != p.crop_data {
        return Err("RenderSpec layout.cropData does not match cropData".to_string());
    }

    let process_clip_count = p.clips.as_ref().map_or(0, Vec::len);
    if spec.sequence.clips.len() != process_clip_count {
        return Err(format!(
            "RenderSpec sequence clip count ({}) does not match ProcessParams clips ({})",
            spec.sequence.clips.len(),
            process_clip_count
        ));
    }
    if let Some(process_clips) = p.clips.as_ref() {
        for (index, (spec_clip, process_clip)) in spec
            .sequence
            .clips
            .iter()
            .zip(process_clips.iter())
            .enumerate()
        {
            if spec_clip.is_gap.unwrap_or(false) != process_clip.is_gap.unwrap_or(false)
                || !approx_eq(spec_clip.media_start, process_clip.start)
                || !approx_eq(spec_clip.media_end, process_clip.end)
            {
                return Err(format!(
                    "RenderSpec clip #{} does not match ProcessParams clip",
                    index + 1
                ));
            }
        }
    }

    let spec_subtitle_count = spec
        .layers
        .subtitles
        .as_ref()
        .map_or(0, |subtitle| subtitle.segments.len());
    let process_subtitle_count = p
        .subtitle
        .as_ref()
        .and_then(|subtitle| subtitle.segments.as_ref())
        .map_or(0, Vec::len);
    if spec_subtitle_count != process_subtitle_count {
        return Err(format!(
            "RenderSpec subtitle count ({}) does not match ProcessParams subtitles ({})",
            spec_subtitle_count, process_subtitle_count
        ));
    }

    if let Some(spec_title) = spec.layers.title.as_ref() {
        let process_text = p.text.as_ref().ok_or_else(|| {
            "RenderSpec title exists but ProcessParams text is missing".to_string()
        })?;
        if process_text.content.as_deref().unwrap_or("") != spec_title.text
            || process_text.x.unwrap_or(540) != spec_title.x
            || process_text.y.unwrap_or(115) != spec_title.y
        {
            return Err("RenderSpec title does not match ProcessParams text".to_string());
        }
    } else if p
        .text
        .as_ref()
        .and_then(|text| text.content.as_deref())
        .is_some_and(|content| !content.is_empty())
    {
        return Err("ProcessParams text exists but RenderSpec title is empty".to_string());
    }

    if spec.layers.se.len() != p.se_slots.as_ref().map_or(0, Vec::len) {
        return Err("RenderSpec SE count does not match ProcessParams seSlots".to_string());
    }
    if spec.layers.images.len() != p.overlay_images.as_ref().map_or(0, Vec::len) {
        return Err(
            "RenderSpec image count does not match ProcessParams overlayImages".to_string(),
        );
    }
    if spec.layers.track_clips.len() != p.track_clips.as_ref().map_or(0, Vec::len) {
        return Err(
            "RenderSpec track clip count does not match ProcessParams trackClips".to_string(),
        );
    }

    Ok(())
}

fn normalize_process_params_from_render_spec(mut p: ProcessParams) -> ProcessParams {
    let Some(spec) = p.render_spec.clone() else {
        return p;
    };

    p.input_path = spec.source.path.clone();
    p.layout = spec.layout.kind.clone();
    p.crop_data = spec.layout.crop_data.clone();
    p.game_y = Some(spec.layout.game_y);
    p.game_scale = Some(spec.layout.game_scale);
    p.trim_start = None;
    p.trim_duration = None;
    p.clips = if spec.sequence.clips.is_empty() {
        None
    } else {
        Some(
            spec.sequence
                .clips
                .iter()
                .map(|clip| {
                    let transform = clip.transform.as_ref();
                    ClipParams {
                        is_gap: clip.is_gap,
                        start: clip.media_start,
                        end: clip.media_end,
                        speed: clip.speed,
                        volume: clip.volume,
                        muted: clip.muted,
                        position_x: transform.and_then(|value| value.position_x),
                        position_y: transform.and_then(|value| value.position_y),
                        scale: transform.and_then(|value| value.scale),
                        rotation: transform.and_then(|value| value.rotation),
                        flip_horizontal: transform.and_then(|value| value.flip_horizontal),
                        flip_vertical: transform.and_then(|value| value.flip_vertical),
                        opacity: transform.and_then(|value| value.opacity),
                        keyframes: clip.keyframes.clone(),
                        transition_in: clip.transition_in.clone(),
                        transition_out: clip.transition_out.clone(),
                        motion_preset: clip.motion_preset.clone(),
                        color: clip.color.clone(),
                        effects: clip.effects.clone(),
                        speed_curve: clip.speed_curve.clone(),
                        reverse: clip.reverse,
                        freeze_frame: clip.freeze_frame,
                        freeze_duration: clip.freeze_duration,
                        audio_effects: clip.audio_effects.clone(),
                    }
                })
                .collect(),
        )
    };

    p.text = spec.layers.title.as_ref().map(|title| TextParams {
        content: Some(title.text.clone()),
        x: Some(title.x),
        y: Some(title.y),
        font: Some(title.font.clone()),
        color: Some(title.color.clone()),
        size: Some(title.size),
        stroke_color: Some(title.stroke_color.clone()),
        stroke_width: Some(title.stroke_width),
        shadow_color: Some(title.shadow_color.clone()),
        shadow_blur: Some(title.shadow_blur),
        start_time: Some(title.start_time),
        end_time: title.end_time,
    });

    p.subtitle = spec
        .layers
        .subtitles
        .as_ref()
        .map(|subtitle| SubtitleParams {
            segments: Some(subtitle.segments.clone()),
            font: Some(subtitle.font.clone()),
            color: Some(subtitle.color.clone()),
            size: Some(subtitle.size),
            stroke_color: Some(subtitle.stroke_color.clone()),
            stroke_width: Some(subtitle.stroke_width),
            shadow_color: Some(subtitle.shadow_color.clone()),
            shadow_blur: Some(subtitle.shadow_blur),
            y: Some(subtitle.y),
            emphasis_mode: Some(subtitle.emphasis_mode.clone()),
            emphasis_color: Some(subtitle.emphasis_color.clone()),
        });

    p.avatar = spec.layers.avatar.as_ref().map(|avatar| AvatarParams {
        path: avatar.path.clone(),
        x: Some(avatar.x),
        y: Some(avatar.y),
        scale: Some(avatar.scale),
    });

    p.bgm = spec.layers.bgm.as_ref().map(|bgm| BgmParams {
        path: bgm.path.clone(),
        volume: Some(bgm.volume),
        start: Some(bgm.trim_start),
        timeline_start: Some(bgm.timeline_start),
        timeline_end: bgm.timeline_end,
    });

    p.se_slots = if spec.layers.se.is_empty() {
        None
    } else {
        Some(
            spec.layers
                .se
                .iter()
                .map(|se| SeParams {
                    path: se.path.clone(),
                    volume: Some(se.volume),
                    trigger_time: Some(se.trigger_time),
                })
                .collect(),
        )
    };

    p.overlay_images = if spec.layers.images.is_empty() {
        None
    } else {
        Some(
            spec.layers
                .images
                .iter()
                .map(|image| OverlayImageParams {
                    path: image.path.clone(),
                    x: Some((image.position.x * spec.canvas.width as f64).round() as u32),
                    y: Some((image.position.y * spec.canvas.height as f64).round() as u32),
                    scale: Some(image.scale),
                    start_time: Some(image.start_time),
                    end_time: Some(image.end_time),
                })
                .collect(),
        )
    };

    p.track_clips = if spec.layers.track_clips.is_empty() {
        None
    } else {
        Some(spec.layers.track_clips.clone())
    };

    p.ducking = if spec.audio.ducking.enabled {
        Some(DuckingParams {
            enabled: Some(true),
            preset: Some(spec.audio.ducking.preset.clone()),
            main_voice: Some(spec.audio.ducking.main_voice),
            bgm: Some(spec.audio.ducking.bgm),
            se: Some(spec.audio.ducking.se),
        })
    } else {
        None
    };

    p
}

// ============================================================
// Tauri コマンド
// ============================================================

#[tauri::command]
pub async fn get_video_info(
    app: tauri::AppHandle,
    input_path: String,
) -> Result<VideoInfo, String> {
    ensure_asset_path_allowed(&app, &input_path, "入力メディア")?;
    get_video_info_inner(&app, &input_path).await
}

#[tauri::command]
pub async fn process_video_v_focus(
    app: tauri::AppHandle,
    params: ProcessParams,
) -> Result<(), String> {
    log::info!("process_video_v_focus: input={}", params.input_path);
    validate_render_spec_params(&params)?;
    let mut params = normalize_process_params_from_render_spec(params);

    ensure_asset_path_allowed(&app, &params.input_path, "入力メディア")?;
    ensure_derived_output_path(&params.input_path, &params.output_path)?;
    if crate::license::process_uses_creator_features(&params) {
        crate::license::require_creator(&app)?;
    }

    if let Some(avatar) = params.avatar.as_ref() {
        ensure_asset_path_allowed(&app, &avatar.path, "アバター素材")?;
    }
    if let Some(bgm) = params.bgm.as_ref() {
        ensure_asset_path_allowed(&app, &bgm.path, "BGM素材")?;
    }
    if let Some(se_slots) = params.se_slots.as_ref() {
        for se in se_slots {
            ensure_asset_path_allowed(&app, &se.path, "効果音素材")?;
        }
    }
    if let Some(images) = params.overlay_images.as_ref() {
        for image in images {
            ensure_asset_path_allowed(&app, &image.path, "画像素材")?;
        }
    }
    if let Some(track_clips) = params.track_clips.as_ref() {
        for clip in track_clips {
            ensure_asset_path_allowed(&app, &clip.path, "追加トラック素材")?;
            if let Some(lut) = clip
                .color
                .as_ref()
                .and_then(|color| color.lut_path.as_deref())
            {
                ensure_asset_path_allowed(&app, lut, "LUT")?;
            }
        }
    }
    if let Some(clips) = params.clips.as_ref() {
        for clip in clips {
            if let Some(lut) = clip
                .color
                .as_ref()
                .and_then(|color| color.lut_path.as_deref())
            {
                ensure_asset_path_allowed(&app, lut, "LUT")?;
            }
        }
    }
    if let Some(text) = params.text.as_ref().and_then(|text| text.font.as_deref()) {
        crate::font::ensure_font_path_allowed(&app, text)?;
    }
    if let Some(font) = params
        .subtitle
        .as_ref()
        .and_then(|subtitle| subtitle.font.as_deref())
    {
        crate::font::ensure_font_path_allowed(&app, font)?;
    }

    if let Some(parent) = std::path::Path::new(&params.output_path).parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("出力ディレクトリの作成に失敗: {}", e))?;
        }
    }

    emit_progress(&app, "analyzing", 0.0, "動画情報を取得中...");
    let info = get_video_info_inner(&app, &params.input_path)
        .await
        .unwrap_or(VideoInfo {
            duration: 0.0,
            width: 1920,
            height: 1080,
            fps: 30.0,
            has_audio: false,
        });
    let missing_track_fps = params
        .track_clips
        .as_deref()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .filter(|(_, clip)| {
            clip.kind == "video"
                && clip
                    .source_fps
                    .is_none_or(|fps| !fps.is_finite() || fps < 1.0)
        })
        .map(|(index, clip)| (index, clip.path.clone()))
        .collect::<Vec<_>>();
    for (index, path) in missing_track_fps {
        let fps = match get_video_info_inner(&app, &path).await {
            Ok(track_info) => track_info.fps,
            Err(error) => {
                log::warn!(
                    "追加トラックのfpsを取得できないため30fpsを使用します ({}): {}",
                    path,
                    error
                );
                30.0
            }
        };
        if let Some(clip) = params
            .track_clips
            .as_mut()
            .and_then(|clips| clips.get_mut(index))
        {
            clip.source_fps = Some(fps);
        }
        if let Some(clip) = params
            .render_spec
            .as_mut()
            .and_then(|spec| spec.layers.track_clips.get_mut(index))
        {
            clip.source_fps = Some(fps);
        }
    }
    log::info!(
        "Video info: {}s, {}x{} @ {:.3}fps",
        info.duration,
        info.width,
        info.height,
        info.fps
    );
    validate_source_clip_ranges(&params, info.duration)?;
    if params.layout == "source" {
        // The native probe is authoritative for display rotation. This also
        // repairs stale project metadata from older versions of the app.
        params.output_width = info.width;
        params.output_height = info.height;
        params.output_fps = info.fps;
    }

    let progress_duration = expected_output_duration(&params, info.duration);
    log::info!(
        "Expected output duration for progress: {:.3}s",
        progress_duration
    );
    let output_transaction = RenderOutputTransaction::new(&params)?;
    let render_params = output_transaction.staged_params(&params);
    cleanup_generated_render_files(&render_params.output_path);

    let encoder = EncoderConfig::from_gpu_type(&params.gpu_type);
    let args = make_ffmpeg_args(
        &render_params,
        &encoder,
        info.has_audio,
        progress_duration,
        info.fps,
    )
    .inspect_err(|_| {
        cleanup_generated_render_files(&render_params.output_path);
    })?;
    let result = run_ffmpeg_with_progress(&app, args, progress_duration, "レンダリング中").await;
    cleanup_generated_render_files(&render_params.output_path);
    let result = validate_render_attempt(&app, &render_params, progress_duration, result).await;

    if result.is_ok() {
        output_transaction.commit()?;
        emit_progress(&app, "complete", 100.0, "処理完了！");
        return Ok(());
    }

    let err1 = result.unwrap_err();
    log::warn!("First attempt failed: {}", err1);

    // フィルター構文や未搭載フィルターはエンコーダを変えても直らない。
    // 同じ失敗を3回繰り返して「H.264失敗」と誤表示しない。
    if is_filter_graph_failure(&err1) {
        return Err(format!(
            "書き出しフィルターの処理に失敗しました。アプリを再起動して再度お試しください。\n{}",
            err1
        ));
    }

    let mut fallback_errors = vec![format!("{}: {}", encoder.codec, err1)];

    if encoder.codec != "h264_mf" {
        emit_progress(
            &app,
            "rendering",
            0.0,
            "エンコード失敗、Windows標準H.264へフォールバック中...",
        );
        let cpu = EncoderConfig::cpu_fallback();
        let cpu_args = make_ffmpeg_args(
            &render_params,
            &cpu,
            info.has_audio,
            progress_duration,
            info.fps,
        )
        .inspect_err(|_| {
            cleanup_generated_render_files(&render_params.output_path);
        })?;
        let result_cpu = run_ffmpeg_with_progress(
            &app,
            cpu_args,
            progress_duration,
            "レンダリング中 (Windows H.264)",
        )
        .await;
        cleanup_generated_render_files(&render_params.output_path);
        let result_cpu =
            validate_render_attempt(&app, &render_params, progress_duration, result_cpu).await;

        if result_cpu.is_ok() {
            output_transaction.commit()?;
            emit_progress(&app, "complete", 100.0, "処理完了！ (CPUフォールバック)");
            return Ok(());
        }

        let err2 = result_cpu.unwrap_err();
        log::warn!("Media Foundation fallback failed: {}", err2);
        fallback_errors.push(format!("h264_mf: {}", err2));
    }

    if encoder.codec != "libopenh264" {
        emit_progress(
            &app,
            "rendering",
            0.0,
            "Windows標準H.264失敗、ソフトウェア変換へフォールバック中...",
        );
        let software = EncoderConfig::software_fallback();
        let software_args = make_ffmpeg_args(
            &render_params,
            &software,
            info.has_audio,
            progress_duration,
            info.fps,
        )
        .inspect_err(|_| {
            cleanup_generated_render_files(&render_params.output_path);
        })?;
        let result_software = run_ffmpeg_with_progress(
            &app,
            software_args,
            progress_duration,
            "レンダリング中 (ソフトウェア)",
        )
        .await;
        cleanup_generated_render_files(&render_params.output_path);
        let result_software =
            validate_render_attempt(&app, &render_params, progress_duration, result_software).await;

        if result_software.is_ok() {
            output_transaction.commit()?;
            emit_progress(
                &app,
                "complete",
                100.0,
                "処理完了！ (ソフトウェアフォールバック)",
            );
            return Ok(());
        }

        let err3 = result_software.unwrap_err();
        log::error!("Software fallback failed: {}", err3);
        fallback_errors.push(format!("libopenh264: {}", err3));
    }

    Err(format!(
        "すべてのH.264エンコーダが失敗しました:\n{}",
        fallback_errors.join("\n")
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        build_render_execution_plan, cleanup_generated_render_files, expected_output_duration,
        generated_ass_path, generated_filter_script_path, is_filter_graph_failure,
        make_ffmpeg_args, media_proxy_args, media_proxy_file_name,
        normalize_process_params_from_render_spec, parse_render_progress, png_backup_prefix,
        probe_contains_video_stream, remove_failed_render_output, restore_png_backups,
        validate_png_sequence, validate_render_spec_params, validate_source_clip_ranges,
        write_png_transaction_state, OutputPathLock, PngTransactionJournal,
        RenderOutputTransaction,
    };
    use crate::ffmpeg::encoder::EncoderConfig;
    use crate::ProcessParams;
    use serde_json::json;
    use std::path::PathBuf;

    fn filter_script_contents(args: &[String]) -> String {
        let path = args
            .windows(2)
            .find_map(|pair| (pair[0] == "-/filter_complex").then(|| pair[1].as_str()))
            .expect("filter script argument missing");
        std::fs::read_to_string(path).expect("filter script missing")
    }

    fn process_params_json() -> serde_json::Value {
        let output_path =
            std::env::temp_dir().join(format!("tateclip-test-output-{}.mp4", uuid::Uuid::new_v4()));
        json!({
            "inputPath": "C:\\videos\\source.mp4",
            "outputPath": output_path.to_string_lossy(),
            "renderSpec": {
                "version": 1,
                "canvas": {
                    "width": 1080,
                    "height": 1920,
                    "aspect": "9:16"
                },
                "source": {
                    "path": "C:\\videos\\source.mp4",
                    "duration": 120.0,
                    "width": 1920,
                    "height": 1080
                },
                "sequence": {
                    "clips": [
                        {
                            "id": "clip1",
                            "mediaStart": 10.0,
                            "mediaEnd": 20.0,
                            "label": "A"
                        }
                    ]
                },
                "layout": {
                    "kind": "commentary",
                    "gameY": 653,
                    "gameScale": 1.0,
                    "cropData": "0.0,100,50,400,700"
                },
                "layers": {
                    "title": {
                        "text": "Title",
                        "x": 540,
                        "y": 115,
                        "font": "Arial",
                        "color": "#FFFFFF",
                        "size": 44,
                        "strokeColor": "#000000",
                        "strokeWidth": 3,
                        "shadowColor": "rgba(0,0,0,0.5)",
                        "shadowBlur": 0
                    },
                    "subtitles": {
                        "segments": [
                            {
                                "id": "sub1",
                                "text": "hello",
                                "startTime": 2.0,
                                "endTime": 3.5,
                                "emotion": "neutral"
                            }
                        ],
                        "font": "Arial",
                        "color": "#FFFFFF",
                        "size": 40,
                        "strokeColor": "#000000",
                        "strokeWidth": 4,
                        "shadowColor": "rgba(0,0,0,0.5)",
                        "shadowBlur": 2,
                        "y": 0.9
                    },
                    "avatar": null,
                    "bgm": null,
                    "se": [],
                    "images": []
                },
                "audio": {
                    "ducking": {
                        "enabled": false,
                        "preset": "standard",
                        "mainVoice": 1.0,
                        "bgm": 0.15,
                        "se": 1.0
                    }
                }
            },
            "gpuType": "CPU",
            "layout": "commentary",
            "cropData": "0.0,100,50,400,700",
            "clips": [
                {
                    "isGap": false,
                    "start": 10.0,
                    "end": 20.0
                }
            ],
            "gameY": 653,
            "gameScale": 1.0,
            "text": {
                "content": "Title",
                "x": 540,
                "y": 115,
                "font": "Arial",
                "color": "#FFFFFF",
                "size": 44,
                "strokeColor": "#000000",
                "strokeWidth": 3,
                "shadowColor": "rgba(0,0,0,0.5)",
                "shadowBlur": 0
            },
            "subtitle": {
                "segments": [
                    {
                        "id": "sub1",
                        "text": "hello",
                        "startTime": 2.0,
                        "endTime": 3.5,
                        "emotion": "neutral"
                    }
                ],
                "font": "Arial",
                "color": "#FFFFFF",
                "size": 40,
                "strokeColor": "#000000",
                "strokeWidth": 4,
                "shadowColor": "rgba(0,0,0,0.5)",
                "shadowBlur": 2,
                "y": 0.9
            }
        })
    }

    #[test]
    fn render_progress_uses_sequence_duration_instead_of_source_duration() {
        let params: ProcessParams = serde_json::from_value(process_params_json()).unwrap();
        let normalized = normalize_process_params_from_render_spec(params);
        assert_eq!(expected_output_duration(&normalized, 120.0), 10.0);
    }

    #[test]
    fn expected_duration_accounts_for_speed_and_freeze() {
        let mut value = process_params_json();
        value["renderSpec"] = serde_json::Value::Null;
        value["clips"] = json!([
            { "start": 0.0, "end": 8.0, "speed": 2.0 },
            { "start": 8.0, "end": 12.0, "freezeFrame": 10.0, "freezeDuration": 3.0 }
        ]);
        let params: ProcessParams = serde_json::from_value(value.clone()).unwrap();
        assert!((expected_output_duration(&params, 120.0) - 7.0).abs() < 0.001);
    }

    #[test]
    fn source_clip_ranges_must_be_finite_and_inside_the_probed_duration() {
        let mut value = process_params_json();
        value["renderSpec"] = serde_json::Value::Null;
        value["clips"] = json!([{ "start": 90.0, "end": 121.0 }]);
        let params: ProcessParams = serde_json::from_value(value.clone()).unwrap();
        assert!(validate_source_clip_ranges(&params, 120.0).is_err());

        value["clips"] = json!([{ "start": 90.0, "end": 120.0 }]);
        let params: ProcessParams = serde_json::from_value(value).unwrap();
        assert!(validate_source_clip_ranges(&params, 120.0).is_ok());
    }

    #[test]
    fn all_layouts_use_the_shared_advanced_compositor() {
        for layout in ["commentary", "portrait", "stage"] {
            let mut value = process_params_json();
            value["layout"] = json!(layout);
            value["renderSpec"]["layout"]["kind"] = json!(layout);
            value["renderSpec"]["sequence"]["clips"][0]["motionPreset"] = json!("pop");
            value["renderSpec"]["sequence"]["clips"][0]["color"] = json!({ "brightness": 5.0 });
            value["renderSpec"]["sequence"]["clips"][0]["effects"] = json!({ "noise": 12.0 });
            let params: ProcessParams = serde_json::from_value(value).unwrap();
            let args = make_ffmpeg_args(&params, &EncoderConfig::cpu_fallback(), true, 10.0, 30.0)
                .unwrap();
            let filter = filter_script_contents(&args);
            assert!(filter.contains("drawtext"), "title missing for {layout}");
            assert!(filter.contains("ass='"), "subtitles missing for {layout}");
            assert!(filter.contains("curves=all="), "color missing for {layout}");
            assert!(
                filter.contains("noise=alls="),
                "effect missing for {layout}"
            );
            assert!(filter.contains("exp(-3.2"), "motion missing for {layout}");
            match layout {
                "portrait" => assert!(filter.contains("crop=ih*(9/16)")),
                "stage" => assert!(filter.contains("crop=ih*(3/4)")),
                _ => assert!(filter.contains("crop=ih*(16/9)")),
            }
            cleanup_generated_render_files(&params.output_path);
        }
    }

    #[test]
    fn smoke_all_layouts_with_silent_video_and_audio_when_configured() {
        let (Some(video_path), Some(audio_path)) = (
            std::env::var_os("TATECLIP_LAYOUT_SMOKE_VIDEO"),
            std::env::var_os("TATECLIP_LAYOUT_SMOKE_AUDIO"),
        ) else {
            return;
        };
        let ffmpeg_path =
            std::env::var_os("TATECLIP_NLE_SMOKE_FFMPEG").unwrap_or_else(|| "ffmpeg".into());

        for layout in ["commentary", "portrait", "stage"] {
            let output_path = std::env::temp_dir().join(format!(
                "tateclip-layout-smoke-{layout}-{}.mp4",
                uuid::Uuid::new_v4()
            ));
            let mut value = process_params_json();
            value["inputPath"] = json!(video_path.to_string_lossy());
            value["outputPath"] = json!(output_path.to_string_lossy());
            value["renderSpec"] = serde_json::Value::Null;
            value["layout"] = json!(layout);
            value["cropData"] = serde_json::Value::Null;
            value["clips"] = json!([{
                "isGap": false,
                "start": 0.0,
                "end": 2.0,
                "motionPreset": "pop",
                "color": { "brightness": 4.0 },
                "effects": { "noise": 3.0 }
            }]);
            value["subtitle"] = serde_json::Value::Null;
            value["bgm"] = json!({
                "path": audio_path.to_string_lossy(),
                "volume": 0.5,
                "start": 0.0,
                "timelineStart": 0.0,
                "timelineEnd": 2.0
            });
            value["outputWidth"] = json!(360);
            value["outputHeight"] = json!(640);
            value["outputFps"] = json!(24.0);
            value["videoBitrateKbps"] = json!(1_500);
            let params: ProcessParams = serde_json::from_value(value).unwrap();
            let args = make_ffmpeg_args(
                &params,
                &EncoderConfig::software_fallback(),
                false,
                2.0,
                30.0,
            )
            .unwrap();

            let output = std::process::Command::new(&ffmpeg_path)
                .args(&args)
                .output()
                .expect("failed to launch layout smoke FFmpeg");
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(
                output.status.success(),
                "{layout} layout smoke failed: {stderr}"
            );
            assert!(
                std::fs::metadata(&output_path)
                    .map(|value| value.len())
                    .unwrap_or(0)
                    > 10_000,
                "{layout} layout output is missing or too small"
            );

            let probe = std::process::Command::new(&ffmpeg_path)
                .args(["-hide_banner", "-i"])
                .arg(&output_path)
                .output()
                .expect("failed to probe layout smoke output");
            let probe_text = String::from_utf8_lossy(&probe.stderr);
            assert!(probe_contains_video_stream(&probe_text));
            assert!(probe_text
                .lines()
                .any(|line| line.contains("Stream #") && line.contains("Audio:")));

            let decode = std::process::Command::new(&ffmpeg_path)
                .args(["-v", "error", "-i"])
                .arg(&output_path)
                .args(["-map", "0:v:0", "-an", "-f", "null", "-"])
                .output()
                .expect("failed to decode layout smoke output");
            assert!(
                decode.status.success(),
                "{layout} output did not decode completely: {}",
                String::from_utf8_lossy(&decode.stderr)
            );

            cleanup_generated_render_files(&params.output_path);
            let _ = std::fs::remove_file(output_path);
        }
    }

    #[test]
    fn generated_ass_is_a_temp_file_not_an_output_sidecar() {
        let path = generated_ass_path("C:\\videos\\clip.mp4");
        assert!(path.ends_with(".ass"));
        assert!(!path.ends_with("clip.mp4.ass"));
    }

    #[test]
    fn large_rough_cut_uses_a_filter_script_instead_of_the_windows_command_line() {
        let output_path =
            std::env::temp_dir().join(format!("tateclip-many-keeps-{}.mp4", uuid::Uuid::new_v4()));
        let mut value = process_params_json();
        value["renderSpec"] = serde_json::Value::Null;
        value["layout"] = json!("source");
        value["outputPath"] = json!(output_path.to_string_lossy());
        value["subtitle"] = serde_json::Value::Null;
        value["clips"] = json!((0..120)
            .map(|index| json!({ "start": index as f64 * 2.0, "end": index as f64 * 2.0 + 1.0 }))
            .collect::<Vec<_>>());
        let params: ProcessParams = serde_json::from_value(value).unwrap();

        let args =
            make_ffmpeg_args(&params, &EncoderConfig::cpu_fallback(), true, 120.0, 30.0).unwrap();
        assert!(!args.iter().any(|arg| arg == "-filter_complex"));
        assert!(args.iter().all(|arg| arg.len() < 4096));
        let filter = filter_script_contents(&args);
        assert!(
            filter.len() > 32_767,
            "test graph was only {} bytes",
            filter.len()
        );
        assert!(std::path::Path::new(&generated_filter_script_path(&params.output_path)).exists());

        cleanup_generated_render_files(&params.output_path);
        assert!(!std::path::Path::new(&generated_filter_script_path(&params.output_path)).exists());
    }

    #[test]
    fn smoke_source_process_args_with_real_video_when_configured() {
        let Some(video_path) = std::env::var_os("TATECLIP_ROUGH_CUT_SMOKE_VIDEO") else {
            return;
        };
        let ffmpeg_path =
            std::env::var_os("TATECLIP_NLE_SMOKE_FFMPEG").unwrap_or_else(|| "ffmpeg".into());
        let output_path = std::env::temp_dir().join(format!(
            "tateclip-process-rough-cut-smoke-{}.mp4",
            uuid::Uuid::new_v4()
        ));
        let mut value = process_params_json();
        value["inputPath"] = json!(video_path.to_string_lossy());
        value["outputPath"] = json!(output_path.to_string_lossy());
        value["renderSpec"] = serde_json::Value::Null;
        value["layout"] = json!("source");
        value["subtitle"] = serde_json::Value::Null;
        value["clips"] = json!([
            { "start": 0.0, "end": 2.0 },
            { "start": 4.0, "end": 6.0 }
        ]);
        value["outputWidth"] = json!(1920);
        value["outputHeight"] = json!(1080);
        value["outputFps"] = json!(30.0);
        value["videoBitrateKbps"] = json!(3_000);
        let params: ProcessParams = serde_json::from_value(value).unwrap();
        let args = make_ffmpeg_args(
            &params,
            &EncoderConfig::software_fallback(),
            true,
            4.0,
            30.0,
        )
        .unwrap();
        assert!(args.iter().any(|arg| arg == "-/filter_complex"));

        let output = std::process::Command::new(&ffmpeg_path)
            .args(&args)
            .output()
            .expect("failed to launch process-args rough-cut FFmpeg");
        let stderr = String::from_utf8_lossy(&output.stderr);
        cleanup_generated_render_files(&params.output_path);
        assert!(
            output.status.success(),
            "process-args rough-cut smoke failed: {stderr}"
        );
        assert!(
            std::fs::metadata(&output_path)
                .map(|value| value.len())
                .unwrap_or(0)
                > 10_000,
            "process-args rough-cut output is missing or too small"
        );
        let _ = std::fs::remove_file(output_path);
    }

    #[test]
    fn media_proxy_name_changes_when_source_revision_changes() {
        let path = std::path::Path::new("C:\\videos\\source.mp4");
        let first = media_proxy_file_name(path, 1_000, 100);
        let same = media_proxy_file_name(path, 1_000, 100);
        let changed = media_proxy_file_name(path, 1_001, 100);

        assert_eq!(first, same);
        assert_ne!(first, changed);
        assert!(first.starts_with("tateclip-proxy-"));
        assert!(first.ends_with(".mp4"));
    }

    #[test]
    fn media_proxy_args_create_video_and_optional_audio_preview() {
        let args = media_proxy_args(
            "C:\\videos\\source.mp4",
            std::path::Path::new("C:\\cache\\proxy.mp4"),
        );

        assert!(args.windows(2).any(|pair| pair == ["-map", "0:v:0"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "0:a?"]));
        assert!(args.windows(2).any(|pair| pair == ["-c:v", "libopenh264"]));
        assert!(args.iter().any(|arg| arg.contains("scale=960:540")));
        assert_eq!(args.last().unwrap(), "C:\\cache\\proxy.mp4");
    }

    #[test]
    fn rendered_output_probe_requires_a_video_stream() {
        let video_and_audio = "\
Stream #0:0: Video: h264, yuv420p, 1080x1920, 60 fps\n\
Stream #0:1: Audio: aac, 48000 Hz, stereo";
        let audio_only = "Stream #0:0: Audio: aac, 48000 Hz, stereo";

        assert!(probe_contains_video_stream(video_and_audio));
        assert!(!probe_contains_video_stream(audio_only));
    }

    #[test]
    fn failed_render_output_is_removed_immediately() {
        let path = std::env::temp_dir().join(format!(
            "vfocus-invalid-render-{}.mp4",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, b"audio-only-or-partial").unwrap();

        let mut params: ProcessParams = serde_json::from_value(process_params_json()).unwrap();
        params.output_path = path.to_string_lossy().into_owned();
        remove_failed_render_output(&params);

        assert!(!path.exists());
    }

    #[test]
    fn png_sequence_validation_and_cleanup_cover_the_whole_exact_sequence() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-png-sequence-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let pattern = directory.join("clip_%05d.png");
        let first = directory.join("clip_00001.png");
        let second = directory.join("clip_00002.png");
        let unrelated = directory.join("other_00001.png");
        let fake_png = |fill: u8| {
            let mut bytes = vec![fill; 128];
            bytes[..8].copy_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);
            bytes[12..16].copy_from_slice(b"IHDR");
            bytes[16..20].copy_from_slice(&1_u32.to_be_bytes());
            bytes[20..24].copy_from_slice(&1_u32.to_be_bytes());
            bytes
        };
        std::fs::write(&first, fake_png(1)).unwrap();
        std::fs::write(&second, fake_png(2)).unwrap();
        std::fs::write(&unrelated, vec![3_u8; 128]).unwrap();

        validate_png_sequence(&pattern.to_string_lossy(), 2.0, 1.0).unwrap();
        std::fs::write(&second, vec![9_u8; 128]).unwrap();
        assert!(validate_png_sequence(&pattern.to_string_lossy(), 2.0, 1.0)
            .unwrap_err()
            .contains("画像ヘッダーが不正"));
        std::fs::write(&second, fake_png(2)).unwrap();

        let mut params: ProcessParams = serde_json::from_value(process_params_json()).unwrap();
        params.render_spec = None;
        params.export_format = "png_sequence".to_string();
        params.output_path = pattern.to_string_lossy().into_owned();
        remove_failed_render_output(&params);

        assert!(!first.exists());
        assert!(!second.exists());
        assert!(unrelated.exists());
        std::fs::remove_file(unrelated).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn failed_staged_render_preserves_previous_successful_output() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-render-transaction-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let output = directory.join("clip_tateclip.mp4");
        std::fs::write(&output, b"previous-success").unwrap();
        let mut params: ProcessParams = serde_json::from_value(process_params_json()).unwrap();
        params.output_path = output.to_string_lossy().into_owned();

        let failed = RenderOutputTransaction::new(&params).unwrap();
        let failed_params = failed.staged_params(&params);
        std::fs::write(&failed_params.output_path, b"partial").unwrap();
        remove_failed_render_output(&failed_params);
        drop(failed);
        assert_eq!(std::fs::read(&output).unwrap(), b"previous-success");

        let successful = RenderOutputTransaction::new(&params).unwrap();
        let successful_params = successful.staged_params(&params);
        std::fs::write(&successful_params.output_path, b"validated-new-output").unwrap();
        successful.commit().unwrap();
        assert_eq!(std::fs::read(&output).unwrap(), b"validated-new-output");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn committed_png_sequence_removes_old_tail_without_touching_unrelated_files() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-png-transaction-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let pattern = directory.join("clip_tateclip_%05d.png");
        let unrelated = directory.join("keep.png");
        for index in 1..=3 {
            std::fs::write(
                directory.join(format!("clip_tateclip_{index:05}.png")),
                format!("old-{index}"),
            )
            .unwrap();
        }
        std::fs::write(&unrelated, b"keep").unwrap();

        let mut params: ProcessParams = serde_json::from_value(process_params_json()).unwrap();
        params.render_spec = None;
        params.export_format = "png_sequence".to_string();
        params.output_path = pattern.to_string_lossy().into_owned();
        let transaction = RenderOutputTransaction::new(&params).unwrap();
        let staged = transaction.staged_params(&params);
        let staged_path = PathBuf::from(&staged.output_path);
        let staged_parent = staged_path.parent().unwrap();
        std::fs::write(staged_parent.join("clip_tateclip_00001.png"), b"new-1").unwrap();
        std::fs::write(staged_parent.join("clip_tateclip_00002.png"), b"new-2").unwrap();

        transaction.commit().unwrap();

        assert_eq!(
            std::fs::read(directory.join("clip_tateclip_00001.png")).unwrap(),
            b"new-1"
        );
        assert_eq!(
            std::fs::read(directory.join("clip_tateclip_00002.png")).unwrap(),
            b"new-2"
        );
        assert!(!directory.join("clip_tateclip_00003.png").exists());
        assert_eq!(std::fs::read(&unrelated).unwrap(), b"keep");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn committed_png_sequence_matches_existing_windows_names_case_insensitively() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-png-case-transaction-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        for index in 1..=3 {
            std::fs::write(
                directory.join(format!("CLIP_TATECLIP_{index:05}.PNG")),
                format!("old-{index}"),
            )
            .unwrap();
        }

        let mut params: ProcessParams = serde_json::from_value(process_params_json()).unwrap();
        params.render_spec = None;
        params.export_format = "png_sequence".to_string();
        params.output_path = directory
            .join("clip_tateclip_%05d.png")
            .to_string_lossy()
            .into_owned();
        let transaction = RenderOutputTransaction::new(&params).unwrap();
        let staged = transaction.staged_params(&params);
        let staged_parent = PathBuf::from(&staged.output_path)
            .parent()
            .unwrap()
            .to_path_buf();
        std::fs::write(staged_parent.join("clip_tateclip_00001.png"), b"new-1").unwrap();
        std::fs::write(staged_parent.join("clip_tateclip_00002.png"), b"new-2").unwrap();

        transaction.commit().unwrap();

        assert_eq!(
            std::fs::read(directory.join("clip_tateclip_00001.png")).unwrap(),
            b"new-1"
        );
        assert_eq!(
            std::fs::read(directory.join("clip_tateclip_00002.png")).unwrap(),
            b"new-2"
        );
        assert!(!directory.join("CLIP_TATECLIP_00003.PNG").exists());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn render_transaction_rejects_a_concurrent_writer_for_the_same_output() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-render-lock-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let output = directory.join("clip_tateclip.mp4");
        let mut params: ProcessParams = serde_json::from_value(process_params_json()).unwrap();
        params.output_path = output.to_string_lossy().into_owned();

        let first = RenderOutputTransaction::new(&params).unwrap();
        let error = RenderOutputTransaction::new(&params).err().unwrap();
        assert!(error.contains("別のTateClipで使用中"));
        #[cfg(windows)]
        {
            let mut differently_cased = params.clone();
            differently_cased.output_path = directory
                .join("CLIP_TATECLIP.MP4")
                .to_string_lossy()
                .into_owned();
            let case_error = RenderOutputTransaction::new(&differently_cased)
                .err()
                .unwrap();
            assert!(case_error.contains("別のTateClipで使用中"));
        }
        drop(first);
        let after_release = RenderOutputTransaction::new(&params).unwrap();
        drop(after_release);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_png_restore_keeps_the_only_backup() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-png-restore-test-{}",
            uuid::Uuid::new_v4()
        ));
        let backup_directory = directory.join("backup");
        let original = directory.join("clip_tateclip_00001.png");
        std::fs::create_dir_all(&backup_directory).unwrap();
        std::fs::create_dir_all(&original).unwrap();
        let backup = backup_directory.join("clip_tateclip_00001.png");
        std::fs::write(&backup, b"only-backup").unwrap();

        let error = restore_png_backups(&[(backup.clone(), original.clone())]).unwrap_err();
        assert!(error.contains("clip_tateclip_00001.png"));
        assert_eq!(std::fs::read(&backup).unwrap(), b"only-backup");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn interrupted_png_install_is_rolled_back_before_the_next_render() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-png-recovery-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let pattern = directory.join("clip_tateclip_%05d.png");
        let first = directory.join("clip_tateclip_00001.png");
        let second = directory.join("clip_tateclip_00002.png");
        let (lock, lock_key) = OutputPathLock::acquire(&pattern).unwrap();
        drop(lock);
        let backup_directory = directory.join(format!(
            "{}{}",
            png_backup_prefix(&lock_key),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&backup_directory).unwrap();
        write_png_transaction_state(
            &backup_directory,
            &PngTransactionJournal {
                state: "installing".to_string(),
                old_files: vec![
                    "clip_tateclip_00001.png".to_string(),
                    "clip_tateclip_00002.png".to_string(),
                ],
                installed_files: vec!["clip_tateclip_00001.png".to_string()],
            },
        )
        .unwrap();
        std::fs::write(
            backup_directory.join("clip_tateclip_00001.png"),
            b"previous-1",
        )
        .unwrap();
        std::fs::write(
            backup_directory.join("clip_tateclip_00002.png"),
            b"previous-2",
        )
        .unwrap();
        std::fs::write(&first, b"partial-new").unwrap();

        let mut params: ProcessParams = serde_json::from_value(process_params_json()).unwrap();
        params.render_spec = None;
        params.export_format = "png_sequence".to_string();
        params.output_path = pattern.to_string_lossy().into_owned();
        let transaction = RenderOutputTransaction::new(&params).unwrap();

        assert_eq!(std::fs::read(&first).unwrap(), b"previous-1");
        assert_eq!(std::fs::read(&second).unwrap(), b"previous-2");
        assert!(!backup_directory.exists());
        drop(transaction);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn interrupted_install_recovery_preserves_already_restored_old_frames() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-png-partial-rollback-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let pattern = directory.join("clip_tateclip_%05d.png");
        let first = directory.join("clip_tateclip_00001.png");
        let second = directory.join("clip_tateclip_00002.png");
        let third = directory.join("clip_tateclip_00003.png");
        let (lock, lock_key) = OutputPathLock::acquire(&pattern).unwrap();
        drop(lock);
        let backup_directory = directory.join(format!(
            "{}{}",
            png_backup_prefix(&lock_key),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&backup_directory).unwrap();
        write_png_transaction_state(
            &backup_directory,
            &PngTransactionJournal {
                state: "installing".to_string(),
                old_files: vec![
                    "clip_tateclip_00001.png".to_string(),
                    "clip_tateclip_00002.png".to_string(),
                ],
                installed_files: vec![],
            },
        )
        .unwrap();
        std::fs::write(&first, b"already-restored-old-1").unwrap();
        std::fs::write(&second, b"new-2").unwrap();
        std::fs::write(&third, b"new-only-3").unwrap();
        std::fs::write(backup_directory.join("clip_tateclip_00002.png"), b"old-2").unwrap();

        let mut params: ProcessParams = serde_json::from_value(process_params_json()).unwrap();
        params.render_spec = None;
        params.export_format = "png_sequence".to_string();
        params.output_path = pattern.to_string_lossy().into_owned();
        let transaction = RenderOutputTransaction::new(&params).unwrap();

        assert_eq!(std::fs::read(&first).unwrap(), b"already-restored-old-1");
        assert_eq!(std::fs::read(&second).unwrap(), b"old-2");
        assert!(!third.exists());
        assert!(!backup_directory.exists());
        drop(transaction);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn structured_decode_progress_reports_final_duration_and_frames() {
        let (frames, seconds, ended) = parse_render_progress(
            "frame=1\nout_time_us=33333\nprogress=continue\nframe=300\nout_time_us=10000000\nprogress=end\n",
        );
        assert_eq!(frames, 300);
        assert!((seconds - 10.0).abs() < 0.001);
        assert!(ended);
    }

    #[test]
    fn render_spec_consistency_validation_accepts_matching_params() {
        let params: ProcessParams = serde_json::from_value(process_params_json()).unwrap();
        validate_render_spec_params(&params).unwrap();
    }

    #[test]
    fn render_spec_validation_accepts_source_aspect_canvas() {
        let mut value = process_params_json();
        value["layout"] = json!("source");
        value["renderSpec"]["layout"]["kind"] = json!("source");
        value["renderSpec"]["canvas"] = json!({
            "width": 3840,
            "height": 2160,
            "aspect": "3840:2160"
        });
        let params: ProcessParams = serde_json::from_value(value).unwrap();
        validate_render_spec_params(&params).unwrap();
    }

    #[test]
    fn filter_graph_failure_is_not_reported_as_encoder_failure() {
        assert!(is_filter_graph_failure(
            "[AVFilterGraph] No such filter: 'boxblur'\nError parsing filterchain"
        ));
        assert!(is_filter_graph_failure(
            "[AVFilterGraph] Error parsing a filter description around: [bg]"
        ));
        assert!(is_filter_graph_failure(
            "Error applying option 'start_t' to filter 'trim': Option not found"
        ));
        assert!(is_filter_graph_failure(
            "Stream specifier ':a' in filtergraph description matches no streams"
        ));
        assert!(!is_filter_graph_failure(
            "[h264_amf] AMF failed to initialise encoder"
        ));
    }

    #[test]
    fn render_spec_validation_rejects_out_of_range_keyframe_values() {
        let mut value = process_params_json();
        value["renderSpec"]["sequence"]["clips"][0]["keyframes"] = json!([{
            "id": "bad-scale",
            "time": 0.0,
            "property": "scale",
            "value": 0.0,
            "interpolation": "linear"
        }]);
        let params: ProcessParams = serde_json::from_value(value).unwrap();
        let error = validate_render_spec_params(&params).unwrap_err();
        assert!(error.contains("scale"));
        assert!(error.contains("0.1"));
    }

    #[test]
    fn render_spec_consistency_validation_rejects_mismatched_clip() {
        let mut value = process_params_json();
        value["clips"][0]["end"] = json!(22.0);
        let params: ProcessParams = serde_json::from_value(value).unwrap();
        let err = validate_render_spec_params(&params).unwrap_err();
        assert!(err.contains("clip #1"));
    }

    #[test]
    fn render_spec_consistency_validation_rejects_mismatched_crop_data() {
        let mut value = process_params_json();
        value["cropData"] = json!("0.0,1,2,3,4");
        let params: ProcessParams = serde_json::from_value(value).unwrap();
        let err = validate_render_spec_params(&params).unwrap_err();
        assert!(err.contains("cropData"));
    }

    #[test]
    fn render_spec_normalization_prefers_render_spec_values() {
        let mut value = process_params_json();
        value["text"]["color"] = json!("#000000");
        value["text"]["font"] = json!("Impact");

        let params: ProcessParams = serde_json::from_value(value).unwrap();
        validate_render_spec_params(&params).unwrap();

        let normalized = normalize_process_params_from_render_spec(params);
        let text = normalized.text.unwrap();
        assert_eq!(text.color.unwrap(), "#FFFFFF");
        assert_eq!(text.font.unwrap(), "Arial");
        assert_eq!(normalized.clips.unwrap()[0].start, 10.0);
        assert_eq!(normalized.crop_data.unwrap(), "0.0,100,50,400,700");
    }

    #[test]
    fn render_execution_plan_and_ffmpeg_args_prefer_render_spec_layers() {
        let mut value = process_params_json();
        value["renderSpec"]["layers"]["subtitles"] = json!(null);
        value["subtitle"] = json!(null);
        value["renderSpec"]["layers"]["title"]["text"] = json!("Spec Title");
        value["renderSpec"]["layers"]["title"]["color"] = json!("#FFD700");
        value["text"]["content"] = json!("Legacy Title");
        value["text"]["color"] = json!("#000000");
        value["renderSpec"]["layers"]["bgm"] = json!({
            "path": "C:\\audio\\spec-bgm.mp3",
            "volume": 0.25,
            "timelineStart": 2.0,
            "timelineEnd": 6.0,
            "trimStart": 4.0
        });
        value["bgm"] = json!({
            "path": "C:\\audio\\legacy-bgm.mp3",
            "volume": 0.9,
            "start": 9.0
        });
        value["renderSpec"]["layers"]["images"] = json!([
            {
                "id": "img1",
                "path": "C:\\images\\spec.png",
                "position": { "x": 0.25, "y": 0.5 },
                "scale": 0.4,
                "startTime": 1.0,
                "endTime": 2.0,
                "label": null,
                "linkedClipId": null
            }
        ]);
        value["overlayImages"] = json!([
            {
                "path": "C:\\images\\legacy.png",
                "x": 999,
                "y": 111,
                "scale": 0.1,
                "startTime": 8.0,
                "endTime": 9.0
            }
        ]);
        value["renderSpec"]["audio"]["ducking"] = json!({
            "enabled": true,
            "preset": "voice-first",
            "mainVoice": 0.8,
            "bgm": 0.12,
            "se": 0.7
        });
        value["ducking"] = json!({
            "enabled": false,
            "preset": "legacy",
            "mainVoice": 1.0,
            "bgm": 0.5,
            "se": 1.0
        });

        let params: ProcessParams = serde_json::from_value(value).unwrap();
        let plan = build_render_execution_plan(&params);

        let title = plan.title.as_ref().unwrap();
        assert_eq!(title.content, "Spec Title");
        assert_eq!(title.color, "#FFD700");

        let bgm = plan.bgm.as_ref().unwrap();
        assert_eq!(bgm.index, 1);
        assert_eq!(bgm.path, "C:\\audio\\spec-bgm.mp3");
        assert_eq!(bgm.volume, 0.25);
        assert_eq!(bgm.source_start, 4.0);
        assert_eq!(bgm.timeline_start, 2.0);
        assert_eq!(bgm.timeline_end, Some(6.0));

        let image = &plan.overlay_images[0];
        assert_eq!(image.index, 2);
        assert_eq!(image.path, "C:\\images\\spec.png");
        assert_eq!(image.x, 270);
        assert_eq!(image.y, 960);
        assert_eq!(image.scale, 0.4);

        assert!(plan.ducking.enabled);
        assert_eq!(plan.ducking.main_voice, 0.8);
        assert_eq!(plan.ducking.bgm, 0.12);

        let args =
            make_ffmpeg_args(&params, &EncoderConfig::cpu_fallback(), true, 10.0, 30.0).unwrap();
        let filter = filter_script_contents(&args);

        assert!(args.contains(&"C:\\audio\\spec-bgm.mp3".to_string()));
        assert!(args.contains(&"C:\\images\\spec.png".to_string()));
        assert!(!args.contains(&"C:\\audio\\legacy-bgm.mp3".to_string()));
        assert!(!args.contains(&"C:\\images\\legacy.png".to_string()));
        assert!(filter.contains("Spec Title"));
        assert!(filter.contains("0xFFD700"));
        assert!(filter.contains("[2:v]scale"));
        assert!(filter.contains("atrim=duration=4.000"));
        assert!(filter.contains("adelay=2000|2000"));
        assert!(!filter.contains("Legacy Title"));
        cleanup_generated_render_files(&params.output_path);
    }
}
