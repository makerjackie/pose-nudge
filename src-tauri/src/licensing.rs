use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

const PRODUCT_ID: &str = "oneposture-pro";
const DEFAULT_LICENSE_API_URL: &str = "https://01mvp.com/api";
const DEFAULT_LICENSE_PUBLIC_KEY: &str = "3ikazOS9SDxt25wT17gpx9cgfOwmF3O9WP_2zp7au8Y";

fn license_api_url() -> &'static str {
    option_env!("ONEPOSTURE_LICENSE_API_URL").unwrap_or(DEFAULT_LICENSE_API_URL)
}

fn license_public_key() -> &'static str {
    option_env!("ONEPOSTURE_LICENSE_PUBLIC_KEY").unwrap_or(DEFAULT_LICENSE_PUBLIC_KEY)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EntitlementClaims {
    pub version: u8,
    pub license_id: String,
    pub product_id: String,
    pub edition: String,
    pub device_id: String,
    pub issued_at: i64,
    pub expires_at: Option<i64>,
    pub device_limit: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct LicenseStatus {
    pub edition: String,
    pub active: bool,
    pub commercial_ready: bool,
    pub license_id: Option<String>,
    pub expires_at: Option<i64>,
    pub message: Option<String>,
}

impl LicenseStatus {
    fn free(commercial_ready: bool, message: Option<String>) -> Self {
        Self {
            edition: "free".to_string(),
            active: false,
            commercial_ready,
            license_id: None,
            expires_at: None,
            message,
        }
    }
}

#[derive(Serialize)]
struct ActivationRequest<'a> {
    product_id: &'a str,
    license_key: &'a str,
    device_id: &'a str,
}

#[derive(Deserialize)]
struct ActivationResponse {
    entitlement: String,
}

#[derive(Deserialize)]
struct ActivationErrorResponse {
    code: Option<String>,
}

fn entitlement_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("license").join("entitlement.token"))
        .map_err(|error| format!("Failed to resolve license directory: {}", error))
}

fn device_id_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("license").join("device-id"))
        .map_err(|error| format!("Failed to resolve license directory: {}", error))
}

fn get_or_create_device_id(app: &AppHandle) -> Result<String, String> {
    let path = device_id_path(app)?;
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create license directory: {}", error))?;
    }
    let device_id = uuid::Uuid::new_v4().to_string();
    fs::write(&path, &device_id)
        .map_err(|error| format!("Failed to save device identifier: {}", error))?;
    Ok(device_id)
}

fn decode_public_key(encoded: &str) -> Result<VerifyingKey, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded.trim())
        .map_err(|error| format!("Invalid license public key encoding: {}", error))?;
    let key_bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "License public key must be 32 bytes".to_string())?;
    VerifyingKey::from_bytes(&key_bytes)
        .map_err(|error| format!("Invalid license public key: {}", error))
}

fn verify_entitlement_with_key(
    token: &str,
    key: &VerifyingKey,
    now: i64,
    expected_device_id: &str,
) -> Result<EntitlementClaims, String> {
    let (payload_segment, signature_segment) = token
        .trim()
        .split_once('.')
        .ok_or_else(|| "Malformed entitlement".to_string())?;
    let payload = URL_SAFE_NO_PAD
        .decode(payload_segment)
        .map_err(|error| format!("Invalid entitlement payload: {}", error))?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(signature_segment)
        .map_err(|error| format!("Invalid entitlement signature: {}", error))?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|error| format!("Invalid entitlement signature: {}", error))?;
    key.verify(payload_segment.as_bytes(), &signature)
        .map_err(|_| "Entitlement signature verification failed".to_string())?;

    let claims: EntitlementClaims = serde_json::from_slice(&payload)
        .map_err(|error| format!("Invalid entitlement claims: {}", error))?;
    if claims.version != 1 || claims.product_id != PRODUCT_ID || claims.edition != "pro" {
        return Err("Entitlement is not valid for OnePosture Pro".to_string());
    }
    if claims.device_id != expected_device_id {
        return Err("Entitlement belongs to another device".to_string());
    }
    if claims.expires_at.is_some_and(|expires_at| expires_at < now) {
        return Err("Entitlement has expired".to_string());
    }
    Ok(claims)
}

fn status_from_token(token: &str, public_key: &str, device_id: &str) -> LicenseStatus {
    let now = chrono::Utc::now().timestamp();
    match decode_public_key(public_key)
        .and_then(|key| verify_entitlement_with_key(token, &key, now, device_id))
    {
        Ok(claims) => LicenseStatus {
            edition: claims.edition,
            active: true,
            commercial_ready: true,
            license_id: Some(claims.license_id),
            expires_at: claims.expires_at,
            message: None,
        },
        Err(error) => LicenseStatus::free(true, Some(error)),
    }
}

