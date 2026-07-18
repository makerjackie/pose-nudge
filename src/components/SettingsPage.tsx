import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Command, open } from '@tauri-apps/plugin-shell';
import { platform } from '@tauri-apps/plugin-os';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { useTheme } from 'next-themes';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { Bell, CheckCircle2, KeyRound, MonitorUp, Moon, Sparkles, Volume2 } from 'lucide-react';
import {
    loadReminderPreferences,
    saveReminderPreferences,
    type ReminderPreferences,
} from '@/lib/reminders';

// --- LocalStorage Keys ---
const LANGUAGE_KEY = "pose_nudge_language";
const NOTIFICATION_FREQUENCY_KEY = "pose_nudge_notification_frequency";
const TURTLE_NECK_SENSITIVITY_KEY = "pose_nudge_turtle_neck_sensitivity";
const SHOULDER_SENSITIVITY_KEY = "pose_nudge_shoulder_sensitivity";
const CAMERA_INDEX_KEY = "pose_nudge_camera_index";
const CAMERA_NAME_KEY = "pose_nudge_camera_name";
const LEGACY_CAMERA_DEVICE_KEY = "pose_nudge_camera";
const MONITORING_INTERVAL_KEY = "pose_nudge_monitoring_interval";
const BATTERY_SAVING_MODE_KEY = "pose_nudge_battery_saving_mode";

// --- Type Definitions ---
interface CameraDetail {
    index: number;
    name: string;
}

interface LicenseStatus {
    edition: 'free' | 'pro';
    active: boolean;
    commercial_ready: boolean;
    license_id?: string;
    expires_at?: number;
    message?: string;
}

const normalizeCameraName = (value: string): string =>
    value.toLowerCase().replace(/\s+/g, ' ').trim();

