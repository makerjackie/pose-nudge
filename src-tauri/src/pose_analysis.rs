use anyhow::{anyhow, Result};
use base64::{engine::general_purpose, Engine as _};
use image::{ImageBuffer, Rgb};
use log::{debug, info, warn};
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

const MODEL_SIZE: u32 = 640;

#[derive(Debug, Clone, Copy)]
struct LetterboxTransform {
    scale: f32,
    pad_x: f32,
    pad_y: f32,
}

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

#[derive(Debug, Clone, Copy, PartialEq)]
struct PostureMetrics {
    /// 1.0 is the configured threshold; values below it are still useful for a continuous score.
    head_deviation: f32,
    /// 1.0 is the configured threshold; values below it are still useful for a continuous score.
    shoulder_deviation: f32,
    baseline_ready: bool,
}

pub struct PoseAnalyzer {
    session: Arc<Mutex<Option<Session>>>,
    confidence_threshold: f32,
    recent_turtle_neck_results: Mutex<VecDeque<bool>>,
    recent_shoulder_results: Mutex<VecDeque<bool>>,
    recent_posture_scores: Mutex<VecDeque<f32>>,
    temporal_window_size: usize,
    baseline_face_shoulder_ratio: Mutex<Option<f32>>,
    baseline_shoulder_alignment: Mutex<Option<f32>>,
    baseline_head_forward_ratio: Mutex<Option<f32>>,
    baseline_head_height_ratio: Mutex<Option<f32>>,

    temporal_threshold_count: Mutex<usize>,
    turtle_neck_thresholds: Mutex<(f32, f32)>,
    shoulder_alignment_thresholds: Mutex<(f32, f32)>,
}

impl PoseAnalyzer {
    pub fn new() -> Self {
        const WINDOW_SIZE: usize = 5;
        const DEFAULT_THRESHOLD_COUNT: usize = 3;
        const DEFAULT_TURTLE_THRESHOLDS: (f32, f32) = (0.12, 0.08);
        const DEFAULT_SHOULDER_THRESHOLDS: (f32, f32) = (0.06, 0.12);

        Self {
            session: Arc::new(Mutex::new(None)),
            // Upper-body desktop framing often produces a lower object score than a
            // full-body scene. Core keypoint confidence is checked separately below.
            confidence_threshold: 0.18,
            recent_turtle_neck_results: Mutex::new(VecDeque::with_capacity(WINDOW_SIZE)),
            recent_shoulder_results: Mutex::new(VecDeque::with_capacity(WINDOW_SIZE)),
            recent_posture_scores: Mutex::new(VecDeque::with_capacity(WINDOW_SIZE)),
            temporal_window_size: WINDOW_SIZE,
            baseline_face_shoulder_ratio: Mutex::new(None),
            baseline_shoulder_alignment: Mutex::new(None),
            baseline_head_forward_ratio: Mutex::new(None),
            baseline_head_height_ratio: Mutex::new(None),

            temporal_threshold_count: Mutex::new(DEFAULT_THRESHOLD_COUNT),
            turtle_neck_thresholds: Mutex::new(DEFAULT_TURTLE_THRESHOLDS),
            shoulder_alignment_thresholds: Mutex::new(DEFAULT_SHOULDER_THRESHOLDS),
        }
    }

    pub fn set_notification_frequency(&self, level: u8) {
        let count = match level {
            1 => 2,
            3 => 4,
            _ => 3,
        };
        *self.temporal_threshold_count.lock() = count;
        info!("Detection stability updated: {} out of 5 detections", count);
    }

    pub fn set_turtle_neck_sensitivity(&self, level: u8) {
        let thresholds = match level {
            1 => (0.18, 0.12),
            3 => (0.08, 0.06),
            _ => (0.12, 0.08),
        };
        *self.turtle_neck_thresholds.lock() = thresholds;
        info!("Turtle-neck sensitivity updated: level {}", level);
    }