pub fn get_license_status(app: &AppHandle) -> LicenseStatus {
    let public_key = license_public_key();
    let Ok(path) = entitlement_path(app) else {
        return LicenseStatus::free(true, Some("License storage is unavailable".to_string()));
    };
    match fs::read_to_string(path) {
        Ok(token) => match get_or_create_device_id(app) {
            Ok(device_id) => status_from_token(&token, public_key, &device_id),
            Err(error) => LicenseStatus::free(true, Some(error)),
        },
        Err(_) => LicenseStatus::free(true, None),
    }
}

pub async fn activate(app: &AppHandle, license_key: &str) -> Result<LicenseStatus, String> {
    let api_url = license_api_url();
    let public_key = license_public_key();
    let device_id = get_or_create_device_id(app)?;
    let normalized_license_key = license_key.trim().to_uppercase();
    let endpoint = format!("{}/v1/activations", api_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .post(endpoint)
        .json(&ActivationRequest {
            product_id: PRODUCT_ID,
            license_key: &normalized_license_key,
            device_id: &device_id,
        })
        .send()
        .await
        .map_err(|_| "NETWORK_ERROR".to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let error = response.json::<ActivationErrorResponse>().await.ok();
        return Err(error
            .and_then(|value| value.code)
            .unwrap_or_else(|| format!("HTTP_{}", status.as_u16())));
    }
    let activation: ActivationResponse = response
        .json()
        .await
        .map_err(|_| "INVALID_RESPONSE".to_string())?;
    let status = status_from_token(&activation.entitlement, public_key, &device_id);
    if !status.active {
        return Err(status
            .message
            .unwrap_or_else(|| "Invalid entitlement".to_string()));
    }

    let path = entitlement_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create license directory: {}", error))?;
    }
    fs::write(&path, activation.entitlement)
        .map_err(|error| format!("Failed to save entitlement: {}", error))?;
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn verifies_a_product_scoped_offline_entitlement() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let claims = EntitlementClaims {
            version: 1,
            license_id: "lic_test".to_string(),
            product_id: PRODUCT_ID.to_string(),
            edition: "pro".to_string(),
            device_id: "device-1".to_string(),
            issued_at: 100,
            expires_at: None,
            device_limit: 3,
        };
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
        let signature = signing_key.sign(payload.as_bytes());
        let token = format!(
            "{}.{}",
            payload,
            URL_SAFE_NO_PAD.encode(signature.to_bytes())
        );

        let verified =
            verify_entitlement_with_key(&token, &signing_key.verifying_key(), 200, "device-1")
                .expect("valid entitlement");
        assert_eq!(verified.license_id, "lic_test");
    }

    #[test]
    fn rejects_an_entitlement_for_another_product() {
        let signing_key = SigningKey::from_bytes(&[9u8; 32]);
        let claims = EntitlementClaims {
            version: 1,
            license_id: "lic_other".to_string(),
            product_id: "another-app".to_string(),
            edition: "pro".to_string(),
            device_id: "device-1".to_string(),
            issued_at: 100,
            expires_at: None,
            device_limit: 1,
        };
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
        let signature = signing_key.sign(payload.as_bytes());
        let token = format!(
            "{}.{}",
            payload,
            URL_SAFE_NO_PAD.encode(signature.to_bytes())
        );

        assert!(
            verify_entitlement_with_key(&token, &signing_key.verifying_key(), 200, "device-1",)
                .is_err()
        );
    }

    #[test]
    fn rejects_an_entitlement_copied_to_another_device() {
        let signing_key = SigningKey::from_bytes(&[11u8; 32]);
        let claims = EntitlementClaims {
            version: 1,
            license_id: "lic_device".to_string(),
            product_id: PRODUCT_ID.to_string(),
            edition: "pro".to_string(),
            device_id: "device-1".to_string(),
            issued_at: 100,
            expires_at: None,
            device_limit: 3,
        };
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
        let signature = signing_key.sign(payload.as_bytes());
        let token = format!(
            "{}.{}",
            payload,
            URL_SAFE_NO_PAD.encode(signature.to_bytes())
        );

        assert!(
            verify_entitlement_with_key(&token, &signing_key.verifying_key(), 200, "device-2",)
                .is_err()
        );
    }
}
