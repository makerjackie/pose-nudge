use anyhow::{anyhow, Result};
use base64::{engine::general_purpose, Engine as _};
use image::{ImageBuffer, Rgb};
use log::info;
use ort::{
    session::{
        builder::{GraphOptimizationLevel, SessionBuilder},
        Session, SessionOutputs,
    },
    value::Value,
};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::sync::Arc;
use tauri::{path::BaseDirectory, AppHandle, Manager};

#[derive(Debug, Clone)]
pub struct KeyPoint {
    pub x: f32,
    pub y: f32,
    pub confidence: f32,
}

#[derive(Debug, Clone)]
pub struct PoseKeypoints {
    pub nose: KeyPoint,
    pub left_eye: KeyPoint,
    pub right_eye: KeyPoint,
    pub left_ear: KeyPoint,
    pub right_ear: KeyPoint,
    pub left_shoulder: KeyPoint,
    pub right_shoulder: KeyPoint,
}

pub struct PoseAnalyzer {
    session: Arc<Mutex<Option<Session>>>,
    confidence_threshold: f32,
    recent_turtle_neck_results: Mutex<VecDeque<bool>>,
    recent_shoulder_results: Mutex<VecDeque<bool>>,
    temporal_window_size: usize,
    baseline_face_shoulder_ratio: Mutex<Option<f32>>,
    baseline_shoulder_alignment: Mutex<Option<f32>>,
    baseline_head_forward_ratio: Mutex<Option<f32>>,

    temporal_threshold_count: Mutex<usize>,
    turtle_neck_thresholds: Mutex<(f32, f32)>,
    shoulder_alignment_thresholds: Mutex<(f32, f32)>,
}

impl PoseAnalyzer {
    pub fn new() -> Self {
        const WINDOW_SIZE: usize = 3;
        const DEFAULT_THRESHOLD_COUNT: usize = 2;
        const DEFAULT_TURTLE_THRESHOLDS: (f32, f32) = (0.030, 0.020);
        const DEFAULT_SHOULDER_THRESHOLDS: (f32, f32) = (0.9, 0.18);

        Self {
            session: Arc::new(Mutex::new(None)),
            confidence_threshold: 0.5,
            recent_turtle_neck_results: Mutex::new(VecDeque::with_capacity(WINDOW_SIZE)),
            recent_shoulder_results: Mutex::new(VecDeque::with_capacity(WINDOW_SIZE)),
            temporal_window_size: WINDOW_SIZE,
            baseline_face_shoulder_ratio: Mutex::new(None),
            baseline_shoulder_alignment: Mutex::new(None),
            baseline_head_forward_ratio: Mutex::new(None),

            temporal_threshold_count: Mutex::new(DEFAULT_THRESHOLD_COUNT),
            turtle_neck_thresholds: Mutex::new(DEFAULT_TURTLE_THRESHOLDS),
            shoulder_alignment_thresholds: Mutex::new(DEFAULT_SHOULDER_THRESHOLDS),
        }
    }

    pub fn set_notification_frequency(&self, level: u8) {
        let count = match level {
            1 => 1,
            3 => 3,
            _ => 2,
        };
        *self.temporal_threshold_count.lock() = count;
        info!("Notification frequency updated: {} out of 3 detections", count);
    }

    pub fn set_turtle_neck_sensitivity(&self, level: u8) {
        let thresholds = match level {
            1 => (0.040, 0.030),
            3 => (0.020, 0.015),
            _ => (0.030, 0.020),
        };
        *self.turtle_neck_thresholds.lock() = thresholds;
        info!("Turtle-neck sensitivity updated: level {}", level);
    }

    pub fn set_shoulder_sensitivity(&self, level: u8) {
        let thresholds = match level {
            1 => (1.2, 0.22),
            3 => (0.7, 0.15),
            _ => (0.9, 0.18),
        };
        *self.shoulder_alignment_thresholds.lock() = thresholds;
        info!("Shoulder alignment sensitivity updated: level {}", level);
    }

    pub fn clear_recent_results(&self) {
        self.recent_turtle_neck_results.lock().clear();
        self.recent_shoulder_results.lock().clear();
    }

