import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import Webcam from 'react-webcam';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import { load, Store } from '@tauri-apps/plugin-store';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { loadReminderPreferences } from '@/lib/reminders';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Camera,
  CameraOff,
  Activity,
  CheckCircle,
  XCircle,
  PlayCircle,
  StopCircle,
  Lightbulb,
  Cpu,
} from 'lucide-react';

interface PostureAnalysis {
  turtle_neck: boolean;
  shoulder_misalignment: boolean;
  posture_score: number | null;
  recommendations: string[];
  confidence?: number;
  reliable?: boolean;
}

interface MonitoringStatus {
  active: boolean;
}

const CAMERA_INDEX_KEY = 'pose_nudge_camera_index';
const CAMERA_NAME_KEY = 'pose_nudge_camera_name';
const LEGACY_CAMERA_DEVICE_KEY = 'pose_nudge_camera';

const normalizeCameraName = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

const isValidPreviewFramePayload = (payload: string): boolean =>
  payload.startsWith('data:image/') && payload.includes('base64,') && payload.length > 'data:image/jpeg;base64,'.length;

const WebcamCapture = () => {
  const { t } = useTranslation();
  const [store, setStore] = useState<Store | null>(null);
  
  const webcamRef = useRef<Webcam>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isWebcamReady, setIsWebcamReady] = useState(false);
  const [isModelInitialized, setIsModelInitialized] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PostureAnalysis | null>(null);
  const [error, setError] = useState<string>('');
  const [initializationProgress, setInitializationProgress] = useState<string>('');
  const [calibrationStatus, setCalibrationStatus] = useState<'idle' | 'calibrating' | 'success' | 'error'>('idle');
  const [calibratedImage, setCalibratedImage] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const [currentPlatform, setCurrentPlatform] = useState<string>('unknown');
  const [backendPreviewFrame, setBackendPreviewFrame] = useState<string | null>(null);
  const [useBackendPreview, setUseBackendPreview] = useState(false);
  const shouldUseBackendPreview = useBackendPreview || (
    isMonitoring
    && currentPlatform === 'windows'
  );

  const videoConstraints = useMemo(
    () => ({
      facingMode: 'user',
      deviceId: selectedDeviceId,
    }),
    [selectedDeviceId]
  );

  useEffect(() => {
    let cancelled = false;

    const resolveSelectedDeviceId = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        if (!cancelled) {
          setSelectedDeviceId(undefined);
        }
        return;
      }

      try {
        const savedIndexRaw = localStorage.getItem(CAMERA_INDEX_KEY);
        const savedCameraName = localStorage.getItem(CAMERA_NAME_KEY);
        const legacyDeviceId = localStorage.getItem(LEGACY_CAMERA_DEVICE_KEY);
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((device) => device.kind === 'videoinput');

        let nextDeviceId: string | undefined;

        if (savedCameraName) {
          const normalizedTarget = normalizeCameraName(savedCameraName);
          const matchedByName = normalizedTarget.length > 0
            ? videoInputs.find((device) => {
                const normalizedLabel = normalizeCameraName(device.label);
                return normalizedLabel.length > 0
                  && (normalizedLabel.includes(normalizedTarget) || normalizedTarget.includes(normalizedLabel));
              })
            : undefined;

          if (matchedByName) {
            nextDeviceId = matchedByName.deviceId;
          }
        }

        if (!nextDeviceId && legacyDeviceId && videoInputs.some((device) => device.deviceId === legacyDeviceId)) {
          nextDeviceId = legacyDeviceId;
        }

        if (savedIndexRaw !== null) {
          const parsedIndex = Number.parseInt(savedIndexRaw, 10);
          if (!nextDeviceId && !Number.isNaN(parsedIndex) && parsedIndex >= 0 && parsedIndex < videoInputs.length) {
            nextDeviceId = videoInputs[parsedIndex].deviceId;
          }
        }

        if (!nextDeviceId && videoInputs.length > 0) {
          nextDeviceId = videoInputs[0].deviceId;
        }

        if (cancelled) {
          return;
        }

        setSelectedDeviceId(nextDeviceId);
        if (nextDeviceId) {
          localStorage.setItem(LEGACY_CAMERA_DEVICE_KEY, nextDeviceId);
        }
      } catch (deviceError) {
        if (!cancelled) {
          setSelectedDeviceId(undefined);
        }
        console.error('Failed to enumerate camera devices:', deviceError);
      }
    };

    void resolveSelectedDeviceId();

    const handleDeviceChange = () => {
      void resolveSelectedDeviceId();
    };

    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);

    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
    };
  }, []);

  const initializeModel = useCallback(async () => {
    if (isModelInitialized) return;
    try {
      setInitializationProgress(t('webcam.initModel', 'AI 모델 초기화 중...'));
      await invoke('initialize_pose_model');
      setIsModelInitialized(true);
      setInitializationProgress('');
    } catch (err) {
      console.error(err);
      setError(t('webcam.initModelError', 'AI 모델 초기화에 실패했습니다.'));
      setInitializationProgress('');
    }
  }, [isModelInitialized, t]);
  
  const handleCalibrate = useCallback(async () => {
    const hasCaptureSource = Boolean(webcamRef.current) || Boolean(shouldUseBackendPreview && backendPreviewFrame);
    if (!hasCaptureSource || !isModelInitialized || !store) {
      setError(t('webcam.calibrationNotReady', '모델, 웹캠 또는 저장소가 준비되지 않았습니다.'));
      return;
    }
    setCalibrationStatus('calibrating');
    setError('');
    try {
      const imageSamples: string[] = [];
      if (shouldUseBackendPreview && backendPreviewFrame) {
        imageSamples.push(backendPreviewFrame);
      } else {
        for (let index = 0; index < 5; index += 1) {
          const frame = webcamRef.current?.getScreenshot();
          if (frame) imageSamples.push(frame);
          if (index < 4) {
            await new Promise((resolve) => setTimeout(resolve, 220));
          }
        }
      }
      if (imageSamples.length === 0) throw new Error(t('webcam.captureError', '웹캠 이미지를 캡처할 수 없습니다.'));

      const imageSrc = imageSamples[Math.floor(imageSamples.length / 2)];
      
      const filePath = await invoke<string>('save_calibrated_image', { imageData: imageSrc });
      await invoke('calibrate_user_posture', { imageDataSamples: imageSamples });
      const imageUrl = convertFileSrc(filePath);
      const cacheBustedUrl = `${imageUrl}?t=${new Date().getTime()}`;

      await store.set('calibratedImagePath', filePath);
      await store.save(); 

      setCalibratedImage(cacheBustedUrl);
      setCalibrationStatus('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(t('webcam.calibrationError', `자세 캘리브레이션에 실패했습니다: ${errorMessage}`));
      setCalibrationStatus('error');
    } finally {
        setTimeout(() => setCalibrationStatus('idle'), 3000);
    }
  }, [backendPreviewFrame, isModelInitialized, shouldUseBackendPreview, store, t]);

  useEffect(() => {
    try {
      setCurrentPlatform(platform());
    } catch (platformError) {
      console.error('Failed to resolve platform:', platformError);
    }
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const storeInstance = await load('.settings.dat');
        setStore(storeInstance);

        const savedImagePath = await storeInstance.get<string>('calibratedImagePath');
        if (savedImagePath) {
          const imageUrl = convertFileSrc(savedImagePath);
          setCalibratedImage(`${imageUrl}?t=${new Date().getTime()}`);
        }
      
        const status = await invoke<MonitoringStatus>('get_monitoring_status');
        setIsMonitoring(status.active);
        if (!status.active) {
          setAnalysisResult(null);
        }
      } catch (err) {
        console.error('Failed to load initial webcam state:', err);
      }
    };
    loadInitialData();

    const unlistenPromises = Promise.all([
      listen<string>('posture-alert', (event) => {
        window.dispatchEvent(new CustomEvent('pose-nudge-toast', { detail: event.payload }));
      }),
      listen<{ active: boolean }>('monitoring-state-changed', (event) => {
        const nextActive = event.payload.active;
        setIsMonitoring(nextActive);

        if (!nextActive) {
          setAnalysisResult(null);
          setBackendPreviewFrame(null);
          setUseBackendPreview(false);
        }
      }),
      listen<string>('camera-preview-frame', (event) => {
        const framePayload = event.payload?.trim();
        if (!framePayload || !isValidPreviewFramePayload(framePayload)) {
          return;
        }

        setBackendPreviewFrame(framePayload);
        setIsWebcamReady(true);
        setError('');
      }),
      listen<PostureAnalysis>('analysis-update', (event) => {
        setAnalysisResult(event.payload);
      }),
    ]);

    return () => {
      unlistenPromises.then((unlisteners) => {
        unlisteners.forEach((unlisten) => {
          unlisten();
        });
      });
    };
  }, []);

  useEffect(() => {
    if (isWebcamReady && !isModelInitialized) {
      initializeModel();
    }
  }, [isWebcamReady, isModelInitialized, initializeModel]);

  useEffect(() => {
    if (!isMonitoring) {
      setAnalysisResult(null);
      setBackendPreviewFrame(null);
      setUseBackendPreview(false);
    }
  }, [isMonitoring]);

  useEffect(() => {
    if (!isMonitoring || !shouldUseBackendPreview || backendPreviewFrame) {
      return;
    }

    invoke('request_preview_frame').catch((requestError) => {
      console.error('Failed to request immediate preview frame:', requestError);
    });
  }, [backendPreviewFrame, isMonitoring, shouldUseBackendPreview]);

  const onUserMedia = useCallback(() => {
    setIsWebcamReady(true);
    setUseBackendPreview(false);
    setError('');
  }, []);
  const onUserMediaError = useCallback(async () => {
    setIsWebcamReady(false);
    setAnalysisResult(null);
    setUseBackendPreview(isMonitoring);

    if (isMonitoring) {
      setError(t('webcam.previewFallback', '브라우저 웹캠 접근에 실패해 분석용 카메라 화면으로 전환합니다.'));
      return;
    }

    try {
      const os = await platform();
      if (os === 'linux') {
        setError(
          t(
            'webcam.permissionErrorLinux',
            'Failed to access the webcam on Linux. Make sure no other app is using the camera and re-select the camera in Settings.'
          )
        );
        return;
      }
    } catch (platformError) {
      console.error('Failed to resolve platform:', platformError);
    }

    setError(t('webcam.permissionError', '웹캠에 접근할 수 없습니다.'));
  }, [isMonitoring, t]);

  const getPostureStatusColor = (score?: number | null): string => {
    if (score == null) return '';
    if (score >= 80) return 'score-good';
    if (score >= 60) return 'score-medium';
    return 'score-bad';
  };
  
  const isReadyForUI = isWebcamReady && isModelInitialized;

  const toggleMonitoring = async () => {
    try {
      if (isMonitoring) {
        await invoke('stop_monitoring');
        return;
      }

      if (
        loadReminderPreferences().native_notification
        && localStorage.getItem('oneposture_notification_permission_asked') !== 'true'
      ) {
        const granted = await isPermissionGranted();
        if (!granted) {
          await requestPermission();
        }
        localStorage.setItem('oneposture_notification_permission_asked', 'true');
      }

      await invoke('start_monitoring');
    } catch (monitoringError) {
      console.error('Failed to change monitoring state:', monitoringError);
      setError(t('webcam.monitoringToggleError', '无法切换监测状态，请检查摄像头权限。'));
    }
  };

  return (
    <section className="page-stack monitoring-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t('webcam.eyebrow', 'Live posture field')}</p>
          <h1>{t('webcam.title', 'See what OnePosture sees')}</h1>
          <p>{t('webcam.subtitle', 'Set a comfortable upright baseline, then let confidence-aware detection handle the rest.')}</p>
        </div>
      </header>

      <div className="monitoring-layout">
        <section className="camera-stage">
          <header className="camera-stage-header">
            <p>{t('webcam.cameraPreview', 'Private camera preview')}</p>
            <span className={isMonitoring ? 'is-live' : ''}><i />{isMonitoring ? t('webcam.monitoringActiveStatus') : t('webcam.monitoringInactiveStatus')}</span>
          </header>
          <div className="camera-frame">
            {shouldUseBackendPreview ? (
              backendPreviewFrame ? (
                <img src={backendPreviewFrame} alt={t('webcam.backendPreviewAlt', 'Monitoring camera preview')} />
              ) : (
                <div className="camera-waiting">{t('webcam.waitingPreviewFrame', 'Loading camera preview…')}</div>
              )
            ) : (
              <Webcam
                ref={webcamRef}
                audio={false}
                videoConstraints={videoConstraints}
                onUserMedia={onUserMedia}
                onUserMediaError={onUserMediaError}
                screenshotFormat="image/jpeg"
              />
            )}
            <div className={`camera-outline ${getPostureStatusColor(isMonitoring ? analysisResult?.posture_score : null)}`} />
            {isMonitoring && analysisResult?.reliable !== false && analysisResult?.posture_score != null && (
              <div className="camera-score"><strong>{analysisResult.posture_score}</strong><span>{t('webcam.currentScore')}</span></div>
            )}
          </div>
        </section>

        <aside className="monitor-side">
          <section className="control-card">
            <div className={`monitor-status ${isMonitoring ? 'is-live' : ''}`}>
              <span>{isMonitoring ? <Activity /> : <StopCircle />}</span>
              <p>
                <strong>{isMonitoring ? t('webcam.monitoringActiveStatus') : t('webcam.monitoringInactiveStatus')}</strong>
                <small>{isMonitoring ? t('webcam.backgroundGuide', 'You may close the window; monitoring continues from the menu bar.') : t('webcam.startGuide', 'Start when your head and shoulders are clearly visible.')}</small>
              </p>
            </div>
            <button type="button" className={`monitor-primary ${isMonitoring ? 'is-stop' : ''}`} onClick={toggleMonitoring}>
              {isMonitoring ? <StopCircle /> : <PlayCircle />}
              {isMonitoring ? t('webcam.stopMonitoring') : t('webcam.startMonitoring')}
            </button>
            <div className="system-readiness">
              <div className={isWebcamReady ? 'is-ready' : ''}><Camera />{t('webcam.webcam')} · {isWebcamReady ? 'ON' : 'OFF'}</div>
              <div className={isModelInitialized ? 'is-ready' : ''}><Cpu />{t('webcam.aiModel')} · {isModelInitialized ? 'ON' : 'OFF'}</div>
            </div>
            {error && <p className="inline-error">{error}</p>}
            {initializationProgress && <p className="inline-progress">{initializationProgress}</p>}
          </section>

          <section className="calibration-card">
            <h3>{t('webcam.calibration')}</h3>
            <p>{t('webcam.calibrationGuide')}</p>
            <button type="button" className="calibration-action" onClick={handleCalibrate} disabled={!isReadyForUI || calibrationStatus === 'calibrating'}>
              {calibrationStatus === 'calibrating' ? t('webcam.saving') : t('webcam.setCurrentPosture')}
            </button>
            {calibrationStatus === 'success' && <p className="inline-progress">{t('webcam.saveSuccess')}</p>}
            {calibrationStatus === 'error' && <p className="inline-error">{t('webcam.saveError')}</p>}
            {calibratedImage && (
              <div className="calibration-reference">
                <button type="button" onClick={() => setIsPreviewOpen(true)}><img src={calibratedImage} alt={t('webcam.calibratedThumbnail')} /></button>
                <span>{t('webcam.savedReferencePosture')}</span>
              </div>
            )}
          </section>
        </aside>

        <section className="analysis-card">
          <div className="section-heading"><div><p className="eyebrow">{t('webcam.realtimeStatus')}</p><h3>{t('webcam.currentDetected')}</h3></div></div>
          <div className="analysis-content">
            {isMonitoring && analysisResult ? (
              analysisResult.reliable === false ? (
                <div className="confidence-warning"><strong>{t('webcam.lowConfidenceTitle', 'Posture is not clear yet')}</strong><p>{t('webcam.lowConfidenceDesc', 'Keep your head and both shoulders visible. This frame will not be scored or trigger a reminder.')}</p></div>
              ) : (
                <>
                  <div className={`analysis-signal ${analysisResult.turtle_neck ? 'is-bad' : 'is-good'}`}><span>{analysisResult.turtle_neck ? <XCircle /> : <CheckCircle />}{t('webcam.headPosition')}</span><strong>{analysisResult.turtle_neck ? t('webcam.caution') : t('webcam.normal')}</strong></div>
                  <div className={`analysis-signal ${analysisResult.shoulder_misalignment ? 'is-bad' : 'is-good'}`}><span>{analysisResult.shoulder_misalignment ? <XCircle /> : <CheckCircle />}{t('webcam.shoulderMisalign')}</span><strong>{analysisResult.shoulder_misalignment ? t('webcam.imbalance') : t('webcam.normal')}</strong></div>
                  {analysisResult.recommendations.length > 0 && (
                    <div className="recommendation-box"><strong><Lightbulb />{t('dashboard.tipsTitle')}</strong><ul>{analysisResult.recommendations.map((rec) => <li key={rec}>{t(rec.includes('.') ? `dashboard.${rec}` : `dashboard.tips.${rec}`)}</li>)}</ul></div>
                  )}
                </>
              )
            ) : (
              <div className="analysis-empty"><CameraOff /><p>{t('webcam.startMonitoringDesc', 'Start monitoring to see live posture signals.')}</p></div>
            )}
          </div>
        </section>
      </div>
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{t('webcam.savedReferencePosture', 'Saved reference posture')}</DialogTitle></DialogHeader>
          {calibratedImage && (<img src={calibratedImage} alt={t('webcam.calibratedPreview', 'Calibrated Posture Preview')} className="rounded-lg w-full h-auto aspect-video" />)}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default WebcamCapture;
