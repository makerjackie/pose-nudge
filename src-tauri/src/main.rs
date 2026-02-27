#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use log::{error, info, warn, LevelFilter};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
  image::Image,
  menu::{Menu, MenuItem, PredefinedMenuItem},
  path::{BaseDirectory, PathResolver},
  tray::{TrayIcon, TrayIconBuilder},
  AppHandle,
  Emitter,
  Manager,
  Runtime,
  State,
};
use tauri_plugin_notification::NotificationExt;
use tokio::time::sleep;

use image::{codecs::jpeg::JpegEncoder, ImageBuffer, Rgb};
use nokhwa::{
    pixel_format::RgbFormat,
    utils::{ApiBackend, CameraIndex, CameraInfo, RequestedFormat, RequestedFormatType},
    Camera,
};

use sqlx;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_sql::{DbInstances, Migration, MigrationKind};

mod pose_analysis;
use pose_analysis::PoseAnalyzer;

pub struct Translations {
    data: HashMap<String, HashMap<String, String>>,
}

impl Translations {
    pub fn new<R: Runtime>(path_resolver: &PathResolver<R>) -> Self {
        let mut data = HashMap::new();
        let locales = vec!["en", "ko", "ja", "zh", "tr"];

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
                        error!("Failed to parse translation file for '{}': {:?}", lang, resource_path);
                    }
                } else {
                    error!("Failed to read translation file for '{}': {:?}", lang, resource_path);
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

#[derive(Clone)]
struct AppState {
    pose_analyzer: Arc<PoseAnalyzer>,
    monitoring_active: Arc<Mutex<bool>>,
    force_capture_now: Arc<Mutex<bool>>,
    last_alert_time: Arc<Mutex<Instant>>,
    alert_messages: Arc<Mutex<Vec<String>>>,
    camera: Arc<Mutex<Option<Camera>>>,
    selected_camera_index: Arc<Mutex<u32>>,
    monitoring_interval_secs: Arc<Mutex<u64>>,
    translations: Arc<Translations>,
    current_language: Arc<Mutex<String>>,
    battery_saving_mode: Arc<Mutex<bool>>,
    tray: Arc<Mutex<Option<TrayIcon>>>,
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
    let requested = RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);

    match Camera::new(CameraIndex::Index(index), requested) {
        Ok(mut cam) => match cam.open_stream() {
            Ok(_) => {
                info!("Started camera stream in normal mode (index={})", index);
                *cam_lock = Some(cam);
                true
            }
            Err(e) => {
                error!("Failed to start camera stream in normal mode (index={}): {}", index, e);
                false
            }
        },
        Err(e) => {
            error!("Failed to initialize camera in normal mode (index={}): {}", index, e);
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
async fn analyze_pose_data(
    state: State<'_, AppState>,
    image_data: String,
) -> Result<String, String> {
    match state.pose_analyzer.analyze_image_sync(&image_data) {
        Ok(result_str) => Ok(result_str),
        Err(e) => {
            warn!("Pose analysis failed during calibration: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
async fn initialize_pose_model(
    state: State<'_, AppState>,
    handle: tauri::AppHandle,
) -> Result<(), String> {
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
    *lock_or_recover(&state.monitoring_active) = true;
    *lock_or_recover(&state.force_capture_now) = true;

    if let Some(tray) = lock_or_recover(&state.tray).as_ref() {
        if let Some(default_icon) = app.default_window_icon() {
            if let Err(e) = tray.set_icon(Some(default_icon.clone())) {
                error!("Failed to update tray icon: {}", e);
            }
        } else {
            warn!("Default window icon not found.");
        }
    }
    let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": true }));
    info!("Real-time monitoring started");
    Ok(())
}

fn encode_preview_frame_data_url(image: &ImageBuffer<Rgb<u8>, Vec<u8>>) -> Result<String, String> {
    let mut jpeg_bytes: Vec<u8> = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, 70);

    encoder
        .encode(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ColorType::Rgb8.into(),
        )
        .map_err(|e| format!("프리뷰 프레임 JPEG 인코딩 실패: {}", e))?;

    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg_bytes)))
}

#[tauri::command]
async fn stop_monitoring(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    *lock_or_recover(&state.monitoring_active) = false;
    *lock_or_recover(&state.force_capture_now) = false;
    stop_and_release_camera(&state, "stop_monitoring command");

    if let Some(tray) = lock_or_recover(&state.tray).as_ref() {
        if let Ok(monitoring_off_icon_path) = app.path().resolve("icons/monitoring_off.png", BaseDirectory::Resource) {
            if let Ok(bytes) = fs::read(&monitoring_off_icon_path) {
                if let Ok(monitoring_off_icon) = Image::from_bytes(&bytes) {
                    if let Err(e) = tray.set_icon(Some(monitoring_off_icon)) {
                error!("Failed to update tray icon: {}", e);
                    }
                } else {
                    error!("Failed to create icon image");
                }
            } else {
                error!("Failed to read icon file");
            }
        } else {
            error!("Failed to resolve icon path");
        }
    }
    let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": false }));
    info!("Real-time monitoring stopped");
    Ok(())
}

#[tauri::command]
async fn calibrate_user_posture(
    state: State<'_, AppState>,
    handle: tauri::AppHandle,
    image_data: String,
) -> Result<(), String> {
    info!("Starting user posture calibration");
    state
        .pose_analyzer
        .set_baseline_posture(&image_data, &handle)
        .map_err(|e| {
            error!("User posture calibration failed: {}", e);
            e.to_string()
        })
}

#[tauri::command]
fn get_pose_recommendations() -> Result<Vec<String>, String> {
    Ok(vec![
        "목을 곧게 펴고 어깨를 뒤로 당기세요".to_string(),
        "모니터를 눈높이에 맞춰 조정하세요".to_string(),
        "30분마다 스트레칭을 해주세요".to_string(),
        "의자에 등을 완전히 기대고 앉으세요".to_string(),
        "발은 바닥에 평평하게 놓으세요".to_string(),
    ])
}

#[tauri::command]
fn get_alert_messages(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut alert_messages = lock_or_recover(&state.alert_messages);
    let messages = alert_messages.clone();
    alert_messages.clear();
    Ok(messages)
}

#[tauri::command]
fn get_monitoring_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let monitoring_active = *lock_or_recover(&state.monitoring_active);
    Ok(serde_json::json!({ "active": monitoring_active }))
}

#[tauri::command]
fn request_preview_frame(state: State<'_, AppState>) -> Result<(), String> {
    if *lock_or_recover(&state.monitoring_active) {
        *lock_or_recover(&state.force_capture_now) = true;
        info!("Received immediate preview frame request");
    }
    Ok(())
}

#[tauri::command]
fn test_model_status(state: State<'_, AppState>) -> Result<String, String> {
    state
        .pose_analyzer
        .test_analysis()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_calibrated_image(
    handle: tauri::AppHandle,
    image_data: String,
) -> Result<String, String> {
    let base64_str = image_data
        .split(',')
        .nth(1)
        .ok_or_else(|| "잘못된 Base64 데이터 형식입니다.".to_string())?;
    let decoded_image = STANDARD
        .decode(base64_str)
        .map_err(|e| format!("Base64 디코딩 실패: {}", e))?;
    let app_data_path = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 디렉토리를 찾을 수 없습니다: {}", e))?;
    let image_dir = app_data_path.join("calibration_images");
    fs::create_dir_all(&image_dir).map_err(|e| format!("이미지 저장 디렉토리 생성 실패: {}", e))?;
    let file_path = image_dir.join("calibrated_pose.jpeg");
    let mut file = fs::File::create(&file_path).map_err(|e| format!("파일 생성 실패: {:?}", e))?;
    file.write_all(&decoded_image)
        .map_err(|e| format!("파일 쓰기 실패: {:?}", e))?;
    info!("Calibration image overwritten: {:?}", file_path);
    Ok(file_path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn get_available_cameras() -> Result<Vec<CameraDetail>, String> {
    match nokhwa::query(ApiBackend::Auto) {
        Ok(cameras) => {
            info!("Detected {} available cameras", cameras.len());
            let camera_details = cameras
                .into_iter()
                .map(|cam: CameraInfo| CameraDetail {
                    index: cam.index().as_index().unwrap_or(0) as u32,
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
                    "카메라 목록 조회 실패: {}. Linux에서는 다른 앱의 카메라 점유 또는 런타임 포털/샌드박스 권한 문제일 수 있습니다.",
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
    info!("Monitoring interval updated: {} seconds", interval_secs_final);
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
        return Err("실행 파일 경로를 찾을 수 없습니다.".to_string());
    }
    Ok(())
}

// --- Background Tasks ---

async fn background_alert_task(app_handle: AppHandle, state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(3));
    loop {
        interval.tick().await;
        let messages_to_send = {
            let mut alert_messages = lock_or_recover(&state.alert_messages);
            if !alert_messages.is_empty() {
                let message = alert_messages.drain(..).collect::<Vec<_>>().join("\n");
                Some(message)
            } else {
                None
            }
        };

        if let Some(message) = messages_to_send {
            if message.is_empty() {
                continue;
            }

            info!("System notification triggered: {}", &message);

            let builder = app_handle.notification().builder();
            let result = builder
                .title("🐢")
                .body(&message)
                .icon("icons/icon.png".to_string())
                .show();

            if let Err(e) = result {
                error!("Failed to send system notification: {}", e);
            }
        }
    }
}

async fn background_monitoring_task(app_handle: AppHandle, state: AppState) {
    let mut last_analysis_time = Instant::now() - Duration::from_secs(3);

    loop {
        sleep(Duration::from_secs(1)).await;

        if !*lock_or_recover(&state.monitoring_active) {
            continue;
        }

        let interval_duration = {
            let secs = *lock_or_recover(&state.monitoring_interval_secs);
            Duration::from_secs(secs.max(1))
        };

        let force_capture = {
            let mut force_capture_now = lock_or_recover(&state.force_capture_now);
            let should_capture = *force_capture_now;
            if should_capture {
                *force_capture_now = false;
            }
            should_capture
        };

        if !force_capture && last_analysis_time.elapsed() < interval_duration {
            continue;
        }

        if force_capture {
            info!("Executing forced immediate capture");
        }

        last_analysis_time = Instant::now();

        let battery_saving = *lock_or_recover(&state.battery_saving_mode);
        let selected_index = *lock_or_recover(&state.selected_camera_index);
        let buffer_option = if battery_saving {
            stop_and_release_camera(&state, "pre-capture cleanup for battery-saving mode");
            info!("Battery-saving mode: attempting camera capture, index {}", selected_index);
            let requested_types = [
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

                        info!("Battery-saving mode: camera stream opened ({:?})", requested_type);
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
                            error!("Failed to close camera stream ({:?}): {}", requested_type, e);
                        } else {
                            info!("Battery-saving mode: camera stream closed ({:?})", requested_type);
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
            info!("Battery-saving mode: starting image decode");
            if let Ok(decoded_image) = buffer.decode_image::<RgbFormat>() {
                info!("Battery-saving mode: image decode succeeded");
                if let Some(rgb_image) = ImageBuffer::<Rgb<u8>, _>::from_raw(
                    decoded_image.width(),
                    decoded_image.height(),
                    decoded_image.into_raw(),
                ) {
                    match encode_preview_frame_data_url(&rgb_image) {
                        Ok(preview_frame_data_url) => {
                            if let Err(e) = app_handle.emit("camera-preview-frame", &preview_frame_data_url) {
                                error!("Failed to emit preview frame event: {}", e);
                            }
                        }
                        Err(e) => {
                            error!("Failed to generate preview frame: {}", e);
                        }
                    }

                    if let Ok(result_str) = state.pose_analyzer.analyze_image_buffer(&rgb_image) {
                        info!("Battery-saving mode: pose analysis succeeded");
                        if let Ok(result_json) = serde_json::from_str::<Value>(&result_str) {
                            let _ = app_handle.emit("analysis-update", &result_json);
                            let score = result_json
                                .get("posture_score")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0);
                            let is_turtle = result_json
                                .get("turtle_neck")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let is_shoulder = result_json
                                .get("shoulder_misalignment")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            info!("Battery-saving mode: turtle_neck={}, shoulder_misalignment={}", is_turtle, is_shoulder);
                            let timestamp = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .map(|duration| duration.as_secs() as i64)
                                .unwrap_or_else(|error| {
                                    warn!("Failed to convert system time (before UNIX_EPOCH): {}", error);
                                    0
                                });

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

                            if is_turtle || is_shoulder {
                                let mut last_alert = lock_or_recover(&state.last_alert_time);
                                if last_alert.elapsed() >= Duration::from_secs(10) {
                                    let lang = lock_or_recover(&state.current_language).clone();
                                    let translations = &state.translations;

                                    let message_key = if is_turtle && is_shoulder {
                                        "alert_both"
                                    } else if is_turtle {
                                        "alert_turtle"
                                    } else {
                                        "alert_shoulder"
                                    };

                                    info!("Resolving translation: lang='{}', key='{}'", lang, message_key);
                                    let message = translations.get(&lang, message_key);
                                    info!("Resolved translation: '{}'", message);

                                    lock_or_recover(&state.alert_messages).push(message);
                                    *last_alert = Instant::now();
            state.pose_analyzer.clear_recent_results();
                                }
                            }
                        }
                    }
                }
            }
        }
    }
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
        .plugin(tauri_plugin_log::Builder::new().targets([Target::new(TargetKind::Stdout), Target::new(TargetKind::Webview)]).level(LevelFilter::Info).build())
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
            let quit = PredefinedMenuItem::quit(app, Some("Quit Pose Nudge"))?;
            let show = MenuItem::with_id(app, "show", "Show App", true, None::<&str>)?;
            let start_monitoring_item = MenuItem::with_id(app, "start_monitoring", "Start Monitoring", true, None::<&str>)?;
            let stop_monitoring_item = MenuItem::with_id(app, "stop_monitoring", "Stop Monitoring", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&start_monitoring_item, &stop_monitoring_item, &PredefinedMenuItem::separator(app)?, &show, &quit])?;

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::ManagerExt;

                let autostart_manager = app.autolaunch();
                let _ = autostart_manager.enable();
                info!("registered for autostart? {}", autostart_manager.is_enabled().unwrap_or(false));
            }

            let translations = Arc::new(Translations::new(&app.path()));

            let app_state = AppState {
                pose_analyzer: Arc::new(PoseAnalyzer::new()),
                monitoring_active: Arc::new(Mutex::new(true)),
                force_capture_now: Arc::new(Mutex::new(false)),
                last_alert_time: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60))),
                alert_messages: Arc::new(Mutex::new(Vec::new())),
                camera: Arc::new(Mutex::new(None)),
                selected_camera_index: Arc::new(Mutex::new(0)),
                monitoring_interval_secs: Arc::new(Mutex::new(3)),
                translations: translations,
                current_language: Arc::new(Mutex::new("en".to_string())),
                battery_saving_mode: Arc::new(Mutex::new(false)),
                tray: Arc::new(Mutex::new(None)),
            };
            app.manage(app_state.clone());

            let alert_app_handle = app.handle().clone();
            let alert_state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                background_alert_task(alert_app_handle, alert_state).await;
            });

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

            let default_icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "기본 창 아이콘을 찾을 수 없습니다."))?;

            let tray = TrayIconBuilder::new()
                .icon(default_icon)
                .tooltip("Pose Nudge")
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
                            *lock_or_recover(&state.monitoring_active) = true;
                            *lock_or_recover(&state.force_capture_now) = true;
                            if let Some(tray) = lock_or_recover(&state.tray).as_ref() {
                                if let Some(default_icon) = app.default_window_icon() {
                                    if let Err(e) = tray.set_icon(Some(default_icon.clone())) {
                                        error!("Failed to update tray icon: {}", e);
                                    }
                                } else {
                                    warn!("Default window icon not found; skipping tray icon update.");
                                }
                            }
                            let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": true }));
                        }
                        "stop_monitoring" => {
                            info!("'Stop Monitoring' clicked");
                            *lock_or_recover(&state.monitoring_active) = false;
                            *lock_or_recover(&state.force_capture_now) = false;
                            stop_and_release_camera(&state, "tray stop_monitoring action");
                            if let Some(tray) = lock_or_recover(&state.tray).as_ref() {
                                if let Ok(monitoring_off_icon_path) = app.path().resolve("icons/monitoring_off.png", BaseDirectory::Resource) {
                                    if let Ok(bytes) = fs::read(&monitoring_off_icon_path) {
                                        if let Ok(monitoring_off_icon) = Image::from_bytes(&bytes) {
                                            if let Err(e) = tray.set_icon(Some(monitoring_off_icon)) {
                                                error!("Failed to update tray icon: {}", e);
                                            }
                                        } else {
                                            error!("Failed to create icon image");
                                        }
                                    } else {
                                        error!("Failed to read icon file");
                                    }
                                } else {
                                    error!("Failed to resolve icon path");
                                }
                            }
                            let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": false }));
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            *lock_or_recover(&app_state.tray) = Some(tray);
            info!("Pose Nudge application initialized");
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
            analyze_pose_data,
            get_pose_recommendations,
            get_alert_messages,
            get_monitoring_status,
            request_preview_frame,
            test_model_status,
            calibrate_user_posture,
            save_calibrated_image,
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
