// ============================================================
// テキストスタイル（テキスト / 字幕で共通利用）
// ============================================================

use super::animation::{
    apply_motion_rotation_expression, apply_motion_scale_expression, apply_motion_y_expression,
    apply_rotation_transition_expression, apply_transition_expressions,
    apply_zoom_transition_expression, keyframe_expression, transition_progress_expression,
};
use super::clip_effects::{
    build_audio_effect_filter, build_color_filter, build_visual_effect_filter, to_ffmpeg_color,
};
use super::escaping::escape_filter_path;

/// テキストの描画スタイル（フォント・色・縁取り・影）
pub struct TextStyle<'a> {
    pub font: &'a str,
    pub color: &'a str,
    pub size: u32,
    pub stroke_color: &'a str,
    pub stroke_width: u32,
    pub shadow_color: &'a str,
    pub shadow_blur: u32,
}

#[derive(Clone, Debug, Default)]
pub struct TrackClipFilterParams {
    pub input_index: usize,
    pub kind: String,
    pub timeline_start: f64,
    pub timeline_end: f64,
    pub source_start: f64,
    pub source_end: f64,
    pub source_fps: f64,
    pub volume: f64,
    pub muted: bool,
    pub has_audio: bool,
    pub track_order: usize,
    pub render_video: bool,
    pub render_audio: bool,
    pub position_x: f64,
    pub position_y: f64,
    pub scale: f64,
    pub rotation: f64,
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
    pub opacity: f64,
    pub keyframes: Vec<crate::ClipKeyframe>,
    pub transition_in: Option<crate::ClipTransition>,
    pub transition_out: Option<crate::ClipTransition>,
    pub motion_preset: Option<String>,
    pub color: Option<crate::ClipColorAdjustments>,
    pub effects: Option<crate::ClipVisualEffects>,
    pub speed: f64,
    pub speed_curve: Vec<crate::SpeedCurvePoint>,
    pub reverse: bool,
    pub freeze_frame: Option<f64>,
    pub audio_effects: Option<crate::ClipAudioEffects>,
}

// ============================================================
// FilterParams
// ============================================================

pub struct FilterParams<'a> {
    pub output_width: u32,
    pub output_height: u32,
    // ヘッダーテキスト
    pub header_text: &'a str,
    pub header_style: TextStyle<'a>,
    pub header_x: u32,
    pub header_y: u32,
    pub header_start_time: f64,
    pub header_end_time: Option<f64>,
    pub watermark_text: &'a str,
    pub watermark_style: TextStyle<'a>,
    pub watermark_position: &'a str,
    pub watermark_opacity: f64,

    // アバター
    pub has_avatar: bool,
    pub avatar_x: u32,
    pub avatar_y: u32,
    pub avatar_scale: f64,

    // ゲーム映像
    pub game_y: Option<u32>,
    pub game_scale: f64,
    pub layout_kind: &'a str,
    pub crop_data: Option<&'a str>,

    // 字幕 (ASS ファイルパス — None の場合は字幕なし)
    pub ass_file: Option<String>,
    pub ass_fonts_dir: Option<String>,

    // オーディオ/NLE
    pub clips: Vec<crate::ClipParams>,
    /// 元動画に音声ストリームがあるか。無い場合は同尺の無音を生成する。
    pub main_has_audio: bool,
    /// 合成後タイムラインの期待尺。音声ミックスをこの長さへ揃える。
    pub timeline_duration: f64,
    /// Main source average frame rate, used to choose the final decodable frame.
    pub source_fps: f64,
    pub bgm_index: Option<usize>,
    pub bgm_volume: f64,
    pub bgm_timeline_start: f64,
    pub bgm_duration: Option<f64>,

    // SEスロット (input_index, volume, trigger_time_sec)
    pub se_slots: Vec<(usize, f64, f64)>,

    // 画像オーバーレイ (input_index, x, y, scale, start_time, end_time)
    pub overlay_images: Vec<(usize, u32, u32, f64, f64, f64)>,

    // 素材ライブラリから追加された任意V2+/A2+トラック
    pub track_clips: Vec<TrackClipFilterParams>,

    // ダッキング
    pub ducking_enabled: bool,
    pub ducking_main_voice: f64,
    pub ducking_bgm: f64,
    pub ducking_se: f64,
}

/// ラフカット用。演出を焼き込まず、KEEP区間だけを元の画角で連結する。
fn build_source_filter(params: &FilterParams) -> (String, String, String) {
    let width = params.output_width.clamp(128, 7680) / 2 * 2;
    let height = params.output_height.clamp(128, 7680) / 2 * 2;
    let fit = format!(
        "scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p"
    );

    if params.clips.is_empty() {
        let mut graph = format!("[0:v]{fit}[out]");
        let audio = if params.main_has_audio {
            "0:a?".to_string()
        } else {
            graph.push_str(&format!(
                ";anullsrc=r=48000:cl=stereo:d={:.6}[a_source_silence]",
                params.timeline_duration.max(0.001)
            ));
            "[a_source_silence]".to_string()
        };
        return (graph, "[out]".to_string(), audio);
    }

    let mut graph = String::new();
    let mut video_inputs = String::new();
    let mut audio_inputs = String::new();
    for (index, clip) in params.clips.iter().enumerate() {
        if clip.is_gap.unwrap_or(false) {
            let duration = clip.start.max(0.001);
            graph.push_str(&format!(
                "color=c=black:s={width}x{height}:r=30:d={duration:.6}[source_v_{index}];anullsrc=r=48000:cl=stereo:d={duration:.6}[source_a_{index}];"
            ));
        } else {
            let speed = clip.speed.unwrap_or(1.0).clamp(0.25, 4.0);
            let duration = ((clip.end - clip.start).max(0.001) / speed).max(0.001);
            graph.push_str(&format!(
                "[0:v]trim=start={:.6}:end={:.6},setpts=(PTS-STARTPTS)/{speed:.6},{fit}[source_v_{index}];",
                clip.start.max(0.0),
                clip.end.max(clip.start + 0.001),
            ));
            if params.main_has_audio {
                graph.push_str(&format!(
                    "[0:a]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS,{},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[source_a_{index}];",
                    clip.start.max(0.0),
                    clip.end.max(clip.start + 0.001),
                    build_atempo_chain(speed),
                ));
            } else {
                graph.push_str(&format!(
                    "anullsrc=r=48000:cl=stereo:d={duration:.6}[source_a_{index}];"
                ));
            }
        }
        video_inputs.push_str(&format!("[source_v_{index}]"));
        audio_inputs.push_str(&format!("[source_a_{index}]"));
    }
    let count = params.clips.len();
    graph.push_str(&format!(
        "{video_inputs}concat=n={count}:v=1:a=0[out];{audio_inputs}concat=n={count}:v=0:a=1[a_source]"
    ));
    (graph, "[out]".to_string(), "[a_source]".to_string())
}

/// 出力解像度定数
const OUT_W: u32 = 1080;
const OUT_H: u32 = 1920;
/// ゲーム映像の高さ (16:9 を 1080 幅に収めたとき)
const GAME_H: u32 = 608;

/// drawtext フィルタ文字列を生成するヘルパー
fn build_drawtext(
    text: &str,
    style: &TextStyle,
    x_expr: &str,
    y_expr: &str,
    enable: Option<&str>,
    opacity: Option<f64>,
) -> String {
    build_drawtext_with_resolver(
        text,
        style,
        x_expr,
        y_expr,
        enable,
        opacity,
        crate::font::resolve_font_reference,
    )
}

fn build_drawtext_with_resolver<F>(
    text: &str,
    style: &TextStyle,
    x_expr: &str,
    y_expr: &str,
    enable: Option<&str>,
    opacity: Option<f64>,
    resolve_font: F,
) -> String
where
    F: Fn(&str, &str) -> crate::font::FontResolution,
{
    let escaped = text.replace('\'', "'\\''").replace(':', "\\:");
    let resolution = resolve_font(style.font, text);
    let fontfile = escape_filter_path(&resolution.path);
    let mut color = to_ffmpeg_color(style.color);
    if let Some(alpha) = opacity {
        color = format!(
            "{}@{:.2}",
            color.split('@').next().unwrap_or(&color),
            alpha.clamp(0.05, 1.0)
        );
    }
    let stroke_c = to_ffmpeg_color(style.stroke_color);
    let shadow_c = to_ffmpeg_color(style.shadow_color);

    let mut dt = format!(
        "drawtext=text='{text}':fontsize={size}:fontcolor={color}:\
         x={x}:y={y}:\
         borderw={bw}:bordercolor={bc}:\
         shadowx={sx}:shadowy={sy}:shadowcolor={sc}:\
         fontfile='{ff}'",
        text = escaped,
        size = style.size,
        color = color,
        x = x_expr,
        y = y_expr,
        bw = style.stroke_width,
        bc = stroke_c,
        sx = style.shadow_blur,
        sy = style.shadow_blur,
        sc = shadow_c,
        ff = fontfile,
    );

    if let Some(en) = enable {
        dt.push_str(&format!(":enable='{}'", en));
    }

    dt
}

fn build_atempo_chain(speed: f64) -> String {
    let mut remaining = speed.clamp(0.25, 4.0);
    let mut filters = Vec::new();
    while remaining < 0.5 - f64::EPSILON {
        filters.push("atempo=0.500000".to_string());
        remaining /= 0.5;
    }
    while remaining > 2.0 + f64::EPSILON {
        filters.push("atempo=2.000000".to_string());
        remaining /= 2.0;
    }
    filters.push(format!("atempo={remaining:.6}"));
    filters.join(",")
}

fn clip_speed_segments(clip: &crate::ClipParams) -> Vec<(f64, f64, f64)> {
    let source_duration = (clip.end - clip.start).max(0.001);
    let fallback = clip.speed.unwrap_or(1.0).clamp(0.25, 4.0);
    let mut points: Vec<(f64, f64)> = clip
        .speed_curve
        .iter()
        .filter(|point| point.position.is_finite() && point.speed.is_finite())
        .map(|point| (point.position.clamp(0.0, 1.0), point.speed.clamp(0.25, 4.0)))
        .collect();
    points.sort_by(|a, b| a.0.total_cmp(&b.0));
    if points.is_empty() {
        return vec![(clip.start, clip.end, fallback)];
    }
    if points[0].0 > 0.0 {
        points.insert(0, (0.0, fallback));
    }
    if points.last().unwrap().0 < 1.0 {
        let speed = points.last().unwrap().1;
        points.push((1.0, speed));
    }
    points
        .windows(2)
        .filter_map(|window| {
            let (from, from_speed) = window[0];
            let (to, to_speed) = window[1];
            if to - from <= 0.000_001 {
                return None;
            }
            Some((
                clip.start + source_duration * from,
                clip.start + source_duration * to,
                ((from_speed + to_speed) / 2.0).clamp(0.25, 4.0),
            ))
        })
        .collect()
}

