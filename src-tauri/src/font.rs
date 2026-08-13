use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

const JAPANESE_SAMPLE: &str = "日本語あいうえおカタカナ";
const MAX_FONT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontDescriptor {
    pub reference: String,
    pub label: String,
    pub family: String,
    pub path: String,
    pub supports_japanese: bool,
    pub is_bold: bool,
    pub source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontResolution {
    pub path: String,
    pub family: String,
    pub fallback_used: bool,
    pub is_bold: bool,
    pub warning: Option<String>,
}

#[derive(Clone, Debug)]
struct FontMetadata {
    family: String,
    supports_text: bool,
    is_bold: bool,
}

struct SystemFont {
    reference: &'static str,
    label: &'static str,
    family_hint: &'static str,
    file_name: &'static str,
}

const SYSTEM_FONTS: &[SystemFont] = &[
    SystemFont {
        reference: "system:meiryo-bold",
        label: "メイリオ Bold",
        family_hint: "Meiryo",
        file_name: "meiryob.ttc",
    },
    SystemFont {
        reference: "system:yu-gothic-bold",
        label: "游ゴシック Bold",
        family_hint: "Yu Gothic",
        file_name: "YuGothB.ttc",
    },
    SystemFont {
        reference: "system:arial-bold",
        label: "Arial Bold",
        family_hint: "Arial",
        file_name: "arialbd.ttf",
    },
    SystemFont {
        reference: "system:impact",
        label: "Impact",
        family_hint: "Impact",
        file_name: "impact.ttf",
    },
    SystemFont {
        reference: "system:segoe-ui-bold",
        label: "Segoe UI Bold",
        family_hint: "Segoe UI",
        file_name: "segoeuib.ttf",
    },
];

fn windows_font_dir() -> PathBuf {
    std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("Fonts")
}

fn system_font_path(font: &SystemFont) -> PathBuf {
    windows_font_dir().join(font.file_name)
}

fn system_font_for_reference(reference: &str) -> Option<&'static SystemFont> {
    let clean = reference.trim().trim_matches(|c| c == '\'' || c == '"');
    let lower = clean.to_lowercase();
    SYSTEM_FONTS.iter().find(|font| {
        lower == font.reference
            || lower == font.family_hint.to_lowercase()
            || (lower.contains("noto sans jp") && font.reference == "system:meiryo-bold")
            || (lower.contains("meiryo") && font.reference == "system:meiryo-bold")
            || (lower.contains("yu gothic") && font.reference == "system:yu-gothic-bold")
            || (lower == "arial" && font.reference == "system:arial-bold")
            || (lower == "impact" && font.reference == "system:impact")
            || (lower.contains("segoe ui") && font.reference == "system:segoe-ui-bold")
    })
}

pub fn is_font_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "ttf" | "otf" | "ttc"
            )
        })
}

pub fn is_trusted_system_font(path: &str) -> bool {
    let candidate = fs::canonicalize(path).ok();
    candidate.is_some_and(|candidate| {
        SYSTEM_FONTS.iter().any(|font| {
            fs::canonicalize(system_font_path(font)).is_ok_and(|trusted| trusted == candidate)
        })
    })
}

fn managed_font_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("fonts"))
        .map_err(|error| format!("フォント保存先を取得できません: {}", error))
}

pub fn is_managed_font<R: Runtime>(app: &tauri::AppHandle<R>, path: &str) -> bool {
    let Ok(candidate) = fs::canonicalize(path) else {
        return false;
    };
    let Ok(root) = managed_font_dir(app).and_then(|path| {
        fs::create_dir_all(&path)
            .map_err(|error| error.to_string())
            .and_then(|_| fs::canonicalize(path).map_err(|error| error.to_string()))
    }) else {
        return false;
    };
    candidate.starts_with(root) && is_font_path(path)
}

pub fn ensure_font_path_allowed<R: Runtime>(
    app: &tauri::AppHandle<R>,
    reference: &str,
) -> Result<(), String> {
    if system_font_for_reference(reference).is_some() {
        return Ok(());
    }
    if !is_font_path(reference) {
        return Ok(()); // 旧プロジェクトのフォント名は解決時に安全なシステムフォントへ寄せる。
    }
    if is_trusted_system_font(reference)
        || is_managed_font(app, reference)
        || app.asset_protocol_scope().is_allowed(reference)
    {
        return Ok(());
    }
    Err(
        "フォントへのアクセスが許可されていません。フォント追加から選び直してください。"
            .to_string(),
    )
}

fn font_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("フォントファイルを読み込めません: {}", error))?;
    if metadata.len() > MAX_FONT_BYTES {
        return Err("フォントファイルが大きすぎます（上限64MB）".to_string());
    }
    fs::read(path).map_err(|error| format!("フォントファイルを読み込めません: {}", error))
}

