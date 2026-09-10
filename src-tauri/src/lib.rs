//! ErabiFlow — Tauri backend
//!
//! モジュール構成:
//!   - commands/ — Tauri コマンド (video, audio, system)
//!   - ffmpeg/   — FFmpeg フィルタ構築・エンコーダ設定・プロセス実行
//!   - daemon    — ローカル解析Pythonデーモン非同期 IPC マネージャ

mod atomic_file;
mod commands;
mod daemon;
mod download_cancel;
mod ffmpeg;
mod ffmpeg_runtime;
mod font;
mod license;
mod media_protocol;
mod model;
mod path_security;
mod recovery;

use serde::{Deserialize, Serialize};
use tauri::Manager;

// ============================================================
// 型定義（各モジュールから参照される共通型）
// ============================================================

/// 動画情報（フロントエンドに返す）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
}

/// 字幕のセグメント
#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TextSegment {
    pub id: String,
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
    pub emotion: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_override: Option<SubtitleStyleOverride>,
}

/// 1つの字幕だけに適用する外観。未指定項目は字幕全体の設定を継承する。
#[derive(Clone, Deserialize, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStyleOverride {
    pub font: Option<String>,
    pub color: Option<String>,
    pub size: Option<u32>,
    pub stroke_color: Option<String>,
    pub stroke_width: Option<u32>,
    pub shadow_color: Option<String>,
    pub shadow_blur: Option<u32>,
    pub position_y: Option<f64>,
    pub emphasis_mode: Option<String>,
    pub emphasis_color: Option<String>,
}

/// エージェントが提案する推奨カットポイント
#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentHighlight {
    pub start: f64,
    pub end: f64,
    pub label: String,
    pub reason: String,
    pub excitement: u32,
    pub is_pro_required: Option<bool>,
}

// ============================================================
// ProcessParams サブ構造体
// ============================================================

/// テキスト（タイトル）パラメータ
#[derive(Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TextParams {
    pub content: Option<String>,
    pub x: Option<u32>,
    pub y: Option<u32>,
    pub font: Option<String>,
    pub color: Option<String>,
    pub size: Option<u32>,
    pub stroke_color: Option<String>,
    pub stroke_width: Option<u32>,
    pub shadow_color: Option<String>,
    pub shadow_blur: Option<u32>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
}

/// 字幕パラメータ
#[derive(Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleParams {
    pub segments: Option<Vec<TextSegment>>,
    pub font: Option<String>,
    pub color: Option<String>,
    pub size: Option<u32>,
    pub stroke_color: Option<String>,
    pub stroke_width: Option<u32>,
    pub shadow_color: Option<String>,
    pub shadow_blur: Option<u32>,
    pub y: Option<f64>,
    pub emphasis_mode: Option<String>,
    pub emphasis_color: Option<String>,
}

/// アバターパラメータ
#[derive(Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AvatarParams {
    pub path: String,
    pub x: Option<u32>,
    pub y: Option<u32>,
    pub scale: Option<f64>,
}

/// BGMパラメータ
#[derive(Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BgmParams {
    pub path: String,
    pub volume: Option<f64>,
    /// BGM素材内の読み始め（旧start互換）
    pub start: Option<f64>,
    pub timeline_start: Option<f64>,
    pub timeline_end: Option<f64>,
}

/// SEパラメータ
#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeParams {
    pub path: String,
    pub volume: Option<f64>,
    pub trigger_time: Option<f64>,
}

