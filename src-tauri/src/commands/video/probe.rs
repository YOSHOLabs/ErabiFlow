use regex::Regex;

use crate::VideoInfo;

pub(super) async fn probe_video(app: &tauri::AppHandle, path: &str) -> Result<String, String> {
    let output = crate::ffmpeg_runtime::output(app, ["-i", path]).await?;
    Ok(String::from_utf8_lossy(&output.stderr).to_string())
}

pub(super) fn probe_contains_video_stream(text: &str) -> bool {
    text.lines()
        .any(|line| line.contains("Stream #") && line.contains("Video:"))
}

pub(super) fn parse_render_progress(text: &str) -> (u64, f64, bool) {
    let mut frames = 0_u64;
    let mut seconds = 0.0_f64;
    let mut ended = false;
    for line in text.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        match key {
            "frame" => frames = value.trim().parse().unwrap_or(frames),
            // FFmpeg's out_time_us/out_time_ms values are microseconds despite
            // the historical out_time_ms name.
            "out_time_us" | "out_time_ms" => {
                seconds = value
                    .trim()
                    .parse::<f64>()
                    .map(|value| value / 1_000_000.0)
                    .unwrap_or(seconds)
            }
            "progress" if value.trim() == "end" => ended = true,
            _ => {}
        }
    }
    (frames, seconds, ended)
}

pub(crate) async fn get_video_info_inner(
    app: &tauri::AppHandle,
    path: &str,
) -> Result<VideoInfo, String> {
    let text = probe_video(app, path).await?;
    parse_video_info(&text)
}

fn parse_video_info(text: &str) -> Result<VideoInfo, String> {
    let dur_re = Regex::new(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)").map_err(|e| e.to_string())?;
    let duration = if let Some(caps) = dur_re.captures(text) {
        let h: f64 = caps[1].parse().unwrap_or(0.0);
        let m: f64 = caps[2].parse().unwrap_or(0.0);
        let s: f64 = caps[3].parse().unwrap_or(0.0);
        let cs: f64 = caps[4].parse().unwrap_or(0.0);
        h * 3600.0 + m * 60.0 + s + cs / 100.0
    } else {
        0.0
    };

    let video_line = text
        .lines()
        .find(|line| line.contains("Video:"))
        .unwrap_or("");
    let res_re = Regex::new(r"(\d{2,5})x(\d{2,5})").map_err(|e| e.to_string())?;
    let (encoded_width, encoded_height) = if let Some(caps) = res_re.captures(video_line) {
        (
            caps[1].parse().unwrap_or(1920u32),
            caps[2].parse().unwrap_or(1080u32),
        )
    } else {
        (1920, 1080)
    };

    // FFmpeg autorotates frames by default. Report display dimensions as well,
    // otherwise a 1920x1080 phone recording with rotate=90 is treated as a
    // landscape canvas while the decoded frames are actually portrait.
    let matrix_rotation_re =
        Regex::new(r"(?i)rotation of\s+(-?\d+(?:\.\d+)?)\s+degrees").map_err(|e| e.to_string())?;
    let metadata_rotation_re =
        Regex::new(r"(?im)^\s*rotate\s*:\s*(-?\d+(?:\.\d+)?)\s*$").map_err(|e| e.to_string())?;
    let rotation = matrix_rotation_re
        .captures(text)
        .or_else(|| metadata_rotation_re.captures(text))
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse::<f64>().ok())
        .unwrap_or(0.0);
    let normalized_rotation = rotation.rem_euclid(360.0);
    let swaps_dimensions =
        (normalized_rotation - 90.0).abs() < 0.5 || (normalized_rotation - 270.0).abs() < 0.5;
    let (width, height) = if swaps_dimensions {
        (encoded_height, encoded_width)
    } else {
        (encoded_width, encoded_height)
    };

    let fps_re =
        Regex::new(r"(?:^|[\s,])(\d+(?:\.\d+)?)\s+fps(?:[\s,]|$)").map_err(|e| e.to_string())?;
    let fps = text
        .lines()
        .find(|line| line.contains("Video:"))
        .and_then(|line| fps_re.captures(line))
        .and_then(|caps| caps.get(1))
        .and_then(|value| value.as_str().parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(30.0);

    Ok(VideoInfo {
        duration,
        width,
        height,
        fps,
        has_audio: text
            .lines()
            .any(|line| line.contains("Stream #") && line.contains("Audio:")),
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_render_progress, parse_video_info, probe_contains_video_stream};

    #[test]
    fn parses_video_metadata_from_the_video_stream_line() {
        let text = "Duration: 00:01:02.50\n  Stream #0:0: Video: h264, yuv420p, 1920x1080, 59.94 fps\n  Stream #0:1: Audio: aac";
        let info = parse_video_info(text).unwrap();
        assert_eq!(info.duration, 62.5);
        assert_eq!((info.width, info.height), (1920, 1080));
        assert_eq!(info.fps, 59.94);
        assert!(info.has_audio);
        assert!(probe_contains_video_stream(text));
    }

    #[test]
    fn swaps_display_dimensions_for_rotation_metadata() {
        let metadata = "Duration: 00:00:12.00\n  Stream #0:0: Video: h264, yuv420p, 1920x1080, 29.97 fps\n    Metadata:\n      rotate          : 90\n  Stream #0:1: Audio: aac";
        let info = parse_video_info(metadata).unwrap();
        assert_eq!((info.width, info.height), (1080, 1920));

        let display_matrix = "Duration: 00:00:12.00\n  Stream #0:0: Video: hevc, yuv420p, 3840x2160, 59.94 fps\n    Side data:\n      displaymatrix: rotation of -90.00 degrees";
        let info = parse_video_info(display_matrix).unwrap();
        assert_eq!((info.width, info.height), (2160, 3840));
    }

    #[test]
    fn ignores_non_video_dimensions_before_the_video_stream() {
        let text = "cover 600x600\nDuration: 00:00:01.00\n  Stream #0:0: Video: h264, yuv420p, 1280x720, 30 fps";
        let info = parse_video_info(text).unwrap();
        assert_eq!((info.width, info.height), (1280, 720));
    }

    #[test]
    fn progress_parser_uses_the_last_valid_values() {
        let progress = "frame=12\nout_time_us=1500000\nframe=bad\nprogress=end\n";
        assert_eq!(parse_render_progress(progress), (12, 1.5, true));
    }
}
