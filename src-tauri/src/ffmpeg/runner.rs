/// FFmpeg プロセス実行 + プログレスイベント送信
///
/// `-progress pipe:1` で stdout にプログレス情報を出力させ、
/// `out_time_us` をパースしてリアルタイムに進捗を Tauri イベントとして emit する。
use regex::Regex;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

#[derive(Clone, serde::Serialize)]
pub struct ProgressPayload {
    pub phase: String,
    pub progress: f64,
    pub message: String,
}

/// args を受け取って FFmpeg を実行し、プログレスを Tauri イベントで emit する。
/// duration_secs: 動画の長さ（進捗率計算用）
/// phase_label: イベントの `phase` フィールドに入れる文字列
pub async fn run_ffmpeg_with_progress(
    app: &tauri::AppHandle,
    args: Vec<String>,
    duration_secs: f64,
    phase_label: &str,
) -> Result<(), String> {
    log::info!("FFmpeg args: {:?}", args);

    let mut command = crate::ffmpeg_runtime::command(app)?;
    command
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("FFmpegを開始できません: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "FFmpegの進捗出力を取得できません".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "FFmpegのエラー出力を取得できません".to_string())?;
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).await.map(|_| bytes)
    });
    let mut stdout_lines = BufReader::new(stdout).lines();

    let time_re = Regex::new(r"out_time_us=(\d+)").map_err(|e| e.to_string())?;
    let progress_end_re = Regex::new(r"progress=end").map_err(|e| e.to_string())?;
    let mut last_progress: f64 = 0.0;
    while let Some(line) = stdout_lines
        .next_line()
        .await
        .map_err(|error| format!("FFmpegの進捗を読み取れません: {error}"))?
    {
        if let Some(caps) = time_re.captures(&line) {
            if let Ok(us) = caps[1].parse::<f64>() {
                let current_secs = us / 1_000_000.0;
                let progress = if duration_secs > 0.0 {
                    (current_secs / duration_secs * 100.0).min(100.0)
                } else {
                    0.0
                };

                // 0.5% 以上変化したときだけ emit（イベント過多を防ぐ）
                if (progress - last_progress).abs() >= 0.5 {
                    last_progress = progress;
                    let _ = app.emit(
                        "processing-progress",
                        ProgressPayload {
                            phase: phase_label.to_string(),
                            progress,
                            message: format!("{}: {:.1}%", phase_label, progress),
                        },
                    );
                }
            }
        }

        if progress_end_re.is_match(&line) {
            let _ = app.emit(
                "processing-progress",
                ProgressPayload {
                    phase: phase_label.to_string(),
                    progress: 100.0,
                    message: format!("{}: 完了", phase_label),
                },
            );
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|error| format!("FFmpegの終了状態を取得できません: {error}"))?;
    let stderr_bytes = stderr_task
        .await
        .map_err(|error| format!("FFmpegエラー出力タスクが失敗しました: {error}"))?
        .map_err(|error| format!("FFmpegのエラー出力を読み取れません: {error}"))?;
    let stderr_output = String::from_utf8_lossy(&stderr_bytes).to_string();

    if status.success() {
        if last_progress < 100.0 {
            let _ = app.emit(
                "processing-progress",
                ProgressPayload {
                    phase: phase_label.to_string(),
                    progress: 100.0,
                    message: format!("{}: 完了", phase_label),
                },
            );
        }
        return Ok(());
    }

    Err(format!(
        "FFmpeg exited with code {:?}:\n{}",
        status.code(),
        stderr_output
    ))
}

/// emit_progress: プログレスイベントを送信するユーティリティ
pub fn emit_progress(app: &tauri::AppHandle, phase: &str, progress: f64, message: &str) {
    let _ = app.emit(
        "processing-progress",
        ProgressPayload {
            phase: phase.to_string(),
            progress,
            message: message.to_string(),
        },
    );
}

/// 無音区間を検出する
/// 戻り値: Vec<(f64, f64)> = (無音開始時間, 無音終了時間) のリスト
pub async fn detect_silence(
    app: &tauri::AppHandle,
    input_path: &str,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
    threshold_db: f64,
    min_duration: f64,
    padding: f64,
) -> Result<Vec<(f64, f64)>, String> {
    emit_progress(app, "analyzing", 0.0, "無音区間を解析中...");

    let mut args = vec!["-hide_banner".to_string(), "-vn".to_string()];

    if let Some(start) = trim_start {
        args.push("-ss".to_string());
        args.push(format!("{:.3}", start));
    }
    if let Some(dur) = trim_duration {
        args.push("-t".to_string());
        args.push(format!("{:.3}", dur));
    }

    args.extend([
        "-i".to_string(),
        input_path.to_string(),
        "-af".to_string(),
        format!("silencedetect=noise={}dB:d={}", threshold_db, min_duration),
        "-f".to_string(),
        "null".to_string(),
        "-".to_string(),
    ]);

    log::info!("silencedetect args: {:?}", args);
    let output = crate::ffmpeg_runtime::output(app, args).await?;

    let stderr = String::from_utf8_lossy(&output.stderr);

    let mut silences = Vec::new();
    let mut current_start: Option<f64> = None;

    let start_re = Regex::new(r"silence_start:\s+([\d\.]+)").unwrap();
    let end_re = Regex::new(r"silence_end:\s+([\d\.]+)").unwrap();

    let offset = trim_start.unwrap_or(0.0);

    for line in stderr.lines() {
        if let Some(caps) = start_re.captures(line) {
            if let Ok(val) = caps[1].parse::<f64>() {
                current_start = Some(val);
            }
        }
        if let Some(caps) = end_re.captures(line) {
            if let Ok(val) = caps[1].parse::<f64>() {
                if let Some(start) = current_start {
                    // StartがEndより前であるか確認
                    if val > start {
                        // パディングを適用して「カットする範囲」を狭める
                        let p_start = start + padding;
                        let p_end = val - padding;

                        // パディング後も有効な幅がある場合のみ追加
                        if p_end > p_start {
                            silences.push((p_start + offset, p_end + offset));
                        }
                    }
                    current_start = None;
                }
            }
        }
    }

    log::info!(
        "Detected {} silence periods (after padding)",
        silences.len()
    );
    Ok(silences)
}