/// 画像オーバーレイパラメータ
#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OverlayImageParams {
    pub path: String,
    pub x: Option<u32>,
    pub y: Option<u32>,
    pub scale: Option<f64>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrackMediaClipParams {
    pub id: String,
    pub track_id: String,
    pub path: String,
    pub kind: String,
    pub timeline_start: f64,
    pub timeline_end: f64,
    pub source_start: f64,
    pub source_end: f64,
    #[serde(default)]
    pub source_fps: Option<f64>,
    pub volume: f64,
    pub muted: bool,
    pub has_audio: bool,
    pub track_order: usize,
    pub render_video: bool,
    pub render_audio: bool,
    pub transform: RenderSpecClipTransform,
    #[serde(default)]
    pub keyframes: Vec<ClipKeyframe>,
    pub transition_in: Option<ClipTransition>,
    pub transition_out: Option<ClipTransition>,
    pub motion_preset: Option<String>,
    pub color: Option<ClipColorAdjustments>,
    pub effects: Option<ClipVisualEffects>,
    pub speed: Option<f64>,
    #[serde(default)]
    pub speed_curve: Vec<SpeedCurvePoint>,
    #[serde(default)]
    pub reverse: bool,
    pub freeze_frame: Option<f64>,
    pub audio_effects: Option<ClipAudioEffects>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipKeyframe {
    pub id: String,
    pub time: f64,
    pub property: String,
    pub value: f64,
    pub interpolation: String,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipTransition {
    pub r#type: String,
    pub duration: f64,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ClipColorAdjustments {
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub temperature: f64,
    pub tint: f64,
    pub highlights: f64,
    pub shadows: f64,
    pub blacks: f64,
    pub whites: f64,
    pub hue: f64,
    pub hsl_saturation: f64,
    pub lightness: f64,
    pub curve_shadows: f64,
    pub curve_midtones: f64,
    pub curve_highlights: f64,
    pub lut_path: Option<String>,
}

impl Default for ClipColorAdjustments {
    fn default() -> Self {
        Self {
            brightness: 0.0,
            contrast: 100.0,
            saturation: 100.0,
            temperature: 0.0,
            tint: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            blacks: 0.0,
            whites: 0.0,
            hue: 0.0,
            hsl_saturation: 0.0,
            lightness: 0.0,
            curve_shadows: 0.0,
            curve_midtones: 0.0,
            curve_highlights: 0.0,
            lut_path: None,
        }
    }
}

#[derive(Clone, Deserialize, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClipChromaKey {
    pub enabled: bool,
    pub color: String,
    pub similarity: f64,
    pub blend: f64,
}

#[derive(Clone, Deserialize, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClipMask {
    pub shape: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub feather: f64,
}

#[derive(Clone, Deserialize, Serialize, Debug, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ClipVisualEffects {
    pub blur: f64,
    pub mosaic: f64,
    pub motion_blur: f64,
    pub sharpen: f64,
    pub noise: f64,
    pub vhs: f64,
    pub film: f64,
    pub glitch: f64,
    pub rgb_shift: f64,
    pub glow: f64,
    pub light_leak: f64,
    pub lens_flare: f64,
    pub rain: f64,
    pub snow: f64,
    pub fire: f64,
    pub particles: f64,
    pub shake: f64,
    pub warp: f64,
    pub chromatic_aberration: f64,
    pub chroma: ClipChromaKey,
    pub mask: ClipMask,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpeedCurvePoint {
    pub position: f64,
    pub speed: f64,
}

#[derive(Clone, Deserialize, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClipAudioEffects {
    pub eq_low: f64,
    pub eq_mid: f64,
    pub eq_high: f64,
    pub normalize: bool,
    pub noise_reduction: f64,
    pub fade_in: f64,
    pub fade_out: f64,
}

/// ダッキングプリセット
#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DuckingParams {
    pub enabled: Option<bool>,
    pub preset: Option<String>,
    pub main_voice: Option<f64>,
    pub bgm: Option<f64>,
    pub se: Option<f64>,
}

/// NLE クリップパラメータ
#[derive(Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipParams {
    pub is_gap: Option<bool>,
    pub start: f64,
    pub end: f64,
    pub speed: Option<f64>,
    pub volume: Option<f64>,
    pub muted: Option<bool>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
    pub scale: Option<f64>,
    pub rotation: Option<f64>,
    pub flip_horizontal: Option<bool>,
    pub flip_vertical: Option<bool>,
    pub opacity: Option<f64>,
    #[serde(default)]
    pub keyframes: Vec<ClipKeyframe>,
    pub transition_in: Option<ClipTransition>,
    pub transition_out: Option<ClipTransition>,
    pub motion_preset: Option<String>,
    pub color: Option<ClipColorAdjustments>,
    pub effects: Option<ClipVisualEffects>,
    #[serde(default)]
    pub speed_curve: Vec<SpeedCurvePoint>,
    #[serde(default)]
    pub reverse: bool,
    pub freeze_frame: Option<f64>,
    pub freeze_duration: Option<f64>,
    pub audio_effects: Option<ClipAudioEffects>,
}

