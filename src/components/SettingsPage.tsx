import { useState, useEffect, useCallback } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Command, open } from '@tauri-apps/plugin-shell';
import { platform } from '@tauri-apps/plugin-os';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { useTheme } from 'next-themes';
import { isPermissionGranted } from '@tauri-apps/plugin-notification';
import {
    BadgeCheck,
    Bell,
    BellRing,
    CheckCircle2,
    Gauge,
    KeyRound,
    MonitorUp,
    Moon,
    Settings2,
    Sparkles,
    Volume2,
} from 'lucide-react';
import {
    loadReminderPreferences,
    saveReminderPreferences,
    type ReminderPreferences,
} from '@/lib/reminders';
import {
    appPreferences,
    normalizeAppLanguage,
    resolvePreferredVideoDevice,
    type AppLanguage,
} from '@/lib/preferences';
import { requestReminderPermission } from '@/lib/monitoring';

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

const LanguageSettings = () => {
    const { i18n, t } = useTranslation();
    const [lang, setLang] = useState<AppLanguage>(() => appPreferences.readLanguage(i18n.language));

    useEffect(() => {
        const initialLang = appPreferences.readLanguage(i18n.language);

        if (initialLang !== i18n.language) {
            void i18n.changeLanguage(initialLang);
        }
        setLang(initialLang);
        appPreferences.writeLanguage(initialLang);
        invoke('set_current_language', { lang: initialLang }).catch(console.error);
    }, [i18n]);

    const handleChange = (value: string) => {
        const language = normalizeAppLanguage(value);
        void i18n.changeLanguage(language);
        setLang(language);
        appPreferences.writeLanguage(language);
        invoke('set_current_language', { lang: language }).catch(console.error);
    };

    return (
        <section className="settings-card">
            <header className="settings-card-header">
                <h3>{t('settings.languageTitle')}</h3>
            </header>
            <div className="settings-card-content">
                <Select value={lang} onValueChange={handleChange}>
                    <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ko">{t('settings.languageKorean')}</SelectItem>
                        <SelectItem value="en">{t('settings.languageEnglish', 'English')}</SelectItem>
                        <SelectItem value="ja">{t('settings.languageJapanese', '日本語')}</SelectItem>
                        <SelectItem value="zh">{t('settings.languageChinese', '简体中文')}</SelectItem>
                        <SelectItem value="zh-Hant">{t('settings.languageTraditional', '繁體中文')}</SelectItem>
                        <SelectItem value="tr">{t('settings.languageTurkish', 'Türkçe')}</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </section>
    );
};