fn parse_face(bytes: &[u8]) -> Result<ttf_parser::Face<'_>, String> {
    ttf_parser::Face::parse(bytes, 0)
        .map_err(|_| "TTF/OTF/TTCとして解析できないフォントです".to_string())
}

fn family_name(face: &ttf_parser::Face<'_>) -> Option<String> {
    for wanted in [
        ttf_parser::name_id::TYPOGRAPHIC_FAMILY,
        ttf_parser::name_id::FAMILY,
        ttf_parser::name_id::FULL_NAME,
    ] {
        if let Some(value) = face
            .names()
            .into_iter()
            .filter(|name| name.name_id == wanted)
            .find_map(|name| name.to_string())
        {
            if !value.trim().is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn supports_text(face: &ttf_parser::Face<'_>, text: &str) -> bool {
    text.chars()
        .filter(|character| !character.is_whitespace() && !character.is_control())
        .all(|character| face.glyph_index(character).is_some())
}

fn inspect_path(
    path: &Path,
    reference: String,
    label: String,
    source: &str,
) -> Result<FontDescriptor, String> {
    if !is_font_path(path.to_string_lossy().as_ref()) {
        return Err("対応形式はTTF / OTF / TTCです".to_string());
    }
    let bytes = font_bytes(path)?;
    let face = parse_face(&bytes)?;
    let family = family_name(&face).unwrap_or_else(|| label.clone());
    Ok(FontDescriptor {
        reference,
        label,
        family,
        path: path.to_string_lossy().into_owned(),
        supports_japanese: supports_text(&face, JAPANESE_SAMPLE),
        is_bold: face.is_bold(),
        source: source.to_string(),
    })
}

#[tauri::command]
pub fn list_system_fonts() -> Vec<FontDescriptor> {
    SYSTEM_FONTS
        .iter()
        .filter_map(|font| {
            let path = system_font_path(font);
            inspect_path(
                &path,
                font.reference.to_string(),
                font.label.to_string(),
                "system",
            )
            .ok()
        })
        .collect()
}

#[tauri::command]
pub fn import_font_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    font_path: String,
) -> Result<FontDescriptor, String> {
    crate::path_security::ensure_asset_path_allowed(&app, &font_path, "追加フォント")?;
    let source_path = Path::new(&font_path);
    let label = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("追加フォント")
        .to_string();
    inspect_path(source_path, font_path.clone(), label.clone(), "custom")?;

    let directory = managed_font_dir(&app)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("フォント保存先を作成できません: {}", error))?;
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("ttf")
        .to_ascii_lowercase();
    let managed_path = directory.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
    fs::copy(source_path, &managed_path)
        .map_err(|error| format!("フォントをアプリへ追加できません: {}", error))?;

    inspect_path(
        &managed_path,
        managed_path.to_string_lossy().into_owned(),
        label,
        "custom",
    )
}

fn requested_font_path(reference: &str) -> Option<PathBuf> {
    if let Some(system_font) = system_font_for_reference(reference) {
        return Some(system_font_path(system_font));
    }
    if is_font_path(reference) {
        return Some(PathBuf::from(reference));
    }
    None
}

fn font_metadata(path: &Path, text: &str) -> Option<FontMetadata> {
    font_bytes(path)
        .and_then(|bytes| {
            let face = parse_face(&bytes)?;
            Ok(FontMetadata {
                family: family_name(&face).unwrap_or_else(|| "sans-serif".to_string()),
                supports_text: supports_text(&face, text),
                is_bold: face.is_bold(),
            })
        })
        .ok()
}

fn resolve_font_from_candidates<F>(
    requested_path: PathBuf,
    requested_is_fallback: bool,
    requested_exists: bool,
    fallback_paths: &[PathBuf],
    text: &str,
    inspect: F,
) -> FontResolution
where
    F: Fn(&Path, &str) -> Option<FontMetadata>,
{
    let requested = inspect(&requested_path, text);

    if let Some(metadata) = requested.as_ref().filter(|metadata| metadata.supports_text) {
        return FontResolution {
            path: requested_path.to_string_lossy().into_owned(),
            family: metadata.family.clone(),
            fallback_used: requested_is_fallback,
            is_bold: metadata.is_bold,
            warning: None,
        };
    }

    let fallback = fallback_paths
        .iter()
        .filter(|path| *path != &requested_path)
        .find_map(|path| {
            inspect(path, text)
                .filter(|metadata| metadata.supports_text)
                .map(|metadata| (path, metadata))
        });

    if let Some((fallback_path, metadata)) = fallback {
        return FontResolution {
            path: fallback_path.to_string_lossy().into_owned(),
            family: metadata.family.clone(),
            fallback_used: true,
            is_bold: metadata.is_bold,
            warning: Some(if !requested_exists {
                format!(
                    "選択フォントが見つからないため、{}で表示・書き出しします。",
                    metadata.family
                )
            } else {
                format!(
                    "選択フォントに含まれない文字があるため、{}で表示・書き出しします。",
                    metadata.family
                )
            }),
        };
    }

    FontResolution {
        path: requested_path.to_string_lossy().into_owned(),
        family: requested
            .as_ref()
            .map(|metadata| metadata.family.clone())
            .unwrap_or_else(|| "sans-serif".to_string()),
        fallback_used: false,
        is_bold: requested.as_ref().is_some_and(|metadata| metadata.is_bold),
        warning: Some(
            "選択フォントを正しく読み込めません。書き出し結果を確認してください。".to_string(),
        ),
    }
}

pub fn resolve_font_reference(reference: &str, text: &str) -> FontResolution {
    let requested = requested_font_path(reference);
    let requested_is_fallback = requested.is_none();
    let requested_path = requested.unwrap_or_else(|| system_font_path(&SYSTEM_FONTS[0]));
    let requested_exists = requested_path.exists();
    let fallback_paths = SYSTEM_FONTS
        .iter()
        .map(system_font_path)
        .collect::<Vec<_>>();

    resolve_font_from_candidates(
        requested_path,
        requested_is_fallback,
        requested_exists,
        &fallback_paths,
        text,
        font_metadata,
    )
}

#[tauri::command]
pub fn resolve_font_preview<R: Runtime>(
    app: tauri::AppHandle<R>,
    font_ref: String,
    text: String,
) -> Result<FontResolution, String> {
    if is_font_path(&font_ref) {
        ensure_font_path_allowed(&app, &font_ref)?;
    }
    Ok(resolve_font_reference(&font_ref, &text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_font_references_are_not_treated_as_files() {
        assert!(!is_font_path("system:meiryo-bold"));
        assert!(is_font_path(r"C:\fonts\custom.OTF"));
    }

    #[test]
    fn japanese_text_resolves_to_a_font_with_glyphs() {
        let requested = PathBuf::from("fixtures/latin-bold.ttf");
        let fallback_paths = vec![
            PathBuf::from("fixtures/other-latin.ttf"),
            PathBuf::from("fixtures/japanese-bold.ttf"),
        ];
        let resolution = resolve_font_from_candidates(
            requested,
            false,
            true,
            &fallback_paths,
            "爆音ルンバ",
            |path, _text| match path.file_name().and_then(|name| name.to_str()) {
                Some("latin-bold.ttf") => Some(FontMetadata {
                    family: "Fixture Latin".to_string(),
                    supports_text: false,
                    is_bold: true,
                }),
                Some("other-latin.ttf") => Some(FontMetadata {
                    family: "Fixture Other Latin".to_string(),
                    supports_text: false,
                    is_bold: false,
                }),
                Some("japanese-bold.ttf") => Some(FontMetadata {
                    family: "Fixture Japanese".to_string(),
                    supports_text: true,
                    is_bold: true,
                }),
                _ => None,
            },
        );

        assert!(resolution.path.ends_with("japanese-bold.ttf"));
        assert!(resolution.fallback_used);
        assert_eq!(resolution.family, "Fixture Japanese");
        assert!(resolution.is_bold);
        assert!(resolution
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains("Fixture Japanese")));
    }

    #[test]
    fn selected_japanese_font_keeps_its_real_weight() {
        let requested = PathBuf::from("fixtures/japanese-bold.ttf");
        let resolution = resolve_font_from_candidates(
            requested,
            false,
            true,
            &[],
            "日本語タイトル",
            |_path, _text| {
                Some(FontMetadata {
                    family: "Fixture Japanese".to_string(),
                    supports_text: true,
                    is_bold: true,
                })
            },
        );

        assert!(resolution.path.ends_with("japanese-bold.ttf"));
        assert!(resolution.is_bold);
        assert!(!resolution.fallback_used);
        assert!(resolution.warning.is_none());
    }

    #[test]
    fn missing_japanese_font_reports_the_unresolved_fallback() {
        let requested = PathBuf::from("fixtures/latin-bold.ttf");
        let fallback_paths = vec![PathBuf::from("fixtures/other-latin.ttf")];
        let resolution = resolve_font_from_candidates(
            requested,
            false,
            true,
            &fallback_paths,
            "日本語タイトル",
            |path, _text| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| FontMetadata {
                        family: name.to_string(),
                        supports_text: false,
                        is_bold: true,
                    })
            },
        );

        assert!(resolution.path.ends_with("latin-bold.ttf"));
        assert!(!resolution.fallback_used);
        assert_eq!(resolution.family, "latin-bold.ttf");
        assert!(resolution.warning.is_some());
    }
}
