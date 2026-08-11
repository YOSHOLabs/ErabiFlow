/// ffmpeg/ass.rs — ASS (Advanced SubStation Alpha) 字幕ファイル生成
///
/// TextSegment[] + スタイル情報 → .ass ファイルを生成する。
/// FFmpeg の `ass` フィルタで読み込み、drawtext チェーンを完全に置き換える。
use crate::TextSegment;

// ============================================================
// ASS スタイル定義
// ============================================================

pub struct AssStyle {
    pub font: String,
    pub size: u32,
    /// ASS Primary Color (&HAABBGGRR format)
    pub color: String,
    /// ASS Outline Color
    pub outline_color: String,
    pub outline_width: u32,
    /// ASS Shadow/Back Color
    pub shadow_color: String,
    pub shadow_depth: u32,
    /// ASS Alignment (2 = bottom-center, 8 = top-center, 5 = middle-center)
    pub alignment: u8,
    /// 垂直マージン (PlayResY の座標系)
    pub margin_v: u32,
    pub bold: bool,
    pub emphasis_mode: String,
    pub emphasis_color: String,
}

// ============================================================
// CSS色 → ASS色 変換
// ============================================================

/// CSS色表記 (#RRGGBB, rgba(), etc.) を ASS色表記 (&HAABBGGRR) に変換する。
/// ASS は BGR 順で、アルファは 00=不透明, FF=完全透明 という独自仕様。
fn css_color_to_ass(css: &str) -> String {
    let css = css.trim();

    // #RRGGBB or #RRGGBBAA
    if css.starts_with('#') && css.len() >= 7 {
        let r = u8::from_str_radix(&css[1..3], 16).unwrap_or(255);
        let g = u8::from_str_radix(&css[3..5], 16).unwrap_or(255);
        let b = u8::from_str_radix(&css[5..7], 16).unwrap_or(255);
        let a: u8 = if css.len() >= 9 {
            // CSS alpha は 00=透明, FF=不透明。ASS は逆。
            255 - u8::from_str_radix(&css[7..9], 16).unwrap_or(255)
        } else {
            0 // 不透明
        };
        return format!("&H{:02X}{:02X}{:02X}{:02X}", a, b, g, r);
    }

    // rgba(r,g,b,a) — a は 0.0〜1.0
    if css.starts_with("rgba(") {
        let inner = css.trim_start_matches("rgba(").trim_end_matches(')');
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() == 4 {
            let r: u8 = parts[0].trim().parse().unwrap_or(255);
            let g: u8 = parts[1].trim().parse().unwrap_or(255);
            let b: u8 = parts[2].trim().parse().unwrap_or(255);
            let a: f64 = parts[3].trim().parse().unwrap_or(1.0);
            let ass_alpha = ((1.0 - a) * 255.0) as u8;
            return format!("&H{:02X}{:02X}{:02X}{:02X}", ass_alpha, b, g, r);
        }
    }

    // rgb(r,g,b)
    if css.starts_with("rgb(") {
        let inner = css.trim_start_matches("rgb(").trim_end_matches(')');
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() == 3 {
            let r: u8 = parts[0].trim().parse().unwrap_or(255);
            let g: u8 = parts[1].trim().parse().unwrap_or(255);
            let b: u8 = parts[2].trim().parse().unwrap_or(255);
            return format!("&H00{:02X}{:02X}{:02X}", b, g, r);
        }
    }

    // 名前付き色のフォールバック
    match css.to_lowercase().as_str() {
        "white" => "&H00FFFFFF".to_string(),
        "black" => "&H00000000".to_string(),
        "red" => "&H000000FF".to_string(),
        "yellow" => "&H0000FFFF".to_string(),
        _ => "&H00FFFFFF".to_string(),
    }
}

/// フォント名を ASS 用に正規化する
fn normalize_font_name(font: &str) -> String {
    let clean = font
        .trim()
        .trim_matches(|character| character == '\'' || character == '"');
    if clean.is_empty() {
        "Meiryo".to_string()
    } else {
        clean.to_string()
    }
}

// ============================================================
// タイムコード変換
// ============================================================

/// 秒数を ASS タイムコード (H:MM:SS.CC) に変換する
fn secs_to_ass_time(secs: f64) -> String {
    let total_cs = (secs * 100.0).round() as u64;
    let cs = total_cs % 100;
    let total_secs = total_cs / 100;
    let s = total_secs % 60;
    let total_mins = total_secs / 60;
    let m = total_mins % 60;
    let h = total_mins / 60;
    format!("{}:{:02}:{:02}.{:02}", h, m, s, cs)
}

