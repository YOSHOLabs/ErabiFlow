use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAssetReference {
    path: String,
    kind: String,
}

#[tauri::command]
pub fn authorize_project_assets(
    app: tauri::AppHandle,
    assets: Vec<ProjectAssetReference>,
) -> Result<(), String> {
    if assets.len() > 10_000 {
        return Err("プロジェクト内の素材数が上限を超えています".into());
    }
    for asset in assets {
        crate::path_security::authorize_project_asset(&app, &asset.path, &asset.kind)?;
    }
    Ok(())
}

fn generated_dir(app: &tauri::AppHandle, kind: &str) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("保存先を取得できません: {error}"))?
        .join("generated")
        .join(kind);
    std::fs::create_dir_all(&dir).map_err(|error| format!("保存先を作成できません: {error}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn save_generated_sticker(app: tauri::AppHandle, png_base64: String) -> Result<String, String> {
    let encoded = png_base64
        .split_once(',')
        .map(|(_, body)| body)
        .unwrap_or(&png_base64);
    // フロントエンドの最大1024x1024 PNGと最悪ケースのBase64膨張を同じ境界に揃える。
    if encoded.len() > 8_000_000 {
        return Err("ステッカー画像が大きすぎます".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "ステッカー画像を読み取れません".to_string())?;
    if bytes.len() < 24
        || bytes.len() > 5_000_000
        || bytes[..8] != [137, 80, 78, 71, 13, 10, 26, 10]
    {
        return Err("PNG形式のステッカーだけ保存できます".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0
        || height == 0
        || width > 1024
        || height > 1024
        || u64::from(width) * u64::from(height) > 1_048_576
    {
        return Err("ステッカー画像は1024x1024以内にしてください".into());
    }
    let path =
        generated_dir(&app, "stickers")?.join(format!("sticker-{}.png", uuid::Uuid::new_v4()));
    std::fs::write(&path, bytes).map_err(|error| format!("ステッカーを保存できません: {error}"))?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| format!("ステッカーを表示許可できません: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    #[test]
    fn png_signature_round_trip_is_recognizable() {
        let png = [137u8, 80, 78, 71, 13, 10, 26, 10, 0];
        let decoded = STANDARD.decode(STANDARD.encode(png)).unwrap();
        assert_eq!(&decoded[..8], &png[..8]);
    }
}
