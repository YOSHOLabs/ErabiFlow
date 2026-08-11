use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::Manager;

// 公開鍵だけをアプリへ埋め込む。対応する秘密鍵はリポジトリ外で保管する。
const CREATOR_LICENSE_PUBLIC_KEY_BASE64: &str = "U6i0dzFadMkWI9KmEJxsvM0RSnMYMBVw1n9vIvupBt4=";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LicenseClaims {
    version: u32,
    license_id: String,
    installation_id: String,
    plan: String,
    issued_at: i64,
    expires_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementSnapshot {
    pub plan: String,
    pub status: String,
    pub installation_id: String,
    pub license_id: Option<String>,
    pub expires_at: Option<i64>,
    pub message: Option<String>,
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("ライセンス保存先を取得できません: {error}"))?;
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("ライセンス保存先を作成できません: {error}"))?;
    Ok(path)
}

fn license_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("creator-license.vflicense"))
}

#[cfg(windows)]
fn machine_source() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography").ok()?;
    key.get_value::<String, _>("MachineGuid").ok()
}

#[cfg(not(windows))]
fn machine_source() -> Option<String> {
    None
}

fn installation_id(app: &tauri::AppHandle) -> Result<String, String> {
    if let Some(machine_id) = machine_source() {
        // Keep the legacy domain separator: changing it would invalidate already-issued Creator licenses.
        let digest = Sha256::digest(format!("v-focus:creator:{machine_id}").as_bytes());
        return Ok(format!("VF-{}", hex_lower(&digest)[..24].to_uppercase()));
    }

    // Windows以外とMachineGuid取得不可環境向けの安定フォールバック。
    let path = app_data_dir(app)?.join("installation-id.txt");
    if let Ok(value) = std::fs::read_to_string(&path) {
        let value = value.trim();
        if !value.is_empty() {
            return Ok(value.to_string());
        }
    }
    let value = format!(
        "VF-{}",
        uuid::Uuid::new_v4().simple().to_string()[..24].to_uppercase()
    );
    std::fs::write(&path, &value)
        .map_err(|error| format!("インストールIDを保存できません: {error}"))?;
    Ok(value)
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn configured_verifying_key() -> Result<VerifyingKey, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(CREATOR_LICENSE_PUBLIC_KEY_BASE64)
        .map_err(|_| "Creatorライセンス公開鍵が壊れています".to_string())?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Creatorライセンス公開鍵の長さが不正です".to_string())?;
    VerifyingKey::from_bytes(&bytes)
        .map_err(|_| "Creatorライセンス公開鍵を読み込めません".to_string())
}

fn verify_token_with_key(
    token: &str,
    expected_installation_id: &str,
    now: i64,
    verifying_key: &VerifyingKey,
) -> Result<LicenseClaims, String> {
    let parts: Vec<_> = token.trim().split('.').collect();
    if parts.len() != 3 || parts[0] != "vf1" {
        return Err("ライセンスキーの形式が正しくありません".to_string());
    }

    let signature_bytes = URL_SAFE_NO_PAD
        .decode(parts[2])
        .map_err(|_| "ライセンス署名を読み取れません".to_string())?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| "ライセンス署名の長さが不正です".to_string())?;
    verifying_key
        .verify(parts[1].as_bytes(), &signature)
        .map_err(|_| "ライセンス署名を確認できません".to_string())?;

    let payload = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| "ライセンス情報を読み取れません".to_string())?;
    let claims: LicenseClaims =
        serde_json::from_slice(&payload).map_err(|_| "ライセンス情報が壊れています".to_string())?;

    if claims.version != 1 || claims.plan != "creator" {
        return Err("このTateClip版では利用できないライセンスです".to_string());
    }
    if claims.installation_id != expected_installation_id {
        return Err("このライセンスは別のPC用です。再発行してください".to_string());
    }
    if claims.issued_at > now + 300 {
        return Err("PCの日時が正しくないためライセンスを確認できません".to_string());
    }
    if claims
        .expires_at
        .is_some_and(|expires_at| expires_at <= now)
    {
        return Err("Creatorライセンスの有効期限が切れています".to_string());
    }
    if claims.license_id.trim().is_empty() {
        return Err("ライセンスIDがありません".to_string());
    }

    Ok(claims)
}

