//! media_protocol — Tauriカスタムプロトコル `vfocus://` によるメディア配信
//!
//! `convertFileSrc` (asset://) の代替として、HTTP Range Request に対応した
//! ファイルストリーミングプロトコルを提供する。
//!
//! これにより:
//! - 2GB超の動画でも MEDIA_ERR_NETWORK が発生しない
//! - ファイアウォール警告なし（アプリ内部プロトコルのため）
//! - Seekが高速（Range Request対応）

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use tauri::http::{header, Response, StatusCode};
use tauri::Manager;

const MAX_CHUNK_SIZE: usize = 8 * 1024 * 1024;
const MAX_FONT_SIZE: u64 = 64 * 1024 * 1024;

/// レスポンスに CORS ヘッダーを付与するヘルパー関数
fn append_cors(mut res: Response<Vec<u8>>) -> Response<Vec<u8>> {
    let headers = res.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        header::HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        header::HeaderValue::from_static("GET, OPTIONS, HEAD"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        header::HeaderValue::from_static("Range, Content-Type"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        header::HeaderValue::from_static("Content-Range, Content-Length, Accept-Ranges"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        header::HeaderValue::from_static("nosniff"),
    );
    res
}

fn error_response(status: StatusCode, message: &'static [u8]) -> Response<Vec<u8>> {
    append_cors(
        Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(message.to_vec())
            .unwrap(),
    )
}

/// `vfocus://` カスタムプロトコルのリクエストハンドラ。
///
/// URL形式: `vfocus://media/<エンコード済みファイルパス>`
///  (Windows: `http://vfocus.localhost/media/<エンコード済みファイルパス>`)
pub fn handle_request<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: &tauri::http::Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    // CORS OPTIONS プリフライトのハンドリング
    if request.method() == "OPTIONS" {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, OPTIONS, HEAD")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range, Content-Type")
            .header(header::ACCESS_CONTROL_MAX_AGE, "86400")
            .body(Vec::new())
            .unwrap();
    }

    let uri = request.uri();

    // パスからファイルパスを抽出
    let raw_path = uri.path();
    let path_str = raw_path
        .strip_prefix("/media/")
        .unwrap_or(raw_path.trim_start_matches('/'));

    // URLデコード
    let file_path = match urlencoding_decode(path_str) {
        Some(p) => p,
        None => {
            return error_response(StatusCode::BAD_REQUEST, b"Invalid path encoding");
        }
    };

    // vfocus:// はメディア表示専用。さらに、ファイルダイアログ等を通じて
    // Tauriのasset scopeへ追加されたパスだけを公開する。
    let font_allowed = crate::font::is_font_path(&file_path)
        && (crate::font::is_trusted_system_font(&file_path)
            || crate::font::is_managed_font(app_handle, &file_path));
    let generated_allowed = crate::path_security::is_managed_generated_asset_path(
        app_handle,
        std::path::Path::new(&file_path),
    );
    if !is_supported_media_path(&file_path)
        || (!app_handle.asset_protocol_scope().is_allowed(&file_path)
            && !font_allowed
            && !generated_allowed)
    {
        log::warn!("[vfocus] Blocked out-of-scope media request");
        return error_response(StatusCode::FORBIDDEN, b"Media access denied");
    }

    // ファイルを開く
    let mut file = match File::open(&file_path) {
        Ok(f) => f,
        Err(e) => {
            log::warn!("[vfocus] File not found: {} — {}", file_path, e);
            return error_response(StatusCode::NOT_FOUND, b"Media file not found");
        }
    };

    let metadata = match file.metadata() {
        Ok(m) => m,
        Err(_) => {
            return append_cors(
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(b"Cannot read file metadata".to_vec())
                    .unwrap(),
            );
        }
    };

    let file_len = metadata.len();
    let content_type = guess_content_type(&file_path);

    // FontFace は通常Rangeを使わずフォント全体を要求する。メディア向けの8MB分割を
    // 適用するとTTCが途中で切れるため、検証済みフォントだけは全体を返す。
    if crate::font::is_font_path(&file_path) {
        if file_len > MAX_FONT_SIZE {
            return error_response(StatusCode::PAYLOAD_TOO_LARGE, b"Font file is too large");
        }
        let mut buffer = Vec::with_capacity(file_len as usize);
        if file.read_to_end(&mut buffer).is_err() {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, b"Cannot read font file");
        }
        return append_cors(
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CONTENT_LENGTH, file_len)
                .body(buffer)
                .unwrap(),
        );
    }

    // Range ヘッダーを解析
    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|h: &header::HeaderValue| h.to_str().ok());

    if let Some(range_str) = range_header {
        // Range Request → 206 Partial Content
        let (start, end) = parse_range(range_str, file_len);

        if start >= file_len || end >= file_len || start > end {
            return append_cors(
                Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{}", file_len))
                    .body(Vec::new())
                    .unwrap(),
            );
        }

        let chunk_size = (end - start + 1) as usize;
        // チャンクサイズ制限（メモリ保護: 最大8MB）
        let actual_chunk = chunk_size.min(MAX_CHUNK_SIZE);

        if file.seek(SeekFrom::Start(start)).is_err() {
            return append_cors(
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(b"Seek failed".to_vec())
                    .unwrap(),
            );
        }

        let mut buffer = vec![0u8; actual_chunk];
        let bytes_read = match file.read(&mut buffer) {
            Ok(n) => n,
            Err(_) => {
                return append_cors(
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(b"Read failed".to_vec())
                        .unwrap(),
                );
            }
        };
        buffer.truncate(bytes_read);

        append_cors(
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(
                    header::CONTENT_RANGE,
                    format!(
                        "bytes {}-{}/{}",
                        start,
                        start + bytes_read as u64 - 1,
                        file_len
                    ),
                )
                .header(header::CONTENT_LENGTH, bytes_read)
                .body(buffer)
                .unwrap(),
        )
    } else {
        // Range なし → 200 OK
        let read_size = (file_len as usize).min(MAX_CHUNK_SIZE);
        let mut buffer = vec![0u8; read_size];
        let bytes_read = match file.read(&mut buffer) {
            Ok(n) => n,
            Err(_) => {
                return append_cors(
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(b"Read failed".to_vec())
                        .unwrap(),
                );
            }
        };
        buffer.truncate(bytes_read);

        append_cors(
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_LENGTH, file_len)
                .body(buffer)
                .unwrap(),
        )
    }
}