    pub fn set_shoulder_sensitivity(&self, level: u8) {
        let thresholds = match level {
            1 => (0.09, 0.16),
            3 => (0.04, 0.10),
            _ => (0.06, 0.12),
        };
        *self.shoulder_alignment_thresholds.lock() = thresholds;
        info!("Shoulder alignment sensitivity updated: level {}", level);
    }

    pub fn clear_recent_results(&self) {
        self.recent_turtle_neck_results.lock().clear();
        self.recent_shoulder_results.lock().clear();
        self.recent_posture_scores.lock().clear();
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
            .map_err(|e| anyhow!("Failed to resolve the model resource path: {}", e))?;

        if !model_path.exists() {
            return Err(anyhow!(
                "The yolo11n-pose.onnx model file is missing at {:?}",
                model_path
            ));
        }
        info!("Loaded YOLO11n-pose model: {:?}", model_path);
        Ok(model_path)
    }

    pub fn is_model_initialized(&self) -> bool {
        self.session.lock().is_some()
    }

    pub fn analyze_image_buffer(
        &self,
        image_buffer: &ImageBuffer<Rgb<u8>, Vec<u8>>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        debug!(
            "analyze_image_buffer started, image size: {}x{}",
            image_buffer.width(),
            image_buffer.height()
        );
        if !self.is_model_initialized() {
            info!("Model is not initialized");
            return Ok(serde_json::json!({
                "status": "model_not_initialized",
                "recommendations": [],
            })
            .to_string());
        }

        let keypoints = match self.extract_pose_keypoints(image_buffer) {
            Ok(keypoints) => keypoints,
            Err(error) => {
                warn!("No reliable pose landmarks in current frame: {}", error);
                self.clear_recent_results();
                return Ok(serde_json::json!({
                    "turtle_neck": false,
                    "shoulder_misalignment": false,
                    "posture_score": null,
                    "recommendations": [],
                    "confidence": 0.0,
                    "reliable": false,
                    "baseline_ready": self.has_baseline(),
                    "detection_mode": "uncertain",
                    "status": "pose_not_found"
                })
                .to_string());
            }
        };

        let avg_confidence = self.calculate_average_confidence(&keypoints);
        let reliable = avg_confidence >= 0.48
            && keypoints.nose.confidence >= 0.35
            && keypoints.left_shoulder.confidence >= 0.35
            && keypoints.right_shoulder.confidence >= 0.35;
        if !reliable {
            self.clear_recent_results();
            return Ok(serde_json::json!({
                "turtle_neck": false,
                "shoulder_misalignment": false,
                "posture_score": null,
                "recommendations": [],
                "confidence": avg_confidence,
                "reliable": false,
                "detection_mode": "uncertain",
                "status": "low_confidence"
            })
            .to_string());
        }

        let metrics = self.calculate_posture_metrics(&keypoints);
        debug!(
            "Pose landmarks: nose=({:.1},{:.1},{:.2}), eyes=({:.1},{:.1},{:.2})/({:.1},{:.1},{:.2}), ears=({:.1},{:.1},{:.2})/({:.1},{:.1},{:.2}), shoulders=({:.1},{:.1},{:.2})/({:.1},{:.1},{:.2}); mode={}, head_deviation={:.2}, shoulder_deviation={:.2}",
            keypoints.nose.x,
            keypoints.nose.y,
            keypoints.nose.confidence,
            keypoints.left_eye.x,
            keypoints.left_eye.y,
            keypoints.left_eye.confidence,
            keypoints.right_eye.x,
            keypoints.right_eye.y,
            keypoints.right_eye.confidence,
            keypoints.left_ear.x,
            keypoints.left_ear.y,
            keypoints.left_ear.confidence,
            keypoints.right_ear.x,
            keypoints.right_ear.y,
            keypoints.right_ear.confidence,
            keypoints.left_shoulder.x,
            keypoints.left_shoulder.y,
            keypoints.left_shoulder.confidence,
            keypoints.right_shoulder.x,
            keypoints.right_shoulder.y,
            keypoints.right_shoulder.confidence,
            if self.is_side_view(&keypoints) { "side" } else { "front" },
            metrics.head_deviation,
            metrics.shoulder_deviation,
        );
        let current_turtle_neck = metrics.head_deviation >= 1.0;
        let current_shoulder_misalignment = metrics.shoulder_deviation >= 1.0;

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
        let stable_posture_score = metrics.baseline_ready.then(|| {
            let frame_score = Self::calculate_posture_score(metrics);
            let mut history = self.recent_posture_scores.lock();
            if history.len() >= self.temporal_window_size {
                history.pop_front();
            }
            history.push_back(frame_score);
            (history.iter().sum::<f32>() / history.len() as f32)
                .round()
                .clamp(0.0, 100.0) as u8
        });
        let detection_mode = if self.is_side_view(&keypoints) {
            "side_head_forward"
        } else {
            "front_head_distance"
        };

        let result = serde_json::json!({
            "turtle_neck": current_turtle_neck,
            "shoulder_misalignment": current_shoulder_misalignment,
            "stable_turtle_neck": final_turtle_neck,
            "stable_shoulder_misalignment": final_shoulder_misalignment,
            "posture_score": stable_posture_score,
            "recommendations": recommendations,
            "confidence": avg_confidence,
            "reliable": true,
            "baseline_ready": metrics.baseline_ready,
            "head_deviation": metrics.head_deviation,
            "shoulder_deviation": metrics.shoulder_deviation,
            "detection_mode": detection_mode,
            "status": "yolo_analysis_success"
        });

        Ok(result.to_string())
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
        let (input_tensor, transform) = self.preprocess_image(image)?;
        let mut session_guard = self.session.lock();
        let session = session_guard
            .as_mut()
            .ok_or("The YOLO pose model is not initialized")?;
        let outputs = session.run(ort::inputs!["images" => input_tensor])?;
        info!("Model inference succeeded");
        self.postprocess_output(&outputs, image.width(), image.height(), transform)
    }