fn verify_token(token: &str, expected_installation_id: &str) -> Result<LicenseClaims, String> {
    verify_token_with_key(
        token,
        expected_installation_id,
        chrono::Utc::now().timestamp(),
        &configured_verifying_key()?,
    )
}

fn free_snapshot(
    installation_id: String,
    status: &str,
    message: Option<String>,
) -> EntitlementSnapshot {
    EntitlementSnapshot {
        plan: "free".to_string(),
        status: status.to_string(),
        installation_id,
        license_id: None,
        expires_at: None,
        message,
    }
}

fn current_snapshot(app: &tauri::AppHandle) -> Result<EntitlementSnapshot, String> {
    let installation_id = installation_id(app)?;
    let path = license_path(app)?;
    let token = match std::fs::read_to_string(path) {
        Ok(token) => token,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(free_snapshot(installation_id, "free", None));
        }
        Err(error) => {
            return Ok(free_snapshot(
                installation_id,
                "invalid",
                Some(format!("ライセンスを読み込めません: {error}")),
            ));
        }
    };

    match verify_token(&token, &installation_id) {
        Ok(claims) => Ok(EntitlementSnapshot {
            plan: "creator".to_string(),
            status: "creator".to_string(),
            installation_id,
            license_id: Some(claims.license_id),
            expires_at: claims.expires_at,
            message: None,
        }),
        Err(error) => Ok(free_snapshot(installation_id, "invalid", Some(error))),
    }
}

#[tauri::command]
pub fn get_entitlement(app: tauri::AppHandle) -> Result<EntitlementSnapshot, String> {
    current_snapshot(&app)
}

#[tauri::command]
pub fn activate_creator_license(
    app: tauri::AppHandle,
    token: String,
) -> Result<EntitlementSnapshot, String> {
    let installation_id = installation_id(&app)?;
    let claims = verify_token(&token, &installation_id)?;
    let path = license_path(&app)?;
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, token.trim())
        .map_err(|error| format!("ライセンスを一時保存できません: {error}"))?;
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|error| format!("以前のライセンスを更新できません: {error}"))?;
    }
    std::fs::rename(&temporary, &path)
        .map_err(|error| format!("ライセンスを保存できません: {error}"))?;

    Ok(EntitlementSnapshot {
        plan: "creator".to_string(),
        status: "creator".to_string(),
        installation_id,
        license_id: Some(claims.license_id),
        expires_at: claims.expires_at,
        message: None,
    })
}

#[tauri::command]
pub fn deactivate_creator_license(app: tauri::AppHandle) -> Result<EntitlementSnapshot, String> {
    let path = license_path(&app)?;
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("ライセンスを解除できません: {error}")),
    }
    let installation_id = installation_id(&app)?;
    Ok(free_snapshot(installation_id, "free", None))
}

pub fn require_creator(app: &tauri::AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let snapshot = current_snapshot(app)?;
    if snapshot.plan == "creator" {
        Ok(())
    } else {
        Err(snapshot
            .message
            .unwrap_or_else(|| "この処理にはTateClip Creatorライセンスが必要です".to_string()))
    }
}

