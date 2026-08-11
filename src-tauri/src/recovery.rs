use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

const MAX_RECOVERY_BYTES: usize = 20 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub project_json: String,
    pub saved_at: String,
}

fn recovery_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("自動復旧の保存先を取得できません: {error}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("自動復旧の保存先を作成できません: {error}"))?;
    Ok((
        directory.join("recovery.vfocus.json"),
        directory.join("recovery.vfocus.backup.json"),
        directory.join("recovery.vfocus.tmp.json"),
    ))
}

fn validate_project_json(project_json: &str) -> Result<(), String> {
    if project_json.len() > MAX_RECOVERY_BYTES {
        return Err(
            "プロジェクトが自動復旧の上限20MBを超えています。手動保存してください".to_string(),
        );
    }
    let value: serde_json::Value = serde_json::from_str(project_json)
        .map_err(|error| format!("自動復旧データがJSONではありません: {error}"))?;
    if value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .is_none()
        || value
            .get("document")
            .and_then(serde_json::Value::as_object)
            .is_none()
    {
        return Err("自動復旧データにプロジェクト情報がありません".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn save_recovery_snapshot(app: tauri::AppHandle, project_json: String) -> Result<(), String> {
    validate_project_json(&project_json)?;
    let snapshot = RecoverySnapshot {
        project_json,
        saved_at: chrono::Utc::now().to_rfc3339(),
    };
    let serialized = serde_json::to_vec(&snapshot)
        .map_err(|error| format!("自動復旧データを変換できません: {error}"))?;
    let (primary, backup, temporary) = recovery_paths(&app)?;
    std::fs::write(&temporary, serialized)
        .map_err(|error| format!("自動復旧データを一時保存できません: {error}"))?;

    if backup.exists() {
        let _ = std::fs::remove_file(&backup);
    }
    if primary.exists() {
        std::fs::rename(&primary, &backup)
            .map_err(|error| format!("以前の自動復旧データを退避できません: {error}"))?;
    }
    if let Err(error) = std::fs::rename(&temporary, &primary) {
        if backup.exists() && !primary.exists() {
            let _ = std::fs::rename(&backup, &primary);
        }
        return Err(format!("自動復旧データを確定できません: {error}"));
    }
    if backup.exists() {
        let _ = std::fs::remove_file(backup);
    }
    Ok(())
}

#[tauri::command]
pub fn get_recovery_snapshot(app: tauri::AppHandle) -> Result<Option<RecoverySnapshot>, String> {
    let (primary, backup, _) = recovery_paths(&app)?;
    for path in [primary, backup] {
        match std::fs::read(&path) {
            Ok(bytes) => {
                let snapshot = serde_json::from_slice::<RecoverySnapshot>(&bytes)
                    .map_err(|error| format!("自動復旧データが壊れています: {error}"))?;
                validate_project_json(&snapshot.project_json)?;
                return Ok(Some(snapshot));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("自動復旧データを読み込めません: {error}")),
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn clear_recovery_snapshot(app: tauri::AppHandle) -> Result<(), String> {
    let paths = recovery_paths(&app)?;
    for path in [paths.0, paths.1, paths.2] {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("自動復旧データを削除できません: {error}")),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_project_json, MAX_RECOVERY_BYTES};

    #[test]
    fn accepts_versioned_project_and_rejects_unrelated_json() {
        assert!(validate_project_json(r#"{"version":8,"document":{"inputPath":"x.mp4"}}"#).is_ok());
        assert!(validate_project_json(r#"{"document":{}}"#).is_err());
        assert!(validate_project_json("not json").is_err());
    }

    #[test]
    fn rejects_oversized_recovery_data() {
        let oversized = "x".repeat(MAX_RECOVERY_BYTES + 1);
        assert!(validate_project_json(&oversized).is_err());
    }
}
