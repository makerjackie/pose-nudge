#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use log::{debug, error, info, warn, LevelFilter};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    path::{BaseDirectory, PathResolver},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, State,
};
use tauri_plugin_notification::NotificationExt;
use tokio::time::sleep;

use image::{codecs::jpeg::JpegEncoder, ImageBuffer, Rgb};
use nokhwa::{
    pixel_format::RgbFormat,
    utils::{ApiBackend, CameraIndex, CameraInfo, RequestedFormat, RequestedFormatType},
    Camera,
};

use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_sql::{DbInstances, Migration, MigrationKind};

mod licensing;
mod pose_analysis;
mod reminder;
use pose_analysis::PoseAnalyzer;
use reminder::{PostureSignal, ReminderEngine, ReminderPreferences, ReminderState};

#[tauri::command]
fn get_license_status(app: AppHandle) -> licensing::LicenseStatus {
    licensing::get_license_status(&app)
}

#[tauri::command]
async fn activate_license(
    app: AppHandle,
    license_key: String,
) -> Result<licensing::LicenseStatus, String> {
    let status = licensing::activate(&app, &license_key).await?;
    let _ = app.emit("license-status-changed", &status);
    Ok(status)
}

pub struct Translations {
    data: HashMap<String, HashMap<String, String>>,
}

impl Translations {
    pub fn new<R: Runtime>(path_resolver: &PathResolver<R>) -> Self {
        let mut data = HashMap::new();
        let locales = vec!["en", "ko", "ja", "zh", "zh-Hant", "tr"];

        for lang in locales {
            if let Ok(resource_path) =
                path_resolver.resolve(format!("../locales/{}.json", lang), BaseDirectory::Resource)
            {
                if let Ok(file_content) = fs::read_to_string(&resource_path) {
                    if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&file_content)
                    {
                        data.insert(lang.to_string(), map);

                        info!("Loaded translation file for '{}'.", lang);
                    } else {
                        error!(
                            "Failed to parse translation file for '{}': {:?}",
                            lang, resource_path
                        );
                    }
                } else {
                    error!(
                        "Failed to read translation file for '{}': {:?}",
                        lang, resource_path
                    );
                }
            } else {
                error!("Translation resource path not found for '{}'.", lang);
            }
        }
        Self { data }
    }

    pub fn get(&self, lang: &str, key: &str) -> String {
        self.data
            .get(lang)
            .and_then(|translations| translations.get(key))
            .cloned()
            .unwrap_or_else(|| {
                self.data
                    .get("en")
                    .and_then(|translations| translations.get(key))
                    .cloned()
                    .unwrap_or_else(|| key.to_string())
            })
    }
}

fn normalize_language_code(lang: &str) -> String {
    let normalized = lang.to_ascii_lowercase();
    if normalized.starts_with("ko") {
        "ko".to_string()
    } else if normalized.starts_with("ja") {
        "ja".to_string()
    } else if normalized.starts_with("zh-hant")
        || normalized.starts_with("zh-tw")
        || normalized.starts_with("zh-hk")
    {
        "zh-Hant".to_string()
    } else if normalized.starts_with("zh") {
        "zh".to_string()
    } else if normalized.starts_with("tr") {
        "tr".to_string()
    } else {
        "en".to_string()
    }
}

// --- App State ---
#[derive(serde::Serialize, Clone)]
struct CameraDetail {
    index: u32,
    name: String,
}

#[derive(Clone, Copy)]
enum TrayStatus {
    Paused,
    Monitoring,
    CameraUnclear,
    PostureGood,
    PostureDrifting,
    ReminderDelivered,
}

impl TrayStatus {
    fn translation_key(self) -> &'static str {
        match self {
            Self::Paused => "tray_status_paused",
            Self::Monitoring => "tray_status_monitoring",
            Self::CameraUnclear => "tray_status_camera_unclear",
            Self::PostureGood => "tray_status_posture_good",
            Self::PostureDrifting => "tray_status_posture_drifting",
            Self::ReminderDelivered => "tray_status_reminder_delivered",
        }
    }
}

#[derive(Clone)]
struct TrayMenuItems {
    start_monitoring: MenuItem<tauri::Wry>,
    stop_monitoring: MenuItem<tauri::Wry>,
    test_reminder: MenuItem<tauri::Wry>,
    show: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

#[derive(Clone)]
struct AppState {
    pose_analyzer: Arc<PoseAnalyzer>,
    monitoring_active: Arc<Mutex<bool>>,
    force_capture_now: Arc<Mutex<bool>>,
    force_preview_now: Arc<Mutex<bool>>,
    backend_preview_active: Arc<Mutex<bool>>,
    calibration_in_progress: Arc<Mutex<bool>>,
    calibration_commit_in_progress: Arc<Mutex<bool>>,
    reminder_engine: Arc<Mutex<ReminderEngine>>,
    reminder_preferences: Arc<Mutex<ReminderPreferences>>,
    camera: Arc<Mutex<Option<Camera>>>,
    selected_camera_index: Arc<Mutex<u32>>,
    monitoring_interval_secs: Arc<Mutex<u64>>,
    translations: Arc<Translations>,
    current_language: Arc<Mutex<String>>,
    battery_saving_mode: Arc<Mutex<bool>>,
    tray: Arc<Mutex<Option<TrayIcon>>>,
    tray_status_item: Arc<Mutex<Option<MenuItem<tauri::Wry>>>>,
    tray_menu_items: Arc<Mutex<Option<TrayMenuItems>>>,
    tray_status: Arc<Mutex<TrayStatus>>,
}

fn ensure_continuous_camera_stream(state: &AppState) -> bool {
    let mut cam_lock = lock_or_recover(&state.camera);

    if let Some(cam) = cam_lock.as_mut() {
        if cam.is_stream_open() {
            return true;
        }

        match cam.open_stream() {
            Ok(_) => {
                info!("Reused and restarted existing camera stream");
                return true;
            }
            Err(e) => {
                error!("Failed to restart existing camera stream: {}", e);
                *cam_lock = None;
            }
        }
    }

    let index = *lock_or_recover(&state.selected_camera_index);
    // Prefer the camera's full field-of-view resolution. Highest-frame-rate modes on
    // built-in Mac cameras can select a lower-resolution, visibly tighter crop.
    let requested =
        RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestResolution);

