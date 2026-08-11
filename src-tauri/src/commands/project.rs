use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

fn validate_project_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("プロジェクトの保存先は絶対パスで指定してください".to_string());
    }
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("vfocus"))
    {
        return Err("プロジェクトは.vfocus形式で保存してください".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "プロジェクトの保存先を確認できません".to_string())?;
    if !parent.is_dir() {
        return Err("プロジェクトの保存先フォルダーが存在しません".to_string());
    }
    Ok(())
}

fn validate_project_json(project_json: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(project_json)
        .map_err(|error| format!("プロジェクトJSONが不正です: {error}"))?;
    let valid = value.as_object().is_some_and(|object| {
        object
            .get("version")
            .and_then(|value| value.as_u64())
            .is_some()
    }) && value
        .get("document")
        .is_some_and(|document| document.is_object());
    if !valid {
        return Err("TateClipプロジェクトとして保存できないデータです".to_string());
    }
    Ok(())
}

fn temporary_project_path(project_path: &Path) -> Result<PathBuf, String> {
    let parent = project_path
        .parent()
        .ok_or_else(|| "プロジェクトの保存先を確認できません".to_string())?;
    let name = project_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "プロジェクトのファイル名を確認できません".to_string())?;
    Ok(parent.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4())))
}

fn save_project_file_inner(project_path: &str, project_json: &str) -> Result<(), String> {
    let destination = Path::new(project_path);
    validate_project_path(destination)?;
    validate_project_json(project_json)?;
    let temporary = temporary_project_path(destination)?;

    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("プロジェクトの一時ファイルを作成できません: {error}"))?;
        file.write_all(project_json.as_bytes())
            .map_err(|error| format!("プロジェクトを書き込めません: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("プロジェクトの書き込みを確定できません: {error}"))?;
        drop(file);
        crate::atomic_file::replace_file(&temporary, destination)
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn save_handoff_file_inner(handoff_path: &str, content: &str) -> Result<(), String> {
    let destination = Path::new(handoff_path);
    if !destination.is_absolute() {
        return Err("受け渡しファイルの保存先は絶対パスで指定してください".to_string());
    }
    let valid_extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            ["json", "csv", "edl", "srt"]
                .iter()
                .any(|ext| value.eq_ignore_ascii_case(ext))
        });
    if !valid_extension {
        return Err("受け渡しファイルはJSON / CSV / EDL / SRT形式で保存してください".to_string());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "受け渡しファイルの保存先を確認できません".to_string())?;
    if !parent.is_dir() {
        return Err("受け渡しファイルの保存先フォルダーが存在しません".to_string());
    }
    let temporary = temporary_project_path(destination)?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("受け渡し用の一時ファイルを作成できません: {error}"))?;
        file.write_all(content.as_bytes())
            .map_err(|error| format!("受け渡しファイルを書き込めません: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("受け渡しファイルの書き込みを確定できません: {error}"))?;
        drop(file);
        crate::atomic_file::replace_file(&temporary, destination)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub async fn save_project_file(project_path: String, project_json: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || save_project_file_inner(&project_path, &project_json))
        .await
        .map_err(|error| format!("プロジェクト保存処理が停止しました: {error}"))?
}

#[tauri::command]
pub async fn save_handoff_file(handoff_path: String, content: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || save_handoff_file_inner(&handoff_path, &content))
        .await
        .map_err(|error| format!("受け渡しファイル保存処理が停止しました: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{save_handoff_file_inner, save_project_file_inner};

    #[test]
    fn project_save_replaces_an_existing_file_after_json_validation() {
        let directory =
            std::env::temp_dir().join(format!("tateclip-project-save-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("edit.vfocus");
        std::fs::write(&path, b"old project").unwrap();

        save_project_file_inner(
            &path.to_string_lossy(),
            r#"{"version":14,"document":{"inputPath":"movie.mp4"}}"#,
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            r#"{"version":14,"document":{"inputPath":"movie.mp4"}}"#
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn invalid_project_data_never_overwrites_the_existing_file() {
        let directory = std::env::temp_dir().join(format!(
            "tateclip-project-save-invalid-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("edit.vfocus");
        std::fs::write(&path, b"old project").unwrap();

        assert!(save_project_file_inner(&path.to_string_lossy(), "not json").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"old project");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn handoff_save_atomically_replaces_supported_text_files() {
        let directory =
            std::env::temp_dir().join(format!("tateclip-handoff-save-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("roughcut.edl");
        std::fs::write(&path, b"old").unwrap();
        save_handoff_file_inner(&path.to_string_lossy(), "TITLE: NEW\r\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "TITLE: NEW\r\n");
        assert!(
            save_handoff_file_inner(&directory.join("unsafe.exe").to_string_lossy(), "nope")
                .is_err()
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
