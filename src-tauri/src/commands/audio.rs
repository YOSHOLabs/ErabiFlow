use crate::daemon::DaemonManager;
/// commands/audio.rs — 音声関連の Tauri コマンド (v2: デーモン IPC)
use crate::ffmpeg::runner::run_ffmpeg_with_progress;
use crate::path_security::ensure_asset_path_allowed;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::Manager;

#[tauri::command]
pub fn list_system_voices() -> Result<Vec<String>, String> {
    #[cfg(not(windows))]
    {
        return Ok(Vec::new());
    }
    #[cfg(windows)]
    {
        let script = "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; @($s.GetInstalledVoices() | Where-Object {$_.Enabled} | ForEach-Object {$_.VoiceInfo.Name}) | ConvertTo-Json -Compress";
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(0x08000000)
            .output()
            .map_err(|error| format!("音声一覧を取得できません: {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let text = String::from_utf8_lossy(&output.stdout);
        if let Ok(list) = serde_json::from_str::<Vec<String>>(text.trim()) {
            return Ok(list);
        }
        if let Ok(single) = serde_json::from_str::<String>(text.trim()) {
            return Ok(vec![single]);
        }
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn synthesize_speech(
    app: tauri::AppHandle,
    text: String,
    voice: Option<String>,
    rate: i32,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("読み上げる文章を入力してください".into());
    }
    if text.chars().count() > 3000 {
        return Err("読み上げは3000文字以内にしてください".into());
    }
    #[cfg(not(windows))]
    {
        let _ = (app, voice, rate);
        return Err("現在の音声合成はWindows版で利用できます".into());
    }
    #[cfg(windows)]
    {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("保存先を取得できません: {error}"))?
            .join("generated")
            .join("speech");
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("保存先を作成できません: {error}"))?;
        let path = dir.join(format!("speech-{}.wav", uuid::Uuid::new_v4()));
        let script = "Add-Type -AssemblyName System.Speech; $t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TATECLIP_TTS_TEXT)); $v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TATECLIP_TTS_VOICE)); $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; if($v){$s.SelectVoice($v)}; $s.Rate=[Math]::Max(-10,[Math]::Min(10,[int]$env:TATECLIP_TTS_RATE)); $s.SetOutputToWaveFile($env:TATECLIP_TTS_OUTPUT); $s.Speak($t); $s.Dispose()";
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("TATECLIP_TTS_TEXT", STANDARD.encode(text.as_bytes()))
            .env(
                "TATECLIP_TTS_VOICE",
                STANDARD.encode(voice.unwrap_or_default().as_bytes()),
            )
            .env("TATECLIP_TTS_RATE", rate.clamp(-10, 10).to_string())
            .env("TATECLIP_TTS_OUTPUT", &path)
            .creation_flags(0x08000000)
            .output()
            .map_err(|error| format!("音声合成を開始できません: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "音声合成に失敗しました: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        if std::fs::metadata(&path)
            .map(|value| value.len())
            .unwrap_or(0)
            < 44
        {
            return Err("音声ファイルを生成できませんでした".into());
        }
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|error| format!("音声を再生許可できません: {error}"))?;
        Ok(path.to_string_lossy().into_owned())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SubtitleCorrectionRecord {
    scope: String,
    game_id: Option<String>,
    source_path: Option<String>,
    original: String,
    corrected: String,
    created_at: String,
}

fn subtitle_corrections_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("アプリデータ保存先を取得できません: {error}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("アプリデータ保存先を作成できません: {error}"))?;
    Ok(data_dir.join("subtitle-corrections.jsonl"))
}

fn load_subtitle_corrections(app: &tauri::AppHandle) -> Vec<SubtitleCorrectionRecord> {
    let path = match subtitle_corrections_path(app) {
        Ok(path) => path,
        Err(error) => {
            log::warn!("Subtitle correction loading skipped: {error}");
            return Vec::new();
        }
    };
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(error) => {
            log::warn!("Subtitle correction loading skipped: {error}");
            return Vec::new();
        }
    };
    let mut records: Vec<_> = content
        .lines()
        .filter_map(|line| serde_json::from_str::<SubtitleCorrectionRecord>(line).ok())
        .collect();
    if records.len() > 500 {
        records.drain(..records.len() - 500);
    }
    records
}

/// 動画の指定範囲から音声を抽出する (16kHz, mono, wav)
/// ※ FFmpeg直接呼び出しのため変更なし
#[tauri::command]
pub async fn extract_audio(
    app: tauri::AppHandle,
    input_path: String,
    output_path: String,
    start_time: f64,
    duration: Option<f64>,
) -> Result<(), String> {
    ensure_asset_path_allowed(&app, &input_path, "入力メディア")?;
    ensure_asset_path_allowed(&app, &output_path, "音声出力先")?;
    log::info!(
        "extract_audio: input={}, output={}",
        input_path,
        output_path
    );

    let mut args = vec![
        "-y".to_string(),
        "-ss".to_string(),
        format!("{:.3}", start_time),
    ];

    if let Some(dur) = duration {
        args.push("-t".to_string());
        args.push(format!("{:.3}", dur));
    }

    args.extend(vec![
        "-i".to_string(),
        input_path,
        "-vn".to_string(),
        "-acodec".to_string(),
        "pcm_s16le".to_string(),
        "-ar".to_string(),
        "16000".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        output_path,
    ]);

    run_ffmpeg_with_progress(&app, args, duration.unwrap_or(0.0), "audio_extraction").await
}

/// 無音区間を検出してフロントエンドに返すTauriコマンド
/// ※ FFmpeg直接呼び出しのため変更なし
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceSegmentResult {
    pub start: f64,
    pub end: f64,
}

#[tauri::command]
pub async fn detect_silence_segments(
    app: tauri::AppHandle,
    input_path: String,
    trim_start: Option<f64>,
    trim_duration: Option<f64>,
    threshold_db: f64,
    min_duration: f64,
    padding: f64,
) -> Result<Vec<SilenceSegmentResult>, String> {
    ensure_asset_path_allowed(&app, &input_path, "入力メディア")?;
    crate::license::require_creator(&app)?;
    log::info!("detect_silence_segments: input={}", input_path);
    let silences = crate::ffmpeg::runner::detect_silence(
        &app,
        &input_path,
        trim_start,
        trim_duration,
        threshold_db,
        min_duration,
        padding,
    )
    .await?;

    Ok(silences
        .into_iter()
        .map(|(s, e)| SilenceSegmentResult { start: s, end: e })
        .collect())
}

/// ゲーム実況ハイライト分析 (デーモン経由 → openshortsパイプライン)
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command arguments mirror the typed frontend IPC contract.
pub async fn analyze_highlights(
    app: tauri::AppHandle,
    daemon: tauri::State<'_, DaemonManager>,
    video_path: String,
    chunk_size: Option<u32>,
    threshold: Option<f64>,
    max_clips: Option<u32>,
    language: Option<String>,
    game_id: Option<String>,
    gpu_type: Option<String>,
    force_reanalyze: Option<bool>,
    client_job_id: Option<String>,
    translate_to_english: Option<bool>,
) -> Result<serde_json::Value, String> {
    ensure_asset_path_allowed(&app, &video_path, "解析対象メディア")?;
    log::info!(
        "analyze_highlights: video={}, gpu_type={:?}",
        video_path,
        gpu_type
    );

    let video_file = std::path::Path::new(&video_path);
    if !video_file.exists() {
        return Err(format!("動画ファイルが見つかりません: {}", video_path));
    }

    let subtitle_corrections = load_subtitle_corrections(&app);
    let params = serde_json::json!({
        "video_path": video_path,
        "chunk_size": chunk_size.unwrap_or(300),
        "threshold": threshold.unwrap_or(30.0),
        "max_clips": max_clips.unwrap_or(10),
        "language": language,
        "game_id": game_id.unwrap_or_else(|| "auto".to_string()),
        "subtitle_corrections": subtitle_corrections,
        "gpu_type": gpu_type.unwrap_or_else(|| "CPU".to_string()),
        "force_reanalyze": force_reanalyze.unwrap_or(false),
        "client_job_id": client_job_id,
        "translate_to_english": translate_to_english.unwrap_or(false),
    });

    let result = daemon.send(&app, "analyze_highlights", params).await?;
    Ok(result)
}

/// 実行中のAI解析にキャンセル要求を送る。
///
/// 実際の停止タイミングはPython/Whisper側のチェックポイントに依存するが、
/// daemonは解析中もこのコマンドを受け付ける。
#[tauri::command]
pub async fn cancel_analysis(
    app: tauri::AppHandle,
    daemon: tauri::State<'_, DaemonManager>,
    client_job_id: Option<String>,
) -> Result<serde_json::Value, String> {
    daemon
        .send(
            &app,
            "cancel_analysis",
            serde_json::json!({
                "client_job_id": client_job_id,
            }),
        )
        .await
}

fn find_wav_data_chunk(wav_data: &[u8]) -> Result<&[u8], String> {
    if wav_data.len() < 12 || &wav_data[0..4] != b"RIFF" || &wav_data[8..12] != b"WAVE" {
        return Err("有効なRIFF/WAVEファイルではありません".to_string());
    }

    let mut cursor = 12usize;
    while cursor + 8 <= wav_data.len() {
        let chunk_id = &wav_data[cursor..cursor + 4];
        let chunk_size = u32::from_le_bytes([
            wav_data[cursor + 4],
            wav_data[cursor + 5],
            wav_data[cursor + 6],
            wav_data[cursor + 7],
        ]) as usize;
        let data_start = cursor + 8;
        let data_end = data_start
            .checked_add(chunk_size)
            .ok_or_else(|| "WAVチャンクサイズが不正です".to_string())?;

        if data_end > wav_data.len() {
            return Err("WAVチャンクがファイル末尾を超えています".to_string());
        }
        if chunk_id == b"data" {
            return Ok(&wav_data[data_start..data_end]);
        }

        cursor = data_end
            .checked_add(chunk_size % 2)
            .ok_or_else(|| "WAVチャンク位置が不正です".to_string())?;
    }

    Err("WAVのdataチャンクが見つかりません".to_string())
}

struct TemporaryWaveformFile(std::path::PathBuf);

impl Drop for TemporaryWaveformFile {
    fn drop(&mut self) {
        match std::fs::remove_file(&self.0) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => log::warn!(
                "波形一時ファイルを削除できませんでした ({}): {}",
                self.0.display(),
                error
            ),
        }
    }
}

fn waveform_samples_per_second(value: Option<u32>) -> Result<usize, String> {
    let requested = value.unwrap_or(100);
    if !(1..=1_000).contains(&requested) {
        return Err("波形のsamplesPerSecondは1～1000で指定してください".to_string());
    }
    Ok(requested as usize)
}

/// タイムライン表示用の波形データを生成
/// FFmpegでPCM WAVに変換 → RustでRMS計算 → 正規化した f32 配列を返す
#[tauri::command]
pub async fn get_waveform_data(
    app: tauri::AppHandle,
    input_path: String,
    samples_per_second: Option<u32>,
) -> Result<Vec<f32>, String> {
    ensure_asset_path_allowed(&app, &input_path, "入力メディア")?;
    // ズーム時にぼやけないよう、デフォルトで100SPSの高解像度波形を生成する
    let sps = waveform_samples_per_second(samples_per_second)?;
    let sample_rate: u32 = 8000; // 波形表示用なので低レートで十分

    log::info!("get_waveform_data: input={}, sps={}", input_path, sps);

    let waveform_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("波形キャッシュ保存先を取得できません: {error}"))?
        .join("waveforms");
    std::fs::create_dir_all(&waveform_dir)
        .map_err(|error| format!("波形キャッシュ保存先を作成できません: {error}"))?;
    let tmp_wav = waveform_dir.join(format!("waveform-{}.wav", uuid::Uuid::new_v4()));
    let _temporary_file = TemporaryWaveformFile(tmp_wav.clone());

    // ffprobeでオーディオトラック数を取得
    let mut stream_count = 1;
    let ffprobe_cmd = std::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            &input_path,
        ])
        .output();
    if let Ok(output) = ffprobe_cmd {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let count = stdout.lines().filter(|l| !l.trim().is_empty()).count();
        if count > 0 {
            stream_count = count;
        }
    }

    // FFmpegで低レートmono PCM WAVに変換 (複数トラックがあればミックスダウン)
    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input_path.clone(),
        "-vn".to_string(),
    ];

    if stream_count > 1 {
        args.push("-filter_complex".to_string());
        args.push(format!("amix=inputs={}:duration=longest", stream_count));
    }

    args.extend(vec![
        "-acodec".to_string(),
        "pcm_s16le".to_string(),
        "-ar".to_string(),
        sample_rate.to_string(),
        "-ac".to_string(),
        "1".to_string(),
        tmp_wav.to_string_lossy().into_owned(),
    ]);

    crate::ffmpeg::runner::run_ffmpeg_with_progress(&app, args, 0.0, "waveform").await?;

    // WAVファイル読み込み＆RMS計算
    let wav_data =
        std::fs::read(&tmp_wav).map_err(|e| format!("WAVファイル読み込み失敗: {}", e))?;

    // PCM 16bit サンプルを読み込み
    let pcm_data = match find_wav_data_chunk(&wav_data) {
        Ok(data) => data,
        Err(error) => return Err(error),
    };
    let total_samples = pcm_data.len() / 2; // 16bit = 2 bytes per sample
    let samples_per_window = sample_rate as usize / sps;

    if samples_per_window == 0 || total_samples == 0 {
        return Ok(vec![]);
    }

    let num_windows = total_samples / samples_per_window;
    let mut rms_values: Vec<f32> = Vec::with_capacity(num_windows);

    for w in 0..num_windows {
        let start = w * samples_per_window;
        let end = std::cmp::min(start + samples_per_window, total_samples);

        let mut sum_sq: f64 = 0.0;
        let mut count = 0u32;

        for i in start..end {
            let byte_idx = i * 2;
            if byte_idx + 1 >= pcm_data.len() {
                break;
            }
            let sample = i16::from_le_bytes([pcm_data[byte_idx], pcm_data[byte_idx + 1]]);
            let normalized = sample as f64 / 32768.0;
            sum_sq += normalized * normalized;
            count += 1;
        }

        let rms = if count > 0 {
            (sum_sq / count as f64).sqrt()
        } else {
            0.0
        };
        rms_values.push(rms as f32);
    }

    // 正規化 (0.0 - 1.0)
    let max_rms = rms_values.iter().cloned().fold(0.0f32, f32::max);
    if max_rms > 0.001 {
        for v in &mut rms_values {
            *v /= max_rms;
        }
    }

    log::info!(
        "get_waveform_data: {} RMS samples generated",
        rms_values.len()
    );
    Ok(rms_values)
}