// ============================================================
// RenderSpec — フロントエンド共通レンダー仕様
// ============================================================

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecParams {
    pub version: u32,
    pub canvas: RenderSpecCanvas,
    pub source: RenderSpecSource,
    pub sequence: RenderSpecSequence,
    pub layout: RenderSpecLayout,
    pub layers: RenderSpecLayers,
    pub audio: RenderSpecAudio,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecCanvas {
    pub width: u32,
    pub height: u32,
    pub aspect: String,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecSource {
    pub path: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecSequence {
    pub clips: Vec<RenderSpecClip>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecClip {
    pub id: String,
    pub is_gap: Option<bool>,
    pub media_start: f64,
    pub media_end: f64,
    pub label: Option<String>,
    pub speed: Option<f64>,
    pub volume: Option<f64>,
    pub muted: Option<bool>,
    pub transform: Option<RenderSpecClipTransform>,
    #[serde(default)]
    pub keyframes: Vec<ClipKeyframe>,
    pub transition_in: Option<ClipTransition>,
    pub transition_out: Option<ClipTransition>,
    pub motion_preset: Option<String>,
    pub color: Option<ClipColorAdjustments>,
    pub effects: Option<ClipVisualEffects>,
    #[serde(default)]
    pub speed_curve: Vec<SpeedCurvePoint>,
    #[serde(default)]
    pub reverse: bool,
    pub freeze_frame: Option<f64>,
    pub freeze_duration: Option<f64>,
    pub audio_effects: Option<ClipAudioEffects>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecClipTransform {
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
    pub scale: Option<f64>,
    pub rotation: Option<f64>,
    pub flip_horizontal: Option<bool>,
    pub flip_vertical: Option<bool>,
    pub opacity: Option<f64>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecLayout {
    pub kind: String,
    pub game_y: u32,
    #[serde(default = "default_game_scale")]
    pub game_scale: f64,
    pub crop_data: Option<String>,
}

fn default_game_scale() -> f64 {
    1.0
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecLayers {
    pub title: Option<RenderSpecTitleLayer>,
    #[serde(default)]
    pub watermark: Option<RenderSpecWatermarkLayer>,
    pub subtitles: Option<RenderSpecSubtitleLayer>,
    pub avatar: Option<RenderSpecAvatarLayer>,
    pub bgm: Option<RenderSpecBgmLayer>,
    pub se: Vec<RenderSpecSeLayer>,
    pub images: Vec<RenderSpecImageLayer>,
    #[serde(default)]
    pub track_clips: Vec<TrackMediaClipParams>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecWatermarkLayer {
    pub text: String,
    pub font: String,
    pub color: String,
    pub size: u32,
    pub opacity: f64,
    pub position: String,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecTitleLayer {
    pub text: String,
    pub x: u32,
    pub y: u32,
    pub font: String,
    pub color: String,
    pub size: u32,
    pub stroke_color: String,
    pub stroke_width: u32,
    pub shadow_color: String,
    pub shadow_blur: u32,
    #[serde(default)]
    pub start_time: f64,
    #[serde(default)]
    pub end_time: Option<f64>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecSubtitleLayer {
    pub segments: Vec<TextSegment>,
    pub font: String,
    pub color: String,
    pub size: u32,
    pub stroke_color: String,
    pub stroke_width: u32,
    pub shadow_color: String,
    pub shadow_blur: u32,
    pub y: f64,
    #[serde(default = "default_emphasis_mode")]
    pub emphasis_mode: String,
    #[serde(default = "default_emphasis_color")]
    pub emphasis_color: String,
}

fn default_emphasis_mode() -> String {
    "none".to_string()
}

fn default_emphasis_color() -> String {
    "#FDE047".to_string()
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecAvatarLayer {
    pub path: String,
    pub x: u32,
    pub y: u32,
    pub scale: f64,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecBgmLayer {
    pub path: String,
    pub volume: f64,
    #[serde(default)]
    pub timeline_start: f64,
    pub timeline_end: Option<f64>,
    #[serde(default, alias = "start")]
    pub trim_start: f64,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecSeLayer {
    pub id: String,
    pub path: String,
    pub volume: f64,
    pub trigger_time: f64,
    pub label: Option<String>,
    pub linked_clip_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecImageLayer {
    pub id: String,
    pub path: String,
    pub position: RenderSpecPosition,
    pub scale: f64,
    pub start_time: f64,
    pub end_time: f64,
    pub label: Option<String>,
    pub linked_clip_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecAudio {
    pub ducking: RenderSpecDucking,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpecDucking {
    pub enabled: bool,
    pub preset: String,
    pub main_voice: f64,
    pub bgm: f64,
    pub se: f64,
}

/// 無音カット設定パラメータ
#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JumpCutConfigParams {
    pub threshold_db: Option<f64>,
    pub min_duration: Option<f64>,
    pub padding: Option<f64>,
}

/// 処理パラメータ（フロントエンドから受け取る）
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessParams {
    pub input_path: String,
    pub output_path: String,
    #[serde(default = "default_export_format")]
    pub export_format: String,
    #[serde(default = "default_video_codec")]
    pub video_codec: String,
    #[serde(default = "default_output_width")]
    pub output_width: u32,
    #[serde(default = "default_output_height")]
    pub output_height: u32,
    #[serde(default = "default_output_fps")]
    pub output_fps: f64,
    #[serde(default = "default_video_bitrate")]
    pub video_bitrate_kbps: u32,
    pub render_spec: Option<RenderSpecParams>,
    pub gpu_type: String,
    pub layout: String,

    pub enable_jump_cut: Option<bool>,
    pub jump_cut_config: Option<JumpCutConfigParams>,
    pub crop_data: Option<String>,

    // トリム
    pub trim_start: Option<f64>,
    pub trim_duration: Option<f64>,

    // NLE マルチクリップ
    pub clips: Option<Vec<ClipParams>>,

    // ゲーム映像位置
    pub game_y: Option<u32>,
    pub game_scale: Option<f64>,

    // ネスト構造のサブパラメータ
    pub text: Option<TextParams>,
    pub subtitle: Option<SubtitleParams>,
    pub avatar: Option<AvatarParams>,
    pub bgm: Option<BgmParams>,
    pub se_slots: Option<Vec<SeParams>>,
    pub overlay_images: Option<Vec<OverlayImageParams>>,
    pub track_clips: Option<Vec<TrackMediaClipParams>>,
    pub ducking: Option<DuckingParams>,
}

fn default_export_format() -> String {
    "mp4".to_string()
}
fn default_video_codec() -> String {
    "h264".to_string()
}
fn default_output_width() -> u32 {
    1080
}
fn default_output_height() -> u32 {
    1920
}
fn default_output_fps() -> f64 {
    30.0
}
fn default_video_bitrate() -> u32 {
    12_000
}

// ============================================================
// Tauri エントリポイント
// ============================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // The development config intentionally has no updater endpoint or
            // public key. Registering the updater in a debug build makes Tauri
            // deserialize that missing config as `null` and abort at startup.
            // Beta/stable release builds provide the updater config overlays.
            #[cfg(all(desktop, not(debug_assertions)))]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // ---- ローカル解析デーモンの起動 ----
            let app_handle = app.handle().clone();
            let daemon_manager = daemon::DaemonManager::new();
            if !app.manage(daemon_manager.clone()) {
                return Err("DaemonManager state is already registered".into());
            }
            tauri::async_runtime::spawn(async move {
                match daemon_manager.start(&app_handle).await {
                    Ok(()) => {
                        log::info!("Local analysis daemon started successfully");
                    }
                    Err(e) => {
                        log::error!("Failed to start local analysis daemon: {}", e);
                        // Manager state は残す。次のコマンド時に自動再起動を試みる。
                    }
                }
            });

            Ok(())
        })
        .register_uri_scheme_protocol("vfocus", |context, request| {
            media_protocol::handle_request(context.app_handle(), &request)
        })
        .invoke_handler(tauri::generate_handler![
            commands::video::get_video_info,
            commands::video::media_proxy::generate_media_proxy,
            commands::video::media_proxy::remove_media_proxy,
            commands::video::process_video_v_focus,
            commands::audio::extract_audio,
            commands::audio::list_system_voices,
            commands::audio::synthesize_speech,
            commands::assets::save_generated_sticker,
            commands::assets::authorize_project_assets,
            commands::project::save_project_file,
            commands::project::save_handoff_file,
            commands::feedback::append_highlight_feedback,
            commands::feedback::append_highlight_feedback_batch,
            commands::feedback::get_highlight_feedback_status,
            commands::feedback::get_highlight_feedback_summary,
            commands::feedback::clear_highlight_feedback,
            commands::audio::detect_silence_segments,
            commands::audio::analyze_highlights,
            commands::audio::cancel_analysis,
            commands::audio::get_waveform_data,
            commands::audio::learn_subtitle_correction,
            commands::system::detect_gpu,
            commands::system::check_daemon_health,
            commands::system::get_daemon_diagnostics,
            model::get_whisper_model_status,
            model::download_whisper_model,
            model::cancel_whisper_model_download,
            model::remove_downloaded_whisper_model,
            ffmpeg_runtime::get_ffmpeg_runtime_status,
            ffmpeg_runtime::download_ffmpeg_runtime,
            ffmpeg_runtime::cancel_ffmpeg_runtime_download,
            ffmpeg_runtime::remove_downloaded_ffmpeg_runtime,
            license::get_entitlement,
            license::activate_creator_license,
            license::deactivate_creator_license,
            recovery::save_recovery_snapshot,
            recovery::get_recovery_snapshot,
            recovery::clear_recovery_snapshot,
            font::list_system_fonts,
            font::import_font_file,
            font::resolve_font_preview
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
