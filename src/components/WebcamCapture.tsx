import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import Webcam from 'react-webcam';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import { load, Store } from '@tauri-apps/plugin-store';
import { appPreferences, resolvePreferredVideoDevice } from '@/lib/preferences';
import { getMonitoringActive, onMonitoringChange, setMonitoringActive } from '@/lib/monitoring';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Camera,
  CameraOff,
  Activity,
  CheckCircle,
  XCircle,
  PlayCircle,
  StopCircle,
  Cpu,
  ShieldCheck,
} from 'lucide-react';

interface PostureAnalysis {
  turtle_neck: boolean;
  shoulder_misalignment: boolean;
  posture_score: number | null;
  recommendations: string[];
  confidence?: number;
  reliable?: boolean;
  baseline_ready?: boolean;
  head_deviation?: number;
  shoulder_deviation?: number;
}

const isValidPreviewFramePayload = (payload: string): boolean =>
  payload.startsWith('data:image/') && payload.includes('base64,') && payload.length > 'data:image/jpeg;base64,'.length;

const localizeCalibrationError = (
  t: ReturnType<typeof useTranslation>['t'],
  errorMessage: string,
): string => {
  const [code, detected, minimum] = errorMessage.split(':');
  if (code === 'CALIBRATION_INSUFFICIENT_FRAMES') {
    return t('webcam.calibrationInsufficientFrames', { detected, minimum });
  }
  if (code === 'CALIBRATION_NO_SAMPLES') return t('webcam.calibrationNoSamples');
  if (code === 'CALIBRATION_NO_KEYPOINTS') return t('webcam.calibrationNoKeypoints');
  if (code === 'CALIBRATION_FRAME_TIMEOUT') return t('webcam.calibrationFrameTimeout');
  if (code === 'CALIBRATION_INVALID_REFERENCE') return t('webcam.calibrationInvalidReference');
  if (code === 'CALIBRATION_IN_PROGRESS') return t('webcam.calibrationInProgress');
  return t('webcam.calibrationError', { error: errorMessage });
};

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
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationError, setCalibrationError] = useState('');
  const [calibratedImage, setCalibratedImage] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const [currentPlatform, setCurrentPlatform] = useState<string>('unknown');
  const [backendPreviewFrame, setBackendPreviewFrame] = useState<string | null>(null);
  const [useBackendPreview, setUseBackendPreview] = useState(false);
  const [previewFps, setPreviewFps] = useState<number | null>(null);
  const shouldUseBackendPreview = useBackendPreview || (
    isMonitoring && currentPlatform === 'windows'
  );

  const videoConstraints = useMemo(
    () => ({
      ...(selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId } }
        : { facingMode: 'user' }),
      width: { ideal: 1280 },
      height: { ideal: 720 },
      aspectRatio: { ideal: 16 / 9 },
    }),
    [selectedDeviceId]
  );

  const captureBackendCalibrationFrame = useCallback(async (): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      const timeout = window.setTimeout(() => {
        disposed = true;
        unlisten?.();
        reject(new Error('CALIBRATION_FRAME_TIMEOUT'));
      }, 5000);

      void listen<string>('camera-preview-frame', (event) => {
        const frame = event.payload?.trim();
        if (disposed || !frame || !isValidPreviewFramePayload(frame)) return;
        disposed = true;
        window.clearTimeout(timeout);
        unlisten?.();
        resolve(frame);
      }).then((dispose) => {
        unlisten = dispose;
        if (disposed) dispose();
        else invoke('request_preview_frame').catch((requestError) => {
          disposed = true;
          window.clearTimeout(timeout);
          dispose();
          reject(requestError);
        });
      }).catch(reject);
    });
  }, []);

  useEffect(() => {
    try {
      setCurrentPlatform(platform());
    } catch (platformError) {
      console.error('Failed to resolve platform:', platformError);
    }
  }, []);

  useEffect(() => {
    void invoke('set_backend_preview_active', { active: shouldUseBackendPreview });
    return () => {
      void invoke('set_backend_preview_active', { active: false });
    };
  }, [shouldUseBackendPreview]);

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
        const devices = await navigator.mediaDevices.enumerateDevices();
        const nextDeviceId = resolvePreferredVideoDevice(devices)?.deviceId;

        if (cancelled) {
          return;
        }

        setSelectedDeviceId(nextDeviceId);
        if (nextDeviceId) {
          appPreferences.writeCamera({ deviceId: nextDeviceId });
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
      setInitializationProgress(t('webcam.initModel'));
      await invoke('initialize_pose_model');
      setIsModelInitialized(true);
      setInitializationProgress('');
    } catch (err) {
      console.error(err);
      setError(t('webcam.initModelError'));
      setInitializationProgress('');
    }
  }, [isModelInitialized, t]);
  
  const handleCalibrate = useCallback(async () => {
    const hasCaptureSource = Boolean(webcamRef.current) || Boolean(shouldUseBackendPreview && backendPreviewFrame);
    if (!hasCaptureSource || !isModelInitialized || !store) {
      setError(t('webcam.calibrationNotReady'));
      return;
    }
    setCalibrationStatus('calibrating');
    setCalibrationProgress(0);
    setCalibrationError('');
    setError('');
    try {
      await invoke('set_calibration_active', { active: true });
      const imageSamples: string[] = [];
      if (shouldUseBackendPreview && backendPreviewFrame) {
        for (let index = 0; index < 5; index += 1) {
          imageSamples.push(await captureBackendCalibrationFrame());
          setCalibrationProgress(index + 1);
        }
      } else {
        for (let index = 0; index < 5; index += 1) {
          const frame = webcamRef.current?.getScreenshot();
          if (frame) {
            imageSamples.push(frame);
            setCalibrationProgress(imageSamples.length);
          }
          if (index < 4) {
            await new Promise((resolve) => setTimeout(resolve, 220));
          }
        }
      }
      if (imageSamples.length === 0) throw new Error(t('webcam.captureError'));

      const imageSrc = imageSamples[Math.floor(imageSamples.length / 2)];
      const filePath = await invoke<string>('calibrate_user_posture', {
        imageDataSamples: imageSamples,
        referenceImageData: imageSrc,
      });
      const imageUrl = convertFileSrc(filePath);
      const cacheBustedUrl = `${imageUrl}?t=${new Date().getTime()}`;

      await store.set('calibratedImagePath', filePath);
      await store.save(); 

      setCalibratedImage(cacheBustedUrl);
      setCalibrationStatus('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setCalibrationError(localizeCalibrationError(t, errorMessage));
      setCalibrationStatus('error');
    } finally {
      void invoke('set_calibration_active', { active: false });
      setTimeout(() => {
        setCalibrationStatus('idle');
        setCalibrationProgress(0);
      }, 4000);
    }
  }, [backendPreviewFrame, captureBackendCalibrationFrame, isModelInitialized, shouldUseBackendPreview, store, t]);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const storeInstance = await load('.settings.dat');
        setStore(storeInstance);

        const migratedImagePath = await invoke<string | null>('get_calibrated_image_path');
        const savedImagePath = migratedImagePath
          ?? await storeInstance.get<string>('calibratedImagePath');
        if (savedImagePath) {
          const imageUrl = convertFileSrc(savedImagePath);
          setCalibratedImage(`${imageUrl}?t=${new Date().getTime()}`);
        }
      
        const active = await getMonitoringActive();
        setIsMonitoring(active);
        if (!active) {
          setAnalysisResult(null);
        }
      } catch (err) {
        console.error('Failed to load initial webcam state:', err);
      }
    };
    loadInitialData();

    const monitoringListener = onMonitoringChange((nextActive) => {
      setIsMonitoring(nextActive);
      if (!nextActive) {
        setAnalysisResult(null);
        setBackendPreviewFrame(null);
        setUseBackendPreview(false);
      }
    });
    const unlistenPromises = Promise.all([
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
      void monitoringListener.then((unlisten) => unlisten());
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

  useEffect(() => {
    if (!isMonitoring || shouldUseBackendPreview) {
      setPreviewFps(null);
      return;
    }
    const video = webcamRef.current?.video;
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return;

    let frameCount = 0;
    let lastReportAt = performance.now();
    let callbackId = 0;
    const onVideoFrame: VideoFrameRequestCallback = (now) => {
      frameCount += 1;
      const elapsed = now - lastReportAt;
      if (elapsed >= 2000) {
        const measuredFps = (frameCount * 1000) / elapsed;
        setPreviewFps(Math.round(measuredFps));
        console.info(`[preview-health] fps=${measuredFps.toFixed(1)}`);
        frameCount = 0;
        lastReportAt = now;
      }
      callbackId = video.requestVideoFrameCallback(onVideoFrame);
    };
    callbackId = video.requestVideoFrameCallback(onVideoFrame);
    return () => {
      video.cancelVideoFrameCallback(callbackId);
      setPreviewFps(null);
    };
  }, [isMonitoring, shouldUseBackendPreview]);

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
      setError(t('webcam.previewFallback'));
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

    setError(t('webcam.permissionError'));
  }, [isMonitoring, t]);

  const getPostureStatusColor = (score?: number | null): string => {
    if (score == null) return '';
    if (score >= 80) return 'score-good';
    if (score >= 60) return 'score-medium';
    return 'score-bad';
  };
  
  const isReadyForUI = isWebcamReady && isModelInitialized;
  const confidencePercent = Math.round((analysisResult?.confidence ?? 0) * 100);
  const headDeviationPercent = Math.round((analysisResult?.head_deviation ?? 0) * 100);
  const shoulderDeviationPercent = Math.round((analysisResult?.shoulder_deviation ?? 0) * 100);
  const score = analysisResult?.posture_score ?? null;
  const baselineReady = calibrationStatus === 'success' || analysisResult?.baseline_ready === true;
  const needsCalibration = Boolean(
    isMonitoring && analysisResult?.reliable !== false && analysisResult?.baseline_ready === false,
  );

  const toggleMonitoring = async () => {
    try {
      await setMonitoringActive(!isMonitoring);
    } catch (monitoringError) {
      console.error('Failed to change monitoring state:', monitoringError);
      setError(t('webcam.monitoringToggleError', '无法切换监测状态，请检查摄像头权限。'));
    }
  };

  return (
    <section className="page-stack monitoring-page">
      <header className="page-heading">
        <div>
          <h1>{t('nav.monitoring', 'Live posture')}</h1>
          <p className="privacy-note"><ShieldCheck />{t('webcam.privacyNote', 'All processing happens on this device. Video is never uploaded.')}</p>
        </div>
      </header>

      <div className="monitoring-layout">
        <section className="camera-stage">
          <header className="camera-stage-header">
            <p><Camera />{t('webcam.cameraPreview', 'Private camera preview')}</p>
            <span><ShieldCheck />{t('shell.localOnly', 'On-device')}{previewFps ? ` · ${previewFps} FPS` : ''}</span>
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
                forceScreenshotSourceSize
              />
            )}
            <div className="framing-guide" aria-hidden="true"><i /><i /><i /><i /><span /><b /></div>
            <div className={`camera-outline ${getPostureStatusColor(isMonitoring ? analysisResult?.posture_score : null)}`} />
            {isMonitoring && analysisResult?.reliable !== false && analysisResult?.posture_score != null && (
              <div className="camera-score"><strong>{analysisResult.posture_score}</strong><span>{t('webcam.currentScore')}</span></div>
            )}
          </div>
          <footer className="camera-caption"><ShieldCheck />{t('webcam.previewGuide', 'Keep your head and both shoulders inside the guide. The full camera frame is shown without cropping.')}</footer>
        </section>

        <aside className="monitor-side">
          <section className="control-card">
            <header className="card-title-row">
              <h2>{t('webcam.currentStatus', 'Current status')}</h2>
              <span className={isMonitoring ? 'status-dot is-live' : 'status-dot'}><i />{isMonitoring ? t('webcam.active', 'Active') : t('webcam.monitoringInactiveStatus')}</span>
            </header>
            <div className="posture-status">
              <span className={(needsCalibration || (score != null && score < 80)) ? 'is-warning' : ''}>{(needsCalibration || (score != null && score < 80)) ? <Activity /> : <CheckCircle />}</span>
              <p><strong>{needsCalibration ? t('webcam.calibrationRequiredTitle', 'Set your posture baseline') : score == null ? t('webcam.waitingForSignal', 'Waiting for signal') : score >= 80 ? t('webcam.goodPosture', 'Good posture') : t('webcam.postureDrifting', 'Posture drifting')}</strong><small>{needsCalibration ? t('webcam.calibrationRequiredDesc', 'Hold a comfortable upright posture, then save it below. OnePosture will not show a misleading score before calibration.') : score == null ? t('webcam.startGuide', 'Start when your head and shoulders are clearly visible.') : score >= 80 ? t('webcam.goodPostureDesc', 'Your position is close to the baseline.') : t('webcam.postureDriftingDesc', 'A sustained deviation will trigger your reminder.')}</small></p>
              <div className="compact-score"><strong>{score ?? '—'}</strong><span>{t('dashboard.scoreUnit')}</span></div>
            </div>
            <div className="confidence-meter">
              <p><span>{t('webcam.confidence', 'Confidence')}</span><strong>{isMonitoring && analysisResult ? `${confidencePercent}%` : '—'}</strong></p>
              <div><span style={{ width: `${confidencePercent}%` }} /></div>
              <small>{analysisResult?.reliable === false ? t('webcam.lowConfidenceTitle', 'Posture is not clear yet') : t('webcam.reliableSignal', 'Reliable signal')}</small>
            </div>
            <div className="deviation-list">
              <div><p><span>{t('webcam.headDeviation', 'Head drift')}</span><strong>{isMonitoring && analysisResult?.reliable !== false && !needsCalibration ? `${headDeviationPercent}%` : '—'}</strong></p><div><span style={{ width: `${needsCalibration ? 0 : Math.min(100, headDeviationPercent / 2)}%` }} /></div></div>
              <div><p><span>{t('webcam.shoulderDeviation', 'Shoulder level')}</span><strong>{isMonitoring && analysisResult?.reliable !== false && !needsCalibration ? `${shoulderDeviationPercent}%` : '—'}</strong></p><div><span style={{ width: `${needsCalibration ? 0 : Math.min(100, shoulderDeviationPercent / 2)}%` }} /></div></div>
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

          <section className="analysis-card">
            <div className="card-title-row"><h2>{t('webcam.currentDetected')}</h2></div>
            <div className="analysis-content">
              {isMonitoring && analysisResult ? (
                analysisResult.reliable === false ? (
                  <div className="confidence-warning"><strong>{t('webcam.lowConfidenceTitle', 'Posture is not clear yet')}</strong><p>{t('webcam.lowConfidenceDesc', 'Keep your head and both shoulders visible. This frame will not be scored or trigger a reminder.')}</p></div>
                ) : needsCalibration ? (
                  <div className="confidence-warning"><strong>{t('webcam.calibrationRequiredTitle', 'Set your posture baseline')}</strong><p>{t('webcam.calibrationRequiredDesc', 'Hold a comfortable upright posture, then save it below. OnePosture will not show a misleading score before calibration.')}</p></div>
                ) : (
                  <>
                    <div className={`analysis-signal ${analysisResult.turtle_neck ? 'is-bad' : 'is-good'}`}><span>{analysisResult.turtle_neck ? <XCircle /> : <CheckCircle />}{t('webcam.headPosition')}</span><strong>{analysisResult.turtle_neck ? t('webcam.caution') : t('webcam.normal')}</strong></div>
                    <div className={`analysis-signal ${analysisResult.shoulder_misalignment ? 'is-bad' : 'is-good'}`}><span>{analysisResult.shoulder_misalignment ? <XCircle /> : <CheckCircle />}{t('webcam.shoulderMisalign')}</span><strong>{analysisResult.shoulder_misalignment ? t('webcam.imbalance') : t('webcam.normal')}</strong></div>
                  </>
                )
              ) : (
                <div className="analysis-empty"><CameraOff /><p>{t('webcam.startMonitoringDesc', 'Start monitoring to see live posture signals.')}</p></div>
              )}
            </div>
          </section>

          <section className="calibration-card">
            <div className="card-title-row"><h2>{t('webcam.calibration')}</h2><span className={baselineReady ? 'baseline-state is-ready' : 'baseline-state'}>{baselineReady ? t('webcam.baselineReady', 'Baseline ready') : t('webcam.baselineNeeded', 'Recommended')}</span></div>
            <p>{t('webcam.calibrationGuide')}</p>
            <button type="button" className="calibration-action" onClick={handleCalibrate} disabled={!isReadyForUI || calibrationStatus === 'calibrating'}>
              {calibrationStatus === 'calibrating'
                ? t('webcam.calibrationSampling', { current: calibrationProgress, total: 5 })
                : t('webcam.setCurrentPosture')}
            </button>
            {calibrationStatus === 'success' && <p className="inline-progress">{t('webcam.calibrationApplied')}</p>}
            {calibrationStatus === 'error' && <p className="inline-error">{calibrationError || t('webcam.saveError')}</p>}
            {calibratedImage && (
              <div className="calibration-reference">
                <button type="button" onClick={() => setIsPreviewOpen(true)}><img src={calibratedImage} alt={t('webcam.calibratedThumbnail')} /></button>
                <span>{t('webcam.savedReferencePosture')}</span>
              </div>
            )}
          </section>
        </aside>
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