const DetectionSettings = () => {
    const { t } = useTranslation();

    const [batterySavingMode, setBatterySavingMode] = useState(() => appPreferences.readDetection().batterySavingMode);
    const [frequency, setFrequency] = useState<string>(() => String(appPreferences.readDetection().notificationFrequency));
    const [turtleNeckSensitivity, setTurtleNeckSensitivity] = useState<string>(() => String(appPreferences.readDetection().turtleNeckSensitivity));
    const [shoulderSensitivity, setShoulderSensitivity] = useState<string>(() => String(appPreferences.readDetection().shoulderSensitivity));
    const [monitoringInterval, setMonitoringInterval] = useState<string>(() => String(appPreferences.readDetection().monitoringInterval));

    useEffect(() => {
        invoke('set_battery_saving_mode', { mode: batterySavingMode }).catch(console.error);
    }, [batterySavingMode]);

    useEffect(() => {
        appPreferences.writeDetection({
            batterySavingMode,
            notificationFrequency: Number.parseInt(frequency, 10),
            turtleNeckSensitivity: Number.parseInt(turtleNeckSensitivity, 10),
            shoulderSensitivity: Number.parseInt(shoulderSensitivity, 10),
            monitoringInterval: Number.parseInt(monitoringInterval, 10),
        });

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
        { value: '3', label: t('settings.interval3m') },
        { value: '5', label: t('settings.interval5m') },
        { value: '10', label: t('settings.interval10m') },
        { value: '15', label: t('settings.interval15m') },
        { value: '30', label: t('settings.interval30m') },
    ] : [
        { value: '3', label: t('settings.interval3s') },
        { value: '5', label: t('settings.interval5s') },
        { value: '7', label: t('settings.interval7s') },
        { value: '10', label: t('settings.interval10s') },
        { value: '15', label: t('settings.interval15s') },
    ];

    const handleBatterySavingToggle = (checked: boolean) => {
        setBatterySavingMode(checked);
        if (checked) {
            setFrequency('1');
        }
    };

    return (
        <section className="settings-card">
            <header className="settings-card-header">
                <h3>{t('settings.detectionTitle')}</h3>
            </header>
            <div className="settings-card-content space-y-6">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <span className="font-medium">{t('settings.batterySavingMode')}</span>
                        <p className="text-sm text-muted-foreground">{t('settings.batterySavingModeDesc')}</p>
                    </div>
                    <Switch checked={batterySavingMode} onCheckedChange={handleBatterySavingToggle} />
                </div>
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <span className="font-medium">{t('settings.monitoringInterval')}</span>
                        <p className="text-sm text-muted-foreground">{t('settings.monitoringIntervalDesc')}</p>
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
                        <span className="font-medium">{t('settings.notificationFrequency')}</span>
                        <p className="text-sm text-muted-foreground">{batterySavingMode ? t('settings.notificationFrequencyDescBatterySaving') : t('settings.notificationFrequencyDescNormal')}</p>
                    </div>
                    <Select value={frequency} onValueChange={setFrequency} disabled={batterySavingMode}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">{t('settings.frequencyOnce')}</SelectItem>
                            <SelectItem value="2">{t('settings.frequencyTwice')}</SelectItem>
                            <SelectItem value="3">{t('settings.frequencyThrice')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <span className="font-medium">{t('settings.turtleNeckSensitivity')}</span>
                        <p className="text-sm text-muted-foreground">{t('settings.turtleNeckSensitivityDesc')}</p>
                    </div>
                    <Select value={turtleNeckSensitivity} onValueChange={setTurtleNeckSensitivity}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">{t('settings.sensitivityLoose')}</SelectItem>
                            <SelectItem value="2">{t('settings.sensitivityNormal')}</SelectItem>
                            <SelectItem value="3">{t('settings.sensitivityStrict')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <span className="font-medium">{t('settings.shoulderSensitivity')}</span>
                        <p className="text-sm text-muted-foreground">{t('settings.shoulderSensitivityDesc')}</p>
                    </div>
                    <Select value={shoulderSensitivity} onValueChange={setShoulderSensitivity}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">{t('settings.sensitivityLoose')}</SelectItem>
                            <SelectItem value="2">{t('settings.sensitivityNormal')}</SelectItem>
                            <SelectItem value="3">{t('settings.sensitivityStrict')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </section>
    );
};

const CameraSettings = () => {
    const { t } = useTranslation();
    const [cameras, setCameras] = useState<CameraDetail[]>([]);
    const [selectedCameraIndex, setSelectedCameraIndex] = useState<string>(
        () => String(appPreferences.readCamera().index)
    );

    const syncPreviewCameraDevice = useCallback(async (cameraName: string, fallbackIndex: number) => {
        if (!navigator.mediaDevices?.enumerateDevices) {
            return;
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const resolvedDeviceId = resolvePreferredVideoDevice(devices, {
                index: fallbackIndex,
                name: cameraName,
                deviceId: appPreferences.readCamera().deviceId,
            })?.deviceId;
            if (resolvedDeviceId) {
                appPreferences.writeCamera({ deviceId: resolvedDeviceId });
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

                const savedIndex = String(appPreferences.readCamera().index);
                const hasSavedCamera = availableCameras.some((cam) => cam.index.toString() === savedIndex);
                const resolvedIndex = hasSavedCamera
                    ? savedIndex
                    : availableCameras.length > 0
                        ? availableCameras[0].index.toString()
                        : '0';

                setSelectedCameraIndex(resolvedIndex);
                appPreferences.writeCamera({ index: Number.parseInt(resolvedIndex, 10) });

                const selectedCamera = availableCameras.find((cam) => cam.index.toString() === resolvedIndex);
                if (selectedCamera) {
                    appPreferences.writeCamera({ name: selectedCamera.name });
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
        appPreferences.writeCamera({ index: newIndex });

        const selectedCamera = cameras.find((camera) => camera.index === newIndex);
        if (selectedCamera) {
            appPreferences.writeCamera({ name: selectedCamera.name });
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
                        'settings.cameraPermissionLinux'
                    )
                );
            } else {
                alert(t('settings.cameraPermissionDirect'));
            }
        } catch (error) {
            console.error(t('settings.settingsErrorOpen', 'Failed to open settings window:'), error);
            alert(t('settings.cameraPermissionManual'));
        }
    };

    return (
        <section className="settings-card">
            <header className="settings-card-header">
                <h3>{t('settings.cameraTitle')}</h3>
            </header>
            <div className="settings-card-content space-y-4">
                <div className="settings-callout">
                    <p>{t('settings.cameraGuide')}</p>
                    <button type="button" onClick={openCameraSettings} className="settings-action is-primary mt-2">
                        {t('settings.cameraGoTo')}
                    </button>
                </div>

                <div className="flex items-center justify-between">
                    <span className="font-medium">{t('settings.cameraSelect')}</span>
                    <Select value={selectedCameraIndex} onValueChange={handleCameraChange} disabled={cameras.length === 0}>
                        <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder={cameras.length === 0 ? t('settings.cameraNone') : t('settings.cameraSelectPlaceholder')} />
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
            </div>
        </section>
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
            alert(t('settings.appRestartManual'));
        }
    };

    return (
        <section className="settings-card">
            <header className="settings-card-header">
                <h3>{t('settings.updateTitle')}</h3>
            </header>
            <div className="settings-card-content space-y-4">
                <div className="settings-callout">
                    <p>{t('settings.updateGuide')}</p>
                    <button
                        type="button"
                        onClick={checkForUpdates}
                        disabled={isChecking || isDownloading || isInstalling}
                        className="settings-action is-primary mt-2"
                    >
                        {isChecking ? t('settings.checkingUpdate') : t('settings.checkUpdate')}
                    </button>

                    {updateInfo && (
                        <p className="mt-2 text-sm">
                            {t('settings.updateFound', { version: updateInfo.version, date: updateInfo.date })}
                        </p>
                    )}

                    {isDownloading && (
                        <div className="mt-4">
                            <p className="text-sm mb-2">{t('settings.updateDownloading', { progress })}</p>
                            <Progress value={progress} className="w-full" />
                        </div>
                    )}

                    {isInstalling && (
                        <p className="mt-2 text-sm">{t('settings.updateInstalling')}</p>
                    )}

                    {installed && (
                        <div className="mt-4">
                            <p className="text-sm text-green-700 dark:text-green-300 mb-2">
                                {t('settings.updateInstalled')}
                            </p>
                            <button type="button" onClick={handleRestart} className="settings-action is-secondary">
                                {t('settings.restartApp')}
                            </button>
                        </div>
                    )}

                    {!isChecking && !isDownloading && !isInstalling && !installed && !updateInfo && (
                        <p className="mt-2 text-sm text-muted-foreground">
                            {t('settings.upToDate')}
                        </p>
                    )}
                </div>
            </div>
        </section>
    );
};

const ThemeSettings = () => {
    const { t } = useTranslation();
    const { theme, setTheme } = useTheme();

    const handleThemeChange = (value: string) => {
        setTheme(value);
    };

    return (
        <section className="settings-card">
            <header className="settings-card-header">
                <h3>{t('settings.themeTitle')}</h3>
            </header>
            <div className="settings-card-content">
                <Select value={theme} onValueChange={handleThemeChange}>
                    <SelectTrigger className="w-[250px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="light">{t('settings.themeLight')}</SelectItem>
                        <SelectItem value="dark">{t('settings.themeDark')}</SelectItem>
                        <SelectItem value="system">{t('settings.themeSystem')}</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </section>
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
        setPermission(await requestReminderPermission(true) ? 'granted' : 'denied');
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
                alert(t('settings.notificationPermissionDirect'));
            }
        } catch (error) {
            console.error(t('settings.notificationErrorOpen', 'Failed to open notification settings:'), error);
            alert(t('settings.notificationPermissionManual'));
        }
    };

    return (
        <section className="settings-card settings-reminder-card">
            <header className="settings-card-header">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3>{t('settings.notificationTitle', '可靠提醒')}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {t('settings.notificationSubtitle', '选择一种或多种提醒方式。悬浮提醒不会依赖系统通知横幅。')}
                        </p>
                    </div>
                    <div className={`settings-permission-pill ${permission === 'granted' ? 'is-granted' : 'is-pending'}`}>
                        {permission === 'granted'
                            ? t('settings.notificationGranted', '系统通知已授权')
                            : t('settings.notificationNotGranted', '系统通知未授权')}
                    </div>
                </div>
            </header>
            <div className="settings-card-content space-y-5">
                <div className="grid gap-3 md:grid-cols-3">
                    <label className="settings-channel-option">
                        <Bell className="mt-0.5 h-5 w-5 text-[var(--brand)]" />
                        <span className="min-w-0 flex-1">
                            <span className="block font-semibold">{t('settings.channelNative', '系统通知')}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{t('settings.channelNativeDesc', '遵循 macOS / Windows 的通知设置。')}</span>
                        </span>
                        <Switch checked={preferences.native_notification} onCheckedChange={(checked) => setChannel('native_notification', checked)} />
                    </label>

                    <label className="settings-channel-option is-highlighted">
                        <MonitorUp className="mt-0.5 h-5 w-5 text-[var(--brand)]" />
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 font-semibold">
                                {t('settings.channelFloating', '顶部悬浮提醒')}
                                <span className="settings-tier-badge">{t('settings.freeLabel', '免费')}</span>
                            </span>
                            <span className="mt-1 block text-xs opacity-70">{t('settings.channelFloatingDesc', '系统通知关闭时也能看见。')}</span>
                        </span>
                        <Switch checked={preferences.floating_window} onCheckedChange={(checked) => setChannel('floating_window', checked)} />
                    </label>

                    <label className="settings-channel-option">
                        <Moon className="mt-0.5 h-5 w-5 text-[var(--accent-warm)]" />
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 font-semibold">
                                {t('settings.channelDim', '屏幕柔和变暗')}
                                <span className="settings-tier-badge is-pro">{t('settings.proLabel', '进阶版')}</span>
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
                            <button type="button" onClick={requestNotificationPermission} className="settings-action is-secondary">
                                {t('settings.notificationRequest', '申请通知权限')}
                            </button>
                        )}
                        <button type="button" onClick={sendTestReminder} className="settings-action is-primary">
                            {t('settings.notificationTest', '发送测试提醒')}
                        </button>
                        <button type="button" onClick={openNotificationSettings} className="settings-action is-quiet">
                            {t('settings.notificationGoTo', '打开系统设置')}
                        </button>
                    </div>
                </div>

                {testStatus && (
                    <p className="flex items-center gap-2 text-sm text-[var(--brand)]" role="status">
                        <CheckCircle2 className="h-4 w-4" />
                        {testStatus}
                    </p>
                )}
            </div>
        </section>
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
        <section className="settings-card settings-license-card">
            <div className="settings-license-accent" />
            <header className="settings-card-header">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h3 className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-[var(--accent-gold)]" />
                            OnePosture Pro
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {t('settings.proSubtitle', '一次买断，解锁屏幕柔和变暗提醒；最多可激活 3 台设备。')}
                        </p>
                    </div>
                    <div className="text-left sm:text-right">
                        <p className="text-2xl font-bold text-foreground">¥39</p>
                        <p className="text-xs text-muted-foreground">{t('settings.priceLine', 'China · lifetime / International US$4.99')}</p>
                    </div>
                </div>
            </header>
            <div className="settings-card-content space-y-4">
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
                                    className="settings-license-input"
                                />
                            </div>
                            <button type="button" onClick={activate} disabled={activating || !licenseKey.trim()} className="settings-action is-primary">
                                {activating ? t('settings.activating', '激活中…') : t('settings.activate', '激活 Pro')}
                            </button>
                            <button type="button" onClick={() => void open(purchaseUrl)} className="settings-action is-secondary">
                                {t('settings.buyPro', '购买激活码')}
                            </button>
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
            </div>
        </section>
    );
};