    match Camera::new(CameraIndex::Index(index), requested) {
        Ok(mut cam) => match cam.open_stream() {
            Ok(_) => {
                info!("Started camera stream in normal mode (index={})", index);
                *cam_lock = Some(cam);
                true
            }
            Err(e) => {
                error!(
                    "Failed to start camera stream in normal mode (index={}): {}",
                    index, e
                );
                false
            }
        },
        Err(e) => {
            error!(
                "Failed to initialize camera in normal mode (index={}): {}",
                index, e
            );
            false
        }
    }
}

fn lock_or_recover<'a, T>(mutex: &'a Mutex<T>) -> MutexGuard<'a, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            error!("Mutex poisoned - recovering guarded state");
            poisoned.into_inner()
        }
    }
}

fn stop_and_release_camera(state: &AppState, reason: &str) {
    let camera_to_stop = {
        let mut cam_lock = lock_or_recover(&state.camera);
        cam_lock.take()
    };

    if let Some(mut cam) = camera_to_stop {
        if cam.is_stream_open() {
            if let Err(e) = cam.stop_stream() {
                error!("{}: failed to stop camera stream: {}", reason, e);
            } else {
                info!("{}: camera stream stopped", reason);
            }
        } else {
            info!("{}: camera handle released (stream already closed)", reason);
        }
    }
}

// --- Tauri Commands ---
#[tauri::command]
async fn initialize_pose_model(
    state: State<'_, AppState>,
    handle: tauri::AppHandle,
) -> Result<(), String> {
    if state.pose_analyzer.is_model_initialized() {
        info!("Pose model is already initialized");
        return Ok(());
    }
    info!("Initializing pose model");
    state
        .pose_analyzer
        .initialize_model(handle)
        .await
        .map_err(|e| {
            error!("Pose model initialization failed: {}", e);
            e.to_string()
        })
}

#[tauri::command]
async fn start_monitoring(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if !licensing::get_license_status(&app).can_use_app {
        let _ = app.emit("license-access-required", &serde_json::json!({}));
        return Err("TRIAL_EXPIRED".to_string());
    }
    *lock_or_recover(&state.monitoring_active) = true;
    *lock_or_recover(&state.force_capture_now) = true;
    if *lock_or_recover(&state.backend_preview_active) {
        *lock_or_recover(&state.force_preview_now) = true;
    }
    lock_or_recover(&state.reminder_engine).reset();

    if let Some(tray) = lock_or_recover(&state.tray).as_ref() {
        set_tray_icon(&app, tray, "monitoring_on.png");
    }
    update_tray_status(&state, TrayStatus::Monitoring);
    let _ = app.emit(
        "monitoring-state-changed",
        &serde_json::json!({ "active": true }),
    );
    info!("Real-time monitoring started");
    Ok(())
}

fn encode_preview_frame_data_url(image: &ImageBuffer<Rgb<u8>, Vec<u8>>) -> Result<String, String> {
    const PREVIEW_MAX_WIDTH: u32 = 960;
    let preview = if image.width() > PREVIEW_MAX_WIDTH {
        let (_, preview_height) =
            fit_preview_dimensions(image.width(), image.height(), PREVIEW_MAX_WIDTH);
        image::imageops::resize(
            image,
            PREVIEW_MAX_WIDTH,
            preview_height,
            image::imageops::FilterType::Triangle,
        )
    } else {
        image.clone()
    };
    let mut jpeg_bytes: Vec<u8> = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, 62);

    encoder
        .encode(
            preview.as_raw(),
            preview.width(),
            preview.height(),
            image::ColorType::Rgb8.into(),
        )
        .map_err(|e| format!("Failed to encode preview frame as JPEG: {}", e))?;

    Ok(format!(
        "data:image/jpeg;base64,{}",
        STANDARD.encode(jpeg_bytes)
    ))
}

fn fit_preview_dimensions(width: u32, height: u32, max_width: u32) -> (u32, u32) {
    if width <= max_width || width == 0 {
        return (width, height);
    }
    let fitted_height = ((height as f64 * max_width as f64 / width as f64).round() as u32).max(1);
    (max_width, fitted_height)
}

fn effective_analysis_interval(
    configured: Duration,
    main_window_visible: bool,
    battery_saving: bool,
) -> Duration {
    if main_window_visible && !battery_saving {
        configured.min(Duration::from_secs(1))
    } else {
        configured
    }
}

#[tauri::command]
async fn stop_monitoring(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    *lock_or_recover(&state.monitoring_active) = false;
    *lock_or_recover(&state.force_capture_now) = false;
    *lock_or_recover(&state.force_preview_now) = false;
    lock_or_recover(&state.reminder_engine).reset();
    stop_and_release_camera(&state, "stop_monitoring command");

    if let Some(tray) = lock_or_recover(&state.tray).as_ref() {
        set_tray_icon(&app, tray, "monitoring_off.png");
    }
    update_tray_status(&state, TrayStatus::Paused);
    for label in ["reminder", "screen-dim"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.hide();
        }
    }
    let _ = app.emit(
        "monitoring-state-changed",
        &serde_json::json!({ "active": false }),
    );
    info!("Real-time monitoring stopped");
    Ok(())
}