// ============================================================
// ASS ファイル生成
// ============================================================

/// TextSegment 配列と AssStyle から .ass ファイルを生成する
pub fn generate_ass_file(
    segments: &[TextSegment],
    style: &AssStyle,
    output_path: &str,
    canvas_width: u32,
    canvas_height: u32,
) -> Result<(), String> {
    let mut content = String::with_capacity(4096);

    // ---- [Script Info] ----
    content.push_str("[Script Info]\r\n");
    content.push_str("ScriptType: v4.00+\r\n");
    content.push_str(&format!("PlayResX: {}\r\n", canvas_width));
    content.push_str(&format!("PlayResY: {}\r\n", canvas_height));
    content.push_str("WrapStyle: 0\r\n");
    content.push_str("ScaledBorderAndShadow: yes\r\n");
    content.push_str("\r\n");

    // ---- [V4+ Styles] ----
    content.push_str("[V4+ Styles]\r\n");
    content.push_str(
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\r\n"
    );

    let font_name = normalize_font_name(&style.font);
    let primary_color = if style.emphasis_mode == "karaoke" {
        &style.emphasis_color
    } else {
        &style.color
    };
    let secondary_color = &style.color;
    let outline_color = &style.outline_color;
    let shadow_color = &style.shadow_color;

    content.push_str(&format!(
        "Style: Default,{font},{size},{primary},{secondary},{outline},{shadow},{bold},0,0,0,100,100,0,0,1,{border},{shadow_d},{align},10,10,{margin_v},1\r\n",
        font = font_name,
        size = style.size,
        primary = primary_color,
        secondary = secondary_color,
        outline = outline_color,
        shadow = shadow_color,
        border = style.outline_width,
        shadow_d = style.shadow_depth,
        align = style.alignment,
        margin_v = style.margin_v,
        bold = if style.bold { 1 } else { 0 },
    ));
    content.push_str("\r\n");

    // ---- [Events] ----
    content.push_str("[Events]\r\n");
    content.push_str(
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\n",
    );

    for seg in segments {
        let start = secs_to_ass_time(seg.start_time);
        let end = secs_to_ass_time(seg.end_time);

        // ASS テキストのエスケープ: 改行は \N、{ } はそのまま使える
        let plain_text = seg.text.replace('\n', "\\N").replace('\r', "");
        let override_style = seg.style_override.as_ref();
        let emphasis_mode = override_style
            .and_then(|value| value.emphasis_mode.as_deref())
            .unwrap_or(&style.emphasis_mode);
        let styled_text = if emphasis_mode == "karaoke" {
            build_karaoke_text(&plain_text, seg.end_time - seg.start_time)
        } else {
            plain_text
        };
        let text = apply_segment_style(
            styled_text,
            override_style,
            style,
            canvas_width,
            canvas_height,
        );

        content.push_str(&format!(
            "Dialogue: 0,{start},{end},Default,,0,0,0,,{text}\r\n",
            start = start,
            end = end,
            text = text,
        ));
    }

    // ファイル書き込み (UTF-8 BOM 付き — ASS の慣例)
    let bom = b"\xEF\xBB\xBF";
    let mut output = Vec::with_capacity(bom.len() + content.len());
    output.extend_from_slice(bom);
    output.extend_from_slice(content.as_bytes());

    std::fs::write(output_path, &output)
        .map_err(|e| format!("ASS ファイルの書き込みに失敗: {}", e))?;

    log::info!(
        "Generated ASS file: {} ({} segments)",
        output_path,
        segments.len()
    );
    Ok(())
}