#[cfg(test)]
mod tests {
    use super::{find_wav_data_chunk, waveform_samples_per_second};

    fn append_chunk(wav: &mut Vec<u8>, chunk_id: &[u8; 4], data: &[u8]) {
        wav.extend_from_slice(chunk_id);
        wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
        wav.extend_from_slice(data);
        if !data.len().is_multiple_of(2) {
            wav.push(0);
        }
    }

    #[test]
    fn finds_pcm_after_metadata_chunks() {
        let pcm = [1u8, 2, 3, 4, 5, 6];
        let mut body = b"WAVE".to_vec();
        append_chunk(&mut body, b"fmt ", &[1; 16]);
        append_chunk(&mut body, b"LIST", b"encoder=ffmpeg");
        append_chunk(&mut body, b"data", &pcm);

        let mut wav = b"RIFF".to_vec();
        wav.extend_from_slice(&(body.len() as u32).to_le_bytes());
        wav.extend_from_slice(&body);

        assert_eq!(find_wav_data_chunk(&wav).unwrap(), pcm);
    }

    #[test]
    fn waveform_sample_rate_rejects_zero_and_unbounded_values() {
        assert_eq!(waveform_samples_per_second(None).unwrap(), 100);
        assert_eq!(waveform_samples_per_second(Some(1_000)).unwrap(), 1_000);
        assert!(waveform_samples_per_second(Some(0)).is_err());
        assert!(waveform_samples_per_second(Some(1_001)).is_err());
    }
}