#[tauri::command]
async fn calibrate_user_posture(
    state: State<'_, AppState>,
    handle: tauri::AppHandle,
    image_data_samples: Vec<String>,
    reference_image_data: String,
) -> Result<String, String> {
    if !licensing::get_license_status(&handle).can_use_app {
        let _ = handle.emit("license-access-required", &serde_json::json!({}));
        return Err("TRIAL_EXPIRED".to_string());
    }
    {
        let mut calibration_commit_in_progress =
            lock_or_recover(&state.calibration_commit_in_progress);
        if *calibration_commit_in_progress {
            return Err("CALIBRATION_IN_PROGRESS".to_string());
        }
        *calibration_commit_in_progress = true;
    }
    *lock_or_recover(&state.calibration_in_progress) = true;
    info!("Starting user posture calibration");
    let calibration_result = state.pose_analyzer.calibrate_and_save_reference(
        &image_data_samples,
        &reference_image_data,
        &handle,
    );
    *lock_or_recover(&state.calibration_in_progress) = false;
    *lock_or_recover(&state.calibration_commit_in_progress) = false;

    match calibration_result {
        Ok(reference_path) => {
            *lock_or_recover(&state.force_capture_now) = true;
            Ok(reference_path.to_string_lossy().into_owned())
        }
        Err(error) => {
            error!("User posture calibration failed: {}", error);
            Err(error.to_string())
        }
    }
}

#[tauri::command]
fn get_monitoring_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let monitoring_active = *lock_or_recover(&state.monitoring_active);
    Ok(serde_json::json!({ "active": monitoring_active }))
}

#[tauri::command]
fn set_reminder_preferences(
    app: AppHandle,
    state: State<'_, AppState>,
    preferences: ReminderPreferences,
) -> ReminderPreferences {
    let mut normalized = preferences.normalized();
    let license = licensing::get_license_status(&app);
    if license.commercial_ready && !license.can_use_app {
        normalized.screen_dim = false;
    }
    *lock_or_recover(&state.reminder_preferences) = normalized.clone();
    normalized
}

#[derive(serde::Serialize, Clone)]
struct ReminderPayload {
    message: String,
    duration_ms: u64,
    dim_opacity: f32,
    is_test: bool,
}

fn position_floating_reminder(app: &AppHandle) {
    let Some(window) = app.get_webview_window("reminder") else {
        return;
    };
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let Ok(window_size) = window.outer_size() else {
        return;
    };
    let x =
        monitor_position.x + ((monitor_size.width as i32 - window_size.width as i32) / 2).max(0);
    let y = monitor_position.y + 44;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn cover_primary_monitor(app: &AppHandle) {
    let Some(window) = app.get_webview_window("screen-dim") else {
        return;
    };
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let _ = window.set_position(*monitor.position());
    let _ = window.set_size(*monitor.size());
}

fn update_tray_status(state: &AppState, status: TrayStatus) {
    *lock_or_recover(&state.tray_status) = status;
    let lang = lock_or_recover(&state.current_language).clone();
    let label = state.translations.get(&lang, status.translation_key());
    let status_label = state.translations.get(&lang, "tray_status_label");

    if let Some(item) = lock_or_recover(&state.tray_status_item).as_ref() {
        let _ = item.set_text(format!("{}: {}", status_label, label));
    }
    if let Some(tray) = lock_or_recover(&state.tray).as_ref() {
        let _ = tray.set_tooltip(Some(format!("OnePosture · {}", label)));
    }
}

fn load_tray_icon(app: &AppHandle, filename: &str) -> Result<Image<'static>, String> {
    let icon_path = app
        .path()
        .resolve(format!("icons/{filename}"), BaseDirectory::Resource)
        .map_err(|error| format!("Failed to resolve tray icon {filename}: {error}"))?;

    Image::from_path(&icon_path)
        .map_err(|error| format!("Failed to load tray icon {}: {error}", icon_path.display()))
}

fn set_tray_icon(app: &AppHandle, tray: &TrayIcon, filename: &str) {
    match load_tray_icon(app, filename) {
        Ok(icon) => {
            if let Err(error) = tray.set_icon(Some(icon)) {
                error!("Failed to set tray icon {filename}: {error}");
            }
        }
        Err(error) => error!("{error}"),
    }
}

fn update_tray_menu_language(state: &AppState) {
    let lang = lock_or_recover(&state.current_language).clone();
    if let Some(items) = lock_or_recover(&state.tray_menu_items).as_ref() {
        let _ = items
            .start_monitoring
            .set_text(state.translations.get(&lang, "tray_start_monitoring"));
        let _ = items
            .stop_monitoring
            .set_text(state.translations.get(&lang, "tray_stop_monitoring"));
        let _ = items
            .test_reminder
            .set_text(state.translations.get(&lang, "tray_test_reminder"));
        let _ = items
            .show
            .set_text(state.translations.get(&lang, "tray_show_app"));
        let _ = items
            .quit
            .set_text(state.translations.get(&lang, "tray_quit"));
    }

    let status = *lock_or_recover(&state.tray_status);
    update_tray_status(state, status);
}