fn apply_segment_style(
    text: String,
    override_style: Option<&crate::SubtitleStyleOverride>,
    base: &AssStyle,
    canvas_width: u32,
    canvas_height: u32,
) -> String {
    let Some(style) = override_style else {
        return text;
    };

    let color = style
        .color
        .as_deref()
        .map(css_color_to_ass)
        .unwrap_or_else(|| base.color.clone());
    let emphasis_mode = style
        .emphasis_mode
        .as_deref()
        .unwrap_or(&base.emphasis_mode);
    let emphasis_color = style
        .emphasis_color
        .as_deref()
        .map(css_color_to_ass)
        .unwrap_or_else(|| base.emphasis_color.clone());
    let primary = if emphasis_mode == "karaoke" {
        emphasis_color
    } else {
        color.clone()
    };
    let outline = style
        .stroke_color
        .as_deref()
        .map(css_color_to_ass)
        .unwrap_or_else(|| base.outline_color.clone());
    let shadow = style
        .shadow_color
        .as_deref()
        .map(css_color_to_ass)
        .unwrap_or_else(|| base.shadow_color.clone());
    let size = style.size.unwrap_or(base.size);
    let border = style.stroke_width.unwrap_or(base.outline_width);
    let shadow_depth = style.shadow_blur.unwrap_or(base.shadow_depth).min(10);

    let mut tags = format!(
        "{{\\fs{size}\\1c{primary}\\2c{secondary}\\3c{outline}\\4c{shadow}\\bord{border}\\shad{shadow_depth}",
        secondary = color,
    );
    if let Some(font) = style.font.as_deref() {
        let safe_font: String = normalize_font_name(font)
            .chars()
            .filter(|character| !matches!(character, '{' | '}' | '\\'))
            .collect();
        if !safe_font.is_empty() {
            tags.push_str(&format!("\\fn{}", safe_font));
        }
    }
    if let Some(position_y) = style.position_y {
        let y = (position_y.clamp(0.0, 1.0) * canvas_height as f64).round() as u32;
        tags.push_str(&format!("\\an5\\pos({},{})", canvas_width / 2, y));
    }
    tags.push('}');
    format!("{tags}{text}")
}

/// ProcessParams のサブ構造体から AssStyle を構築するヘルパー
#[allow(clippy::too_many_arguments)] // Mirrors the stable ProcessParams subtitle-style fields.
pub fn build_ass_style_from_params(
    font: &str,
    color: &str,
    size: u32,
    stroke_color: &str,
    stroke_width: u32,
    shadow_color: &str,
    shadow_blur: u32,
    subtitle_y: f64,
    canvas_height: u32,
    bold: bool,
    emphasis_mode: &str,
    emphasis_color: &str,
) -> AssStyle {
    let margin_v = ((1.0 - subtitle_y) * canvas_height as f64).round() as u32;

    AssStyle {
        font: font.to_string(),
        size,
        color: css_color_to_ass(color),
        outline_color: css_color_to_ass(stroke_color),
        outline_width: stroke_width,
        shadow_color: css_color_to_ass(shadow_color),
        shadow_depth: shadow_blur.min(10), // ASS shadow は 0-10 が実用的
        alignment: 2,                      // bottom-center
        margin_v,
        bold,
        emphasis_mode: emphasis_mode.to_string(),
        emphasis_color: css_color_to_ass(emphasis_color),
    }
}