fn track_speed_segments(clip: &TrackClipFilterParams) -> Vec<(f64, f64, f64)> {
    let source_duration = (clip.source_end - clip.source_start).max(0.001);
    let mut points: Vec<(f64, f64)> = clip
        .speed_curve
        .iter()
        .filter(|point| point.position.is_finite() && point.speed.is_finite())
        .map(|point| (point.position.clamp(0.0, 1.0), point.speed.clamp(0.25, 4.0)))
        .collect();
    points.sort_by(|a, b| a.0.total_cmp(&b.0));
    let fallback_speed = if clip.speed.is_finite() && clip.speed >= 0.25 {
        clip.speed.clamp(0.25, 4.0)
    } else {
        1.0
    };
    if points.is_empty() {
        return vec![(clip.source_start, clip.source_end, fallback_speed)];
    }
    if points[0].0 > 0.0 {
        points.insert(0, (0.0, fallback_speed));
    }
    if points.last().unwrap().0 < 1.0 {
        let speed = points.last().unwrap().1;
        points.push((1.0, speed));
    }
    points
        .windows(2)
        .filter_map(|window| {
            if window[1].0 - window[0].0 <= 0.000_001 {
                return None;
            }
            Some((
                clip.source_start + source_duration * window[0].0,
                clip.source_start + source_duration * window[1].0,
                ((window[0].1 + window[1].1) / 2.0).clamp(0.25, 4.0),
            ))
        })
        .collect()
}

fn source_frame_duration(fps: f64) -> f64 {
    let safe_fps = if fps.is_finite() && fps >= 1.0 {
        fps.clamp(1.0, 240.0)
    } else {
        30.0
    };
    1.0 / safe_fps
}

fn build_track_advanced_source(
    index: usize,
    clip: &TrackClipFilterParams,
    audio: bool,
) -> (String, String) {
    let duration = (clip.timeline_end - clip.timeline_start).max(0.001);
    let media = if audio { "a" } else { "v" };
    let output = format!("track_adv_{media}_{index}");
    if let Some(frame) = clip.freeze_frame {
        if audio {
            return (
                format!("anullsrc=r=48000:cl=stereo:d={duration:.6}[{output}];"),
                output,
            );
        }
        let frame_duration = source_frame_duration(clip.source_fps);
        let frame = frame.clamp(
            clip.source_start,
            (clip.source_end - frame_duration).max(clip.source_start),
        );
        let source_fps = 1.0 / frame_duration;
        let tail_padding = (clip.source_end + frame_duration).max(frame_duration);
        return (format!("[{}:v]fps=fps={source_fps:.6}:round=down,tpad=stop_mode=clone:stop_duration={tail_padding:.6},trim=start={frame:.6}:end={:.6},setpts=PTS-STARTPTS,trim=end_frame=1,tpad=stop_mode=clone:stop_duration={duration:.6},trim=duration={duration:.6}[{output}];", clip.input_index, clip.source_end), output);
    }
    let mut segments = track_speed_segments(clip);
    if clip.reverse {
        segments.reverse();
    }
    let mut graph = String::new();
    let mut inputs = String::new();
    for (segment_index, (start, end, speed)) in segments.iter().enumerate() {
        let label = format!("track_adv_{media}_{index}_{segment_index}");
        if audio {
            let reverse = if clip.reverse { ",areverse" } else { "" };
            graph.push_str(&format!("[{}:a]atrim=start={start:.6}:end={end:.6}{reverse},asetpts=PTS-STARTPTS,{}[{label}];", clip.input_index, build_atempo_chain(*speed)));
        } else {
            let reverse = if clip.reverse { ",reverse" } else { "" };
            graph.push_str(&format!("[{}:v]trim=start={start:.6}:end={end:.6}{reverse},setpts=(PTS-STARTPTS)/{speed:.6}[{label}];", clip.input_index));
        }
        inputs.push_str(&format!("[{label}]"));
    }
    let count = segments.len().max(1);
    graph.push_str(&format!(
        "{inputs}concat=n={count}:v={}:a={}[{output}];",
        if audio { 0 } else { 1 },
        if audio { 1 } else { 0 }
    ));
    (graph, output)
}

fn clip_output_duration(clip: &crate::ClipParams) -> f64 {
    if clip.freeze_frame.is_some() {
        return clip.freeze_duration.unwrap_or(2.0).clamp(0.1, 30.0);
    }
    clip_speed_segments(clip)
        .iter()
        .map(|(start, end, speed)| (end - start) / speed)
        .sum::<f64>()
        .max(0.001)
}

/// 可変速・逆再生・フリーズ用の素材列を作り、背景/前景/音声の入力ラベルを返す。
fn build_advanced_clip_sources(
    index: usize,
    clip: &crate::ClipParams,
    main_has_audio: bool,
    source_fps: f64,
) -> (String, String, String, String) {
    if let Some(frame) = clip.freeze_frame {
        let duration = clip.freeze_duration.unwrap_or(2.0).clamp(0.1, 30.0);
        let frame_duration = source_frame_duration(source_fps);
        let last_frame = (clip.end - frame_duration).max(clip.start);
        let frame = frame.clamp(clip.start, last_frame);
        let freeze_fps = 1.0 / frame_duration;
        let tail_padding = (clip.end + frame_duration).max(frame_duration);
        let graph = format!(
            "[0:v]fps=fps={freeze_fps:.6}:round=down,tpad=stop_mode=clone:stop_duration={tail_padding:.6},trim=start={frame:.6}:end={:.6},setpts=PTS-STARTPTS,trim=end_frame=1,tpad=stop_mode=clone:stop_duration={duration:.6},trim=duration={duration:.6},split=2[adv_bg_{index}][adv_game_{index}];anullsrc=r=48000:cl=stereo:d={duration:.6}[adv_a_{index}];",
            clip.end
        );
        return (
            graph,
            format!("adv_bg_{index}"),
            format!("adv_game_{index}"),
            format!("adv_a_{index}"),
        );
    }

    let mut segments = clip_speed_segments(clip);
    if clip.reverse {
        segments.reverse();
    }
    let mut graph = String::new();
    let mut video_inputs = String::new();
    let mut audio_inputs = String::new();
    for (segment_index, (start, end, speed)) in segments.iter().enumerate() {
        let reverse_video = if clip.reverse { ",reverse" } else { "" };
        let reverse_audio = if clip.reverse { ",areverse" } else { "" };
        let atempo = build_atempo_chain(*speed);
        graph.push_str(&format!(
            "[0:v]trim=start={start:.6}:end={end:.6}{reverse_video},setpts=(PTS-STARTPTS)/{speed:.6}[adv_v_{index}_{segment_index}];"
        ));
        if main_has_audio {
            graph.push_str(&format!(
                "[0:a]atrim=start={start:.6}:end={end:.6}{reverse_audio},asetpts=PTS-STARTPTS,{atempo}[adv_as_{index}_{segment_index}];"
            ));
        } else {
            let output_duration = (end - start).max(0.001) / speed.max(0.25);
            graph.push_str(&format!(
                "anullsrc=r=48000:cl=stereo:d={output_duration:.6}[adv_as_{index}_{segment_index}];"
            ));
        }
        video_inputs.push_str(&format!("[adv_v_{index}_{segment_index}]"));
        audio_inputs.push_str(&format!("[adv_as_{index}_{segment_index}]"));
    }
    let count = segments.len().max(1);
    graph.push_str(&format!(
        "{video_inputs}concat=n={count}:v=1:a=0,split=2[adv_bg_{index}][adv_game_{index}];{audio_inputs}concat=n={count}:v=0:a=1[adv_a_{index}];"
    ));
    (
        graph,
        format!("adv_bg_{index}"),
        format!("adv_game_{index}"),
        format!("adv_a_{index}"),
    )
}