fn deliver_reminder(
    app: &AppHandle,
    preferences: &ReminderPreferences,
    message: String,
    is_test: bool,
) {
    let payload = ReminderPayload {
        message: message.clone(),
        duration_ms: preferences.display_seconds * 1000,
        dim_opacity: preferences.dim_opacity,
        is_test,
    };

    // Keep the main window informed for accessibility announcements and any
    // visible in-app status. The reminder surfaces are independent fallbacks.
    let _ = app.emit("posture-alert", &message);

    if preferences.floating_window {
        position_floating_reminder(app);
        if let Some(window) = app.get_webview_window("reminder") {
            let _ = window.show();
            let _ = window.emit("reliable-reminder", &payload);
        }
    }

    if preferences.screen_dim {
        cover_primary_monitor(app);
        if let Some(window) = app.get_webview_window("screen-dim") {
            let _ = window.show();
            let _ = window.emit("reliable-reminder", &payload);
        }
    }

    if preferences.native_notification {
        let mut builder = app
            .notification()
            .builder()
            .title("OnePosture")
            .body(&message)
            .icon("icons/icon.png".to_string());
        if preferences.sound {
            builder = builder.sound("Ping");
        }
        if let Err(error) = builder.show() {
            error!("Failed to send system notification: {}", error);
        }
    }

    let hide_app = app.clone();
    let hide_after = preferences.display_seconds;
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_secs(hide_after)).await;
        for label in ["reminder", "screen-dim"] {
            if let Some(window) = hide_app.get_webview_window(label) {
                let _ = window.hide();
            }
        }
    });
}

#[tauri::command]
fn send_test_reminder(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if !licensing::get_license_status(&app).can_use_app {
        let _ = app.emit("license-access-required", &serde_json::json!({}));
        return Err("TRIAL_EXPIRED".to_string());
    }
    let preferences = lock_or_recover(&state.reminder_preferences).clone();
    let lang = lock_or_recover(&state.current_language).clone();
    let message = state.translations.get(&lang, "alert_both");
    deliver_reminder(&app, &preferences, message, true);
    Ok(())
}

#[tauri::command]
fn dismiss_reminder_surfaces(app: AppHandle) {
    for label in ["reminder", "screen-dim"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.hide();
        }
    }
}

#[tauri::command]
fn request_preview_frame(state: State<'_, AppState>) -> Result<(), String> {
    if *lock_or_recover(&state.monitoring_active) {
        *lock_or_recover(&state.force_preview_now) = true;
        info!("Received immediate preview frame request");
    }
    Ok(())
}

#[tauri::command]
fn set_backend_preview_active(state: State<'_, AppState>, active: bool) {
    *lock_or_recover(&state.backend_preview_active) = active;
    if active && *lock_or_recover(&state.monitoring_active) {
        *lock_or_recover(&state.force_preview_now) = true;
    }
}

#[tauri::command]
fn set_calibration_active(state: State<'_, AppState>, active: bool) {
    *lock_or_recover(&state.calibration_in_progress) = active;
}