type SettingsSection = 'reminders' | 'detection' | 'general' | 'pro';

const SettingsPage = () => {
    const { t } = useTranslation();
    const [section, setSection] = useState<SettingsSection>('reminders');
    const sections: Array<{
        id: SettingsSection;
        icon: typeof BellRing;
        label: string;
        description: string;
    }> = [
        { id: 'reminders', icon: BellRing, label: t('settings.tabReminders', 'Reminders'), description: t('settings.tabRemindersDesc', 'How a posture nudge reaches you') },
        { id: 'detection', icon: Gauge, label: t('settings.tabDetection', 'Detection'), description: t('settings.tabDetectionDesc', 'Camera, sensitivity and intervals') },
        { id: 'general', icon: Settings2, label: t('settings.tabGeneral', 'General'), description: t('settings.tabGeneralDesc', 'Language, theme and updates') },
        { id: 'pro', icon: BadgeCheck, label: 'OnePosture Pro', description: t('settings.tabProDesc', 'License and paid reminder tools') },
    ];
    const activeSection = sections.find((item) => item.id === section) ?? sections[0];

    return (
        <section className="page-stack settings-page">
            <header className="page-heading">
                <div>
                    <p className="eyebrow">{t('settings.eyebrow', 'Make OnePosture yours')}</p>
                    <h1>{t('settings.pageTitle', 'A few choices, clearly grouped')}</h1>
                    <p>{t('settings.pageSubtitle', 'Configure reminder coverage first, then tune detection only if your desk setup needs it.')}</p>
                </div>
            </header>

            <div className="settings-shell">
                <nav className="settings-index" aria-label={t('settings.settingsNavigation', 'Settings sections')}>
                    {sections.map((item) => {
                        const Icon = item.icon;
                        return (
                            <button key={item.id} type="button" className={section === item.id ? 'is-active' : ''} onClick={() => setSection(item.id)}>
                                <Icon />
                                <span><strong>{item.label}</strong><small>{item.description}</small></span>
                            </button>
                        );
                    })}
                </nav>

                <div className="settings-content">
                    <header className="settings-section-heading">
                        <p className="eyebrow">{activeSection.label}</p>
                        <h2>{activeSection.label}</h2>
                        <p>{activeSection.description}</p>
                    </header>
                    <div className="settings-panels">
                        {section === 'reminders' && <NotificationSettings />}
                        {section === 'detection' && <><DetectionSettings /><CameraSettings /></>}
                        {section === 'general' && <><LanguageSettings /><ThemeSettings /><UpdateSettings /></>}
                        {section === 'pro' && <LicenseSettings />}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default SettingsPage;
