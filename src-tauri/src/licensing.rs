use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const PRODUCT_ID: &str = "oneposture-pro";
const DEFAULT_LICENSE_API_URL: &str = "https://01mvp.com/api";
const DEFAULT_LICENSE_PUBLIC_KEY: &str = "3ikazOS9SDxt25wT17gpx9cgfOwmF3O9WP_2zp7au8Y";
pub const TRIAL_DURATION_DAYS: i64 = 7;
const TRIAL_DURATION_SECONDS: i64 = TRIAL_DURATION_DAYS * 24 * 60 * 60;
static TRIAL_STATE_LOCK: Mutex<()> = Mutex::new(());

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
    pub can_use_app: bool,
    pub trial_active: bool,
    pub trial_started_at: Option<i64>,
    pub trial_ends_at: Option<i64>,
    pub trial_days_remaining: u32,
    pub license_id: Option<String>,
    pub expires_at: Option<i64>,
    pub message: Option<String>,
}

impl LicenseStatus {
    fn developer() -> Self {
        Self {
            edition: "free".to_string(),
            active: false,
            commercial_ready: false,
            can_use_app: true,
            trial_active: false,
            trial_started_at: None,
            trial_ends_at: None,
            trial_days_remaining: 0,
            license_id: None,
            expires_at: None,
            message: None,
        }
    }

    fn locked(message: Option<String>) -> Self {
        Self {
            edition: "free".to_string(),
            active: false,
            commercial_ready: true,
            can_use_app: false,
            trial_active: false,
            trial_started_at: None,
            trial_ends_at: None,
            trial_days_remaining: 0,
            license_id: None,
            expires_at: None,
            message,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct TrialState {
    version: u8,
    started_at: i64,
    last_seen_at: i64,
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

fn trial_state_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("license").join("trial.json"))
        .map_err(|error| format!("Failed to resolve trial directory: {}", error))
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
            can_use_app: true,
            trial_active: false,
            trial_started_at: None,
            trial_ends_at: None,
            trial_days_remaining: 0,
            license_id: Some(claims.license_id),
            expires_at: claims.expires_at,
            message: None,
        },
        Err(error) => LicenseStatus::locked(Some(error)),
    }
}

fn status_from_trial_state(
    state: &mut TrialState,
    now: i64,
    message: Option<String>,
) -> LicenseStatus {
    if state.version != 1 || state.started_at <= 0 {
        return LicenseStatus::locked(Some("Trial record is invalid".to_string()));
    }

    // Do not extend the trial when the system clock moves backwards. This is a
    // deliberately light boundary: deleting application data can still reset it.
    let effective_now = now.max(state.started_at).max(state.last_seen_at);
    state.last_seen_at = effective_now;
    let trial_ends_at = state.started_at.saturating_add(TRIAL_DURATION_SECONDS);
    let remaining_seconds = trial_ends_at.saturating_sub(effective_now);
    let trial_active = remaining_seconds > 0;
    let trial_days_remaining = if trial_active {
        ((remaining_seconds + 86_399) / 86_400) as u32
    } else {
        0
    };

    LicenseStatus {
        edition: if trial_active { "trial" } else { "free" }.to_string(),
        active: false,
        commercial_ready: true,
        can_use_app: trial_active,
        trial_active,
        trial_started_at: Some(state.started_at),
        trial_ends_at: Some(trial_ends_at),
        trial_days_remaining,
        license_id: None,
        expires_at: None,
        message,
    }
}

fn get_trial_status(app: &AppHandle, message: Option<String>) -> LicenseStatus {
    let _guard = TRIAL_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = chrono::Utc::now().timestamp();
    let Ok(path) = trial_state_path(app) else {
        return LicenseStatus::locked(Some("Trial storage is unavailable".to_string()));
    };
    let mut state = match fs::read_to_string(&path) {
        Ok(value) => match serde_json::from_str::<TrialState>(&value) {
            Ok(state) => state,
            Err(_) => return LicenseStatus::locked(Some("Trial record is invalid".to_string())),
        },
        Err(error) if error.kind() == ErrorKind::NotFound => TrialState {
            version: 1,
            started_at: now,
            last_seen_at: now,
        },
        Err(error) => {
            return LicenseStatus::locked(Some(format!("Failed to read trial record: {}", error)))
        }
    };
    let status = status_from_trial_state(&mut state, now, message);

    if let Some(parent) = path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return LicenseStatus::locked(Some(format!(
                "Failed to create trial directory: {}",
                error
            )));
        }
    }
    if let Err(error) = serde_json::to_vec_pretty(&state)
        .map_err(|error| error.to_string())
        .and_then(|value| fs::write(&path, value).map_err(|error| error.to_string()))
    {
        return LicenseStatus::locked(Some(format!("Failed to save trial record: {}", error)));
    }
    status
}

pub fn get_license_status(app: &AppHandle) -> LicenseStatus {
    if cfg!(debug_assertions) && option_env!("ONEPOSTURE_ENFORCE_TRIAL_IN_DEBUG") != Some("1") {
        return LicenseStatus::developer();
    }
    let public_key = license_public_key();
    let Ok(path) = entitlement_path(app) else {
        return LicenseStatus::locked(Some("License storage is unavailable".to_string()));
    };
    match fs::read_to_string(path) {
        Ok(token) => match get_or_create_device_id(app) {
            Ok(device_id) => {
                let status = status_from_token(&token, public_key, &device_id);
                if status.active {
                    status
                } else {
                    get_trial_status(app, status.message)
                }
            }
            Err(error) => get_trial_status(app, Some(error)),
        },
        Err(_) => get_trial_status(app, None),
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

    #[test]
    fn grants_a_complete_seven_day_trial() {
        let mut state = TrialState {
            version: 1,
            started_at: 1_000_000,
            last_seen_at: 1_000_000,
        };
        let status = status_from_trial_state(&mut state, 1_000_000, None);
        assert!(status.can_use_app);
        assert!(status.trial_active);
        assert_eq!(status.edition, "trial");
        assert_eq!(status.trial_days_remaining, 7);
        assert_eq!(status.trial_ends_at, Some(1_604_800));
    }

    #[test]
    fn locks_access_when_the_trial_expires() {
        let mut state = TrialState {
            version: 1,
            started_at: 1_000_000,
            last_seen_at: 1_000_000,
        };
        let status = status_from_trial_state(&mut state, 1_604_800, None);
        assert!(!status.can_use_app);
        assert!(!status.trial_active);
        assert_eq!(status.trial_days_remaining, 0);
    }

    #[test]
    fn moving_the_clock_back_does_not_restore_trial_time() {
        let mut state = TrialState {
            version: 1,
            started_at: 1_000_000,
            last_seen_at: 1_500_000,
        };
        let status = status_from_trial_state(&mut state, 1_100_000, None);
        assert_eq!(state.last_seen_at, 1_500_000);
        assert_eq!(status.trial_days_remaining, 2);
    }
}
