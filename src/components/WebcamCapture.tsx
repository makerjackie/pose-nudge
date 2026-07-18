import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import Webcam from 'react-webcam';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import { load, Store } from '@tauri-apps/plugin-store';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { loadReminderPreferences } from '@/lib/reminders';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Camera,
  CameraOff,
  Activity,
  Target,
  CheckCircle,
  XCircle,
  PlayCircle,
  StopCircle,
  Lightbulb,
  Cpu,
  ZoomIn,
} from 'lucide-react';
//import { getDb } from '@/lib/db';

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

const StatusItem: React.FC<{ label: string; isBad: boolean; detectedText?: string; }> = ({ label, isBad, detectedText }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between rounded-lg p-3 bg-muted">
      <span className="text-sm font-medium text-foreground">{t(label)}</span>
      <div className={`flex items-center gap-2 text-sm font-semibold ${isBad ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
        {isBad ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
        <span>
          {isBad
            ? (detectedText ? t(detectedText) : t('webcam.detected', 'Detected'))
            : t('webcam.normal', 'Normal')}
        </span>
      </div>
    </div>
  );
};


const WebcamCapture: React.FC = () => {
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
    if (score == null) return 'ring-slate-300';
    if (score >= 80) return 'ring-emerald-500';
    if (score >= 60) return 'ring-amber-500';
    return 'ring-red-500';
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
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden">
            <div className={`relative group`}>
              {shouldUseBackendPreview ? (
                backendPreviewFrame ? (
                  <img
                    src={backendPreviewFrame}
                    alt={t('webcam.backendPreviewAlt', 'Monitoring camera preview')}
                    className="w-full h-full object-contain aspect-video transition-all bg-muted"
                  />
                ) : (
                  <div className="w-full h-full aspect-video flex items-center justify-center bg-muted text-muted-foreground text-sm">
                    {t('webcam.waitingPreviewFrame', '카메라 프레임을 불러오는 중...')}
                  </div>
                )
              ) : (
                <Webcam
                  ref={webcamRef}
                  audio={false}
                  videoConstraints={videoConstraints}
                  onUserMedia={onUserMedia}
                  onUserMediaError={onUserMediaError}
                  className="w-full h-full object-contain aspect-video transition-all bg-muted"
                  screenshotFormat="image/jpeg"
                />
              )}
              <div className={`absolute inset-0 transition-all ring-4 ring-inset pointer-events-none ${getPostureStatusColor(isMonitoring ? analysisResult?.posture_score : null)}`} />
              {isMonitoring && analysisResult && analysisResult.reliable !== false && analysisResult.posture_score != null && (
                <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm text-white p-3 rounded-lg text-left">
                  <p className="text-sm font-medium">{t('webcam.currentScore', '현재 자세 점수')}</p>
                  <p className="text-4xl font-bold">{analysisResult.posture_score}<span className="text-2xl">{t('dashboard.scoreUnit', '/100')}</span></p>
                </div>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('webcam.realtimeStatus', '실시간 분석 현황')}</CardTitle>
              <CardDescription>
                {t(isMonitoring ? 'webcam.currentDetected' : 'webcam.startMonitoringDescTray', '시스템 트레이 아이콘으로 모니터링을 시작하면 분석 결과가 표시됩니다.')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isMonitoring && analysisResult ? (
                analysisResult.reliable === false ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    <p className="font-semibold">{t('webcam.lowConfidenceTitle', '暂时看不清姿态')}</p>
                    <p className="mt-1 opacity-80">{t('webcam.lowConfidenceDesc', '请让头部和双肩完整出现在画面中；本帧不会计分，也不会触发提醒。')}</p>
                  </div>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <StatusItem label="webcam.headPosition" isBad={analysisResult.turtle_neck} detectedText="webcam.caution" />
                    <StatusItem label="webcam.shoulderMisalign" isBad={analysisResult.shoulder_misalignment} detectedText="webcam.imbalance" />
                  </div>
                  <div className="space-y-3">
                    {analysisResult.recommendations.length > 0 && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2 text-blue-800 dark:text-blue-200"><Lightbulb className="h-4 w-4"/>{t('dashboard.tipsTitle', '개선 팁')}</h4>
                        <ul className="space-y-1 text-xs text-blue-700 dark:text-blue-300 list-disc list-inside">
                          {analysisResult.recommendations.map((rec) => (
                            <li key={rec}>
                              {t(
                                // dotted key (e.g. "motivation.excellent") => dashboard.<dotted>
                                rec.includes('.') ? `dashboard.${rec}` : `dashboard.tips.${rec}`
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
                )
              ) : (
                <div className="text-center py-10 text-muted-foreground">
                  <CameraOff className="mx-auto h-12 w-12 mb-2" />
                  <p>{t('webcam.monitoringInactive', '모니터링 비활성화 상태')}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg-col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>{t('webcam.controlPanel', '컨트롤 패널')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className={`w-full p-4 rounded-lg text-center font-semibold ${isMonitoring ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-muted text-muted-foreground'}`}>
                {isMonitoring ? (
                  <div className="flex items-center justify-center gap-2">
                    <Activity className="h-5 w-5" />
                    <span>{t('webcam.monitoringActiveStatus', '모니터링 활성화 중')}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <StopCircle className="h-5 w-5" />
                    <span>{t('webcam.monitoringInactiveStatus', '모니터링 비활성화 중')}</span>
                  </div>
                )}
              </div>
              <Button
                onClick={toggleMonitoring}
                className={`w-full gap-2 ${isMonitoring ? '' : 'bg-[#2f7d66] text-white hover:bg-[#276b58]'}`}
                variant={isMonitoring ? 'outline' : 'default'}
              >
                {isMonitoring ? <StopCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                {isMonitoring
                  ? t('webcam.stopMonitoring', '停止监测')
                  : t('webcam.startMonitoring', '开始监测')}
              </Button>
              <p className="text-xs text-center text-muted-foreground pt-1">
                {t('webcam.trayControlGuide', '也可以从菜单栏快速暂停或继续。')}
              </p>
              
              <div className="flex justify-around text-sm pt-2">
                <span className={`flex items-center gap-1.5 ${isWebcamReady ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}><Camera className="h-4 w-4"/>{t('webcam.webcam', '웹캠')} {isWebcamReady ? 'ON' : 'OFF'}</span>
                <span className={`flex items-center gap-1.5 ${isModelInitialized ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}><Cpu className="h-4 w-4"/>{t('webcam.aiModel', 'AI 모델')} {isModelInitialized ? 'ON' : 'OFF'}</span>
              </div>
            </CardContent>
            {(error || initializationProgress) && (
              <div className="mt-2 space-y-1">
                {error && (
                  <div className="text-xs text-destructive font-semibold px-2 py-1 rounded bg-destructive/10 border border-destructive/20">
                    {error}
                  </div>
                )}
                {initializationProgress && (
                  <div className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted border border-border">
                    {initializationProgress}
                  </div>
                )}
              </div>
            )}
            <Separator className="my-4"/>
            <CardContent>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Target className="h-4 w-4"/>{t('webcam.calibration', '자세 캘리브레이션')}</h3>
              <Button onClick={handleCalibrate} disabled={!isReadyForUI || calibrationStatus === 'calibrating'} className="w-full" variant="outline">
                {calibrationStatus === 'calibrating' ? t('webcam.saving', '저장 중...') : t('webcam.setCurrentPosture', '현재 자세를 기준으로 설정')}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">{t('webcam.calibrationGuide', '保持自然坐直约 1 秒；OnePosture 会用多帧中位数建立基准。')}</p>
              {calibrationStatus === 'success' && <p className="text-xs text-green-600 dark:text-green-400 mt-1">✅ {t('webcam.saveSuccess', '성공적으로 저장되었습니다.')}</p>}
              {calibrationStatus === 'error' && <p className="text-xs text-destructive mt-1">❌ {t('webcam.saveError', '저장에 실패했습니다.')}</p>}
              {calibratedImage && (
                <div className="mt-4">
                  <p className="text-xs font-semibold mb-2 text-muted-foreground">{t('webcam.savedPosture', '저장된 자세:')}</p>
                  <button
                    type="button"
                    className="relative w-28 h-auto aspect-[4/3] rounded-lg overflow-hidden cursor-pointer group border-2 border-border"
                    onClick={() => setIsPreviewOpen(true)}
                  >
                    <img src={calibratedImage} alt={t('webcam.calibratedThumbnail', 'Calibrated posture thumbnail')} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                      <ZoomIn className="h-8 w-8 text-white" />
                    </div>
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{t('webcam.savedReferencePosture', '저장된 기준 자세')}</DialogTitle></DialogHeader>
          {calibratedImage && (<img src={calibratedImage} alt={t('webcam.calibratedPreview', 'Calibrated Posture Preview')} className="rounded-lg w-full h-auto aspect-video" />)}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WebcamCapture;
