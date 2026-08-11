use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

fn allowed_project_extensions(kind: &str) -> &'static [&'static str] {
    match kind {
        "video" | "proxy" => &["mp4", "mov", "mkv", "avi", "webm", "m4v", "ts", "mts"],
        "image" => &["png", "jpg", "jpeg", "webp", "bmp", "gif"],
        "audio" => &["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "webm"],
        "lut" => &["cube", "3dl"],
        "font" => &["ttf", "otf", "ttc", "woff", "woff2"],
        _ => &[],
    }
}

fn has_allowed_project_extension(path: &Path, kind: &str) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            allowed_project_extensions(kind)
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn managed_generated_root<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|path| path.join("generated"))
}

/// TateClip自身が生成した素材だけを、再起動後も安全に参照できるようにする。
pub fn is_managed_generated_asset_path<R: Runtime>(app: &tauri::AppHandle<R>, path: &Path) -> bool {
    let Ok(candidate) = path.canonicalize() else {
        return false;
    };
    let Some(root) = managed_generated_root(app) else {
        return false;
    };
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    candidate.is_file()
        && candidate.starts_with(root)
        && ["png", "wav", "webm"].iter().any(|allowed| {
            candidate
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case(allowed))
        })
}

/// ユーザーが明示的に開いたプロジェクト内の素材参照を再検証してscopeへ登録する。
pub fn authorize_project_asset<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
    kind: &str,
) -> Result<(), String> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() || !has_allowed_project_extension(candidate, kind) {
        return Err(format!(
            "プロジェクト内の{}素材形式は許可されていません",
            kind
        ));
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|_| format!("プロジェクト素材が見つかりません: {}", candidate.display()))?;
    if !canonical.is_file() {
        return Err(format!(
            "プロジェクト素材が通常ファイルではありません: {}",
            candidate.display()
        ));
    }
    app.asset_protocol_scope()
        .allow_file(&canonical)
        .map_err(|error| format!("プロジェクト素材を表示許可できません: {error}"))?;
    if canonical != candidate {
        let _ = app.asset_protocol_scope().allow_file(candidate);
    }
    Ok(())
}

/// ファイルダイアログ等を通じてasset protocol scopeへ追加されたパスだけを許可する。
pub fn ensure_asset_path_allowed<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
    label: &str,
) -> Result<(), String> {
    let candidate = Path::new(path);
    if candidate.is_absolute()
        && (app.asset_protocol_scope().is_allowed(candidate)
            || is_managed_generated_asset_path(app, candidate))
    {
        return Ok(());
    }

    log::warn!("Blocked out-of-scope {} path", label);
    Err(format!(
        "{}へのアクセスが許可されていません。ファイル選択から選び直してください。",
        label
    ))
}

/// フロントエンドのbuildOutputPathと同じ規則で安全な書き出し先を生成する。
#[cfg(test)]
pub fn derived_output_path(input_path: &str) -> Option<PathBuf> {
    let input = Path::new(input_path);
    input.extension()?;
    let mut file_name = input.file_stem()?.to_os_string();
    file_name.push("_tateclip.mp4");
    Some(input.with_file_name(file_name))
}

pub fn ensure_derived_output_path(input_path: &str, output_path: &str) -> Result<(), String> {
    let input = Path::new(input_path);
    let output = Path::new(output_path);
    let input_parent = input
        .parent()
        .ok_or_else(|| "入力ファイルの保存先を確認できません".to_string())?;
    let output_parent = output
        .parent()
        .ok_or_else(|| "書き出し先を確認できません".to_string())?;
    let input_stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "入力ファイル名から書き出し先を生成できません".to_string())?;
    let output_stem = output
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "書き出しファイル名を確認できません".to_string())?;
    let output_extension = output.extension().and_then(|value| value.to_str());
    let required_prefix = format!("{}_tateclip", input_stem);

    let same_directory = input_parent == output_parent;
    let allowed_extension = output_extension.is_some_and(|extension| {
        ["mp4", "mov", "gif", "png"]
            .iter()
            .any(|allowed| extension.eq_ignore_ascii_case(allowed))
    });
    let safe_name = output_stem == required_prefix
        || output_stem
            .strip_prefix(&required_prefix)
            .is_some_and(|suffix| suffix.starts_with('_') && suffix.len() > 1);

    if !input.is_absolute()
        || !output.is_absolute()
        || !same_directory
        || !allowed_extension
        || !safe_name
    {
        log::warn!("Blocked unexpected output path");
        return Err(
            "書き出し先は素材と同じフォルダの安全なTateClip出力名にしてください".to_string(),
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{derived_output_path, ensure_derived_output_path};
    use std::path::PathBuf;

    #[test]
    fn derives_output_next_to_the_selected_input() {
        assert_eq!(
            derived_output_path(r"C:\clips\match.final.mkv"),
            Some(PathBuf::from(r"C:\clips\match.final_tateclip.mp4")),
        );
    }

    #[test]
    fn rejects_unrelated_or_extensionless_output_paths() {
        assert!(
            ensure_derived_output_path(r"C:\clips\match.mp4", r"C:\clips\match_tateclip.mp4")
                .is_ok()
        );
        assert!(ensure_derived_output_path(
            r"C:\clips\match.mp4",
            r"C:\clips\match_tateclip_260717120000_01_クラッチ.mp4",
        )
        .is_ok());
        assert!(
            ensure_derived_output_path(r"C:\clips\match.mp4", r"C:\Windows\system.ini").is_err()
        );
        assert!(
            ensure_derived_output_path(r"C:\clips\match.mp4", r"C:\clips\other_vfocus.mp4")
                .is_err()
        );
        assert!(
            ensure_derived_output_path(r"C:\clips\match.mp4", r"C:\clips\match_tateclip.mov")
                .is_ok()
        );
        assert_eq!(derived_output_path(r"C:\clips\match"), None);
    }
}