pub fn build_commentary_filter(params: &FilterParams) -> (String, String, String) {
    if params.layout_kind == "source" {
        return build_source_filter(params);
    }
    let portrait_layout = params.layout_kind == "portrait";
    let stage_layout = params.layout_kind == "stage";
    let game_h = if portrait_layout {
        OUT_H
    } else if stage_layout {
        1440
    } else {
        GAME_H
    };
    let crop_ratio = if portrait_layout {
        "9/16"
    } else if stage_layout {
        "3/4"
    } else {
        "16/9"
    };
    let game_y: u32 = if portrait_layout {
        0
    } else {
        match params.game_y {
            Some(gy) => gy.saturating_sub(game_h / 2),
            None => (OUT_H - game_h) / 2,
        }
    };

    let mut f = String::with_capacity(1024);
    let game_scale = params.game_scale.clamp(1.0, 2.5);

    let analyzed_focus_x = params
        .crop_data
        .and_then(|data| data.split(';').next())
        .and_then(|entry| {
            let parts: Vec<&str> = entry.split(',').collect();
            if parts.len() < 5 {
                return None;
            }
            let x = parts[1].parse::<f64>().ok()?;
            let width = parts[3].parse::<f64>().ok()?;
            Some(x + width / 2.0)
        });

    // 0. NLEシーケンス。背景と前景を別々に構築することで、クリップ固有の
    // 回転・反転・不透明度を前景だけへ適用し、背景ブラーは安定して維持する。
    let (background_base, game_base, a_base) = if params.clips.is_empty() {
        let audio_base = if params.main_has_audio {
            "0:a".to_string()
        } else {
            f.push_str(&format!(
                "anullsrc=r=48000:cl=stereo:d={:.6}[main_silence];",
                params.timeline_duration.max(0.001)
            ));
            "[main_silence]".to_string()
        };
        ("[0:v]".to_string(), "[0:v]".to_string(), audio_base)
    } else {
        let mut trim_exprs = String::new();
        let mut concat_bg_inputs = String::new();
        let mut concat_game_inputs = String::new();
        let mut concat_a_inputs = String::new();

        for (i, clip) in params.clips.iter().enumerate() {
            if clip.is_gap.unwrap_or(false) {
                let gap_dur = clip.start.max(0.001);
                trim_exprs.push_str(&format!(
                    "color=c=black:s={OUT_W}x{OUT_H}:r=30:d={dur}[vbg_{i}];\
                     color=c=black@0.0:s={OUT_W}x{game_h}:r=30:d={dur},format=rgba[vgame_{i}];\
                     anullsrc=r=48000:cl=stereo:d={dur}[ag_{i}];",
                    dur = gap_dur,
                    i = i
                ));
                concat_bg_inputs.push_str(&format!("[vbg_{}]", i));
                concat_game_inputs.push_str(&format!("[vgame_{}]", i));
                concat_a_inputs.push_str(&format!("[ag_{}]", i));
            } else {
                let speed = clip.speed.unwrap_or(1.0).clamp(0.25, 4.0);
                let volume_base = if clip.muted.unwrap_or(false) {
                    0.0
                } else {
                    clip.volume.unwrap_or(1.0).clamp(0.0, 2.0)
                };
                let volume = keyframe_expression(&clip.keyframes, "volume", volume_base, "t");
                let clip_scale = clip.scale.unwrap_or(1.0).clamp(1.0, 3.0);
                let clip_duration = clip_output_duration(clip);
                let combined_scale = (game_scale * clip_scale).clamp(1.0, 7.5);
                let scale_base = keyframe_expression(&clip.keyframes, "scale", clip_scale, "it");
                let scale_expr = apply_motion_scale_expression(
                    apply_zoom_transition_expression(
                        scale_base,
                        &clip.transition_in,
                        &clip.transition_out,
                        "it",
                        clip_duration,
                    ),
                    &clip.motion_preset,
                    "it",
                );
                let position_x = clip.position_x.unwrap_or(0.0).clamp(-1.0, 1.0);
                let position_y = clip.position_y.unwrap_or(0.0).clamp(-1.0, 1.0);
                let position_x_base =
                    keyframe_expression(&clip.keyframes, "positionX", position_x, "t");
                let (_, position_x_expr) = apply_transition_expressions(
                    "1".to_string(),
                    position_x_base,
                    &clip.transition_in,
                    &clip.transition_out,
                    "t",
                    clip_duration,
                );
                let position_y_expr = apply_motion_y_expression(
                    keyframe_expression(&clip.keyframes, "positionY", position_y, "t"),
                    &clip.motion_preset,
                    "t",
                );
                let rotation = clip.rotation.unwrap_or(0.0).clamp(-180.0, 180.0);
                let opacity = clip.opacity.unwrap_or(1.0).clamp(0.0, 1.0);
                let crop_x = analyzed_focus_x
                    .map(|focus_x| {
                        format!(
                            "max(0\\,min(iw-ow\\,{focus_x:.2}-ow/2+({position_x_expr})*(iw-ow)/2))"
                        )
                    })
                    .unwrap_or_else(|| {
                        format!("max(0\\,min(iw-ow\\,(iw-ow)*(({position_x_expr})+1)/2))")
                    });
                let crop_y = format!("max(0\\,min(ih-oh\\,(ih-oh)*(({position_y_expr})+1)/2))");
                let mut transforms = String::new();
                if clip.flip_horizontal.unwrap_or(false) {
                    transforms.push_str(",hflip");
                }
                if clip.flip_vertical.unwrap_or(false) {
                    transforms.push_str(",vflip");
                }
                let rotation_base = keyframe_expression(&clip.keyframes, "rotation", rotation, "t");
                let rotation_expr = apply_motion_rotation_expression(
                    apply_rotation_transition_expression(
                        rotation_base,
                        &clip.transition_in,
                        &clip.transition_out,
                        "t",
                        clip_duration,
                    ),
                    &clip.motion_preset,
                    "t",
                );
                if rotation.abs() > 0.001
                    || clip
                        .keyframes
                        .iter()
                        .any(|keyframe| keyframe.property == "rotation")
                    || clip
                        .transition_in
                        .as_ref()
                        .is_some_and(|value| value.r#type == "rotate")
                    || clip
                        .transition_out
                        .as_ref()
                        .is_some_and(|value| value.r#type == "rotate")
                    || clip.motion_preset.as_deref() == Some("swing")
                {
                    transforms.push_str(&format!(
                        ",rotate='({rotation_expr})*PI/180':ow=iw:oh=ih:c=black@0"
                    ));
                }
                let opacity_base = keyframe_expression(&clip.keyframes, "opacity", opacity, "T");
                let (opacity_expr, _) = apply_transition_expressions(
                    opacity_base,
                    "0".to_string(),
                    &clip.transition_in,
                    &clip.transition_out,
                    "T",
                    clip_duration,
                );
                let has_opacity_animation = clip
                    .keyframes
                    .iter()
                    .any(|keyframe| keyframe.property == "opacity")
                    || transition_progress_expression(
                        &clip.transition_in,
                        "T",
                        clip_duration,
                        true,
                    )
                    .is_some_and(|(kind, _)| kind == "fade" || kind == "dissolve")
                    || transition_progress_expression(
                        &clip.transition_out,
                        "T",
                        clip_duration,
                        false,
                    )
                    .is_some_and(|(kind, _)| kind == "fade" || kind == "dissolve");
                let opacity_filter = if has_opacity_animation {
                    format!(",geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({opacity_expr})'")
                } else {
                    format!(",colorchannelmixer=aa={opacity:.6}")
                };
                let color_filter = build_color_filter(&clip.color);
                let visual_effect_filter = build_visual_effect_filter(&clip.effects);
                let has_zoom_keys = clip.keyframes.iter().any(|keyframe| {
                    matches!(
                        keyframe.property.as_str(),
                        "scale" | "positionX" | "positionY"
                    )
                }) || clip
                    .transition_in
                    .as_ref()
                    .is_some_and(|value| value.r#type == "zoom")
                    || clip
                        .transition_out
                        .as_ref()
                        .is_some_and(|value| value.r#type == "zoom");
                let has_zoom_keys = has_zoom_keys
                    || matches!(clip.motion_preset.as_deref(), Some("pop" | "bounce"));
                let game_filter = if has_zoom_keys {
                    let zoom_x =
                        keyframe_expression(&clip.keyframes, "positionX", position_x, "it");
                    let zoom_y = apply_motion_y_expression(
                        keyframe_expression(&clip.keyframes, "positionY", position_y, "it"),
                        &clip.motion_preset,
                        "it",
                    );
                    format!(
                        "crop=ih*({crop_ratio}):ih:(iw-ow)/2:(ih-oh)/2,zoompan=z='{game_scale:.6}*({scale_expr})':x='iw/2-iw/zoom/2+({zoom_x})*(iw-iw/zoom)/2':y='ih/2-ih/zoom/2+({zoom_y})*(ih-ih/zoom)/2':d=1:s={OUT_W}x{game_h}:fps=30"
                    )
                } else {
                    format!(
                        "crop=ih*({crop_ratio})/{combined_scale:.6}:ih/{combined_scale:.6}:{crop_x}:{crop_y},scale={OUT_W}:{game_h}"
                    )
                };
                let audio_effect_filter =
                    build_audio_effect_filter(&clip.audio_effects, clip_duration);
                let advanced =
                    clip.freeze_frame.is_some() || clip.reverse || !clip.speed_curve.is_empty();
                if advanced {
                    let (graph, bg_source, game_source, audio_source) = build_advanced_clip_sources(
                        i,
                        clip,
                        params.main_has_audio,
                        params.source_fps,
                    );
                    trim_exprs.push_str(&graph);
                    trim_exprs.push_str(&format!(
                        "[{bg_source}]fps=30,scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,crop={OUT_W}:{OUT_H},gblur=sigma=30:steps=2[vbg_{i}];[{game_source}]fps=30{transforms},{game_filter}{color_filter}{visual_effect_filter},format=rgba{opacity_filter}[vgame_{i}];[{audio_source}]anull{audio_effect_filter},volume='{volume}':eval=frame[at_{i}];"
                    ));
                } else {
                    let atempo = build_atempo_chain(speed);
                    let audio_source = if params.main_has_audio {
                        format!(
                            "[0:a]atrim=start={}:end={},asetpts=PTS-STARTPTS,{}{},volume='{}':eval=frame[at_{}];",
                            clip.start,
                            clip.end,
                            atempo,
                            audio_effect_filter,
                            volume,
                            i
                        )
                    } else {
                        format!(
                            "anullsrc=r=48000:cl=stereo:d={:.6}[at_{}];",
                            clip_duration, i
                        )
                    };
                    trim_exprs.push_str(&format!(
                        "[0:v]trim=start={start}:end={end},setpts=(PTS-STARTPTS)/{speed:.6},fps=30,\
                         scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,crop={OUT_W}:{OUT_H},\
                         gblur=sigma=30:steps=2[vbg_{i}];\
                         [0:v]trim=start={start}:end={end},setpts=(PTS-STARTPTS)/{speed:.6},fps=30{transforms},\
                         {game_filter}{color_filter}{visual_effect_filter},format=rgba{opacity_filter}[vgame_{i}];\
                          {audio_source}",
                        start = clip.start,
                        end = clip.end,
                        i = i,
                        speed = speed,
                        transforms = transforms,
                        game_filter = game_filter,
                        opacity_filter = opacity_filter,
                        color_filter = color_filter,
                        visual_effect_filter = visual_effect_filter,
                        audio_source = audio_source,
                    ));
                }
                concat_bg_inputs.push_str(&format!("[vbg_{}]", i));
                concat_game_inputs.push_str(&format!("[vgame_{}]", i));
                concat_a_inputs.push_str(&format!("[at_{}]", i));
            }
        }

        let n = params.clips.len();
        f.push_str(&trim_exprs);
        f.push_str(&format!(
            "{concat_bg_inputs}concat=n={n}:v=1:a=0[sequence_bg];\
             {concat_game_inputs}concat=n={n}:v=1:a=0[sequence_game];\
             {concat_a_inputs}concat=n={n}:v=0:a=1[concat_a];",
            n = n,
            concat_bg_inputs = concat_bg_inputs,
            concat_game_inputs = concat_game_inputs,
            concat_a_inputs = concat_a_inputs
        ));

        (
            "[sequence_bg]".to_string(),
            "[sequence_game]".to_string(),
            "[concat_a]".to_string(),
        )
    };

    if params.clips.is_empty() {
        // 同梱FFmpeg 2026ビルドにはboxblurがないため、標準搭載のgblurを使う。
        if stage_layout {
            f.push_str(&format!(
                "{background_base}scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,\
                 crop={OUT_W}:{OUT_H},drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill[bg];",
            ));
        } else {
            f.push_str(&format!(
                "{background_base}scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,\
                 crop={OUT_W}:{OUT_H},gblur=sigma=30:steps=2[bg];",
            ));
        }
        let game_crop_x = analyzed_focus_x
            .map(|focus_x| format!("max(0\\,min(iw-ow\\,{focus_x:.2}-ow/2))"))
            .unwrap_or_else(|| "(iw-ow)/2".to_string());
        f.push_str(&format!(
            "{game_base}crop=ih*({crop_ratio})/{game_scale:.4}:ih/{game_scale:.4}:{game_crop_x}:(ih-oh)/2,scale={OUT_W}:{game_h}[game];",
        ));
    } else if stage_layout {
        f.push_str(&format!("{background_base}drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill[bg];{game_base}copy[game];"));
    } else {
        f.push_str(&format!("{background_base}copy[bg];{game_base}copy[game];"));
    }

    // 3. アバター画像リサイズ
    if params.has_avatar {
        let scaled_w = (864.0 * params.avatar_scale).round() as u32;
        f.push_str(&format!(
            "[1:v]scale='trunc(min({scaled_w},iw)/2)*2':-2[avatar_scaled];"
        ));
    }

    // 4. bg + game オーバーレイ
    let clamped_game_y = game_y.clamp(0, OUT_H);
    f.push_str(&format!("[bg][game]overlay=0:{}[tmp1];", clamped_game_y));

    // 5. tmp1 + avatar オーバーレイ
    if params.has_avatar {
        let ax = params.avatar_x.clamp(0, OUT_W);
        let ay = params.avatar_y.clamp(0, OUT_H);
        f.push_str(&format!(
            "[tmp1][avatar_scaled]overlay={ax}-w/2:{ay}-h/2[tmp2];"
        ));
    } else {
        f.push_str("[tmp1]copy[tmp2];");
    }

    // 6. 任意のV2+映像トラックを重ねる。track_orderが大きいものほど前面。
    let mut track_video_inputs: Vec<&TrackClipFilterParams> = params
        .track_clips
        .iter()
        .filter(|clip| clip.kind == "video" && clip.render_video)
        .collect();
    track_video_inputs.sort_by_key(|clip| clip.track_order);
    let mut pre_text_input = "tmp2".to_string();
    for (index, clip) in track_video_inputs.iter().enumerate() {
        let clip_duration = (clip.timeline_end - clip.timeline_start).max(0.001);
        let local_t = format!("t-{:.6}", clip.timeline_start.max(0.0));
        let local_cap_t = format!("T-{:.6}", clip.timeline_start.max(0.0));
        let mut transforms = String::new();
        if clip.flip_horizontal {
            transforms.push_str(",hflip");
        }
        if clip.flip_vertical {
            transforms.push_str(",vflip");
        }
        let has_rotation_keys = clip
            .keyframes
            .iter()
            .any(|keyframe| keyframe.property == "rotation");
        let rotation_base =
            keyframe_expression(&clip.keyframes, "rotation", clip.rotation, &local_t);
        let rotation_expr = apply_motion_rotation_expression(
            apply_rotation_transition_expression(
                rotation_base,
                &clip.transition_in,
                &clip.transition_out,
                &local_t,
                clip_duration,
            ),
            &clip.motion_preset,
            &local_t,
        );
        if clip.rotation.abs() > 0.001
            || has_rotation_keys
            || clip
                .transition_in
                .as_ref()
                .is_some_and(|value| value.r#type == "rotate")
            || clip
                .transition_out
                .as_ref()
                .is_some_and(|value| value.r#type == "rotate")
            || clip.motion_preset.as_deref() == Some("swing")
        {
            transforms.push_str(&format!(
                ",rotate='({rotation_expr})*PI/180':ow=rotw(iw):oh=roth(ih):c=black@0"
            ));
        }
        let scale_base = keyframe_expression(&clip.keyframes, "scale", clip.scale, &local_t);
        let scale_expr = apply_motion_scale_expression(
            apply_zoom_transition_expression(
                scale_base,
                &clip.transition_in,
                &clip.transition_out,
                &local_t,
                clip_duration,
            ),
            &clip.motion_preset,
            &local_t,
        );
        let opacity_base =
            keyframe_expression(&clip.keyframes, "opacity", clip.opacity, &local_cap_t);
        let position_x_base =
            keyframe_expression(&clip.keyframes, "positionX", clip.position_x, &local_t);
        let (opacity_expr, _) = apply_transition_expressions(
            opacity_base,
            "0".to_string(),
            &clip.transition_in,
            &clip.transition_out,
            &local_cap_t,
            clip_duration,
        );
        let (_, position_x_expr) = apply_transition_expressions(
            "1".to_string(),
            position_x_base,
            &clip.transition_in,
            &clip.transition_out,
            &local_t,
            clip_duration,
        );
        let has_opacity_animation = clip
            .keyframes
            .iter()
            .any(|keyframe| keyframe.property == "opacity")
            || transition_progress_expression(
                &clip.transition_in,
                &local_cap_t,
                clip_duration,
                true,
            )
            .is_some_and(|(kind, _)| kind == "fade" || kind == "dissolve")
            || transition_progress_expression(
                &clip.transition_out,
                &local_cap_t,
                clip_duration,
                false,
            )
            .is_some_and(|(kind, _)| kind == "fade" || kind == "dissolve");
        let opacity_filter = if has_opacity_animation {
            format!("geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({opacity_expr})'")
        } else {
            format!("colorchannelmixer=aa={:.6}", clip.opacity.clamp(0.0, 1.0))
        };
        let position_y_expr = apply_motion_y_expression(
            keyframe_expression(&clip.keyframes, "positionY", clip.position_y, &local_t),
            &clip.motion_preset,
            &local_t,
        );
        let x = format!("(W-w)/2+({position_x_expr})*(W-w)/2");
        let y = format!("(H-h)/2+({position_y_expr})*(H-h)/2");
        let prepared = format!("track_v_{index}");
        let scaled = format!("track_scaled_{index}");
        let composed = format!("track_out_{index}");
        let color_filter = build_color_filter(&clip.color);
        let visual_effect_filter = build_visual_effect_filter(&clip.effects);
        let effective_speed = if clip.speed >= 0.25 { clip.speed } else { 1.0 };
        let advanced_playback = clip.freeze_frame.is_some()
            || clip.reverse
            || !clip.speed_curve.is_empty()
            || (effective_speed - 1.0).abs() > 0.001;
        let source_prefix = if advanced_playback {
            let (graph, source) = build_track_advanced_source(index, clip, false);
            f.push_str(&graph);
            format!(
                "[{source}]setpts=PTS-STARTPTS+{:.3}/TB",
                clip.timeline_start.max(0.0)
            )
        } else {
            format!(
                "[{}:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS+{:.3}/TB",
                clip.input_index,
                clip.source_start.max(0.0),
                clip.source_end.max(clip.source_start + 0.001),
                clip.timeline_start.max(0.0)
            )
        };
        f.push_str(&format!(
            "{source_prefix}{}\
             ,scale='trunc(min({OUT_W},iw)*({scale_expr})/2)*2':-2:eval=frame{color_filter}{visual_effect_filter},format=rgba[{scaled}]\
             ;[{scaled}]{opacity_filter}[{prepared}]\
             ;[{pre_text_input}][{prepared}]overlay=x='{x}':y='{y}':enable='between(t,{:.3},{:.3})'[{composed}];",
            transforms,
            clip.timeline_start.max(0.0),
            clip.timeline_end.max(clip.timeline_start + 0.001),
            color_filter = color_filter,
            visual_effect_filter = visual_effect_filter,
        ));
        pre_text_input = composed;
    }

    // 7. 固定テキスト描画
    if params.header_text.is_empty() {
        f.push_str(&format!("[{pre_text_input}]copy[out_fixed]"));
    } else {
        let tx = params.header_x.clamp(0, OUT_W);
        let ty = params.header_y.clamp(0, OUT_H);
        let enable = match params.header_end_time {
            Some(end) if end > params.header_start_time => Some(format!(
                "between(t,{:.3},{:.3})",
                params.header_start_time.max(0.0),
                end
            )),
            _ if params.header_start_time > 0.0 => {
                Some(format!("gte(t,{:.3})", params.header_start_time))
            }
            _ => None,
        };
        let dt = build_drawtext(
            params.header_text,
            &params.header_style,
            &format!("{tx}-text_w/2"),
            &format!("{ty}-text_h/2"),
            enable.as_deref(),
            None,
        );
        f.push_str(&format!("[{pre_text_input}]{dt}[out_fixed]"));
    }

    // 8. 画像オーバーレイ
    if !params.overlay_images.is_empty() {
        let mut current_input = "out_fixed".to_string();
        for (i, (idx, ox, oy, scale, start_t, end_t)) in params.overlay_images.iter().enumerate() {
            let scaled_w = (540.0 * scale).round() as u32;
            let next_label = format!("ovi_{}", i);
            f.push_str(&format!(
                ";[{}:v]scale='trunc(min({},iw)/2)*2':-2[img_s_{}]",
                idx, scaled_w, i
            ));
            let enable = format!("between(t,{},{})", start_t, end_t);
            f.push_str(&format!(
                ";[{current_input}][img_s_{i}]overlay={ox}-w/2:{oy}-h/2:enable='{enable}'[{next_label}]"
            ));
            current_input = next_label;
        }
        // Rename last to out_fixed for continuity
        let last_label = format!("ovi_{}", params.overlay_images.len() - 1);
        // Replace out_fixed references downstream
        f = f.replace(&format!("[{}]", last_label), "[out_img]");
        // Now use out_img as the input to subtitle chain
        f.push_str(";[out_img]copy[out_fixed_final]");
    } else {
        f.push_str(";[out_fixed]copy[out_fixed_final]");
    }

    // 9. 任意の透かし。無効・空欄ならフィルターを追加しない。
    if params.watermark_text.is_empty() {
        f.push_str(";[out_fixed_final]copy[out_watermark]");
    } else {
        let margin = 38;
        let (x, y) = match params.watermark_position {
            "top-left" => (format!("{margin}"), format!("{margin}")),
            "top-right" => (format!("main_w-text_w-{margin}"), format!("{margin}")),
            "bottom-left" => (format!("{margin}"), format!("main_h-text_h-{margin}")),
            _ => (
                format!("main_w-text_w-{margin}"),
                format!("main_h-text_h-{margin}"),
            ),
        };
        let dt = build_drawtext(
            params.watermark_text,
            &params.watermark_style,
            &x,
            &y,
            None,
            Some(params.watermark_opacity),
        );
        f.push_str(&format!(";[out_fixed_final]{dt}[out_watermark]"));
    }

    // 10. ASS 字幕 (外部ファイル) or コピー
    if let Some(ref ass_path) = params.ass_file {
        // バックスラッシュをエスケープ (Windows パス対応)
        let escaped_path = escape_filter_path(ass_path);
        let fonts_dir = params
            .ass_fonts_dir
            .as_ref()
            .map(|path| format!(":fontsdir='{}'", escape_filter_path(path)))
            .unwrap_or_default();
        f.push_str(&format!(
            ";[out_watermark]ass='{}'{}[out]",
            escaped_path, fonts_dir
        ));
    } else {
        f.push_str(";[out_watermark]copy[out]");
    }

    // 11. ジャンプカット/選択 (NLEの場合は前段で処理済みなのでそのままパススルー)
    let v_after_cut = "[out]";
    let a_after_cut = &a_base;

    // 11. SE + BGM + 任意A2+/動画クリップ音声をミックス
    let has_se = !params.se_slots.is_empty();
    let has_bgm = params.bgm_index.is_some();
    let track_audio_inputs: Vec<&TrackClipFilterParams> = params
        .track_clips
        .iter()
        .filter(|clip| clip.render_audio && clip.has_audio && !clip.muted)
        .collect();

    if has_se || has_bgm || !track_audio_inputs.is_empty() {
        // メイン音声のボリューム設定
        let main_vol = if params.ducking_enabled {
            params.ducking_main_voice
        } else {
            1.0
        };
        let main_audio_input = if a_after_cut.starts_with('[') {
            a_after_cut.to_string()
        } else {
            format!("[{a_after_cut}]")
        };
        f.push_str(&format!(
            ";{}volume={:.2}[a_main]",
            main_audio_input, main_vol
        ));

        f.push_str(&format!(
            ";anullsrc=r=48000:cl=stereo:d={:.6}[a_timeline_base]",
            params.timeline_duration.max(0.001)
        ));
        let mut audio_inputs = vec!["[a_timeline_base]".to_string(), "[a_main]".to_string()];
        let mut audio_count = 2;

        // BGM処理
        if let Some(bgm_i) = params.bgm_index {
            let bgm_vol = if params.ducking_enabled {
                params.ducking_bgm
            } else {
                params.bgm_volume
            };
            let delay_ms = (params.bgm_timeline_start.max(0.0) * 1000.0).round() as u64;
            let trim = params
                .bgm_duration
                .map(|duration| format!(",atrim=duration={:.3}", duration.max(0.0)))
                .unwrap_or_default();
            f.push_str(&format!(
                ";[{}:a]atrim=start=0{},asetpts=PTS-STARTPTS,volume={:.2},adelay={}|{}[a_bgm]",
                bgm_i, trim, bgm_vol, delay_ms, delay_ms
            ));
            audio_inputs.push("[a_bgm]".to_string());
            audio_count += 1;
        }

        // SE処理
        for (si, (se_idx, se_vol, trigger_ms)) in params.se_slots.iter().enumerate() {
            let actual_vol = if params.ducking_enabled {
                se_vol * params.ducking_se
            } else {
                *se_vol
            };
            let delay_ms = (trigger_ms * 1000.0) as u64;
            f.push_str(&format!(
                ";[{}:a]volume={:.2},adelay={}|{}[a_se_{}]",
                se_idx, actual_vol, delay_ms, delay_ms, si
            ));
            audio_inputs.push(format!("[a_se_{}]", si));
            audio_count += 1;
        }

        for (track_index, clip) in track_audio_inputs.iter().enumerate() {
            let delay_ms = (clip.timeline_start.max(0.0) * 1000.0).round() as u64;
            let volume = keyframe_expression(&clip.keyframes, "volume", clip.volume, "t");
            let audio_effect_filter = build_audio_effect_filter(
                &clip.audio_effects,
                (clip.timeline_end - clip.timeline_start).max(0.001),
            );
            let effective_speed = if clip.speed >= 0.25 { clip.speed } else { 1.0 };
            let advanced_playback = clip.freeze_frame.is_some()
                || clip.reverse
                || !clip.speed_curve.is_empty()
                || (effective_speed - 1.0).abs() > 0.001;
            let source_prefix = if advanced_playback {
                let (graph, source) = build_track_advanced_source(track_index, clip, true);
                f.push_str(&format!(";{graph}"));
                format!("[{source}]anull")
            } else {
                format!(
                    "[{}:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS",
                    clip.input_index,
                    clip.source_start.max(0.0),
                    clip.source_end.max(clip.source_start + 0.001)
                )
            };
            f.push_str(&format!(
                ";{source_prefix}{audio_effect_filter},volume='{}':eval=frame,adelay={}|{}[a_track_{}]",
                volume,
                delay_ms,
                delay_ms,
                track_index,
            ));
            audio_inputs.push(format!("[a_track_{}]", track_index));
            audio_count += 1;
        }

        // 全音声をミックス
        let inputs_str: String = audio_inputs.join("");
        f.push_str(&format!(
            ";{}amix=inputs={}:duration=longest:dropout_transition=2,atrim=duration={:.6}[a_mixed]",
            inputs_str,
            audio_count,
            params.timeline_duration.max(0.001)
        ));

        (f, v_after_cut.to_string(), "[a_mixed]".to_string())
    } else {
        let final_a = if *a_after_cut == "0:a" {
            "0:a?"
        } else {
            a_after_cut
        };
        (f, v_after_cut.to_string(), final_a.to_string())
    }
}

/// center レイアウト用 vf フィルター文字列を生成する
#[cfg(test)]
pub fn build_center_filter(
    crop_data: &Option<String>,
    bgm_index: Option<usize>,
    bgm_volume: f64,
) -> (String, String, String) {
    let vf = if let Some(data) = crop_data {
        if !data.is_empty() {
            let entries: Vec<&str> = data.split(';').collect();
            if let Some(first) = entries.first() {
                let parts: Vec<&str> = first.split(',').collect();
                if parts.len() >= 5 {
                    format!(
                        "crop={}:{}:{}:{},scale=trunc(iw/2)*2:trunc(ih/2)*2",
                        parts[3], parts[4], parts[1], parts[2]
                    )
                } else {
                    "crop=ih*(9/16):ih:(iw-ow)/2:0,scale=trunc(iw/2)*2:trunc(ih/2)*2".to_string()
                }
            } else {
                "crop=ih*(9/16):ih:(iw-ow)/2:0,scale=trunc(iw/2)*2:trunc(ih/2)*2".to_string()
            }
        } else {
            "crop=ih*(9/16):ih:(iw-ow)/2:0,scale=trunc(iw/2)*2:trunc(ih/2)*2".to_string()
        }
    } else {
        "crop=ih*(9/16):ih:(iw-ow)/2:0,scale=trunc(iw/2)*2:trunc(ih/2)*2".to_string()
    };

    if let Some(i) = bgm_index {
        let filter = format!(
            "{};[0:a]volume=1.0[a0];[{}:a]volume={:.2}[a1];\
             [a0][a1]amix=inputs=2:duration=longest:dropout_transition=2[a_mixed]",
            vf, i, bgm_volume
        );
        (filter, "".to_string(), "[a_mixed]".to_string())
    } else {
        (vf, "".to_string(), "0:a?".to_string())
    }
}

// ============================================================
// Tests
// ============================================================
#[cfg(test)]
mod tests {
    use super::*;

    fn render_capability_contract() -> serde_json::Value {
        serde_json::from_str(include_str!("../../../src/lib/renderCapabilities.json"))
            .expect("render capability contract must be valid JSON")
    }

    #[test]
    fn visual_effect_capability_contract_matches_ffmpeg_filters() {
        let contract = render_capability_contract();
        for entry in contract["visualEffects"]
            .as_array()
            .expect("visualEffects must be an array")
        {
            let id = entry["id"].as_str().expect("effect id");
            let marker = entry["ffmpegMarker"].as_str().expect("FFmpeg marker");
            let mut value = serde_json::json!({});
            value[id] = match id {
                "chroma" => serde_json::json!({
                    "enabled": true,
                    "color": "#00ff00",
                    "similarity": 18.0,
                    "blend": 2.0
                }),
                "mask" => serde_json::json!({
                    "shape": "ellipse",
                    "x": 0.5,
                    "y": 0.5,
                    "width": 0.8,
                    "height": 0.8,
                    "feather": 4.0
                }),
                _ => serde_json::json!(50.0),
            };
            let effects: crate::ClipVisualEffects =
                serde_json::from_value(value).expect("contract effect must deserialize");
            let filter = build_visual_effect_filter(&Some(effects));
            assert!(
                filter.contains(marker),
                "effect {id} must compile marker {marker}; filter={filter}"
            );
        }
    }

    #[test]
    fn color_capability_contract_matches_ffmpeg_filters() {
        let contract = render_capability_contract();
        let entries = contract["color"]
            .as_array()
            .expect("color must be an array");
        let numeric_marker = entries[0]["ffmpegMarker"].as_str().expect("numeric marker");
        let lut_marker = entries[1]["ffmpegMarker"].as_str().expect("LUT marker");
        let baseline = build_color_filter(&Some(crate::ClipColorAdjustments::default()));
        for field in entries[0]["fields"].as_array().expect("numeric fields") {
            let field = field.as_str().expect("numeric field id");
            let mut value = serde_json::to_value(crate::ClipColorAdjustments::default())
                .expect("default color must serialize");
            value[field] = match field {
                "contrast" | "saturation" => serde_json::json!(125.0),
                // 白レベルを正方向へ動かすと上限1.0で飽和するため、負値で接続を検証する。
                "whites" => serde_json::json!(-12.0),
                _ => serde_json::json!(12.0),
            };
            let color: crate::ClipColorAdjustments =
                serde_json::from_value(value).expect("numeric color field must deserialize");
            let filter = build_color_filter(&Some(color));
            assert!(filter.contains(numeric_marker), "{field}: numeric marker");
            assert_ne!(filter, baseline, "{field}: filter output must change");
        }
        let color = crate::ClipColorAdjustments {
            lut_path: Some("C:\\looks\\film.cube".into()),
            ..Default::default()
        };
        assert!(build_color_filter(&Some(color)).contains(lut_marker));
    }

    #[test]
    fn audio_effect_capability_contract_matches_ffmpeg_filters() {
        let contract = render_capability_contract();
        for entry in contract["audioEffects"]
            .as_array()
            .expect("audioEffects must be an array")
        {
            let id = entry["id"].as_str().expect("audio effect id");
            let marker = entry["ffmpegMarker"].as_str().expect("audio FFmpeg marker");
            let mut value = serde_json::to_value(crate::ClipAudioEffects::default())
                .expect("default audio effects must serialize");
            value[id] = if id == "normalize" {
                serde_json::json!(true)
            } else {
                serde_json::json!(2.0)
            };
            let effects: crate::ClipAudioEffects =
                serde_json::from_value(value).expect("audio effect must deserialize");
            let filter = build_audio_effect_filter(&Some(effects), 5.0);
            assert!(filter.contains(marker), "{id}: filter={filter}");
        }
    }

    #[test]
    fn transition_capability_contract_matches_ffmpeg_expressions() {
        let contract = render_capability_contract();
        for entry in contract["transitions"]
            .as_array()
            .expect("transitions must be an array")
        {
            let id = entry["id"].as_str().expect("transition id");
            if id == "none" {
                continue;
            }
            let transition = Some(crate::ClipTransition {
                r#type: id.to_string(),
                duration: 0.5,
            });
            let (kind, _) = transition_progress_expression(&transition, "t", 2.0, true)
                .expect("contract transition must compile");
            assert_eq!(kind, id);
            let target = entry["target"].as_str().expect("transition target");
            match target {
                "opacity" => assert_ne!(
                    apply_transition_expressions(
                        "1".into(),
                        "0".into(),
                        &transition,
                        &None,
                        "t",
                        2.0
                    )
                    .0,
                    "1"
                ),
                "positionX" => assert_ne!(
                    apply_transition_expressions(
                        "1".into(),
                        "0".into(),
                        &transition,
                        &None,
                        "t",
                        2.0
                    )
                    .1,
                    "0"
                ),
                "scale" => assert_ne!(
                    apply_zoom_transition_expression("1".into(), &transition, &None, "t", 2.0),
                    "1"
                ),
                "rotation" => assert_ne!(
                    apply_rotation_transition_expression("0".into(), &transition, &None, "t", 2.0),
                    "0"
                ),
                other => panic!("unsupported transition target in contract: {other}"),
            }
        }
    }

    fn default_style<'a>() -> TextStyle<'a> {
        TextStyle {
            font: "Arial",
            color: "#FFFFFF",
            size: 44,
            stroke_color: "#000000",
            stroke_width: 3,
            shadow_color: "black",
            shadow_blur: 0,
        }
    }

    fn default_params<'a>() -> FilterParams<'a> {
        FilterParams {
            output_width: 1080,
            output_height: 1920,
            header_text: "Header",
            header_style: default_style(),
            header_x: 540,
            header_y: 115,
            header_start_time: 0.0,
            header_end_time: None,
            watermark_text: "",
            watermark_style: default_style(),
            watermark_position: "bottom-right",
            watermark_opacity: 0.55,
            has_avatar: true,
            avatar_x: 540,
            avatar_y: 1498,
            avatar_scale: 1.0,
            game_y: None,
            game_scale: 1.0,
            layout_kind: "commentary",
            crop_data: None,
            ass_file: None,
            ass_fonts_dir: None,
            clips: vec![],
            main_has_audio: true,
            timeline_duration: 10.0,
            source_fps: 30.0,
            bgm_index: None,
            bgm_volume: 0.5,
            bgm_timeline_start: 0.0,
            bgm_duration: None,
            se_slots: vec![],
            overlay_images: vec![],
            track_clips: vec![],
            ducking_enabled: false,
            ducking_main_voice: 1.0,
            ducking_bgm: 0.15,
            ducking_se: 1.0,
        }
    }

    #[test]
    fn test_build_commentary_filter_output() {
        let (f, v_map, a_map) = build_commentary_filter(&default_params());
        assert!(f.contains("drawtext"));
        assert!(f.contains("overlay"));
        assert!(f.contains("gblur=sigma=30:steps=2"));
        assert!(!f.contains("boxblur"));
        assert!(f.contains("[out]"));
        assert_eq!(v_map, "[out]");
        assert_eq!(a_map, "0:a?");
    }

    #[test]
    fn test_portrait_layout_fills_the_vertical_canvas() {
        let mut params = default_params();
        params.layout_kind = "portrait";
        params.has_avatar = false;
        let (filter, _, _) = build_commentary_filter(&params);
        assert!(filter.contains("crop=ih*(9/16)/1.0000:ih/1.0000"));
        assert!(filter.contains("scale=1080:1920[game]"));
        assert!(filter.contains("overlay=0:0[tmp1]"));
    }

    #[test]
    fn test_source_layout_preserves_landscape_canvas_and_ignores_editing_layers() {
        let mut params = default_params();
        params.layout_kind = "source";
        params.output_width = 1920;
        params.output_height = 1080;
        params.clips = vec![crate::ClipParams {
            start: 5.0,
            end: 12.0,
            ..Default::default()
        }];
        let (filter, video, audio) = build_commentary_filter(&params);
        assert!(filter.contains("scale=1920:1080:force_original_aspect_ratio=decrease"));
        assert!(filter.contains("pad=1920:1080"));
        assert!(filter.contains("format=yuv420p"));
        assert!(filter.contains("aresample=48000"));
        assert!(filter.contains("channel_layouts=stereo"));
        assert!(filter.contains("trim=start=5.000000:end=12.000000"));
        assert!(!filter.contains("drawtext"));
        assert!(!filter.contains("gblur"));
        assert_eq!(video, "[out]");
        assert_eq!(audio, "[a_source]");
    }

    #[test]
    fn test_source_layout_accepts_portrait_output() {
        let mut params = default_params();
        params.layout_kind = "source";
        params.output_width = 1080;
        params.output_height = 1920;
        params.clips.clear();
        let (filter, _, audio) = build_commentary_filter(&params);
        assert!(filter.contains("scale=1080:1920:force_original_aspect_ratio=decrease"));
        assert_eq!(audio, "0:a?");
    }

    #[test]
    fn smoke_source_rough_cut_with_real_video_when_configured() {
        let Some(video_path) = std::env::var_os("TATECLIP_ROUGH_CUT_SMOKE_VIDEO") else {
            return;
        };
        let ffmpeg_path =
            std::env::var_os("TATECLIP_NLE_SMOKE_FFMPEG").unwrap_or_else(|| "ffmpeg".into());
        let output_path = std::env::temp_dir().join(format!(
            "tateclip-rough-cut-smoke-{}.mp4",
            uuid::Uuid::new_v4()
        ));
        let mut params = default_params();
        params.layout_kind = "source";
        params.output_width = 1920;
        params.output_height = 1080;
        params.clips = vec![
            crate::ClipParams {
                start: 0.0,
                end: 2.0,
                ..Default::default()
            },
            crate::ClipParams {
                start: 4.0,
                end: 6.0,
                ..Default::default()
            },
        ];
        let (filter, video_map, audio_map) = build_commentary_filter(&params);
        let output = std::process::Command::new(ffmpeg_path)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(video_path)
            .args([
                "-filter_complex",
                &filter,
                "-map",
                &video_map,
                "-map",
                &audio_map,
                "-c:v",
                "libopenh264",
                "-b:v",
                "3M",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&output_path)
            .output()
            .expect("failed to launch FFmpeg rough-cut smoke");

        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "rough-cut smoke failed: {stderr}");
        assert!(
            std::fs::metadata(&output_path)
                .map(|value| value.len())
                .unwrap_or(0)
                > 10_000,
            "rough-cut smoke output is missing or too small"
        );
        let _ = std::fs::remove_file(output_path);
    }

    #[test]
    fn test_stage_layout_uses_black_bars_and_three_by_four_crop() {
        let mut params = default_params();
        params.layout_kind = "stage";
        params.game_y = Some(960);
        params.has_avatar = false;
        let (filter, _, _) = build_commentary_filter(&params);
        assert!(filter.contains("drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill[bg]"));
        assert!(filter.contains("crop=ih*(3/4)/1.0000:ih/1.0000"));
        assert!(filter.contains("scale=1080:1440[game]"));
        assert!(filter.contains("overlay=0:240[tmp1]"));
    }

    #[test]
    fn test_arbitrary_video_and_audio_tracks_are_compiled() {
        let mut params = default_params();
        params.header_text = "";
        params.has_avatar = false;
        params.track_clips = vec![
            TrackClipFilterParams {
                input_index: 1,
                kind: "video".to_string(),
                timeline_start: 0.5,
                timeline_end: 2.5,
                source_start: 1.0,
                source_end: 3.0,
                volume: 0.8,
                muted: false,
                has_audio: false,
                track_order: 0,
                render_video: true,
                render_audio: false,
                position_x: 0.25,
                position_y: -0.2,
                scale: 0.75,
                rotation: 5.0,
                flip_horizontal: false,
                flip_vertical: false,
                opacity: 0.9,
                keyframes: vec![],
                transition_in: None,
                transition_out: None,
                ..Default::default()
            },
            TrackClipFilterParams {
                input_index: 2,
                kind: "audio".to_string(),
                timeline_start: 1.0,
                timeline_end: 3.0,
                source_start: 2.0,
                source_end: 4.0,
                volume: 0.6,
                muted: false,
                has_audio: true,
                track_order: 1,
                render_video: false,
                render_audio: true,
                position_x: 0.0,
                position_y: 0.0,
                scale: 1.0,
                rotation: 0.0,
                flip_horizontal: false,
                flip_vertical: false,
                opacity: 1.0,
                keyframes: vec![],
                transition_in: None,
                transition_out: None,
                ..Default::default()
            },
        ];

        let (filter, video_map, audio_map) = build_commentary_filter(&params);

        assert!(filter.contains("[1:v]trim=start=1.000:end=3.000"));
        assert!(filter.contains("setpts=PTS-STARTPTS+0.500/TB"));
        assert!(filter.contains("colorchannelmixer=aa=0.900000"));
        assert!(filter.contains("between(t,0.500,2.500)"));
        assert!(filter.contains("[2:a]atrim=start=2.000:end=4.000"));
        assert!(filter.contains("adelay=1000|1000"));
        assert_eq!(video_map, "[out]");
        assert_eq!(audio_map, "[a_mixed]");
    }

    #[test]
    fn capability_filters_are_connected_to_the_completed_track_graph() {
        let mut params = default_params();
        params.header_text = "";
        params.has_avatar = false;
        params.track_clips = vec![
            TrackClipFilterParams {
                input_index: 1,
                kind: "video".into(),
                timeline_start: 0.0,
                timeline_end: 2.0,
                source_start: 0.0,
                source_end: 2.0,
                render_video: true,
                position_x: 0.0,
                position_y: 0.0,
                scale: 1.0,
                opacity: 1.0,
                color: Some(crate::ClipColorAdjustments {
                    brightness: 8.0,
                    contrast: 110.0,
                    saturation: 115.0,
                    temperature: 12.0,
                    tint: 4.0,
                    highlights: -5.0,
                    shadows: 7.0,
                    blacks: -3.0,
                    whites: 5.0,
                    hue: 4.0,
                    hsl_saturation: 6.0,
                    lightness: 2.0,
                    curve_shadows: 3.0,
                    curve_midtones: -2.0,
                    curve_highlights: 4.0,
                    lut_path: Some("C:\\looks\\film.cube".into()),
                }),
                ..Default::default()
            },
            TrackClipFilterParams {
                input_index: 2,
                kind: "audio".into(),
                timeline_start: 0.0,
                timeline_end: 2.0,
                source_start: 0.0,
                source_end: 2.0,
                volume: 1.0,
                has_audio: true,
                render_audio: true,
                audio_effects: Some(crate::ClipAudioEffects {
                    eq_low: 2.0,
                    eq_mid: 2.0,
                    eq_high: 2.0,
                    normalize: true,
                    noise_reduction: 20.0,
                    fade_in: 0.2,
                    fade_out: 0.2,
                }),
                ..Default::default()
            },
        ];

        let (filter, _, _) = build_commentary_filter(&params);
        let contract = render_capability_contract();
        for entry in contract["color"].as_array().expect("color") {
            assert!(filter.contains(entry["ffmpegMarker"].as_str().expect("color marker")));
        }
        for entry in contract["audioEffects"].as_array().expect("audioEffects") {
            let marker = entry["ffmpegMarker"].as_str().expect("audio marker");
            assert!(
                filter.contains(marker),
                "completed graph must contain {marker}"
            );
        }
    }

    #[test]
    fn test_build_commentary_filter_custom_params() {
        let params = FilterParams {
            output_width: 1080,
            output_height: 1920,
            header_text: "テスト",
            header_style: TextStyle {
                font: "Noto Sans JP",
                color: "#FFD700",
                ..default_style()
            },
            header_x: 200,
            header_y: 300,
            header_start_time: 0.0,
            header_end_time: Some(3.0),
            watermark_text: "",
            watermark_style: default_style(),
            watermark_position: "bottom-right",
            watermark_opacity: 0.55,
            has_avatar: true,
            avatar_x: 540,
            avatar_y: 1400,
            avatar_scale: 0.8,
            game_y: Some(650),
            game_scale: 1.5,
            layout_kind: "commentary",
            crop_data: None,
            ass_file: None,
            ass_fonts_dir: None,
            clips: vec![],
            main_has_audio: true,
            timeline_duration: 10.0,
            source_fps: 30.0,
            bgm_index: None,
            bgm_volume: 0.5,
            bgm_timeline_start: 0.0,
            bgm_duration: None,
            se_slots: vec![],
            overlay_images: vec![],
            track_clips: vec![],
            ducking_enabled: false,
            ducking_main_voice: 1.0,
            ducking_bgm: 0.15,
            ducking_se: 1.0,
        };
        let (f, _, _) = build_commentary_filter(&params);
        assert!(f.contains("0xFFD700"));
        assert!(f.contains("200"));
        assert!(f.contains("crop=ih*(16/9)/1.5000:ih/1.5000"));
        assert!(f.contains("enable='between(t,0.000,3.000)'"));
        let expected_font =
            escape_filter_path(&crate::font::resolve_font_reference("Noto Sans JP", "テスト").path);
        assert!(f.contains(&format!("fontfile='{expected_font}'")));
    }

    #[test]
    fn test_japanese_title_uses_a_font_with_japanese_glyphs() {
        let style = TextStyle {
            font: "Segoe UI",
            ..default_style()
        };
        let filter = build_drawtext_with_resolver(
            "爆音ルンバ",
            &style,
            "0",
            "0",
            None,
            None,
            |_reference, text| {
                assert_eq!(text, "爆音ルンバ");
                crate::font::FontResolution {
                    path: r"C:\fixtures\japanese-bold.ttf".to_string(),
                    family: "Fixture Japanese".to_string(),
                    fallback_used: true,
                    is_bold: true,
                    warning: None,
                }
            },
        );
        assert!(filter.contains("japanese-bold.ttf"));
        assert!(!filter.contains("segoeui.ttf"));
    }

    #[test]
    fn test_text_watermark_is_top_level_and_uses_opacity() {
        let mut params = default_params();
        params.watermark_text = "@creator";
        params.watermark_position = "top-right";
        params.watermark_opacity = 0.4;
        let (filter, _, _) = build_commentary_filter(&params);
        assert!(filter.contains("text='@creator'"));
        assert!(filter.contains("fontcolor=0xFFFFFF@0.40"));
        assert!(filter.contains("x=main_w-text_w-38:y=38"));
        assert!(filter.contains("[out_watermark]"));
    }

    #[test]
    fn test_bgm_is_trimmed_and_delayed_on_timeline() {
        let mut params = default_params();
        params.bgm_index = Some(1);
        params.bgm_timeline_start = 3.25;
        params.bgm_duration = Some(8.5);
        let (f, _, a_map) = build_commentary_filter(&params);
        assert!(f.contains("atrim=start=0,atrim=duration=8.500"));
        assert!(f.contains("adelay=3250|3250[a_bgm]"));
        assert_eq!(a_map, "[a_mixed]");
    }

    #[test]
    fn test_silent_main_uses_timeline_silence_and_longest_audio_mix() {
        let mut params = default_params();
        params.main_has_audio = false;
        params.bgm_index = Some(1);
        params.timeline_duration = 12.5;

        let (filter, _, audio_map) = build_commentary_filter(&params);

        assert!(!filter.contains("[0:a]"));
        assert!(filter.contains("anullsrc=r=48000:cl=stereo:d=12.500000"));
        assert!(filter.contains("[main_silence]"));
        assert!(filter.contains("duration=longest:dropout_transition=2"));
        assert!(filter.contains("atrim=duration=12.500000[a_mixed]"));
        assert_eq!(audio_map, "[a_mixed]");
    }

    #[test]
    fn test_freeze_at_media_end_uses_source_fps_and_selects_one_available_frame() {
        let mut params = default_params();
        params.source_fps = 24.0;
        params.clips = vec![crate::ClipParams {
            is_gap: Some(false),
            start: 2.0,
            end: 10.0,
            freeze_frame: Some(10.0),
            freeze_duration: Some(2.0),
            ..Default::default()
        }];

        let (filter, _, _) = build_commentary_filter(&params);

        assert!(filter.contains("fps=fps=24.000000:round=down,tpad=stop_mode=clone"));
        assert!(filter.contains("stop_duration=10.041667,trim=start=9.958333"));
        assert!(filter
            .contains("trim=start=9.958333:end=10.000000,setpts=PTS-STARTPTS,trim=end_frame=1"));
        assert!(!filter.contains("trim=start=10.000000:end=10.000000"));
    }

    #[test]
    fn test_track_freeze_does_not_require_a_frame_inside_one_average_frame_window() {
        let clip = TrackClipFilterParams {
            input_index: 1,
            kind: "video".to_string(),
            timeline_start: 0.0,
            timeline_end: 2.0,
            source_start: 1.0,
            source_end: 8.0,
            source_fps: 24.0,
            volume: 1.0,
            muted: false,
            has_audio: false,
            track_order: 1,
            render_video: true,
            render_audio: false,
            position_x: 0.0,
            position_y: 0.0,
            scale: 1.0,
            rotation: 0.0,
            flip_horizontal: false,
            flip_vertical: false,
            opacity: 1.0,
            keyframes: vec![],
            transition_in: None,
            transition_out: None,
            motion_preset: None,
            color: None,
            effects: None,
            speed: 1.0,
            speed_curve: vec![],
            reverse: false,
            freeze_frame: Some(5.0),
            audio_effects: None,
        };

        let (filter, _) = build_track_advanced_source(0, &clip, false);
        assert!(filter.contains("fps=fps=24.000000:round=down"));
        assert!(filter.contains("stop_duration=8.041667,trim=start=5.000000"));
        assert!(filter.contains("trim=start=5.000000:end=8.000000"));
        assert!(filter.contains("trim=end_frame=1,tpad=stop_mode=clone"));
        assert!(!filter.contains("end=5.041667"));
    }

    #[test]
    fn test_commentary_filter_uses_analyzed_focal_point() {
        let mut params = default_params();
        params.crop_data = Some("0.0,100,50,400,700");
        let (f, _, _) = build_commentary_filter(&params);
        assert!(f.contains("300.00-ow/2"));
    }

    #[test]
    fn test_nle_sequence_splits_concat_video_for_background_and_game() {
        let mut params = default_params();
        params.clips = vec![crate::ClipParams {
            is_gap: Some(false),
            start: 5.0,
            end: 10.0,
            ..Default::default()
        }];
        let (f, _, _) = build_commentary_filter(&params);
        assert!(f.contains("[vbg_0]concat=n=1:v=1:a=0[sequence_bg]"));
        assert!(f.contains("[vgame_0]concat=n=1:v=1:a=0[sequence_game]"));
        assert!(f.contains("trim=start=5:end=10"));
        assert!(f.contains("atrim=start=5:end=10"));
        assert!(!f.contains("start_t="));
        assert!(f.contains("gblur=sigma=30:steps=2[vbg_0]"));
        assert!(f.contains("[sequence_game]copy[game]"));
    }

    #[test]
    fn test_nle_clip_speed_transform_and_audio_are_compiled() {
        let mut params = default_params();
        params.clips = vec![crate::ClipParams {
            is_gap: Some(false),
            start: 2.0,
            end: 8.0,
            speed: Some(2.0),
            volume: Some(0.4),
            muted: Some(false),
            position_x: Some(0.5),
            position_y: Some(-0.25),
            scale: Some(1.5),
            rotation: Some(90.0),
            flip_horizontal: Some(true),
            flip_vertical: Some(false),
            opacity: Some(0.6),
            keyframes: vec![],
            transition_in: Some(crate::ClipTransition {
                r#type: "zoom".into(),
                duration: 0.5,
            }),
            transition_out: Some(crate::ClipTransition {
                r#type: "rotate".into(),
                duration: 0.5,
            }),
            motion_preset: Some("pop".into()),
            ..Default::default()
        }];

        let (f, _, _) = build_commentary_filter(&params);
        assert!(f.contains("setpts=(PTS-STARTPTS)/2.000000"));
        assert!(f.contains(",hflip,rotate='((90.000000)+(18.0)*(1-("));
        assert!(f.contains("1.28-0.28*("));
        assert!(f.contains("colorchannelmixer=aa=0.600000"));
        assert!(f.contains("atempo=2.000000,volume='0.400000':eval=frame"));
        assert!(f.contains("+(0.500000)*(iw-iw/zoom)/2"));
        assert!(f.contains("+(-0.250000)*(ih-ih/zoom)/2"));
    }

    #[test]
    fn smoke_nle_clip_effects_with_real_video_when_configured() {
        let Some(video_path) = std::env::var_os("TATECLIP_NLE_SMOKE_VIDEO") else {
            return;
        };
        let ffmpeg_path =
            std::env::var_os("TATECLIP_NLE_SMOKE_FFMPEG").unwrap_or_else(|| "ffmpeg".into());
        let output_path =
            std::env::temp_dir().join(format!("tateclip-nle-smoke-{}.mp4", std::process::id()));

        let mut params = default_params();
        params.header_text = "";
        params.watermark_text = "TateClip Smoke";
        params.watermark_position = "bottom-right";
        params.watermark_opacity = 0.45;
        params.has_avatar = false;
        params.clips = vec![crate::ClipParams {
            is_gap: Some(false),
            start: 2.0,
            end: 8.0,
            speed: Some(2.0),
            volume: Some(0.4),
            muted: Some(false),
            position_x: Some(0.5),
            position_y: Some(-0.25),
            scale: Some(1.5),
            rotation: Some(12.0),
            flip_horizontal: Some(true),
            flip_vertical: Some(false),
            opacity: Some(0.6),
            keyframes: vec![],
            transition_in: Some(crate::ClipTransition {
                r#type: "zoom".into(),
                duration: 0.5,
            }),
            transition_out: Some(crate::ClipTransition {
                r#type: "rotate".into(),
                duration: 0.5,
            }),
            color: Some(crate::ClipColorAdjustments {
                brightness: 8.0,
                contrast: 110.0,
                saturation: 115.0,
                temperature: 12.0,
                tint: 4.0,
                highlights: -5.0,
                shadows: 7.0,
                blacks: -3.0,
                whites: 5.0,
                hue: 4.0,
                hsl_saturation: 6.0,
                lightness: 2.0,
                curve_shadows: 3.0,
                curve_midtones: -2.0,
                curve_highlights: 4.0,
                ..Default::default()
            }),
            effects: Some(crate::ClipVisualEffects {
                blur: 1.0,
                mosaic: 0.0,
                motion_blur: 12.0,
                sharpen: 10.0,
                noise: 8.0,
                vhs: 4.0,
                film: 5.0,
                glitch: 3.0,
                rgb_shift: 4.0,
                glow: 3.0,
                light_leak: 4.0,
                lens_flare: 3.0,
                rain: 2.0,
                snow: 2.0,
                fire: 2.0,
                particles: 2.0,
                shake: 3.0,
                warp: 3.0,
                chromatic_aberration: 4.0,
                chroma: crate::ClipChromaKey::default(),
                mask: crate::ClipMask {
                    shape: "ellipse".into(),
                    x: 0.5,
                    y: 0.5,
                    width: 0.9,
                    height: 0.9,
                    feather: 2.0,
                },
            }),
            motion_preset: Some("pop".into()),
            speed_curve: vec![
                crate::SpeedCurvePoint {
                    position: 0.0,
                    speed: 1.0,
                },
                crate::SpeedCurvePoint {
                    position: 0.5,
                    speed: 1.5,
                },
                crate::SpeedCurvePoint {
                    position: 1.0,
                    speed: 0.75,
                },
            ],
            reverse: true,
            audio_effects: Some(crate::ClipAudioEffects {
                eq_low: 2.0,
                eq_mid: 0.0,
                eq_high: 1.0,
                normalize: false,
                noise_reduction: 10.0,
                fade_in: 0.1,
                fade_out: 0.1,
            }),
            ..Default::default()
        }];
        let (filter, video_map, audio_map) = build_commentary_filter(&params);

        let output = std::process::Command::new(ffmpeg_path)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(video_path)
            .args([
                "-filter_complex",
                &filter,
                "-map",
                &video_map,
                "-map",
                &audio_map,
            ])
            .args([
                "-c:v",
                "libopenh264",
                "-b:v",
                "3M",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&output_path)
            .output()
            .expect("failed to launch FFmpeg NLE smoke");

        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "FFmpeg NLE smoke failed: {stderr}");
        let bytes = std::fs::metadata(&output_path)
            .expect("NLE smoke output was not created")
            .len();
        assert!(
            bytes > 10_000,
            "NLE smoke output is unexpectedly small: {bytes}"
        );
        let _ = std::fs::remove_file(output_path);
    }

    #[test]
    fn smoke_arbitrary_tracks_with_real_media_when_configured() {
        let (Some(main_path), Some(overlay_path), Some(audio_path)) = (
            std::env::var_os("TATECLIP_TRACK_SMOKE_MAIN"),
            std::env::var_os("TATECLIP_TRACK_SMOKE_OVERLAY"),
            std::env::var_os("TATECLIP_TRACK_SMOKE_AUDIO"),
        ) else {
            return;
        };
        let ffmpeg_path =
            std::env::var_os("TATECLIP_NLE_SMOKE_FFMPEG").unwrap_or_else(|| "ffmpeg".into());
        let output_path =
            std::env::temp_dir().join(format!("tateclip-track-smoke-{}.mp4", std::process::id()));
        let mut params = default_params();
        params.header_text = "";
        params.has_avatar = false;
        params.track_clips = vec![
            TrackClipFilterParams {
                input_index: 1,
                kind: "video".to_string(),
                timeline_start: 0.5,
                timeline_end: 2.5,
                source_start: 0.0,
                source_end: 2.0,
                volume: 1.0,
                muted: false,
                has_audio: false,
                track_order: 0,
                render_video: true,
                render_audio: false,
                position_x: 0.35,
                position_y: -0.25,
                scale: 0.6,
                rotation: 8.0,
                flip_horizontal: false,
                flip_vertical: false,
                opacity: 0.85,
                keyframes: vec![
                    crate::ClipKeyframe {
                        id: "kf-scale".into(),
                        time: 1.0,
                        property: "scale".into(),
                        value: 0.9,
                        interpolation: "linear".into(),
                    },
                    crate::ClipKeyframe {
                        id: "kf-x".into(),
                        time: 1.0,
                        property: "positionX".into(),
                        value: -0.2,
                        interpolation: "linear".into(),
                    },
                    crate::ClipKeyframe {
                        id: "kf-rotate".into(),
                        time: 1.0,
                        property: "rotation".into(),
                        value: -5.0,
                        interpolation: "linear".into(),
                    },
                    crate::ClipKeyframe {
                        id: "kf-opacity".into(),
                        time: 1.0,
                        property: "opacity".into(),
                        value: 0.4,
                        interpolation: "linear".into(),
                    },
                ],
                transition_in: Some(crate::ClipTransition {
                    r#type: "dissolve".into(),
                    duration: 0.5,
                }),
                transition_out: Some(crate::ClipTransition {
                    r#type: "slide".into(),
                    duration: 0.5,
                }),
                ..Default::default()
            },
            TrackClipFilterParams {
                input_index: 2,
                kind: "audio".to_string(),
                timeline_start: 1.0,
                timeline_end: 3.0,
                source_start: 0.0,
                source_end: 2.0,
                volume: 0.6,
                muted: false,
                has_audio: true,
                track_order: 1,
                render_video: false,
                render_audio: true,
                position_x: 0.0,
                position_y: 0.0,
                scale: 1.0,
                rotation: 0.0,
                flip_horizontal: false,
                flip_vertical: false,
                opacity: 1.0,
                keyframes: vec![crate::ClipKeyframe {
                    id: "kf-volume".into(),
                    time: 1.0,
                    property: "volume".into(),
                    value: 1.2,
                    interpolation: "linear".into(),
                }],
                transition_in: None,
                transition_out: None,
                ..Default::default()
            },
        ];
        let (filter, video_map, audio_map) = build_commentary_filter(&params);
        let output = std::process::Command::new(ffmpeg_path)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(main_path)
            .arg("-i")
            .arg(overlay_path)
            .arg("-i")
            .arg(audio_path)
            .args([
                "-filter_complex",
                &filter,
                "-map",
                &video_map,
                "-map",
                &audio_map,
            ])
            .args([
                "-c:v",
                "libopenh264",
                "-b:v",
                "3M",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-t",
                "3",
            ])
            .arg(&output_path)
            .output()
            .expect("failed to launch FFmpeg arbitrary-track smoke");

        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            output.status.success(),
            "FFmpeg arbitrary-track smoke failed: {stderr}"
        );
        let bytes = std::fs::metadata(&output_path)
            .expect("arbitrary-track smoke output was not created")
            .len();
        assert!(
            bytes > 10_000,
            "arbitrary-track smoke output is unexpectedly small: {bytes}"
        );
        let probe = std::process::Command::new(
            std::env::var_os("TATECLIP_NLE_SMOKE_FFMPEG").unwrap_or_else(|| "ffmpeg".into()),
        )
        .arg("-i")
        .arg(&output_path)
        .output()
        .expect("failed to probe arbitrary-track smoke output");
        let probe_text = String::from_utf8_lossy(&probe.stderr);
        assert!(
            probe_text.contains("Video:"),
            "smoke output has no video stream: {probe_text}"
        );
        assert!(
            probe_text.contains("Audio:"),
            "smoke output has no audio stream: {probe_text}"
        );
        let _ = std::fs::remove_file(output_path);
    }

    #[test]
    fn test_build_center_filter_default() {
        let (f, _, _) = build_center_filter(&None, None, 0.5);
        assert!(f.contains("9/16"));
    }

    #[test]
    fn test_build_center_filter_with_crop_data() {
        let data = Some("0.0,100,50,400,300".to_string());
        let (f, _, _) = build_center_filter(&data, None, 0.5);
        assert!(f.contains("crop=400:300:100:50"));
    }
}