const normalizeSettingsLanguage = (value: string): string => {
    const normalized = value.toLowerCase();
    if (normalized.startsWith('zh-hant') || normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk')) return 'zh-Hant';
    if (normalized.startsWith('zh')) return 'zh';
    if (normalized.startsWith('ko')) return 'ko';
    if (normalized.startsWith('ja')) return 'ja';
    if (normalized.startsWith('tr')) return 'tr';
    return 'en';
};

// --- Components ---

const LanguageSettings = () => {
    const { i18n, t } = useTranslation();
    const [lang, setLang] = useState(() => normalizeSettingsLanguage(localStorage.getItem(LANGUAGE_KEY) || i18n.language || 'en'));

    useEffect(() => {
        const initialLang = normalizeSettingsLanguage(
            localStorage.getItem(LANGUAGE_KEY) ||
            i18n.language ||
            'en',
        );

        if (initialLang !== i18n.language) {
            i18n.changeLanguage(initialLang);
        }
        setLang(initialLang);
        localStorage.setItem(LANGUAGE_KEY, initialLang);
        invoke('set_current_language', { lang: initialLang }).catch(console.error);

    }, [i18n]);

    const handleChange = (value: string) => {
        i18n.changeLanguage(value);
        setLang(value);
        localStorage.setItem(LANGUAGE_KEY, value);
        invoke('set_current_language', { lang: value }).catch(console.error);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.languageTitle', '언어 설정')}</CardTitle>
            </CardHeader>
            <CardContent>
                <Select value={lang} onValueChange={handleChange}>
                    <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ko">{t('settings.languageKorean', '한국어')}</SelectItem>
                        <SelectItem value="en">{t('settings.languageEnglish', 'English')}</SelectItem>
                        <SelectItem value="ja">{t('settings.languageJapanese', '日本語')}</SelectItem>
                        <SelectItem value="zh">{t('settings.languageChinese', '简体中文')}</SelectItem>
                        <SelectItem value="zh-Hant">{t('settings.languageTraditional', '繁體中文')}</SelectItem>
                        <SelectItem value="tr">{t('settings.languageTurkish', 'Türkçe')}</SelectItem>
                    </SelectContent>
                </Select>
            </CardContent>
        </Card>
    );
};


const DetectionSettings = () => {
    const { t } = useTranslation();

    const [batterySavingMode, setBatterySavingMode] = useState(() => localStorage.getItem(BATTERY_SAVING_MODE_KEY) === 'true');
    const [frequency, setFrequency] = useState<string>(() => localStorage.getItem(NOTIFICATION_FREQUENCY_KEY) || '2');
    const [turtleNeckSensitivity, setTurtleNeckSensitivity] = useState<string>(() => localStorage.getItem(TURTLE_NECK_SENSITIVITY_KEY) || '2');
    const [shoulderSensitivity, setShoulderSensitivity] = useState<string>(() => localStorage.getItem(SHOULDER_SENSITIVITY_KEY) || '2');
    const [monitoringInterval, setMonitoringInterval] = useState<string>(() => localStorage.getItem(MONITORING_INTERVAL_KEY) || '3');

    useEffect(() => {
        invoke('set_battery_saving_mode', { mode: batterySavingMode }).catch(console.error);
    }, [batterySavingMode]);

    useEffect(() => {
        localStorage.setItem(NOTIFICATION_FREQUENCY_KEY, frequency);
        localStorage.setItem(TURTLE_NECK_SENSITIVITY_KEY, turtleNeckSensitivity);
        localStorage.setItem(SHOULDER_SENSITIVITY_KEY, shoulderSensitivity);
        localStorage.setItem(MONITORING_INTERVAL_KEY, monitoringInterval);

        invoke('set_detection_settings', {
            frequency: batterySavingMode ? 1 : parseInt(frequency, 10),
            turtleSensitivity: parseInt(turtleNeckSensitivity, 10),
            shoulderSensitivity: parseInt(shoulderSensitivity, 10),
        }).catch(console.error);

        if (batterySavingMode) {
            invoke('set_monitoring_interval', {
                intervalMins: parseInt(monitoringInterval, 10),
            }).catch(console.error);
        } else {
            invoke('set_monitoring_interval', {
                intervalSecs: parseInt(monitoringInterval, 10),
            }).catch(console.error);
        }

    }, [frequency, turtleNeckSensitivity, shoulderSensitivity, monitoringInterval, batterySavingMode]);

    const monitoringOptions = batterySavingMode ? [
        { value: '3', label: t('settings.interval3m', '3분') },
        { value: '5', label: t('settings.interval5m', '5분') },
        { value: '10', label: t('settings.interval10m', '10분') },
        { value: '15', label: t('settings.interval15m', '15분') },
        { value: '30', label: t('settings.interval30m', '30분') },
    ] : [
        { value: '3', label: t('settings.interval3s', '3초') },
        { value: '5', label: t('settings.interval5s', '5초') },
        { value: '7', label: t('settings.interval7s', '7초') },
        { value: '10', label: t('settings.interval10s', '10초') },
        { value: '15', label: t('settings.interval15s', '15초') },
    ];

    const handleBatterySavingToggle = (checked: boolean) => {
        setBatterySavingMode(checked);
        localStorage.setItem(BATTERY_SAVING_MODE_KEY, checked.toString());
        if (checked) {
            setFrequency('1');
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.detectionTitle', '감지 및 알림 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <span className="font-medium">{t('settings.batterySavingMode', '배터리 절약 모드')}</span>
                        <p className="text-sm text-muted-foreground">{t('settings.batterySavingModeDesc', '활성화 시 모니터링 주기를 분단위로 변경하고 카메라를 절약 모드로 운영합니다.')}</p>
                    </div>
                    <Switch checked={batterySavingMode} onCheckedChange={handleBatterySavingToggle} />
                </div>
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <span className="font-medium">{t('settings.monitoringInterval', '모니터링 주기')}</span>
                        <p className="text-sm text-muted-foreground">{t('settings.monitoringIntervalDesc', '자세를 분석하는 시간 간격을 설정합니다.')}</p>
                    </div>
                    <Select value={monitoringInterval} onValueChange={setMonitoringInterval}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {monitoringOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <span className="font-medium">{t('settings.notificationFrequency', '알림 빈도')}</span>
                        <p className="text-sm text-muted-foreground">{batterySavingMode ? t('settings.notificationFrequencyDescBatterySaving', '배터리 절약 모드에서는 1번으로 고정됩니다.') : t('settings.notificationFrequencyDescNormal', '최근 3번의 감지 중 몇 번 이상 나쁜 자세가 감지되면 알림을 받을지 설정합니다.')}</p>
                    </div>
                    <Select value={frequency} onValueChange={setFrequency} disabled={batterySavingMode}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">{t('settings.frequencyOnce', '1번 (민감)')}</SelectItem>
                            <SelectItem value="2">{t('settings.frequencyTwice', '2번 (보통)')}</SelectItem>
                            <SelectItem value="3">{t('settings.frequencyThrice', '3번 (둔감)')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <span className="font-medium">{t('settings.turtleNeckSensitivity', '거북목 감지 강도')}</span>
                        <p className="text-sm text-muted-foreground">{t('settings.turtleNeckSensitivityDesc', '거북목 자세를 얼마나 엄격하게 감지할지 설정합니다.')}</p>
                    </div>
                    <Select value={turtleNeckSensitivity} onValueChange={setTurtleNeckSensitivity}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">{t('settings.sensitivityLoose', '느슨하게')}</SelectItem>
                            <SelectItem value="2">{t('settings.sensitivityNormal', '보통')}</SelectItem>
                            <SelectItem value="3">{t('settings.sensitivityStrict', '엄격하게')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <span className="font-medium">{t('settings.shoulderSensitivity', '어깨 정렬 감지 강도')}</span>
                        <p className="text-sm text-muted-foreground">{t('settings.shoulderSensitivityDesc', '어깨 비대칭을 얼마나 엄격하게 감지할지 설정합니다.')}</p>
                    </div>
                    <Select value={shoulderSensitivity} onValueChange={setShoulderSensitivity}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">{t('settings.sensitivityLoose', '느슨하게')}</SelectItem>
                            <SelectItem value="2">{t('settings.sensitivityNormal', '보통')}</SelectItem>
                            <SelectItem value="3">{t('settings.sensitivityStrict', '엄격하게')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
    );
};

const CameraSettings = () => {
    const { t } = useTranslation();
    const [cameras, setCameras] = useState<CameraDetail[]>([]);
    const [selectedCameraIndex, setSelectedCameraIndex] = useState<string>(
        () => localStorage.getItem(CAMERA_INDEX_KEY) || '0'
    );

    const syncPreviewCameraDevice = useCallback(async (cameraName: string, fallbackIndex: number) => {
        if (!navigator.mediaDevices?.enumerateDevices) {
            return;
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices.filter((device) => device.kind === 'videoinput');

            if (videoInputs.length === 0) {
                return;
            }

            const normalizedTarget = normalizeCameraName(cameraName);
            const matchedByName = normalizedTarget
                ? videoInputs.find((device) => {
                    const normalizedLabel = normalizeCameraName(device.label);
                    return normalizedLabel.length > 0 && (
                        normalizedLabel.includes(normalizedTarget)
                        || normalizedTarget.includes(normalizedLabel)
                    );
                })
                : undefined;

            const matchedByIndex = Number.isInteger(fallbackIndex)
                && fallbackIndex >= 0
                && fallbackIndex < videoInputs.length
                ? videoInputs[fallbackIndex]
                : videoInputs[0];

            const resolvedDeviceId = (matchedByName ?? matchedByIndex)?.deviceId;
            if (resolvedDeviceId) {
                localStorage.setItem(LEGACY_CAMERA_DEVICE_KEY, resolvedDeviceId);
            }
        } catch (error) {
            console.error('Failed to sync preview camera device:', error);
        }
    }, []);

    useEffect(() => {
        const getCamerasFromBackend = async () => {
            try {
                const availableCameras = await invoke<CameraDetail[]>('get_available_cameras');
                setCameras(availableCameras);

                const savedIndex = localStorage.getItem(CAMERA_INDEX_KEY) || '0';
                const hasSavedCamera = availableCameras.some((cam) => cam.index.toString() === savedIndex);
                const resolvedIndex = hasSavedCamera
                    ? savedIndex
                    : availableCameras.length > 0
                        ? availableCameras[0].index.toString()
                        : '0';

                setSelectedCameraIndex(resolvedIndex);
                localStorage.setItem(CAMERA_INDEX_KEY, resolvedIndex);

                const selectedCamera = availableCameras.find((cam) => cam.index.toString() === resolvedIndex);
                if (selectedCamera) {
                    localStorage.setItem(CAMERA_NAME_KEY, selectedCamera.name);
                    await syncPreviewCameraDevice(selectedCamera.name, selectedCamera.index);
                }

            } catch (error) {
                console.error(t('settings.cameraErrorGetList', 'Failed to fetch camera list from backend:'), error);
            }
        };

        getCamerasFromBackend();
    }, [syncPreviewCameraDevice, t]);

    const handleCameraChange = (value: string) => {
        const newIndex = parseInt(value, 10);
        setSelectedCameraIndex(value);
        localStorage.setItem(CAMERA_INDEX_KEY, value);

        const selectedCamera = cameras.find((camera) => camera.index === newIndex);
        if (selectedCamera) {
            localStorage.setItem(CAMERA_NAME_KEY, selectedCamera.name);
            void syncPreviewCameraDevice(selectedCamera.name, selectedCamera.index);
        }

        invoke('set_selected_camera', { index: newIndex })
            .catch(e => console.error(t('settings.cameraErrorSetSelected', 'Failed to set selected camera in backend:'), e));
    };

    const openCameraSettings = async () => {
        try {
            const osPlatform = await platform();
            if (osPlatform === 'macos') {
                await Command.create('open-settings', ["x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"]).execute();
            } else if (osPlatform === 'windows') {
                await open('ms-settings:privacy-webcam');
            } else if (osPlatform === 'linux') {
                alert(
                    t(
                        'settings.cameraPermissionLinux',
                        'Linux may not provide a direct camera permission window for this app. Close other apps using the webcam, restart Pose Nudge, and re-select the camera. If you use Flatpak or Snap, also verify portal/sandbox camera permissions.'
                    )
                );
            } else {
                alert(t('settings.cameraPermissionDirect', '시스템 설정 > 개인 정보 보호 및 보안 > 카메라에서 앱 권한을 직접 허용해주세요.'));
            }
        } catch (error) {
            console.error(t('settings.settingsErrorOpen', 'Failed to open settings window:'), error);
            alert(t('settings.cameraPermissionManual', '설정 창을 열 수 없습니다. 수동으로 시스템 설정 > 개인 정보 보호 및 보안 > 카메라로 이동하여 권한을 확인해주세요.'));
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.cameraTitle', '카메라 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="p-4 bg-blue-50 border-l-4 border-blue-400 text-blue-800 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-200">
                    <p>{t('settings.cameraGuide', '카메라가 작동하지 않는 경우, 아래 버튼을 클릭하여 시스템 설정에서 앱의 카메라 접근 권한을 허용해주세요.')}</p>
                    <Button onClick={openCameraSettings} className="mt-2">
                        {t('settings.cameraGoTo', '카메라 설정으로 이동')}
                    </Button>
                </div>

                <div className="flex items-center justify-between">
                    <span className="font-medium">{t('settings.cameraSelect', '분석에 사용할 카메라')}</span>
                    <Select value={selectedCameraIndex} onValueChange={handleCameraChange} disabled={cameras.length === 0}>
                        <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder={cameras.length === 0 ? t('settings.cameraNone', '사용 가능한 카메라 없음') : t('settings.cameraSelectPlaceholder', '카메라를 선택하세요')} />
                        </SelectTrigger>
                        <SelectContent>
                            {cameras.map((camera) => (
                                <SelectItem key={camera.index} value={camera.index.toString()}>
                                    {camera.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
    );
};


const UpdateSettings = () => {
    const { t } = useTranslation();
    const [isChecking, setIsChecking] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isInstalling, setIsInstalling] = useState(false);
    const [progress, setProgress] = useState(0);
    const [updateInfo, setUpdateInfo] = useState<{ version: string; date: string } | null>(null);
    const [installed, setInstalled] = useState(false);

    const checkForUpdates = async () => {
        try {
            setIsChecking(true);
            setProgress(0);
            setUpdateInfo(null);
            setInstalled(false);

            const update = await check();

            if (update) {
                setUpdateInfo({ version: update.version || '', date: update.date || '' });
                setIsChecking(false);
                setIsDownloading(true);

                let downloaded = 0;
                let contentLength = 0;

                await update.downloadAndInstall((event) => {
                    switch (event.event) {
                        case 'Started': {
                            contentLength = event.data.contentLength || 0;
                            console.log(`started downloading ${event.data.contentLength} bytes`);
                            break;
                        }
                        case 'Progress': {
                            downloaded += event.data.chunkLength;
                            const currentProgress = contentLength > 0 ? (downloaded / contentLength) * 100 : 0;
                            setProgress(Math.round(currentProgress));
                            console.log(`downloaded ${downloaded} from ${contentLength}`);
                            break;
                        }
                        case 'Finished': {
                            console.log('download finished');
                            setIsDownloading(false);
                            setIsInstalling(true);
                            break;
                        }
                    }
                });

                setIsInstalling(false);
                setInstalled(true);
            } else {
                setIsChecking(false);
            }
        } catch (error) {
            console.error(t('settings.updateErrorCheck', 'Update check failed:'), error);
            setIsChecking(false);
            setIsDownloading(false);
            setIsInstalling(false);
        }
    };

    const handleRestart = async () => {
        try {
            await invoke('restart_app');
        } catch (error) {
            console.error(t('settings.appErrorRestart', 'Failed to restart app:'), error);
            alert(t('settings.appRestartManual', '앱을 수동으로 재시작해주세요.'));
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.updateTitle', '업데이트 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="p-4 bg-green-50 border-l-4 border-green-400 text-green-800 dark:bg-green-900 dark:border-green-600 dark:text-green-200">
                    <p>{t('settings.updateGuide', '새로운 버전이 있는지 확인하고 자동으로 업데이트를 설치합니다.')}</p>
                    <Button
                        onClick={checkForUpdates}
                        disabled={isChecking || isDownloading || isInstalling}
                        className="mt-2"
                    >
                        {isChecking ? t('settings.checkingUpdate', '업데이트 확인 중...') : t('settings.checkUpdate', '업데이트 확인')}
                    </Button>

                    {updateInfo && (
                        <p className="mt-2 text-sm">
                            {t('settings.updateFound', '업데이트 발견: {{version}} ({{date}})', { version: updateInfo.version, date: updateInfo.date })}
                        </p>
                    )}

                    {isDownloading && (
                        <div className="mt-4">
                            <p className="text-sm mb-2">{t('settings.updateDownloading', '다운로드 중... {{progress}}%', { progress })}</p>
                            <Progress value={progress} className="w-full" />
                        </div>
                    )}

                    {isInstalling && (
                        <p className="mt-2 text-sm">{t('settings.updateInstalling', '설치 중...')}</p>
                    )}

                    {installed && (
                        <div className="mt-4">
                            <p className="text-sm text-green-700 dark:text-green-300 mb-2">
                                {t('settings.updateInstalled', '업데이트 설치 완료. 앱을 재시작해주세요.')}
                            </p>
                            <Button onClick={handleRestart} variant="outline">
                                {t('settings.restartApp', '앱 재시작')}
                            </Button>
                        </div>
                    )}

                    {!isChecking && !isDownloading && !isInstalling && !installed && !updateInfo && (
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                            {t('settings.upToDate', '최신 버전입니다.')}
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

const ThemeSettings = () => {
    const { t } = useTranslation();
    const { theme, setTheme } = useTheme();

    const handleThemeChange = (value: string) => {
        setTheme(value);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.themeTitle', '테마 설정')}</CardTitle>
            </CardHeader>
            <CardContent>
                <Select value={theme} onValueChange={handleThemeChange}>
                    <SelectTrigger className="w-[250px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="light">{t('settings.themeLight', '밝은 테마')}</SelectItem>
                        <SelectItem value="dark">{t('settings.themeDark', '어두운 테마')}</SelectItem>
                        <SelectItem value="system">{t('settings.themeSystem', '시스템 설정')}</SelectItem>
                    </SelectContent>
                </Select>
            </CardContent>
        </Card>
    );
};

const NotificationSettings = () => {
    const { t } = useTranslation();
    const [preferences, setPreferences] = useState<ReminderPreferences>(loadReminderPreferences);
    const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
    const [testStatus, setTestStatus] = useState('');
    const [proEnabled, setProEnabled] = useState(true);

    const refreshPermission = useCallback(async () => {
        try {
            setPermission(await isPermissionGranted() ? 'granted' : 'prompt');
        } catch (error) {
            console.error('Failed to read notification permission:', error);
            setPermission('prompt');
        }
    }, []);

    useEffect(() => {
        void refreshPermission();
        invoke<LicenseStatus>('get_license_status')
            .then((status) => setProEnabled(status.active || !status.commercial_ready))
            .catch(console.error);
    }, [refreshPermission]);

    useEffect(() => {
        saveReminderPreferences(preferences);
        invoke<ReminderPreferences>('set_reminder_preferences', { preferences })
            .then((normalized) => {
                if (JSON.stringify(normalized) !== JSON.stringify(preferences)) {
                    setPreferences(normalized);
                    saveReminderPreferences(normalized);
                }
            })
            .catch(console.error);
    }, [preferences]);

    const setChannel = (key: keyof ReminderPreferences, enabled: boolean) => {
        setPreferences((current) => ({ ...current, [key]: enabled }));
    };

    const requestNotificationPermission = async () => {
        try {
            const result = await requestPermission();
            setPermission(result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'prompt');
        } catch (error) {
            console.error('Failed to request notification permission:', error);
            setPermission('denied');
        }
    };

    const sendTestReminder = async () => {
        setTestStatus('');
        if (preferences.native_notification && permission !== 'granted') {
            await requestNotificationPermission();
        }
        try {
            await invoke('send_test_reminder');
            setTestStatus(t('settings.notificationTestSent', '测试提醒已发送。若系统通知未出现，顶部悬浮提醒仍应可见。'));
        } catch (error) {
            console.error('Failed to send test reminder:', error);
            setTestStatus(t('settings.notificationTestFailed', '测试提醒发送失败，请检查日志。'));
        }
    };

    const openNotificationSettings = async () => {
        try {
            const osPlatform = await platform();
            if (osPlatform === 'macos') {
                await Command.create('open-settings', ["x-apple.systempreferences:com.apple.preference.notifications"]).execute();
            } else if (osPlatform === 'windows') {
                await open('ms-settings:notifications');
            } else {
                alert(t('settings.notificationPermissionDirect', '시스템 설정 > 알림에서 앱의 알림 권한을 직접 허용해주세요.'));
            }
        } catch (error) {
            console.error(t('settings.notificationErrorOpen', 'Failed to open notification settings:'), error);
            alert(t('settings.notificationPermissionManual', '설정 창을 열 수 없습니다. 수동으로 시스템 설정 > 알림으로 이동하여 권한을 확인해주세요.'));
        }
    };

    return (
        <Card className="overflow-hidden border-[#2f7d66]/20">
            <CardHeader>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <CardTitle>{t('settings.notificationTitle', '可靠提醒')}</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {t('settings.notificationSubtitle', '选择一种或多种提醒方式。悬浮提醒不会依赖系统通知横幅。')}
                        </p>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-xs font-semibold ${permission === 'granted' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                        {permission === 'granted'
                            ? t('settings.notificationGranted', '系统通知已授权')
                            : t('settings.notificationNotGranted', '系统通知未授权')}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-3">
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40">
                        <Bell className="mt-0.5 h-5 w-5 text-[#2f7d66]" />
                        <span className="min-w-0 flex-1">
                            <span className="block font-semibold">{t('settings.channelNative', '系统通知')}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{t('settings.channelNativeDesc', '遵循 macOS / Windows 的通知设置。')}</span>
                        </span>
                        <Switch checked={preferences.native_notification} onCheckedChange={(checked) => setChannel('native_notification', checked)} />
                    </label>

                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#2f7d66]/30 bg-[#edf5f1] p-4 text-[#14231f] transition-colors hover:bg-[#e4f0ea] dark:bg-[#17372f] dark:text-white">
                        <MonitorUp className="mt-0.5 h-5 w-5 text-[#2f7d66] dark:text-[#7bc4aa]" />
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 font-semibold">
                                {t('settings.channelFloating', '顶部悬浮提醒')}
                                <span className="rounded-full bg-[#2f7d66] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white">Free</span>
                            </span>
                            <span className="mt-1 block text-xs opacity-70">{t('settings.channelFloatingDesc', '系统通知关闭时也能看见。')}</span>
                        </span>
                        <Switch checked={preferences.floating_window} onCheckedChange={(checked) => setChannel('floating_window', checked)} />
                    </label>

                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40">
                        <Moon className="mt-0.5 h-5 w-5 text-[#d9654b]" />
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 font-semibold">
                                {t('settings.channelDim', '屏幕柔和变暗')}
                                <span className="rounded-full bg-[#14231f] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white">Pro</span>
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">{t('settings.channelDimDesc', '用视觉场变化提醒，不打断输入。')}</span>
                        </span>
                        <Switch
                            checked={preferences.screen_dim}
                            disabled={!proEnabled}
                            onCheckedChange={(checked) => setChannel('screen_dim', checked)}
                        />
                    </label>
                </div>

                <div className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <Volume2 className="h-5 w-5 text-muted-foreground" />
                        <div>
                            <p className="font-medium">{t('settings.channelSound', '提醒声音')}</p>
                            <p className="text-xs text-muted-foreground">{t('settings.channelSoundDesc', '仅在发送系统通知时播放。')}</p>
                        </div>
                        <Switch checked={preferences.sound} onCheckedChange={(checked) => setChannel('sound', checked)} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {permission !== 'granted' && (
                            <Button onClick={requestNotificationPermission} variant="outline">
                                {t('settings.notificationRequest', '申请通知权限')}
                            </Button>
                        )}
                        <Button onClick={sendTestReminder} className="bg-[#2f7d66] text-white hover:bg-[#276b58]">
                            {t('settings.notificationTest', '发送测试提醒')}
                        </Button>
                        <Button onClick={openNotificationSettings} variant="ghost">
                            {t('settings.notificationGoTo', '打开系统设置')}
                        </Button>
                    </div>
                </div>

                {testStatus && (
                    <p className="flex items-center gap-2 text-sm text-[#2f7d66]" role="status">
                        <CheckCircle2 className="h-4 w-4" />
                        {testStatus}
                    </p>
                )}
            </CardContent>
        </Card>
    );
};

const LicenseSettings = () => {
    const { t } = useTranslation();
    const [status, setStatus] = useState<LicenseStatus | null>(null);
    const [licenseKey, setLicenseKey] = useState('');
    const [activationStatus, setActivationStatus] = useState('');
    const [activating, setActivating] = useState(false);
    const purchaseUrl = 'https://01mvp.com/products/oneposture-pro';

    const activationErrorMessage = (error: unknown) => {
        const code = String(error);
        if (code.includes('INVALID_LICENSE')) return t('settings.activationInvalid', '激活码无效或尚未完成交付。');
        if (code.includes('DEVICE_LIMIT_REACHED')) return t('settings.activationDeviceLimit', '此激活码的设备名额已用完。');
        if (code.includes('TOO_MANY_REQUESTS')) return t('settings.activationRateLimited', '请求过于频繁，请稍后再试。');
        if (code.includes('ACTIVATION_UNAVAILABLE')) return t('settings.activationUnavailable', '激活服务暂不可用，请稍后再试。');
        if (code.includes('NETWORK_ERROR')) return t('settings.activationNetwork', '无法连接激活服务，请检查网络。');
        return t('settings.activationFailed', '激活失败，请检查激活码后重试。');
    };

    useEffect(() => {
        invoke<LicenseStatus>('get_license_status')
            .then(setStatus)
            .catch((error) => setActivationStatus(String(error)));
    }, []);

    const activate = async () => {
        if (!licenseKey.trim()) return;
        setActivating(true);
        setActivationStatus('');
        try {
            const nextStatus = await invoke<LicenseStatus>('activate_license', { licenseKey });
            setStatus(nextStatus);
            setLicenseKey('');
            setActivationStatus(t('settings.activationSuccess', 'OnePosture Pro 已激活，可离线使用。'));
        } catch (error) {
            setActivationStatus(activationErrorMessage(error));
        } finally {
            setActivating(false);
        }
    };

    return (
        <Card className="overflow-hidden border-[#14231f]/15">
            <div className="h-1.5 bg-gradient-to-r from-[#2f7d66] via-[#e5a84b] to-[#d9654b]" />
            <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-[#e5a84b]" />
                            OnePosture Pro
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {t('settings.proSubtitle', '一次买断，解锁屏幕柔和变暗提醒；最多可激活 3 台设备。')}
                        </p>
                    </div>
                    <div className="text-left sm:text-right">
                        <p className="text-2xl font-bold text-[#14231f] dark:text-white">¥39</p>
                        <p className="text-xs text-muted-foreground">中国 · 永久 / 海外 US$4.99</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                    <p className="rounded-lg bg-muted/50 px-3 py-2">{t('settings.proFeatureDim', '屏幕柔和变暗')}</p>
                    <p className="rounded-lg bg-muted/50 px-3 py-2">{t('settings.proFeatureOffline', '激活后永久离线使用')}</p>
                    <p className="rounded-lg bg-muted/50 px-3 py-2">{t('settings.proFeatureDevices', '最多 3 台设备')}</p>
                </div>

                {status?.active ? (
                    <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        <CheckCircle2 className="h-5 w-5" />
                        {t('settings.proActive', 'Pro 已激活')}
                    </p>
                ) : status?.commercial_ready ? (
                    <div className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <div className="relative flex-1">
                                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    value={licenseKey}
                                    onChange={(event) => setLicenseKey(event.target.value)}
                                    placeholder={t('settings.licensePlaceholder', '输入购买后收到的激活码')}
                                    className="h-10 w-full rounded-md border bg-background pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-[#2f7d66]"
                                />
                            </div>
                            <Button onClick={activate} disabled={activating || !licenseKey.trim()}>
                                {activating ? t('settings.activating', '激活中…') : t('settings.activate', '激活 Pro')}
                            </Button>
                            <Button onClick={() => void open(purchaseUrl)} variant="outline">
                                {t('settings.buyPro', '购买激活码')}
                            </Button>
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">
                            {t('settings.activationGuide', '购买后，激活码会显示在 01MVP 订单页并发送到邮箱。首次激活需要联网，成功后可永久离线使用。')}
                        </p>
                    </div>
                ) : (
                    <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                        {t('settings.commercePreview', '这个构建未配置 01MVP 激活服务，Pro 功能暂不可购买或激活。')}
                    </p>
                )}

                {activationStatus && <p className="text-sm text-muted-foreground" role="status">{activationStatus}</p>}
            </CardContent>
        </Card>
    );
};

const SettingsPage = () => {
    return (
        <div className="space-y-6 p-4 md:p-6">
            <LanguageSettings />
            <ThemeSettings />
            <DetectionSettings />
            <CameraSettings />
            <NotificationSettings />
            <LicenseSettings />
            <UpdateSettings />
        </div>
    );
};

export default SettingsPage;
