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
use std::sync::{Arc, Mutex};
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
  State, // ✨ 제네릭을 위해 Runtime 트레이트 import
};
use tauri_plugin_notification::NotificationExt;
use tokio::time::sleep;

use image::{codecs::jpeg::JpegEncoder, ImageBuffer, Rgb};
use nokhwa::{
    pixel_format::RgbFormat,
    utils::{ApiBackend, CameraIndex, CameraInfo, RequestedFormat, RequestedFormatType},
    // Buffer, // ✨ 수정: 사용하지 않는 import 제거
    Camera,
};

use sqlx;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_sql::{DbInstances, Migration, MigrationKind};

mod pose_analysis;
use pose_analysis::PoseAnalyzer;

// --- 번역 관리 구조체 ---
pub struct Translations {
    data: HashMap<String, HashMap<String, String>>,
}

impl Translations {
    // ✨ 수정: 함수를 제네릭으로 만들어 어떤 Runtime에서도 동작하게 함
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

                        info!("'{}' 언어 번역 파일 로드 성공.", lang);
                    } else {
                        error!("'{}' 언어 번역 파일 파싱 실패: {:?}", lang, resource_path);
                    }
                } else {
                    error!("'{}' 언어 번역 파일 읽기 실패: {:?}", lang, resource_path);
                }
            } else {
                error!("'{}' 언어 리소스 경로를 찾을 수 없습니다.", lang);
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
    let mut cam_lock = state.camera.lock().unwrap();

    if let Some(cam) = cam_lock.as_mut() {
        if cam.is_stream_open() {
            return true;
        }

        match cam.open_stream() {
            Ok(_) => {
                info!("기존 카메라 스트림 재시작 성공");
                return true;
            }
            Err(e) => {
                error!("기존 카메라 스트림 재시작 실패: {}", e);
                *cam_lock = None;
            }
        }
    }

    let index = *state.selected_camera_index.lock().unwrap();
    let requested = RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);

    match Camera::new(CameraIndex::Index(index), requested) {
        Ok(mut cam) => match cam.open_stream() {
            Ok(_) => {
                info!("일반 모드용 카메라 스트림 시작 성공 (index={})", index);
                *cam_lock = Some(cam);
                true
            }
            Err(e) => {
                error!("일반 모드용 카메라 스트림 시작 실패 (index={}): {}", index, e);
                false
            }
        },
        Err(e) => {
            error!("일반 모드용 카메라 초기화 실패 (index={}): {}", index, e);
            false
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
            warn!("자세 분석 실패 (캘리브레이션): {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
async fn initialize_pose_model(
    state: State<'_, AppState>,
    handle: tauri::AppHandle,
) -> Result<(), String> {
    info!("Pose 모델 초기화 시작");
    state
        .pose_analyzer
        .initialize_model(handle)
        .await
        .map_err(|e| {
            error!("Pose 모델 초기화 실패: {}", e);
            e.to_string()
        })
}

#[tauri::command]
async fn start_monitoring(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    *state.monitoring_active.lock().unwrap() = true;
    *state.force_capture_now.lock().unwrap() = true;

    if let Some(tray) = state.tray.lock().unwrap().as_ref() {
        if let Some(default_icon) = app.default_window_icon() {
            if let Err(e) = tray.set_icon(Some(default_icon.clone())) {
                error!("아이콘 변경 실패: {}", e);
            }
        } else {
            warn!("기본 창 아이콘을 찾을 수 없습니다.");
        }
    }
    let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": true }));
    info!("실시간 모니터링 시작");
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
    *state.monitoring_active.lock().unwrap() = false;
    *state.force_capture_now.lock().unwrap() = false;
    if let Some(tray) = state.tray.lock().unwrap().as_ref() {
        if let Ok(monitoring_off_icon_path) = app.path().resolve("icons/monitoring_off.png", BaseDirectory::Resource) {
            if let Ok(bytes) = fs::read(&monitoring_off_icon_path) {
                if let Ok(monitoring_off_icon) = Image::from_bytes(&bytes) {
                    if let Err(e) = tray.set_icon(Some(monitoring_off_icon)) {
                        error!("아이콘 변경 실패: {}", e);
                    }
                } else {
                    error!("아이콘 생성 실패");
                }
            } else {
                error!("아이콘 파일 읽기 실패");
            }
        } else {
            error!("아이콘 경로 해결 실패");
        }
    }
    let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": false }));
    info!("실시간 모니터링 중지");
    Ok(())
}

#[tauri::command]
async fn calibrate_user_posture(
    state: State<'_, AppState>,
    handle: tauri::AppHandle,
    image_data: String,
) -> Result<(), String> {
    info!("사용자 자세 캘리브레이션 시작");
    state
        .pose_analyzer
        .set_baseline_posture(&image_data, &handle)
        .map_err(|e| {
            error!("자세 캘리브레이션 실패: {}", e);
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
    let mut alert_messages = state.alert_messages.lock().unwrap();
    let messages = alert_messages.clone();
    alert_messages.clear();
    Ok(messages)
}

#[tauri::command]
fn get_monitoring_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let monitoring_active = *state.monitoring_active.lock().unwrap();
    Ok(serde_json::json!({ "active": monitoring_active }))
}

#[tauri::command]
fn request_preview_frame(state: State<'_, AppState>) -> Result<(), String> {
    if *state.monitoring_active.lock().unwrap() {
        *state.force_capture_now.lock().unwrap() = true;
        info!("즉시 프리뷰 프레임 요청 수신");
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
    info!("캘리브레이션 이미지 덮어쓰기 완료: {:?}", file_path);
    Ok(file_path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn get_available_cameras() -> Result<Vec<CameraDetail>, String> {
    match nokhwa::query(ApiBackend::Auto) {
        Ok(cameras) => {
            info!("사용 가능한 카메라 {}개 발견", cameras.len());
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
            error!("카메라 목록 조회 실패: {}", e);
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
    info!("선택된 카메라 변경: index {}", index);
    let mut current_cam_lock = state.camera.lock().unwrap();

    if *state.monitoring_active.lock().unwrap() && current_cam_lock.is_some() {
        info!("모니터링 중 카메라 변경 시도...");
        if let Some(mut cam) = current_cam_lock.take() {
            if cam.is_stream_open() {
                let _ = cam.stop_stream();
            }
        }

        let requested =
            RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
        match Camera::new(CameraIndex::Index(index), requested) {
            Ok(mut new_cam) => {
                info!("새 카메라 초기화 성공: {}", new_cam.info().human_name());
                if let Err(e) = new_cam.open_stream() {
                    error!("새 카메라 스트림 시작 실패: {}", e);
                } else {
                    info!("새 카메라 스트림 시작됨.");
                    *current_cam_lock = Some(new_cam);
                }
            }
            Err(e) => {
                error!("인덱스 {}번 새 카메라 초기화 실패: {}", index, e);
            }
        }
    }

    *state.selected_camera_index.lock().unwrap() = index;

    if *state.monitoring_active.lock().unwrap() {
        *state.force_capture_now.lock().unwrap() = true;
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
    info!("모니터링 주기 변경: {}초", interval_secs_final);
    *state.monitoring_interval_secs.lock().unwrap() = interval_secs_final;
    Ok(())
}

#[tauri::command]
async fn set_battery_saving_mode(state: State<'_, AppState>, mode: bool) -> Result<(), String> {
    *state.battery_saving_mode.lock().unwrap() = mode;
    *state.force_capture_now.lock().unwrap() = true;
    info!("배터리 절약 모드 설정: {}", mode);

    if mode {
        // 절약 모드: 기존 카메라 닫기
        if let Some(mut cam) = state.camera.lock().unwrap().take() {
            if cam.is_stream_open() {
                if let Err(e) = cam.stop_stream() {
                    error!("절약 모드 전환 시 카메라 스트림 닫기 실패: {}", e);
                } else {
                    info!("절약 모드 전환 시 카메라 스트림 닫음.");
                }
            }
        }
    } else {
        // 일반 모드: 모니터링 중이면 카메라 열기
        if *state.monitoring_active.lock().unwrap() {
            if !ensure_continuous_camera_stream(&state) {
                warn!("일반 모드 전환 시 카메라 준비 실패. 다음 주기에서 재시도합니다.");
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn set_current_language(state: State<'_, AppState>, lang: String) -> Result<(), String> {
    let normalized = normalize_language_code(&lang);
    info!("현재 언어 변경: {} -> {}", lang, normalized);
    *state.current_language.lock().unwrap() = normalized;
    Ok(())
}

#[tauri::command]
async fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    info!("앱 재시작 요청");
    // 현재 실행 파일 경로 가져오기
    if let Ok(exe_path) = std::env::current_exe() {
        let exe_dir = exe_path.parent().unwrap_or(&exe_path);
        // 새 프로세스로 앱 재시작
        let _ = std::process::Command::new(&exe_path)
            .current_dir(exe_dir)
            .spawn();

        // 현재 앱 종료
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
            let mut alert_messages = state.alert_messages.lock().unwrap();
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

            info!("시스템 알림 발생: {}", &message);

            // ✨ 이것이 Tauri v2의 표준적인 알림 호출 방식입니다.
            let builder = app_handle.notification().builder();
            let result = builder
                .title("🐢")
                .body(&message)
                .icon("icons/icon.png".to_string())
                .show();

            if let Err(e) = result {
                error!("시스템 알림을 보내는 데 실패했습니다: {}", e);
            }
        }
    }
}

async fn background_monitoring_task(app_handle: AppHandle, state: AppState) {
    let mut last_analysis_time = Instant::now() - Duration::from_secs(3);

    loop {
        sleep(Duration::from_secs(1)).await;

        if !*state.monitoring_active.lock().unwrap() {
            continue;
        }

        let interval_duration = {
            let secs = *state.monitoring_interval_secs.lock().unwrap();
            Duration::from_secs(secs.max(1))
        };

        let force_capture = {
            let mut force_capture_now = state.force_capture_now.lock().unwrap();
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
            info!("강제 즉시 캡처 실행");
        }

        last_analysis_time = Instant::now();

        let battery_saving = *state.battery_saving_mode.lock().unwrap();
        let selected_index = *state.selected_camera_index.lock().unwrap();
        let buffer_option = if battery_saving {
            info!("절약 모드: 카메라 캡처 시도, 인덱스 {}", selected_index);
            // 절약 모드: 모니터링할 때만 카메라를 켜고 끄되,
            // Windows(MF) 자원 부족 오류를 줄이기 위해 저 FPS 형식을 우선 시도한다.
            let requested_types = [
                RequestedFormatType::HighestFrameRate(15),
                RequestedFormatType::HighestFrameRate(10),
                RequestedFormatType::AbsoluteHighestFrameRate,
                RequestedFormatType::None,
            ];

            let mut captured_buffer = None;

            for requested_type in requested_types {
                let requested = RequestedFormat::new::<RgbFormat>(requested_type);
                info!("절약 모드: 포맷 시도 {:?}", requested_type);

                match Camera::new(CameraIndex::Index(selected_index), requested) {
                    Ok(mut cam) => {
                        if let Err(e) = cam.open_stream() {
                            error!("카메라 스트림 열기 실패 ({:?}): {}", requested_type, e);
                            continue;
                        }

                        info!("절약 모드: 카메라 스트림 열림 ({:?})", requested_type);
                        tokio::time::sleep(Duration::from_millis(700)).await;

                        let mut frame_captured = None;
                        for attempt in 1..=3 {
                            match cam.frame() {
                                Ok(buffer) => {
                                    if attempt > 1 {
                                        info!("절약 모드: {}회 재시도 후 캡처 성공", attempt - 1);
                                    } else {
                                        info!("절약 모드: 카메라 캡처 성공");
                                    }
                                    frame_captured = Some(buffer);
                                    break;
                                }
                                Err(e) => {
                                    warn!(
                                        "절약 모드: 프레임 캡처 실패 ({:?}, attempt={}): {}",
                                        requested_type,
                                        attempt,
                                        e
                                    );
                                    tokio::time::sleep(Duration::from_millis(250)).await;
                                }
                            }
                        }

                        if let Err(e) = cam.stop_stream() {
                            error!("카메라 스트림 닫기 실패 ({:?}): {}", requested_type, e);
                        } else {
                            info!("절약 모드: 카메라 스트림 닫음 ({:?})", requested_type);
                        }

                        if frame_captured.is_some() {
                            captured_buffer = frame_captured;
                            break;
                        }
                    }
                    Err(e) => {
                        error!("카메라 초기화 실패 ({:?}): {}", requested_type, e);
                    }
                }
            }

            if captured_buffer.is_none() {
                error!("절약 모드: 사용 가능한 포맷에서 카메라 캡처에 모두 실패");
            }

            captured_buffer
        } else {
            // 일반 모드: 기존 로직
            if !ensure_continuous_camera_stream(&state) {
                warn!("일반 모드 카메라 준비 실패. 다음 주기에서 재시도합니다.");
                continue;
            }

            let mut cam_lock = state.camera.lock().unwrap();
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
            info!("절약 모드: 이미지 디코딩 시작");
            if let Ok(decoded_image) = buffer.decode_image::<RgbFormat>() {
                info!("절약 모드: 이미지 디코딩 성공");
                if let Some(rgb_image) = ImageBuffer::<Rgb<u8>, _>::from_raw(
                    decoded_image.width(),
                    decoded_image.height(),
                    decoded_image.into_raw(),
                ) {
                    match encode_preview_frame_data_url(&rgb_image) {
                        Ok(preview_frame_data_url) => {
                            if let Err(e) = app_handle.emit("camera-preview-frame", &preview_frame_data_url) {
                                error!("프리뷰 프레임 이벤트 전송 실패: {}", e);
                            }
                        }
                        Err(e) => {
                            error!("프리뷰 프레임 생성 실패: {}", e);
                        }
                    }

                    if let Ok(result_str) = state.pose_analyzer.analyze_image_buffer(&rgb_image) {
                        info!("절약 모드: 자세 분석 성공");
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
                            info!("절약 모드: 거북목 {}, 어깨 {}", is_turtle, is_shoulder);
                            let timestamp = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap()
                                .as_secs() as i64;

                            let instances = app_handle.state::<DbInstances>();
                            let db_map = instances.0.read().await;

                            // ✨ 수정: 중첩된 if let을 하나로 합쳐서 경고 제거
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
                                    error!("데이터베이스 저장 실패: {}", e);
                                }
                            }

                            if is_turtle || is_shoulder {
                                let mut last_alert = state.last_alert_time.lock().unwrap();
                                if last_alert.elapsed() >= Duration::from_secs(10) {
                                    let lang = state.current_language.lock().unwrap().clone();
                                    let translations = &state.translations;

                                    let message_key = if is_turtle && is_shoulder {
                                        "alert_both"
                                    } else if is_turtle {
                                        "alert_turtle"
                                    } else {
                                        "alert_shoulder"
                                    };

                                    info!("번역 시도: lang='{}', key='{}'", lang, message_key);
                                    let message = translations.get(&lang, message_key);
                                    info!("번역 결과: '{}'", message);

                                    state.alert_messages.lock().unwrap().push(message);
                                    *last_alert = Instant::now();
                                    // 최근 결과 초기화
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
    tauri::Builder::default()
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
            // 데스크탑에서 autostart(자동 시작) 등록 시도
            #[cfg(desktop)]
            {
                // ManagerExt 트레잇을 로컬 스코프에서 가져와 app.autolaunch()를 사용합니다.
                use tauri_plugin_autostart::ManagerExt;

                // 일부 환경에서는 플러그인이 이미 빌더 단계에서 등록되어 있으므로
                // autolaunch 매니저를 통해 활성화 상태를 설정합니다.
                let autostart_manager = app.autolaunch();
                // enable() 호출을 시도하고 상태를 로깅
                let _ = autostart_manager.enable();
                info!("registered for autostart? {}", autostart_manager.is_enabled().unwrap_or(false));
            }

            // ✨ 수정: app.path()가 PathResolver를 반환하므로 .resolver() 없이 바로 참조를 넘겨줍니다.
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

            // 모델 초기화
            let init_app_handle = app.handle().clone();
            let init_state = app_state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = init_state.pose_analyzer.initialize_model(init_app_handle.clone()).await {
                    error!("모델 초기화 실패: {}", e);
                } else {
                    if let Err(e) = init_state.pose_analyzer.load_baseline_from_file(&init_app_handle) {
                        error!("베이스라인 로드 실패: {}", e);
                    }
                }
            });

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
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
                            info!("'Start Monitoring' 클릭됨");
                            *state.monitoring_active.lock().unwrap() = true;
                            *state.force_capture_now.lock().unwrap() = true;

                            let battery_saving = *state.battery_saving_mode.lock().unwrap();
                            if !battery_saving {
                                let mut cam_lock = state.camera.lock().unwrap();
                                if let Some(cam) = cam_lock.as_mut() {
                                    if !cam.is_stream_open() {
                                        if let Err(e) = cam.open_stream() {
                                            error!("기존 웹캠 스트림 시작 실패: {}", e);
                                        } else {
                                            info!("기존 웹캠 스트림 시작됨.");
                                        }
                                    }
                                } else {
                                    let index = *state.selected_camera_index.lock().unwrap();
                                    info!("선택된 인덱스 {}번 카메라로 초기화 시도", index);
                                    let requested = RequestedFormat::new::<RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
                                    match Camera::new(CameraIndex::Index(index), requested) {
                                        Ok(mut cam) => {
                                            info!("웹캠 초기화 성공: {}", cam.info().human_name());
                                            if let Err(e) = cam.open_stream() {
                                                error!("새 웹캠 스트림 시작 실패: {}", e);
                                            } else {
                                                info!("새 웹캠 스트림 시작됨.");
                                                *cam_lock = Some(cam);
                                            }
                                        }
                                        Err(e) => {
                                            error!("인덱스 {}번 웹캠 초기화 실패: {}", index, e);
                                        }
                                    }
                                }
                            }
                            if let Some(tray) = state.tray.lock().unwrap().as_ref() {
                                if let Err(e) = tray.set_icon(Some(app.default_window_icon().unwrap().clone())) {
                                    error!("아이콘 변경 실패: {}", e);
                                }
                            }
                            let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": true }));
                        }
                        "stop_monitoring" => {
                            info!("'Stop Monitoring' 클릭됨");
                            *state.monitoring_active.lock().unwrap() = false;
                            *state.force_capture_now.lock().unwrap() = false;
                            if let Some(cam) = &mut *state.camera.lock().unwrap() {
                                if cam.is_stream_open() {
                                    if let Err(e) = cam.stop_stream() {
                                        error!("웹캠 스트림 중지 실패: {}", e);
                                    } else {
                                        info!("웹캠 스트림 중지됨.");
                                    }
                                }
                            }
                            if let Some(tray) = state.tray.lock().unwrap().as_ref() {
                                if let Ok(monitoring_off_icon_path) = app.path().resolve("icons/monitoring_off.png", BaseDirectory::Resource) {
                                    if let Ok(bytes) = fs::read(&monitoring_off_icon_path) {
                                        if let Ok(monitoring_off_icon) = Image::from_bytes(&bytes) {
                                            if let Err(e) = tray.set_icon(Some(monitoring_off_icon)) {
                                                error!("아이콘 변경 실패: {}", e);
                                            }
                                        } else {
                                            error!("아이콘 생성 실패");
                                        }
                                    } else {
                                        error!("아이콘 파일 읽기 실패");
                                    }
                                } else {
                                    error!("아이콘 경로 해결 실패");
                                }
                            }
                            let _ = app.emit("monitoring-state-changed", &serde_json::json!({ "active": false }));
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            *app_state.tray.lock().unwrap() = Some(tray);
            info!("Pose Nudge 애플리케이션 초기화 완료");
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Destroyed => {
                let camera_to_stop = {
                    let state = window.state::<AppState>();
                    let mut guard = state.camera.lock().unwrap();
                    guard.take()
                };
                if let Some(mut cam) = camera_to_stop {
                    if cam.is_stream_open() {
                        if let Err(e) = cam.stop_stream() {
                             error!("웹캠 스트림 종료 실패: {}", e);
                        } else {
                            info!("웹캠 스트림을 안전하게 종료했습니다.");
                        }
                    }
                }
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