/// Range ヘッダー "bytes=START-END" を解析する
fn parse_range(range_str: &str, file_len: u64) -> (u64, u64) {
    let mut start = 0u64;
    let mut end = file_len.saturating_sub(1);

    if let Some(r) = range_str.strip_prefix("bytes=") {
        let parts: Vec<&str> = r.split('-').collect();
        if let Some(s) = parts.first() {
            if let Ok(v) = s.parse::<u64>() {
                start = v;
            }
        }
        if parts.len() > 1 && !parts[1].is_empty() {
            if let Ok(v) = parts[1].parse::<u64>() {
                end = v;
            }
        }
    }

    (start, end)
}

/// 拡張子からContent-Typeを推定する
fn guess_content_type(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".mp4") || lower.ends_with(".m4v") {
        "video/mp4"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else if lower.ends_with(".mov") {
        "video/quicktime"
    } else if lower.ends_with(".avi") {
        "video/x-msvideo"
    } else if lower.ends_with(".mkv") {
        "video/x-matroska"
    } else if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".m4a") {
        "audio/mp4"
    } else if lower.ends_with(".flac") {
        "audio/flac"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".bmp") {
        "image/bmp"
    } else if lower.ends_with(".ttf") {
        "font/ttf"
    } else if lower.ends_with(".otf") {
        "font/otf"
    } else if lower.ends_with(".ttc") {
        "font/collection"
    } else {
        "application/octet-stream"
    }
}

fn is_supported_media_path(path: &str) -> bool {
    const ALLOWED_EXTENSIONS: &[&str] = &[
        "mp4", "m4v", "webm", "mov", "avi", "mkv", "mp3", "wav", "ogg", "m4a", "flac", "png",
        "jpg", "jpeg", "gif", "webp", "bmp", "ttf", "otf", "ttc",
    ];

    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            ALLOWED_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
        .unwrap_or(false)
}

/// 簡易URLデコード（%XX → バイト変換）
fn urlencoding_decode(input: &str) -> Option<String> {
    let mut result = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hex = &input[i + 1..i + 3];
            let byte = u8::from_str_radix(hex, 16).ok()?;
            result.push(byte);
            i += 3;
            continue;
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(result).ok()
}

#[cfg(test)]
mod tests {
    use super::{is_supported_media_path, parse_range, urlencoding_decode};

    #[test]
    fn media_extension_allowlist_is_case_insensitive() {
        assert!(is_supported_media_path(r"C:\clips\ROUND.MP4"));
        assert!(is_supported_media_path(r"C:\images\avatar.webp"));
        assert!(is_supported_media_path(r"C:\fonts\title.TTF"));
        assert!(!is_supported_media_path(r"C:\fixtures\user\.ssh\id_rsa"));
        assert!(!is_supported_media_path(r"C:\project\settings.json"));
    }

    #[test]
    fn malformed_percent_encoding_is_rejected() {
        assert_eq!(
            urlencoding_decode("C%3A%5Cvideo.mp4"),
            Some(r"C:\video.mp4".into())
        );
        assert_eq!(urlencoding_decode("C%ZZvideo.mp4"), None);
        assert_eq!(urlencoding_decode("C%"), None);
    }

    #[test]
    fn standard_byte_range_is_parsed() {
        assert_eq!(parse_range("bytes=100-199", 1_000), (100, 199));
        assert_eq!(parse_range("bytes=100-", 1_000), (100, 999));
    }
}