pub fn process_uses_creator_features(params: &crate::ProcessParams) -> bool {
    let input_stem = Path::new(&params.input_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let output_stem = Path::new(&params.output_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let basic_output_stem = format!("{input_stem}_tateclip");
    let rough_cut_output_stem = format!("{basic_output_stem}_roughcut");
    // 通常動画とラフカット、および各PNG連番は単発書き出し設定であり、
    // 候補ごとのラベルを足した旧Creator一括出力とは区別する。
    let free_output_stems = [
        basic_output_stem.clone(),
        format!("{basic_output_stem}_%05d"),
        rough_cut_output_stem.clone(),
        format!("{rough_cut_output_stem}_%05d"),
    ];
    let is_batch = !free_output_stems.iter().any(|stem| stem == output_stem);
    let jump_cut = params.enable_jump_cut.unwrap_or(false);
    let auto_reframe = params
        .crop_data
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let ducking = params
        .ducking
        .as_ref()
        .and_then(|value| value.enabled)
        .unwrap_or(false);

    is_batch || jump_cut || auto_reframe || ducking
}

#[cfg(test)]
mod tests {
    use super::{process_uses_creator_features, verify_token_with_key, LicenseClaims};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use ed25519_dalek::{Signer, SigningKey};

    fn token(claims: &LicenseClaims, key: &SigningKey) -> String {
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(claims).unwrap());
        let signature = key.sign(payload.as_bytes());
        format!(
            "vf1.{payload}.{}",
            URL_SAFE_NO_PAD.encode(signature.to_bytes())
        )
    }

    #[test]
    fn verifies_signed_creator_token_and_rejects_other_machine() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let claims = LicenseClaims {
            version: 1,
            license_id: "creator-001".to_string(),
            installation_id: "VF-TEST-PC".to_string(),
            plan: "creator".to_string(),
            issued_at: 1_700_000_000,
            expires_at: Some(1_900_000_000),
        };
        let value = token(&claims, &key);
        assert!(
            verify_token_with_key(&value, "VF-TEST-PC", 1_800_000_000, &key.verifying_key())
                .is_ok()
        );
        assert!(
            verify_token_with_key(&value, "VF-OTHER-PC", 1_800_000_000, &key.verifying_key())
                .is_err()
        );
    }

    #[test]
    fn rejects_tampered_or_expired_token() {
        let key = SigningKey::from_bytes(&[9u8; 32]);
        let claims = LicenseClaims {
            version: 1,
            license_id: "creator-002".to_string(),
            installation_id: "VF-TEST-PC".to_string(),
            plan: "creator".to_string(),
            issued_at: 1_700_000_000,
            expires_at: Some(1_750_000_000),
        };
        let value = token(&claims, &key);
        assert!(
            verify_token_with_key(&value, "VF-TEST-PC", 1_800_000_000, &key.verifying_key())
                .is_err()
        );
        let mut parts: Vec<String> = value.split('.').map(str::to_string).collect();
        let replacement = if parts[1].starts_with('A') { "B" } else { "A" };
        parts[1].replace_range(0..1, replacement);
        let tampered = parts.join(".");
        assert!(verify_token_with_key(
            &tampered,
            "VF-TEST-PC",
            1_700_000_001,
            &key.verifying_key()
        )
        .is_err());
    }

    #[test]
    fn detects_paid_render_features() {
        let mut params: crate::ProcessParams = serde_json::from_value(serde_json::json!({
            "inputPath": "C:\\\\clips\\\\match.mp4",
            "outputPath": "C:\\\\clips\\\\match_tateclip.mp4",
            "gpuType": "CPU",
            "layout": "commentary"
        }))
        .unwrap();
        assert!(!process_uses_creator_features(&params));
        params.output_path = r"C:\clips\match_tateclip_%05d.png".to_string();
        assert!(!process_uses_creator_features(&params));
        params.output_path = r"C:\clips\match_tateclip_roughcut.mp4".to_string();
        params.layout = "source".to_string();
        assert!(!process_uses_creator_features(&params));
        params.output_path = r"C:\clips\match_tateclip_roughcut_%05d.png".to_string();
        assert!(!process_uses_creator_features(&params));
        params.output_path = r"C:\clips\match_tateclip_run_01_clip.mp4".to_string();
        assert!(process_uses_creator_features(&params));
        params.output_path = r"C:\clips\match_tateclip.mp4".to_string();
        params.enable_jump_cut = Some(true);
        assert!(process_uses_creator_features(&params));
    }
}