    fn preprocess_image(
        &self,
        image: &ImageBuffer<Rgb<u8>, Vec<u8>>,
    ) -> Result<(Value, LetterboxTransform), Box<dyn std::error::Error + Send + Sync>> {
        info!("Starting image preprocessing");
        let scale = (MODEL_SIZE as f32 / image.width() as f32)
            .min(MODEL_SIZE as f32 / image.height() as f32);
        let resized_width = (image.width() as f32 * scale).round() as u32;
        let resized_height = (image.height() as f32 * scale).round() as u32;
        let pad_x = (MODEL_SIZE - resized_width) / 2;
        let pad_y = (MODEL_SIZE - resized_height) / 2;
        let resized_image = image::imageops::resize(
            image,
            resized_width,
            resized_height,
            image::imageops::FilterType::Triangle,
        );
        let mut letterboxed = ImageBuffer::from_pixel(MODEL_SIZE, MODEL_SIZE, Rgb([114, 114, 114]));
        image::imageops::overlay(&mut letterboxed, &resized_image, pad_x.into(), pad_y.into());

        let mut input_data = Vec::with_capacity(3 * MODEL_SIZE as usize * MODEL_SIZE as usize);
        for channel in 0..3 {
            for pixel in letterboxed.pixels() {
                input_data.push(pixel.0[channel] as f32 / 255.0);
            }
        }
        let value = Value::from_array((
            [1_usize, 3, MODEL_SIZE as usize, MODEL_SIZE as usize],
            input_data,
        ))?
        .into();
        Ok((
            value,
            LetterboxTransform {
                scale,
                pad_x: pad_x as f32,
                pad_y: pad_y as f32,
            },
        ))
    }