#[tauri::command]
fn get_calibrated_image_path(handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let app_data_path = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve the app data directory: {}", e))?;
    let file_path = app_data_path
        .join("calibration_images")
        .join("calibrated_pose.jpeg");
    Ok(file_path
        .exists()
        .then(|| file_path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn get_available_cameras() -> Result<Vec<CameraDetail>, String> {
    match nokhwa::query(ApiBackend::Auto) {
        Ok(cameras) => {
            info!("Detected {} available cameras", cameras.len());
            let camera_details = cameras
                .into_iter()
                .map(|cam: CameraInfo| CameraDetail {
                    index: cam.index().as_index().unwrap_or(0),
                    name: cam.human_name(),
                })
                .collect();
            Ok(camera_details)
        }
        Err(e) => {
            error!("Failed to query camera list: {}", e);
            #[cfg(target_os = "linux")]
            {
                return Err(format!(
                    "Failed to query cameras: {}. On Linux, close other camera apps and verify portal or sandbox camera permissions.",
                    e
                ));
            }

            #[cfg(not(target_os = "linux"))]
            {
                Err(e.to_string())
            }
        }
    }
}

#[tauri::command]
async fn set_selected_camera(state: State<'_, AppState>, index: u32) -> Result<(), String> {
    info!("Selected camera changed: index {}", index);

    let monitoring_active = *lock_or_recover(&state.monitoring_active);
    let battery_saving = *lock_or_recover(&state.battery_saving_mode);

    if monitoring_active {
        stop_and_release_camera(&state, "set_selected_camera request");
    }

    *lock_or_recover(&state.selected_camera_index) = index;

    if monitoring_active {
        *lock_or_recover(&state.force_capture_now) = true;
        if battery_saving {
            info!("Camera change applied in battery-saving mode; it will take effect on the next capture cycle.");
        } else {
            info!("Camera change applied in normal mode; stream will be recreated on the next monitoring loop.");
        }
    }

    Ok(())
}

#[tauri::command]
async fn set_detection_settings(
    state: State<'_, AppState>,
    frequency: u8,
    turtle_sensitivity: u8,
    shoulder_sensitivity: u8,
) -> Result<(), String> {
    state.pose_analyzer.set_notification_frequency(frequency);
    state
        .pose_analyzer
        .set_turtle_neck_sensitivity(turtle_sensitivity);
    state
        .pose_analyzer
        .set_shoulder_sensitivity(shoulder_sensitivity);
    Ok(())
}

#[tauri::command]
async fn set_monitoring_interval(
    state: State<'_, AppState>,
    interval_secs: Option<u64>,
    interval_mins: Option<u64>,
) -> Result<(), String> {
    let interval_secs_final = if let Some(secs) = interval_secs {
        secs
    } else if let Some(mins) = interval_mins {
        mins * 60
    } else {
        3
    };
    info!(
        "Monitoring interval updated: {} seconds",
        interval_secs_final
    );
    *lock_or_recover(&state.monitoring_interval_secs) = interval_secs_final;
    Ok(())
}

#[tauri::command]
async fn set_battery_saving_mode(state: State<'_, AppState>, mode: bool) -> Result<(), String> {
    *lock_or_recover(&state.battery_saving_mode) = mode;
    *lock_or_recover(&state.force_capture_now) = true;
    info!("Battery-saving mode updated: {}", mode);

    if mode {
        stop_and_release_camera(&state, "battery-saving mode enabled");
    } else {
        if *lock_or_recover(&state.monitoring_active) {
            info!("Switched to normal mode; camera will reconnect on the next monitoring loop.");
        }
    }
    Ok(())
}

#[tauri::command]
async fn set_current_language(state: State<'_, AppState>, lang: String) -> Result<(), String> {
    let normalized = normalize_language_code(&lang);
    info!("Current language changed: {} -> {}", lang, normalized);
    *lock_or_recover(&state.current_language) = normalized;
    update_tray_menu_language(&state);
    Ok(())
}

#[tauri::command]
async fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    info!("Application restart requested");
    if let Ok(exe_path) = std::env::current_exe() {
        let exe_dir = exe_path.parent().unwrap_or(&exe_path);
        let _ = std::process::Command::new(&exe_path)
            .current_dir(exe_dir)
            .spawn();

        app.exit(0);
    } else {
        return Err("Failed to resolve the current executable path".to_string());
    }
    Ok(())
}

// --- Background Tasks ---

async fn background_monitoring_task(app_handle: AppHandle, state: AppState) {
    let mut last_analysis_time = Instant::now() - Duration::from_secs(3);
    let mut last_preview_time = Instant::now() - Duration::from_millis(100);
    let mut last_license_check = Instant::now() - Duration::from_secs(30);

    loop {
        sleep(Duration::from_millis(50)).await;

        if !*lock_or_recover(&state.monitoring_active) {
            continue;
        }

        if last_license_check.elapsed() >= Duration::from_secs(30) {
            last_license_check = Instant::now();
            if !licensing::get_license_status(&app_handle).can_use_app {
                *lock_or_recover(&state.monitoring_active) = false;
                *lock_or_recover(&state.force_capture_now) = false;
                *lock_or_recover(&state.force_preview_now) = false;
                lock_or_recover(&state.reminder_engine).reset();
                stop_and_release_camera(&state, "trial expired");
                if let Some(tray) = lock_or_recover(&state.tray).as_ref() {
                    set_tray_icon(&app_handle, tray, "monitoring_off.png");
                }
                update_tray_status(&state, TrayStatus::Paused);
                let _ = app_handle.emit(
                    "monitoring-state-changed",
                    &serde_json::json!({ "active": false }),
                );
                let _ = app_handle.emit("license-access-required", &serde_json::json!({}));
                continue;
            }
        }

        let configured_interval = {
            let secs = *lock_or_recover(&state.monitoring_interval_secs);
            Duration::from_secs(secs.max(1))
        };
        let main_window_visible = app_handle
            .get_webview_window("main")
            .map(|window| {
                window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
            })
            .unwrap_or(false);
        let battery_saving = *lock_or_recover(&state.battery_saving_mode);
        let analysis_interval =
            effective_analysis_interval(configured_interval, main_window_visible, battery_saving);

        let force_analysis = {
            let mut force_capture_now = lock_or_recover(&state.force_capture_now);
            let should_capture = *force_capture_now;
            if should_capture {
                *force_capture_now = false;
            }
            should_capture
        };
        let force_preview = {
            let mut force_preview_now = lock_or_recover(&state.force_preview_now);
            let should_capture = *force_preview_now;
            if should_capture {
                *force_preview_now = false;
            }
            should_capture
        };
        let backend_preview_active = *lock_or_recover(&state.backend_preview_active);
        let preview_due = force_preview
            || (backend_preview_active
                && main_window_visible
                && !battery_saving
                && last_preview_time.elapsed() >= Duration::from_millis(100));
        let calibration_in_progress = *lock_or_recover(&state.calibration_in_progress);
        let analysis_due = !calibration_in_progress
            && (force_analysis || last_analysis_time.elapsed() >= analysis_interval);

        if !preview_due && !analysis_due {
            continue;
        }

        if force_analysis {
            info!("Executing forced immediate capture");
        }
        if analysis_due {
            last_analysis_time = Instant::now();
        }
        if preview_due {
            last_preview_time = Instant::now();
        }

        let selected_index = *lock_or_recover(&state.selected_camera_index);
        let buffer_option = if battery_saving {
            stop_and_release_camera(&state, "pre-capture cleanup for battery-saving mode");
            info!(
                "Battery-saving mode: attempting camera capture, index {}",
                selected_index
            );
            let requested_types = [
                RequestedFormatType::AbsoluteHighestResolution,
                RequestedFormatType::HighestFrameRate(15),
                RequestedFormatType::HighestFrameRate(10),
                RequestedFormatType::AbsoluteHighestFrameRate,
                RequestedFormatType::None,
            ];

            let mut captured_buffer = None;

            for requested_type in requested_types {
                let requested = RequestedFormat::new::<RgbFormat>(requested_type);
                info!("Battery-saving mode: trying format {:?}", requested_type);

                match Camera::new(CameraIndex::Index(selected_index), requested) {
                    Ok(mut cam) => {
                        if let Err(e) = cam.open_stream() {
                            error!("Failed to open camera stream ({:?}): {}", requested_type, e);
                            continue;
                        }

                        info!(
                            "Battery-saving mode: camera stream opened ({:?})",
                            requested_type
                        );
                        tokio::time::sleep(Duration::from_millis(700)).await;

                        let mut frame_captured = None;
                        for attempt in 1..=3 {
                            match cam.frame() {
                                Ok(buffer) => {
                                    if attempt > 1 {
                                        info!("Battery-saving mode: capture succeeded after {} retries", attempt - 1);
                                    } else {
                                        info!("Battery-saving mode: camera capture succeeded");
                                    }
                                    frame_captured = Some(buffer);
                                    break;
                                }
                                Err(e) => {
                                    warn!(
                                        "Battery-saving mode: frame capture failed ({:?}, attempt={}): {}",
                                        requested_type,
                                        attempt,
                                        e
                                    );
                                    tokio::time::sleep(Duration::from_millis(250)).await;
                                }
                            }
                        }

                        if let Err(e) = cam.stop_stream() {
                            error!(
                                "Failed to close camera stream ({:?}): {}",
                                requested_type, e
                            );
                        } else {
                            info!(
                                "Battery-saving mode: camera stream closed ({:?})",
                                requested_type
                            );
                        }

                        if frame_captured.is_some() {
                            captured_buffer = frame_captured;
                            break;
                        }
                    }
                    Err(e) => {
                        error!("Failed to initialize camera ({:?}): {}", requested_type, e);
                    }
                }
            }

            if captured_buffer.is_none() {
                error!("Battery-saving mode: failed to capture from all available formats");
            }

            captured_buffer
        } else {
            if !ensure_continuous_camera_stream(&state) {
                warn!("Normal mode camera preparation failed. Retrying on the next cycle.");
                continue;
            }

            let mut cam_lock = lock_or_recover(&state.camera);
            if let Some(cam) = cam_lock.as_mut() {
                if cam.is_stream_open() {
                    cam.frame().ok()
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(buffer) = buffer_option {
            debug!("Starting camera frame decode");
            if let Ok(decoded_image) = buffer.decode_image::<RgbFormat>() {
                debug!("Camera frame decode succeeded");
                if let Some(rgb_image) = ImageBuffer::<Rgb<u8>, _>::from_raw(
                    decoded_image.width(),
                    decoded_image.height(),
                    decoded_image.into_raw(),
                ) {
                    if preview_due {
                        match encode_preview_frame_data_url(&rgb_image) {
                            Ok(preview_frame_data_url) => {
                                if let Err(e) =
                                    app_handle.emit("camera-preview-frame", &preview_frame_data_url)
                                {
                                    error!("Failed to emit preview frame event: {}", e);
                                }
                            }
                            Err(e) => {
                                error!("Failed to generate preview frame: {}", e);
                            }
                        }
                    }

                    if !analysis_due {
                        continue;
                    }

                    if let Ok(result_str) = state.pose_analyzer.analyze_image_buffer(&rgb_image) {
                        debug!("Pose analysis succeeded");
                        if let Ok(result_json) = serde_json::from_str::<Value>(&result_str) {
                            let _ = app_handle.emit("analysis-update", &result_json);
                            let score = result_json.get("posture_score").and_then(|v| v.as_i64());
                            let is_turtle = result_json
                                .get("turtle_neck")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let is_shoulder = result_json
                                .get("shoulder_misalignment")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let stable_turtle = result_json
                                .get("stable_turtle_neck")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(is_turtle);
                            let stable_shoulder = result_json
                                .get("stable_shoulder_misalignment")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(is_shoulder);
                            let reliable = result_json
                                .get("reliable")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let baseline_ready = result_json
                                .get("baseline_ready")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            info!("Pose result: reliable={}, head_offset={}, shoulder_misalignment={}", reliable, is_turtle, is_shoulder);

                            let preferences = lock_or_recover(&state.reminder_preferences).clone();
                            let signal = if !reliable || !baseline_ready || score.is_none() {
                                PostureSignal::Unreliable
                            } else if stable_turtle || stable_shoulder {
                                PostureSignal::Bad
                            } else {
                                PostureSignal::Good
                            };
                            let decision = lock_or_recover(&state.reminder_engine).observe(
                                signal,
                                Instant::now(),
                                &preferences,
                            );

                            match decision.state {
                                ReminderState::WaitingForSignal => {
                                    update_tray_status(&state, TrayStatus::CameraUnclear)
                                }
                                ReminderState::Good => {
                                    update_tray_status(&state, TrayStatus::PostureGood)
                                }
                                ReminderState::Drifting => {
                                    update_tray_status(&state, TrayStatus::PostureDrifting)
                                }
                                ReminderState::Cooldown => {
                                    update_tray_status(&state, TrayStatus::ReminderDelivered)
                                }
                            }

                            if !reliable || !baseline_ready {
                                continue;
                            }

                            let timestamp = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .map(|duration| duration.as_secs() as i64)
                                .unwrap_or_else(|error| {
                                    warn!(
                                        "Failed to convert system time (before UNIX_EPOCH): {}",
                                        error
                                    );
                                    0
                                });

                            if let Some(score) = score {
                                let instances = app_handle.state::<DbInstances>();
                                let db_map = instances.0.read().await;

                                if let Some(tauri_plugin_sql::DbPool::Sqlite(sqlite_pool)) =
                                    db_map.get("sqlite:posture_data.db")
                                {
                                    let query = "INSERT INTO posture_log (score, is_turtle_neck, is_shoulder_misaligned, timestamp) VALUES (?, ?, ?, ?)";
                                    if let Err(e) = sqlx::query(query)
                                        .bind(score)
                                        .bind(is_turtle)
                                        .bind(is_shoulder)
                                        .bind(timestamp)
                                        .execute(sqlite_pool)
                                        .await
                                    {
                                        error!("Database write failed: {}", e);
                                    }
                                }
                            }

                            if decision.should_remind {
                                let lang = lock_or_recover(&state.current_language).clone();
                                let message_key = if stable_turtle && stable_shoulder {
                                    "alert_both"
                                } else if stable_turtle {
                                    "alert_turtle"
                                } else {
                                    "alert_shoulder"
                                };
                                let message = state.translations.get(&lang, message_key);
                                deliver_reminder(&app_handle, &preferences, message, false);
                            }
                        }
                    }
                }
            }
        }
    }
}

fn copy_file_if_missing(source: &Path, destination: &Path) -> Result<bool, String> {
    if destination.exists() || !source.exists() {
        return Ok(false);
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, destination).map_err(|error| error.to_string())?;
    Ok(true)
}

fn migrate_legacy_app_data(handle: &AppHandle) -> Result<(), String> {
    let app_data_path = handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve the app data directory: {error}"))?;
    let Some(application_support) = app_data_path.parent() else {
        return Ok(());
    };
    let legacy_path = application_support.join("com.dduldduck.pose-nudge");
    if !legacy_path.exists() {
        return Ok(());
    }
    fs::create_dir_all(&app_data_path).map_err(|error| error.to_string())?;

    let legacy_baseline = legacy_path.join("baseline.json");
    let baseline_path = app_data_path.join("baseline.json");
    if !baseline_path.exists() && legacy_baseline.exists() {
        let baseline_json =
            fs::read_to_string(&legacy_baseline).map_err(|error| error.to_string())?;
        let baseline: Value = serde_json::from_str(&baseline_json)
            .map_err(|error| format!("Legacy baseline is invalid: {error}"))?;
        if !baseline.is_object() {
            return Err("Legacy baseline is not a JSON object".to_string());
        }
    }

    let baseline_migrated = copy_file_if_missing(&legacy_baseline, &baseline_path)?;
    let reference_path = app_data_path
        .join("calibration_images")
        .join("calibrated_pose.jpeg");
    let reference_migrated = copy_file_if_missing(
        &legacy_path
            .join("calibration_images")
            .join("calibrated_pose.jpeg"),
        &reference_path,
    )?;
    let database_migrated = copy_file_if_missing(
        &legacy_path.join("posture_data.db"),
        &app_data_path.join("posture_data.db"),
    )?;

    let legacy_settings_path = legacy_path.join(".settings.dat");
    let settings_path = app_data_path.join(".settings.dat");
    let mut settings = fs::read_to_string(&settings_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if let Some(legacy_settings) = fs::read_to_string(&legacy_settings_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .and_then(|value| value.as_object().cloned())
    {
        for (key, value) in legacy_settings {
            settings.entry(key).or_insert(value);
        }
    }
    if reference_path.exists() {
        settings.insert(
            "calibratedImagePath".to_string(),
            Value::String(reference_path.to_string_lossy().into_owned()),
        );
    }
    let settings_temp = settings_path.with_extension("dat.tmp");
    fs::write(
        &settings_temp,
        serde_json::to_vec_pretty(&Value::Object(settings)).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::rename(&settings_temp, &settings_path).map_err(|error| error.to_string())?;

    if baseline_migrated || reference_migrated || database_migrated {
        info!(
            "Migrated legacy Pose Nudge data (baseline={}, reference={}, database={})",
            baseline_migrated, reference_migrated, database_migrated
        );
    }
    Ok(())
}

// --- Main Application Setup ---

fn main() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            info!("Set WEBKIT_DISABLE_DMABUF_RENDERER=1 for Linux runtime compatibility");
        }
    }

    run();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let run_result = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::Webview),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("oneposture".to_string()),
                    }),
                ])
                .level(LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::new()
            .add_migrations(
                "sqlite:posture_data.db",
                vec![Migration {
                    version: 1,
                    description: "create posture log table",
                    sql: "CREATE TABLE IF NOT EXISTS posture_log (id INTEGER PRIMARY KEY AUTOINCREMENT, score INTEGER NOT NULL, is_turtle_neck BOOLEAN NOT NULL, is_shoulder_misaligned BOOLEAN NOT NULL, timestamp INTEGER NOT NULL);",
                    kind: MigrationKind::Up,
                }],
            ).build())
        .setup(|app| {
            if let Err(error) = migrate_legacy_app_data(app.handle()) {
                error!("Legacy data migration failed: {}", error);
            }
            let quit = MenuItem::with_id(app, "quit", "Quit OnePosture", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show App", true, None::<&str>)?;
            let start_monitoring_item = MenuItem::with_id(app, "start_monitoring", "Start Monitoring", true, None::<&str>)?;
            let stop_monitoring_item = MenuItem::with_id(app, "stop_monitoring", "Stop Monitoring", true, None::<&str>)?;
            let test_reminder_item = MenuItem::with_id(app, "test_reminder", "Test Reminder", true, None::<&str>)?;
            let tray_status_item = MenuItem::with_id(app, "status", "Status: Paused", false, None::<&str>)?;
            let menu = Menu::with_items(app, &[
                &tray_status_item,
                &PredefinedMenuItem::separator(app)?,
                &start_monitoring_item,
                &stop_monitoring_item,
                &test_reminder_item,
                &PredefinedMenuItem::separator(app)?,
                &show,
                &quit,
            ])?;

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let translations = Arc::new(Translations::new(app.path()));

            let app_state = AppState {
                pose_analyzer: Arc::new(PoseAnalyzer::new()),
                monitoring_active: Arc::new(Mutex::new(false)),
                force_capture_now: Arc::new(Mutex::new(false)),
                force_preview_now: Arc::new(Mutex::new(false)),
                backend_preview_active: Arc::new(Mutex::new(false)),
                calibration_in_progress: Arc::new(Mutex::new(false)),
                calibration_commit_in_progress: Arc::new(Mutex::new(false)),
                reminder_engine: Arc::new(Mutex::new(ReminderEngine::new())),
                reminder_preferences: Arc::new(Mutex::new(ReminderPreferences::default())),
                camera: Arc::new(Mutex::new(None)),
                selected_camera_index: Arc::new(Mutex::new(0)),
                monitoring_interval_secs: Arc::new(Mutex::new(3)),
                translations,
                current_language: Arc::new(Mutex::new("en".to_string())),
                battery_saving_mode: Arc::new(Mutex::new(false)),
                tray: Arc::new(Mutex::new(None)),
                tray_status_item: Arc::new(Mutex::new(Some(tray_status_item))),
                tray_menu_items: Arc::new(Mutex::new(Some(TrayMenuItems {
                    start_monitoring: start_monitoring_item,
                    stop_monitoring: stop_monitoring_item,
                    test_reminder: test_reminder_item,
                    show,
                    quit,
                }))),
                tray_status: Arc::new(Mutex::new(TrayStatus::Paused)),
            };
            app.manage(app_state.clone());

            if let Some(dim_window) = app.get_webview_window("screen-dim") {
                let _ = dim_window.set_ignore_cursor_events(true);
            }

            let monitor_app_handle = app.handle().clone();
            let monitor_state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                background_monitoring_task(monitor_app_handle, monitor_state).await;
            });

            let init_app_handle = app.handle().clone();
            let init_state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = init_state.pose_analyzer.initialize_model(init_app_handle.clone()).await {
                    error!("Model initialization failed: {}", e);
                } else {
                    if let Err(e) = init_state.pose_analyzer.load_baseline_from_file(&init_app_handle) {
                        error!("Failed to load baseline: {}", e);
                    }
                }
            });

            let paused_icon = load_tray_icon(app.handle(), "monitoring_off.png")
                .map_err(std::io::Error::other)?;

            let tray = TrayIconBuilder::new()
                .icon(paused_icon)
                .tooltip("OnePosture · Paused")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    let state = app.state::<AppState>();
                    match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "show" => if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        },
                        "start_monitoring" => {
                            info!("'Start Monitoring' clicked");
                            if !licensing::get_license_status(app).can_use_app {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.unminimize();
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                                let _ = app.emit("license-access-required", &serde_json::json!({}));
                                return;
                            }
                            *lock_or_recover(&state.monitoring_active) = true;
                            *lock_or_recover(&state.force_capture_now) = true;
                            if *lock_or_recover(&state.backend_preview_active) {
                                *lock_or_recover(&state.force_preview_now) = true;
                            }
                            lock_or_recover(&state.reminder_engine).reset();
                            if let Some(tray) = lock_or_recover(&state.tray).as_ref() {
                                set_tray_icon(app, tray, "monitoring_on.png");
                            }
                            update_tray_status(&state, TrayStatus::Monitoring);
                            let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": true }));
                        }
                        "stop_monitoring" => {
                            info!("'Stop Monitoring' clicked");
                            *lock_or_recover(&state.monitoring_active) = false;
                            *lock_or_recover(&state.force_capture_now) = false;
                            *lock_or_recover(&state.force_preview_now) = false;
                            lock_or_recover(&state.reminder_engine).reset();
                            stop_and_release_camera(&state, "tray stop_monitoring action");
                            if let Some(tray) = lock_or_recover(&state.tray).as_ref() {
                                set_tray_icon(app, tray, "monitoring_off.png");
                            }
                            update_tray_status(&state, TrayStatus::Paused);
                            for label in ["reminder", "screen-dim"] {
                                if let Some(window) = app.get_webview_window(label) {
                                    let _ = window.hide();
                                }
                            }
                            let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": false }));
                        }
                        "test_reminder" => {
                            if !licensing::get_license_status(app).can_use_app {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.unminimize();
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                                let _ = app.emit("license-access-required", &serde_json::json!({}));
                                return;
                            }
                            let preferences = lock_or_recover(&state.reminder_preferences).clone();
                            let lang = lock_or_recover(&state.current_language).clone();
                            let message = state.translations.get(&lang, "alert_both");
                            deliver_reminder(app, &preferences, message, true);
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            *lock_or_recover(&app_state.tray) = Some(tray);
            update_tray_status(&app_state, TrayStatus::Paused);

            #[cfg(debug_assertions)]
            if std::env::var_os("ONEPOSTURE_TEST_REMINDER").is_some() {
                let test_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    sleep(Duration::from_secs(2)).await;
                    let preferences = ReminderPreferences {
                        native_notification: false,
                        floating_window: true,
                        screen_dim: true,
                        sound: false,
                        display_seconds: 30,
                        ..ReminderPreferences::default()
                    };
                    deliver_reminder(
                        &test_app,
                        &preferences,
                        "Test reminder: gently reset your posture".to_string(),
                        true,
                    );
                });
            }

            info!("OnePosture application initialized");
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Destroyed => {
                let state = window.state::<AppState>();
                stop_and_release_camera(&state, "window destroyed");
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            initialize_pose_model,
            start_monitoring,
            stop_monitoring,
            get_monitoring_status,
            set_reminder_preferences,
            send_test_reminder,
            dismiss_reminder_surfaces,
            get_license_status,
            activate_license,
            request_preview_frame,
            set_backend_preview_active,
            set_calibration_active,
            get_calibrated_image_path,
            calibrate_user_posture,
            set_detection_settings,
            get_available_cameras,
            set_selected_camera,
            set_monitoring_interval,
            set_current_language,
            set_battery_saving_mode,
            restart_app
        ])
        .run(tauri::generate_context!());

    if let Err(error) = run_result {
        error!("Failed to run Tauri application: {}", error);
    }
}

#[cfg(test)]
mod main_tests {
    use super::{effective_analysis_interval, fit_preview_dimensions};
    use std::time::Duration;

    #[test]
    fn preview_resize_preserves_widescreen_aspect_ratio() {
        assert_eq!(fit_preview_dimensions(1920, 1080, 960), (960, 540));
        assert_eq!(fit_preview_dimensions(640, 480, 960), (640, 480));
    }

    #[test]
    fn visible_live_view_updates_analysis_every_second() {
        assert_eq!(
            effective_analysis_interval(Duration::from_secs(15), true, false),
            Duration::from_secs(1)
        );
        assert_eq!(
            effective_analysis_interval(Duration::from_secs(15), false, false),
            Duration::from_secs(15)
        );
        assert_eq!(
            effective_analysis_interval(Duration::from_secs(15), true, true),
            Duration::from_secs(15)
        );
    }
}