fn karaoke_chunks(text: &str) -> Vec<String> {
    if text.chars().any(char::is_whitespace) {
        let mut chunks = Vec::new();
        let mut current = String::new();
        for character in text.chars() {
            current.push(character);
            if character.is_whitespace() || "、。！？!?".contains(character) {
                chunks.push(std::mem::take(&mut current));
            }
        }
        if !current.is_empty() {
            chunks.push(current);
        }
        return chunks;
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut count = 0;
    for character in text.chars() {
        current.push(character);
        count += 1;
        if count >= 3 || "、。！？!?".contains(character) {
            chunks.push(std::mem::take(&mut current));
            count = 0;
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn build_karaoke_text(text: &str, duration: f64) -> String {
    let chunks = karaoke_chunks(text);
    if chunks.is_empty() {
        return text.to_string();
    }
    let total_units: usize = chunks
        .iter()
        .map(|chunk| {
            chunk
                .chars()
                .filter(|character| !character.is_whitespace())
                .count()
                .max(1)
        })
        .sum();
    let total_centiseconds = (duration.max(0.1) * 100.0).round() as usize;
    let mut remaining = total_centiseconds.max(chunks.len());
    let mut output = String::new();
    for (index, chunk) in chunks.iter().enumerate() {
        let units = chunk
            .chars()
            .filter(|character| !character.is_whitespace())
            .count()
            .max(1);
        let chunk_duration = if index + 1 == chunks.len() {
            remaining.max(1)
        } else {
            ((total_centiseconds * units) / total_units)
                .max(1)
                .min(remaining.saturating_sub(chunks.len() - index - 1))
        };
        remaining = remaining.saturating_sub(chunk_duration);
        output.push_str(&format!("{{\\kf{}}}{}", chunk_duration, chunk));
    }
    output
}

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_css_to_ass_hex() {
        assert_eq!(css_color_to_ass("#FFFFFF"), "&H00FFFFFF");
        assert_eq!(css_color_to_ass("#000000"), "&H00000000");
        assert_eq!(css_color_to_ass("#FF0000"), "&H000000FF"); // Red → BGR reversed
        assert_eq!(css_color_to_ass("#00FF00"), "&H0000FF00"); // Green
    }

    #[test]
    fn test_css_to_ass_named() {
        assert_eq!(css_color_to_ass("white"), "&H00FFFFFF");
        assert_eq!(css_color_to_ass("black"), "&H00000000");
    }

    #[test]
    fn test_secs_to_ass_time() {
        assert_eq!(secs_to_ass_time(0.0), "0:00:00.00");
        assert_eq!(secs_to_ass_time(5.5), "0:00:05.50");
        assert_eq!(secs_to_ass_time(65.33), "0:01:05.33");
        assert_eq!(secs_to_ass_time(3661.0), "1:01:01.00");
    }

    #[test]
    fn test_generate_ass_file() {
        let segments = vec![
            TextSegment {
                id: "1".to_string(),
                text: "こんにちは".to_string(),
                start_time: 0.0,
                end_time: 5.0,
                emotion: None,
                style_override: None,
            },
            TextSegment {
                id: "2".to_string(),
                text: "ありがとう".to_string(),
                start_time: 5.0,
                end_time: 10.0,
                emotion: None,
                style_override: None,
            },
        ];

        let style = AssStyle {
            font: "Meiryo".to_string(),
            size: 44,
            color: "&H00FFFFFF".to_string(),
            outline_color: "&H00000000".to_string(),
            outline_width: 3,
            shadow_color: "&H80000000".to_string(),
            shadow_depth: 0,
            alignment: 2,
            margin_v: 290,
            bold: true,
            emphasis_mode: "none".to_string(),
            emphasis_color: "&H0000E0FD".to_string(),
        };

        let path = std::env::temp_dir().join("test_vfocus.ass");
        let path_str = path.to_str().unwrap();

        let result = generate_ass_file(&segments, &style, path_str, 1080, 1920);
        assert!(result.is_ok());

        let content = std::fs::read_to_string(path_str).unwrap();
        // BOM があるので skip
        let content = content.trim_start_matches('\u{FEFF}');
        assert!(content.contains("[Script Info]"));
        assert!(content.contains("PlayResX: 1080"));
        assert!(content.contains("こんにちは"));
        assert!(content.contains("0:00:05.00"));

        // cleanup
        let _ = std::fs::remove_file(path_str);
    }

    #[test]
    fn test_karaoke_text_covers_full_duration() {
        let text = build_karaoke_text("このあと逆転", 1.2);
        assert!(text.contains("{\\kf"));
        assert!(text.contains("この"));
        assert!(text.ends_with("逆転"));
    }

    #[test]
    fn test_individual_subtitle_style_is_written_as_ass_overrides() {
        let segment = TextSegment {
            id: "styled".to_string(),
            text: "ここだけ強調".to_string(),
            start_time: 0.0,
            end_time: 1.5,
            emotion: None,
            style_override: Some(crate::SubtitleStyleOverride {
                font: Some("Yu Gothic".to_string()),
                color: Some("#FF0000".to_string()),
                size: Some(72),
                position_y: Some(0.65),
                emphasis_mode: Some("none".to_string()),
                ..Default::default()
            }),
        };
        let style = AssStyle {
            font: "Meiryo".to_string(),
            size: 40,
            color: "&H00FFFFFF".to_string(),
            outline_color: "&H00000000".to_string(),
            outline_width: 4,
            shadow_color: "&H80000000".to_string(),
            shadow_depth: 2,
            alignment: 2,
            margin_v: 192,
            bold: true,
            emphasis_mode: "karaoke".to_string(),
            emphasis_color: "&H0000E0FD".to_string(),
        };
        let path = std::env::temp_dir().join("test_vfocus_individual.ass");
        generate_ass_file(&[segment], &style, path.to_str().unwrap(), 1080, 1920).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("\\fs72"));
        assert!(content.contains("\\fnYu Gothic"));
        assert!(content.contains("\\1c&H000000FF"));
        assert!(content.contains("\\an5\\pos(540,1248)"));
        assert!(!content.contains("\\kf"));
        let _ = std::fs::remove_file(path);
    }
}
