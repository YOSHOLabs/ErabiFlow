//! commands/system.rs — システム関連の Tauri コマンド
/// 搭載GPUを判定する (NVIDIA / AMD / CPU)
#[tauri::command]
pub async fn detect_gpu() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let result = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
            ])
            .output();

        if let Ok(output) = result {
            let text = String::from_utf8_lossy(&output.stdout).to_uppercase();
            if text.contains("NVIDIA") {
                return Ok("NVIDIA".to_string());
            } else if text.contains("AMD") || text.contains("RADEON") {
                return Ok("AMD".to_string());
            }
        }
    }

    Ok("CPU".to_string())
}

/// デーモンのヘルスチェック（ハードウェアGPU情報などを取得）
#[tauri::command]
pub async fn check_daemon_health(
    app: tauri::AppHandle,
    daemon: tauri::State<'_, crate::daemon::DaemonManager>,
) -> Result<serde_json::Value, String> {
    daemon.send(&app, "health", serde_json::json!({})).await
}

/// デーモン診断情報（直近stderr・保留中リクエストなど）を取得する
#[tauri::command]
pub async fn get_daemon_diagnostics(
    daemon: tauri::State<'_, crate::daemon::DaemonManager>,
) -> Result<crate::daemon::DaemonDiagnostics, String> {
    Ok(daemon.diagnostics().await)
}