#[tauri::command]
pub async fn learn_subtitle_correction(
    app: tauri::AppHandle,
    original_text: String,
    corrected_text: String,
    game_id: Option<String>,
    source_path: Option<String>,
) -> Result<(), String> {
    if original_text == corrected_text
        || original_text.trim().is_empty()
        || corrected_text.trim().is_empty()
    {
        return Ok(());
    }

    log::info!(
        "Learning subtitle correction: '{}' -> '{}'",
        original_text,
        corrected_text
    );

    let normalized_game_id = game_id
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty() && value != "auto" && value != "none");
    let scope = if normalized_game_id.is_some() {
        "game"
    } else {
        "project"
    };
    let record = SubtitleCorrectionRecord {
        scope: scope.to_string(),
        game_id: normalized_game_id,
        source_path,
        original: original_text,
        corrected: corrected_text,
        created_at: chrono::Local::now().to_rfc3339(),
    };
    let doc_path = subtitle_corrections_path(&app)?;

    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&doc_path)
        .map_err(|e| format!("Failed to open learning file: {}", e))?;

    let entry = format!(
        "{}\n",
        serde_json::to_string(&record)
            .map_err(|error| format!("字幕修正を保存形式へ変換できません: {error}"))?
    );

    file.write_all(entry.as_bytes())
        .map_err(|e| format!("Failed to write learning data: {}", e))?;

    Ok(())
}