    pub async fn initialize_model(&self, handle: AppHandle) -> Result<()> {
        info!("Initializing YOLO-pose model...");
        let model_path = self.download_verified_yolo_model(handle).await?;
        let session = SessionBuilder::new()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .commit_from_file(model_path)?;
        *self.session.lock() = Some(session);
        info!("YOLO-pose model initialization complete");
        Ok(())
    }

    async fn download_verified_yolo_model(&self, handle: AppHandle) -> Result<std::path::PathBuf> {
        let model_path = handle
            .path()
            .resolve("../models/yolo11n-pose.onnx", BaseDirectory::Resource)
            .map_err(|e| anyhow!("모델 리소스 경로를 확인하지 못했습니다: {}", e))?;

        if !model_path.exists() {
            return Err(anyhow!(
                "yolo11n-pose.onnx 모델 파일을 찾을 수 없습니다. 경로: {:?}",
                model_path
            ));
        }
        info!("Loaded YOLO11n-pose model: {:?}", model_path);
        Ok(model_path)
    }

    pub fn is_model_initialized(&self) -> bool {
        self.session.lock().is_some()
    }

    pub fn test_analysis(&self) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        if self.is_model_initialized() {
            Ok(r#"{"status": "verified_yolo_model_loaded", "test": "success"}"#.to_string())
        } else {
            Ok(r#"{"status": "verified_yolo_model_not_loaded", "test": "success"}"#.to_string())
        }
    }

    pub fn analyze_image_buffer(
        &self,
        image_buffer: &ImageBuffer<Rgb<u8>, Vec<u8>>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        info!("analyze_image_buffer started, image size: {}x{}", image_buffer.width(), image_buffer.height());
        if !self.is_model_initialized() {
            info!("Model is not initialized");
            return Ok(serde_json::json!({
                "status": "model_not_initialized",
                "recommendations": ["AI 모델을 먼저 초기화해주세요"],
            })
            .to_string());
        }

        let keypoints = self.extract_pose_keypoints(image_buffer)?;

        let current_turtle_neck = self.detect_turtle_neck(&keypoints);
        let current_shoulder_misalignment = self.detect_shoulder_misalignment(&keypoints);
        let realtime_posture_score =
            self.calculate_posture_score(current_turtle_neck, current_shoulder_misalignment);

        let threshold_count = *self.temporal_threshold_count.lock();

        let final_turtle_neck = {
            let mut history = self.recent_turtle_neck_results.lock();
            if history.len() >= self.temporal_window_size {
                history.pop_front();
            }
            history.push_back(current_turtle_neck);
            history.iter().filter(|&&detected| detected).count() >= threshold_count
        };

        let final_shoulder_misalignment = {
            let mut history = self.recent_shoulder_results.lock();
            if history.len() >= self.temporal_window_size {
                history.pop_front();
            }
            history.push_back(current_shoulder_misalignment);
            history.iter().filter(|&&detected| detected).count() >= threshold_count
        };

        let recommendations =
            self.generate_recommendations(final_turtle_neck, final_shoulder_misalignment);
        let avg_confidence = self.calculate_average_confidence(&keypoints);

        let result = serde_json::json!({
            "turtle_neck": final_turtle_neck,
            "shoulder_misalignment": final_shoulder_misalignment,
            "posture_score": realtime_posture_score,
            "recommendations": recommendations,
            "confidence": avg_confidence,
            "status": "yolo_analysis_success"
        });

        Ok(result.to_string())
    }

    pub fn analyze_image_sync(
        &self,
        base64_data: &str,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let image_data = self.decode_base64_image(base64_data)?;
        self.analyze_image_buffer(&image_data)
    }

    fn decode_base64_image(
        &self,
        base64_data: &str,
    ) -> Result<ImageBuffer<Rgb<u8>, Vec<u8>>, Box<dyn std::error::Error + Send + Sync>> {
        let base64_clean = if base64_data.starts_with("data:") {
            base64_data.split(',').nth(1).unwrap_or(base64_data)
        } else {
            base64_data
        };
        let decoded = general_purpose::STANDARD.decode(base64_clean)?;
        let img = image::load_from_memory(&decoded)?;
        Ok(img.to_rgb8())
    }

    fn extract_pose_keypoints(
        &self,
        image: &ImageBuffer<Rgb<u8>, Vec<u8>>,
    ) -> Result<PoseKeypoints, Box<dyn std::error::Error + Send + Sync>> {
        info!("Starting keypoint extraction");
        let input_tensor = self.preprocess_image(image)?;
        let mut session_guard = self.session.lock();
        let session = session_guard
            .as_mut()
            .ok_or("YOLO-pose 모델이 초기화되지 않았습니다")?;
        let outputs = session.run(ort::inputs!["images" => input_tensor])?;
        info!("Model inference succeeded");
        self.postprocess_output(&outputs, image.width(), image.height())
    }

    fn preprocess_image(
        &self,
        image: &ImageBuffer<Rgb<u8>, Vec<u8>>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        info!("Starting image preprocessing");
        let resized_image =
            image::imageops::resize(image, 640, 640, image::imageops::FilterType::Triangle);
        let mut input_data = Vec::with_capacity(3 * 640 * 640);
        for channel in 0..3 {
            for pixel in resized_image.pixels() {
                input_data.push(pixel.0[channel] as f32 / 255.0);
            }
        }
        Ok(Value::from_array(([1_usize, 3, 640, 640], input_data))?.into())
    }

    fn postprocess_output(
        &self,
        outputs: &SessionOutputs,
        orig_width: u32,
        orig_height: u32,
    ) -> Result<PoseKeypoints, Box<dyn std::error::Error + Send + Sync>> {
        info!("Starting output postprocessing");
        let output = outputs
            .get("output0")
            .ok_or("모델 출력을 찾을 수 없습니다")?;
        let (shape, data) = output.try_extract_tensor::<f32>()?;
        info!("Model output shape: {:?}", shape);
        if shape.len() != 3 || shape[1] != 56 {
            return Err("예상하지 못한 모델 출력 형식입니다".into());
        }
        let detections = shape[2] as usize;
        info!("Detection count: {}", detections);
        let mut best_detection = None;
        let mut best_confidence = 0.0f32;
        for i in 0..detections {
            let confidence_idx = 4 * detections + i;
            let confidence = data[confidence_idx];
            //info!("detection {} confidence: {}", i, confidence);
            if confidence > best_confidence && confidence > self.confidence_threshold {
                best_confidence = confidence;
                best_detection = Some(i);
            }
        }
        let detection_idx =
            best_detection.ok_or("신뢰할 수 있는 pose detection을 찾을 수 없습니다")?;
        info!("Selected best detection: {}", detection_idx);
        let scale_x = orig_width as f32 / 640.0;
        let scale_y = orig_height as f32 / 640.0;
        let keypoints = PoseKeypoints {
            nose: self.extract_keypoint_from_data(data, shape, detection_idx, 0, scale_x, scale_y),
            left_eye: self.extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                1,
                scale_x,
                scale_y,
            ),
            right_eye: self.extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                2,
                scale_x,
                scale_y,
            ),
            left_ear: self.extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                3,
                scale_x,
                scale_y,
            ),
            right_ear: self.extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                4,
                scale_x,
                scale_y,
            ),
            left_shoulder: self.extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                5,
                scale_x,
                scale_y,
            ),
            right_shoulder: self.extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                6,
                scale_x,
                scale_y,
            ),
        };
        Ok(keypoints)
    }

    fn extract_keypoint_from_data(
        &self,
        data: &[f32],
        shape: &ort::tensor::Shape,
        detection_idx: usize,
        keypoint_idx: usize,
        scale_x: f32,
        scale_y: f32,
    ) -> KeyPoint {
        let detections = shape[2] as usize;
        let base_feature_idx = 5 + keypoint_idx * 3;
        let x_idx = base_feature_idx * detections + detection_idx;
        let y_idx = (base_feature_idx + 1) * detections + detection_idx;
        let conf_idx = (base_feature_idx + 2) * detections + detection_idx;
        let x = data.get(x_idx).unwrap_or(&0.0) * scale_x;
        let y = data.get(y_idx).unwrap_or(&0.0) * scale_y;
        let confidence = *data.get(conf_idx).unwrap_or(&0.0);
        KeyPoint { x, y, confidence }
    }

    fn calculate_average_confidence(&self, keypoints: &PoseKeypoints) -> f32 {
        let confidences = vec![
            keypoints.nose.confidence,
            keypoints.left_shoulder.confidence,
            keypoints.right_shoulder.confidence,
            keypoints.left_ear.confidence,
            keypoints.right_ear.confidence,
        ];
        let valid_confidences: Vec<f32> = confidences.into_iter().filter(|&c| c > 0.0).collect();
        if valid_confidences.is_empty() {
            0.0
        } else {
            valid_confidences.iter().sum::<f32>() / valid_confidences.len() as f32
        }
    }

    fn detect_turtle_neck(&self, keypoints: &PoseKeypoints) -> bool {
        let (ratio_tolerance, forward_tolerance) = *self.turtle_neck_thresholds.lock();

        let is_face_too_close = {
            if let Some(baseline_ratio) = *self.baseline_face_shoulder_ratio.lock() {
                if let Some(current_ratio) = self.calculate_face_shoulder_ratio(keypoints) {
                    current_ratio > baseline_ratio + ratio_tolerance
                } else {
                    false
                }
            } else {
                false
            }
        };

        let is_head_forward = {
            if let Some(baseline_forward) = *self.baseline_head_forward_ratio.lock() {
                if let Some(current_forward) = self.calculate_head_forward_ratio(keypoints) {
                    current_forward > baseline_forward + forward_tolerance
                } else {
                    false
                }
            } else {
                if let Some(current_forward) = self.calculate_head_forward_ratio(keypoints) {
                    current_forward > 0.08
                } else {
                    false
                }
            }
        };
        is_face_too_close || is_head_forward
    }

    fn detect_shoulder_misalignment(&self, keypoints: &PoseKeypoints) -> bool {
        if keypoints.left_shoulder.confidence < 0.5
            || keypoints.right_shoulder.confidence < 0.5
            || keypoints.nose.confidence < 0.5
        {
            return false;
        }

        let shoulder_height_diff = (keypoints.left_shoulder.y - keypoints.right_shoulder.y).abs();
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width < 1.0 {
            return false;
        }
        let avg_shoulder_y = (keypoints.left_shoulder.y + keypoints.right_shoulder.y) / 2.0;
        let face_height_proxy = (avg_shoulder_y - keypoints.nose.y).abs();
        if face_height_proxy < 1.0 {
            return false;
        }
        let corrected_ratio = shoulder_height_diff / face_height_proxy;

        let (tolerance, min_absolute_threshold) = *self.shoulder_alignment_thresholds.lock();

        if let Some(baseline_corrected_ratio) = *self.baseline_shoulder_alignment.lock() {
            let is_worse_than_baseline = corrected_ratio > baseline_corrected_ratio + tolerance;
            let is_objectively_bad = corrected_ratio > min_absolute_threshold;
            is_worse_than_baseline && is_objectively_bad
        } else {
            let original_ratio = shoulder_height_diff / shoulder_width;
            original_ratio > 0.1 && corrected_ratio > 0.15
        }
    }

    fn calculate_posture_score(
        &self,
        turtle_neck_detected: bool,
        shoulder_misalignment_detected: bool,
    ) -> u8 {
        let mut score = 100u8;
        if turtle_neck_detected {
            score = score.saturating_sub(30);
        }
        if shoulder_misalignment_detected {
            score = score.saturating_sub(20);
        }
        score
    }

    fn calculate_face_shoulder_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.left_eye.confidence < 0.5
            || keypoints.right_eye.confidence < 0.5
            || keypoints.left_shoulder.confidence < 0.5
            || keypoints.right_shoulder.confidence < 0.5
        {
            return None;
        }
        let face_width = (keypoints.right_eye.x - keypoints.left_eye.x).abs();
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width > 1.0 {
            Some(face_width / shoulder_width)
        } else {
            None
        }
    }

    pub fn set_baseline_posture(
        &self,
        base64_data: &str,
        handle: &AppHandle,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let image_data = self.decode_base64_image(base64_data)?;
        let keypoints = self.extract_pose_keypoints(&image_data)?;

        if let Some(ratio) = self.calculate_face_shoulder_ratio(&keypoints) {
            *self.baseline_face_shoulder_ratio.lock() = Some(ratio);
        }
        if let Some(shoulder_alignment) = self.calculate_shoulder_alignment_ratio(&keypoints) {
            *self.baseline_shoulder_alignment.lock() = Some(shoulder_alignment);
        }
        if let Some(forward_ratio) = self.calculate_head_forward_ratio(&keypoints) {
            *self.baseline_head_forward_ratio.lock() = Some(forward_ratio);
        }

        if self.baseline_face_shoulder_ratio.lock().is_some()
            || self.baseline_shoulder_alignment.lock().is_some()
            || self.baseline_head_forward_ratio.lock().is_some()
        {
            self.save_baseline_to_file(handle)?;
            Ok(())
        } else {
            Err("기준 자세를 설정하기 위한 키포인트를 감지하지 못했습니다.".into())
        }
    }

    fn save_baseline_to_file(&self, handle: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let app_data_path = handle.path().app_data_dir().map_err(|e| format!("앱 데이터 디렉토리를 찾을 수 없습니다: {}", e))?;
        let baseline_file = app_data_path.join("baseline.json");

        let baseline_data = serde_json::json!({
            "face_shoulder_ratio": *self.baseline_face_shoulder_ratio.lock(),
            "shoulder_alignment": *self.baseline_shoulder_alignment.lock(),
            "head_forward_ratio": *self.baseline_head_forward_ratio.lock()
        });

        let json_str = serde_json::to_string_pretty(&baseline_data)?;
        std::fs::write(&baseline_file, json_str)?;
        info!("Baseline saved: {:?}", baseline_file);
        Ok(())
    }

    pub fn load_baseline_from_file(&self, handle: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let app_data_path = handle.path().app_data_dir().map_err(|e| format!("앱 데이터 디렉토리를 찾을 수 없습니다: {}", e))?;
        let baseline_file = app_data_path.join("baseline.json");

        if baseline_file.exists() {
            let json_str = std::fs::read_to_string(&baseline_file)?;
            let baseline_data: serde_json::Value = serde_json::from_str(&json_str)?;

            if let Some(ratio) = baseline_data.get("face_shoulder_ratio").and_then(|v| v.as_f64()) {
                *self.baseline_face_shoulder_ratio.lock() = Some(ratio as f32);
            }
            if let Some(alignment) = baseline_data.get("shoulder_alignment").and_then(|v| v.as_f64()) {
                *self.baseline_shoulder_alignment.lock() = Some(alignment as f32);
            }
            if let Some(forward) = baseline_data.get("head_forward_ratio").and_then(|v| v.as_f64()) {
                *self.baseline_head_forward_ratio.lock() = Some(forward as f32);
            }
            info!("Baseline loaded: {:?}", baseline_file);
        } else {
            info!("Baseline file does not exist: {:?}", baseline_file);
        }
        Ok(())
    }

    fn calculate_shoulder_alignment_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.left_shoulder.confidence < 0.5
            || keypoints.right_shoulder.confidence < 0.5
            || keypoints.nose.confidence < 0.5
        {
            return None;
        }
        let shoulder_height_diff = (keypoints.left_shoulder.y - keypoints.right_shoulder.y).abs();
        let avg_shoulder_y = (keypoints.left_shoulder.y + keypoints.right_shoulder.y) / 2.0;
        let face_height_proxy = (avg_shoulder_y - keypoints.nose.y).abs();
        if face_height_proxy > 1.0 {
            Some(shoulder_height_diff / face_height_proxy)
        } else {
            None
        }
    }

    fn calculate_head_forward_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.left_ear.confidence < 0.5
            || keypoints.right_ear.confidence < 0.5
            || keypoints.left_shoulder.confidence < 0.5
            || keypoints.right_shoulder.confidence < 0.5
        {
            return None;
        }
        let ear_center_x = (keypoints.left_ear.x + keypoints.right_ear.x) / 2.0;
        let shoulder_center_x = (keypoints.left_shoulder.x + keypoints.right_shoulder.x) / 2.0;
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width > 1.0 {
            Some((ear_center_x - shoulder_center_x).abs() / shoulder_width)
        } else {
            None
        }
    }

    fn generate_recommendations(
        &self,
        turtle_neck: bool,
        shoulder_misalignment: bool,
    ) -> Vec<String> {
        let mut recommendations = Vec::new();
        if turtle_neck {
            recommendations.push("tip1".to_string());
            recommendations.push("tip2".to_string());
        }
        if shoulder_misalignment {
            recommendations.push("tip4".to_string());
            recommendations.push("tip5".to_string());
        }
        if recommendations.is_empty() {
            recommendations.push("motivation.excellent".to_string());
        }
        recommendations
    }
}