    fn postprocess_output(
        &self,
        outputs: &SessionOutputs,
        orig_width: u32,
        orig_height: u32,
        transform: LetterboxTransform,
    ) -> Result<PoseKeypoints, Box<dyn std::error::Error + Send + Sync>> {
        info!("Starting output postprocessing");
        let output = outputs
            .get("output0")
            .ok_or("The pose model output is missing")?;
        let (shape, data) = output.try_extract_tensor::<f32>()?;
        info!("Model output shape: {:?}", shape);
        if shape.len() != 3 || shape[1] != 56 {
            return Err("The pose model returned an unexpected output shape".into());
        }
        let detections = shape[2] as usize;
        info!("Detection count: {}", detections);
        let mut best_detection = None;
        let mut best_quality = 0.0f32;
        for i in 0..detections {
            let confidence_idx = 4 * detections + i;
            let confidence = data[confidence_idx];
            if confidence <= self.confidence_threshold {
                continue;
            }

            let keypoint_confidence = |keypoint_idx: usize| {
                let feature_idx = 5 + keypoint_idx * 3 + 2;
                data[feature_idx * detections + i]
            };
            let core_quality =
                (keypoint_confidence(0) + keypoint_confidence(5) + keypoint_confidence(6)) / 3.0;
            let quality = confidence * 0.45 + core_quality * 0.55;
            if quality > best_quality {
                best_quality = quality;
                best_detection = Some(i);
            }
        }
        let detection_idx = best_detection.ok_or("No reliable pose detection was found")?;
        info!(
            "Selected best detection: {}, combined quality: {:.2}",
            detection_idx, best_quality
        );
        let keypoints = PoseKeypoints {
            nose: Self::extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                0,
                transform,
                orig_width,
                orig_height,
            ),
            left_eye: Self::extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                1,
                transform,
                orig_width,
                orig_height,
            ),
            right_eye: Self::extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                2,
                transform,
                orig_width,
                orig_height,
            ),
            left_ear: Self::extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                3,
                transform,
                orig_width,
                orig_height,
            ),
            right_ear: Self::extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                4,
                transform,
                orig_width,
                orig_height,
            ),
            left_shoulder: Self::extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                5,
                transform,
                orig_width,
                orig_height,
            ),
            right_shoulder: Self::extract_keypoint_from_data(
                data,
                shape,
                detection_idx,
                6,
                transform,
                orig_width,
                orig_height,
            ),
        };
        Ok(keypoints)
    }

    fn extract_keypoint_from_data(
        data: &[f32],
        shape: &ort::tensor::Shape,
        detection_idx: usize,
        keypoint_idx: usize,
        transform: LetterboxTransform,
        orig_width: u32,
        orig_height: u32,
    ) -> KeyPoint {
        let detections = shape[2] as usize;
        let base_feature_idx = 5 + keypoint_idx * 3;
        let x_idx = base_feature_idx * detections + detection_idx;
        let y_idx = (base_feature_idx + 1) * detections + detection_idx;
        let conf_idx = (base_feature_idx + 2) * detections + detection_idx;
        let model_x = *data.get(x_idx).unwrap_or(&0.0);
        let model_y = *data.get(y_idx).unwrap_or(&0.0);
        let x = ((model_x - transform.pad_x) / transform.scale).clamp(0.0, orig_width as f32);
        let y = ((model_y - transform.pad_y) / transform.scale).clamp(0.0, orig_height as f32);
        let confidence = *data.get(conf_idx).unwrap_or(&0.0);
        KeyPoint { x, y, confidence }
    }

    fn calculate_average_confidence(&self, keypoints: &PoseKeypoints) -> f32 {
        let shoulder_confidence =
            (keypoints.left_shoulder.confidence + keypoints.right_shoulder.confidence) / 2.0;
        let eye_confidence = keypoints
            .left_eye
            .confidence
            .max(keypoints.right_eye.confidence);
        let ear_confidence = keypoints
            .left_ear
            .confidence
            .max(keypoints.right_ear.confidence);

        (keypoints.nose.confidence * 0.30
            + shoulder_confidence * 0.40
            + eye_confidence * 0.15
            + ear_confidence * 0.15)
            .clamp(0.0, 1.0)
    }

    fn calculate_posture_metrics(&self, keypoints: &PoseKeypoints) -> PostureMetrics {
        let (ratio_tolerance, forward_tolerance) = *self.turtle_neck_thresholds.lock();
        let baseline_face = *self.baseline_face_shoulder_ratio.lock();
        let baseline_forward = *self.baseline_head_forward_ratio.lock();
        let baseline_head_height = *self.baseline_head_height_ratio.lock();
        let baseline_shoulder = *self.baseline_shoulder_alignment.lock();

        // A frontal camera cannot directly see neck depth. Combining apparent face growth
        // with the nose-to-shoulder height change is substantially more stable than using
        // either signal alone. Side views use ear-to-shoulder displacement instead.
        let face_growth = match (baseline_face, self.calculate_face_shoulder_ratio(keypoints)) {
            (Some(baseline), Some(current)) if baseline > f32::EPSILON => {
                ((current / baseline - 1.0) / ratio_tolerance).max(0.0)
            }
            _ => 0.0,
        };

        let head_height_drop = match (
            baseline_head_height,
            self.calculate_head_height_ratio(keypoints),
        ) {
            (Some(baseline), Some(current)) if baseline > f32::EPSILON => {
                ((baseline - current) / baseline / ratio_tolerance).max(0.0)
            }
            // Conservative fallback for users who have not calibrated yet. Typical upright
            // frontal values are around 0.45-0.70; the score only moves once the head is
            // clearly low relative to shoulder width.
            (None, Some(current)) => ((0.38 - current) / 0.12).max(0.0),
            _ => 0.0,
        };

        let side_forward = if self.is_side_view(keypoints) {
            match (
                baseline_forward,
                self.calculate_head_forward_ratio(keypoints),
            ) {
                (Some(baseline), Some(current)) => {
                    ((current - baseline) / forward_tolerance).max(0.0)
                }
                (None, Some(current)) => ((current - 0.08) / forward_tolerance).max(0.0),
                _ => 0.0,
            }
        } else {
            0.0
        };

        let head_deviation = if self.is_side_view(keypoints) {
            side_forward.max(face_growth * 0.7)
        } else {
            head_height_drop.max(face_growth * 0.7)
        };

        let shoulder_deviation = self
            .calculate_shoulder_alignment_ratio(keypoints)
            .map(|current| {
                let (tolerance, absolute_threshold) = *self.shoulder_alignment_thresholds.lock();
                match baseline_shoulder {
                    Some(baseline) => {
                        let relative = ((current - baseline) / tolerance).max(0.0);
                        let objective_gate = (current / absolute_threshold).clamp(0.0, 1.0);
                        relative * objective_gate
                    }
                    // Without calibration, avoid treating small camera tilt or natural
                    // asymmetry as bad posture. Calibration restores the personalized gate.
                    None => ((current - 0.14) / 0.12).max(0.0),
                }
            })
            .unwrap_or(0.0);

        PostureMetrics {
            head_deviation: head_deviation.clamp(0.0, 2.5),
            shoulder_deviation: shoulder_deviation.clamp(0.0, 2.5),
            baseline_ready: baseline_face.is_some()
                || baseline_forward.is_some()
                || baseline_head_height.is_some(),
        }
    }

    fn has_baseline(&self) -> bool {
        self.baseline_face_shoulder_ratio.lock().is_some()
            || self.baseline_head_forward_ratio.lock().is_some()
            || self.baseline_head_height_ratio.lock().is_some()
    }

    fn calculate_posture_score(metrics: PostureMetrics) -> f32 {
        fn penalty(severity: f32, weight: f32, maximum: f32) -> f32 {
            if severity <= 0.15 {
                return 0.0;
            }
            (((severity - 0.15) / 0.85) * weight).clamp(0.0, maximum)
        }

        let head_penalty = penalty(metrics.head_deviation, 32.0, 50.0);
        let shoulder_penalty = penalty(metrics.shoulder_deviation, 22.0, 35.0);
        (100.0 - head_penalty - shoulder_penalty).clamp(15.0, 100.0)
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

    fn calculate_head_height_ratio(&self, keypoints: &PoseKeypoints) -> Option<f32> {
        if keypoints.nose.confidence < 0.5
            || keypoints.left_shoulder.confidence < 0.5
            || keypoints.right_shoulder.confidence < 0.5
        {
            return None;
        }
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width <= 1.0 {
            return None;
        }
        let shoulder_y = (keypoints.left_shoulder.y + keypoints.right_shoulder.y) / 2.0;
        Some((shoulder_y - keypoints.nose.y).abs() / shoulder_width)
    }

    pub fn set_baseline_postures(
        &self,
        samples: &[String],
        handle: &AppHandle,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if samples.is_empty() {
            return Err("CALIBRATION_NO_SAMPLES".into());
        }

        let mut face_ratios = Vec::new();
        let mut shoulder_alignments = Vec::new();
        let mut forward_ratios = Vec::new();
        let mut head_height_ratios = Vec::new();
        let mut valid_frames = 0usize;

        for sample in samples {
            let image_data = self.decode_base64_image(sample)?;
            let keypoints = self.extract_pose_keypoints(&image_data)?;
            let confidence = self.calculate_average_confidence(&keypoints);
            if confidence < 0.55
                || keypoints.nose.confidence < 0.5
                || keypoints.left_shoulder.confidence < 0.5
                || keypoints.right_shoulder.confidence < 0.5
            {
                continue;
            }

            valid_frames += 1;
            if let Some(value) = self.calculate_face_shoulder_ratio(&keypoints) {
                face_ratios.push(value);
            }
            if let Some(value) = self.calculate_shoulder_alignment_ratio(&keypoints) {
                shoulder_alignments.push(value);
            }
            if let Some(value) = self.calculate_head_height_ratio(&keypoints) {
                head_height_ratios.push(value);
            }
            if self.is_side_view(&keypoints) {
                if let Some(value) = self.calculate_head_forward_ratio(&keypoints) {
                    forward_ratios.push(value);
                }
            }
        }

        let required_valid_frames = samples.len().min(3);
        if valid_frames < required_valid_frames {
            return Err(format!(
                "CALIBRATION_INSUFFICIENT_FRAMES:{}:{}",
                valid_frames, required_valid_frames
            )
            .into());
        }

        *self.baseline_face_shoulder_ratio.lock() = median(face_ratios);
        *self.baseline_shoulder_alignment.lock() = median(shoulder_alignments);
        *self.baseline_head_forward_ratio.lock() = median(forward_ratios);
        *self.baseline_head_height_ratio.lock() = median(head_height_ratios);
        self.clear_recent_results();

        if self.baseline_face_shoulder_ratio.lock().is_some()
            || self.baseline_shoulder_alignment.lock().is_some()
            || self.baseline_head_forward_ratio.lock().is_some()
            || self.baseline_head_height_ratio.lock().is_some()
        {
            self.save_baseline_to_file(handle)?;
            Ok(())
        } else {
            Err("CALIBRATION_NO_KEYPOINTS".into())
        }
    }

    fn save_baseline_to_file(
        &self,
        handle: &AppHandle,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let app_data_path = handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve the app data directory: {}", e))?;
        let baseline_file = app_data_path.join("baseline.json");

        let baseline_data = serde_json::json!({
            "face_shoulder_ratio": *self.baseline_face_shoulder_ratio.lock(),
            "shoulder_alignment": *self.baseline_shoulder_alignment.lock(),
            "head_forward_ratio": *self.baseline_head_forward_ratio.lock(),
            "head_height_ratio": *self.baseline_head_height_ratio.lock()
        });

        let json_str = serde_json::to_string_pretty(&baseline_data)?;
        std::fs::write(&baseline_file, json_str)?;
        info!("Baseline saved: {:?}", baseline_file);
        Ok(())
    }

    pub fn load_baseline_from_file(
        &self,
        handle: &AppHandle,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let app_data_path = handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve the app data directory: {}", e))?;
        let baseline_file = app_data_path.join("baseline.json");

        if baseline_file.exists() {
            let json_str = std::fs::read_to_string(&baseline_file)?;
            let baseline_data: serde_json::Value = serde_json::from_str(&json_str)?;

            if let Some(ratio) = baseline_data
                .get("face_shoulder_ratio")
                .and_then(|v| v.as_f64())
            {
                *self.baseline_face_shoulder_ratio.lock() = Some(ratio as f32);
            }
            if let Some(alignment) = baseline_data
                .get("shoulder_alignment")
                .and_then(|v| v.as_f64())
            {
                *self.baseline_shoulder_alignment.lock() = Some(alignment as f32);
            }
            if let Some(forward) = baseline_data
                .get("head_forward_ratio")
                .and_then(|v| v.as_f64())
            {
                *self.baseline_head_forward_ratio.lock() = Some(forward as f32);
            }
            if let Some(head_height) = baseline_data
                .get("head_height_ratio")
                .and_then(|v| v.as_f64())
            {
                *self.baseline_head_height_ratio.lock() = Some(head_height as f32);
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
        if (keypoints.left_ear.confidence < 0.5 && keypoints.right_ear.confidence < 0.5)
            || keypoints.left_shoulder.confidence < 0.5
            || keypoints.right_shoulder.confidence < 0.5
        {
            return None;
        }
        let ear_center_x = match (
            keypoints.left_ear.confidence >= 0.5,
            keypoints.right_ear.confidence >= 0.5,
        ) {
            (true, true) => (keypoints.left_ear.x + keypoints.right_ear.x) / 2.0,
            (true, false) => keypoints.left_ear.x,
            (false, true) => keypoints.right_ear.x,
            (false, false) => return None,
        };
        let shoulder_center_x = (keypoints.left_shoulder.x + keypoints.right_shoulder.x) / 2.0;
        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width > 1.0 {
            Some((ear_center_x - shoulder_center_x).abs() / shoulder_width)
        } else {
            None
        }
    }

    fn is_side_view(&self, keypoints: &PoseKeypoints) -> bool {
        let left_ear_visible = keypoints.left_ear.confidence >= 0.5;
        let right_ear_visible = keypoints.right_ear.confidence >= 0.5;
        let left_eye_visible = keypoints.left_eye.confidence >= 0.5;
        let right_eye_visible = keypoints.right_eye.confidence >= 0.5;

        if left_ear_visible != right_ear_visible {
            // Hair, glasses, or lighting often hide one ear in an otherwise frontal view.
            // Require matching one-sided eye visibility before switching to the side model.
            return left_eye_visible != right_eye_visible;
        }
        if !left_ear_visible || !right_ear_visible {
            return false;
        }

        let shoulder_width = (keypoints.right_shoulder.x - keypoints.left_shoulder.x).abs();
        if shoulder_width <= 1.0 {
            return false;
        }
        let ear_span = (keypoints.right_ear.x - keypoints.left_ear.x).abs();
        ear_span / shoulder_width < 0.28
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

fn median(mut values: Vec<f32>) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    let middle = values.len() / 2;
    if values.len().is_multiple_of(2) {
        Some((values[middle - 1] + values[middle]) / 2.0)
    } else {
        Some(values[middle])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keypoints(nose_y: f32, left_shoulder_y: f32, right_shoulder_y: f32) -> PoseKeypoints {
        let visible = |x, y| KeyPoint {
            x,
            y,
            confidence: 0.95,
        };
        PoseKeypoints {
            nose: visible(320.0, nose_y),
            left_eye: visible(300.0, nose_y - 12.0),
            right_eye: visible(340.0, nose_y - 12.0),
            left_ear: visible(285.0, nose_y),
            right_ear: visible(355.0, nose_y),
            left_shoulder: visible(220.0, left_shoulder_y),
            right_shoulder: visible(420.0, right_shoulder_y),
        }
    }

    #[test]
    fn median_rejects_single_frame_outliers() {
        assert_eq!(median(vec![0.2, 0.21, 1.8, 0.19, 0.22]), Some(0.21));
    }

    #[test]
    fn letterbox_keeps_widescreen_geometry() {
        let analyzer = PoseAnalyzer::new();
        let image = ImageBuffer::from_pixel(1280, 720, Rgb([0, 0, 0]));
        let (_, transform) = analyzer.preprocess_image(&image).expect("letterbox");

        assert!((transform.scale - 0.5).abs() < f32::EPSILON);
        assert_eq!(transform.pad_x, 0.0);
        assert_eq!(transform.pad_y, 140.0);
    }

    #[test]
    fn score_is_continuous_instead_of_binary() {
        let excellent = PoseAnalyzer::calculate_posture_score(PostureMetrics {
            head_deviation: 0.0,
            shoulder_deviation: 0.0,
            baseline_ready: true,
        });
        let mild_drift = PoseAnalyzer::calculate_posture_score(PostureMetrics {
            head_deviation: 0.5,
            shoulder_deviation: 0.25,
            baseline_ready: true,
        });
        let clear_drift = PoseAnalyzer::calculate_posture_score(PostureMetrics {
            head_deviation: 1.0,
            shoulder_deviation: 1.0,
            baseline_ready: true,
        });

        assert_eq!(excellent, 100.0);
        assert!((80.0..95.0).contains(&mild_drift));
        assert_eq!(clear_drift, 46.0);
    }

    #[test]
    fn calibrated_frontal_head_drop_is_detected() {
        let analyzer = PoseAnalyzer::new();
        *analyzer.baseline_face_shoulder_ratio.lock() = Some(0.2);
        *analyzer.baseline_head_height_ratio.lock() = Some(0.5);
        *analyzer.baseline_shoulder_alignment.lock() = Some(0.0);

        let metrics = analyzer.calculate_posture_metrics(&keypoints(140.0, 200.0, 200.0));

        assert!(metrics.baseline_ready);
        assert!(metrics.head_deviation >= 1.0);
        assert!(metrics.shoulder_deviation < 0.15);
    }

    #[test]
    fn shoulder_drift_uses_scale_independent_ratio() {
        let analyzer = PoseAnalyzer::new();
        *analyzer.baseline_head_height_ratio.lock() = Some(0.5);
        *analyzer.baseline_shoulder_alignment.lock() = Some(0.0);

        let metrics = analyzer.calculate_posture_metrics(&keypoints(100.0, 188.0, 212.0));

        assert!(metrics.shoulder_deviation >= 1.0);
    }

    #[test]
    fn one_hidden_ear_does_not_turn_a_frontal_face_sideways() {
        let analyzer = PoseAnalyzer::new();
        let mut frontal = keypoints(100.0, 200.0, 200.0);
        frontal.right_ear.confidence = 0.2;

        assert!(!analyzer.is_side_view(&frontal));

        frontal.right_eye.confidence = 0.2;
        assert!(analyzer.is_side_view(&frontal));
    }

    #[test]
    fn one_occluded_face_side_keeps_a_reliable_core_signal() {
        let analyzer = PoseAnalyzer::new();
        let mut partially_occluded = keypoints(100.0, 200.0, 200.0);
        partially_occluded.right_eye.confidence = 0.05;
        partially_occluded.right_ear.confidence = 0.05;

        assert!(analyzer.calculate_average_confidence(&partially_occluded) >= 0.8);
    }
}
