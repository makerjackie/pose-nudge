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
    CheckCircle2,
    KeyRound,
    MonitorUp,
    Moon,
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
import {
    activateLicense,
    announceLicenseStatus,
    getLicenseStatus,
    type LicenseStatus,
} from '@/lib/licensing';

// --- Type Definitions ---
interface CameraDetail {
    index: number;
    name: string;
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
        <div className="settings-form-row">
            <span className="settings-row-copy"><strong>{t('settings.languageTitle')}</strong></span>
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
            <div className="settings-card-content">
                <div className="settings-list">
                    <div className="settings-form-row">
                        <span className="settings-row-copy">
                            <strong>{t('settings.batterySavingMode')}</strong>
                            <small>{t('settings.batterySavingModeDesc')}</small>
                        </span>
                        <Switch checked={batterySavingMode} onCheckedChange={handleBatterySavingToggle} />
                    </div>
                    <div className="settings-form-row">
                        <span className="settings-row-copy">
                            <strong>{t('settings.monitoringInterval')}</strong>
                            <small>{t('settings.monitoringIntervalDesc')}</small>
                        </span>
                        <Select value={monitoringInterval} onValueChange={setMonitoringInterval}>
                            <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {monitoringOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="settings-form-row">
                        <span className="settings-row-copy">
                            <strong>{t('settings.notificationFrequency')}</strong>
                            <small>{batterySavingMode ? t('settings.notificationFrequencyDescBatterySaving') : t('settings.notificationFrequencyDescNormal')}</small>
                        </span>
                        <Select value={frequency} onValueChange={setFrequency} disabled={batterySavingMode}>
                            <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">{t('settings.frequencyOnce')}</SelectItem>
                                <SelectItem value="2">{t('settings.frequencyTwice')}</SelectItem>
                                <SelectItem value="3">{t('settings.frequencyThrice')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="settings-form-row">
                        <span className="settings-row-copy"><strong>{t('settings.turtleNeckSensitivity')}</strong></span>
                        <Select value={turtleNeckSensitivity} onValueChange={setTurtleNeckSensitivity}>
                            <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">{t('settings.sensitivityLoose')}</SelectItem>
                                <SelectItem value="2">{t('settings.sensitivityNormal')}</SelectItem>
                                <SelectItem value="3">{t('settings.sensitivityStrict')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="settings-form-row">
                        <span className="settings-row-copy"><strong>{t('settings.shoulderSensitivity')}</strong></span>
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
            <div className="settings-card-content">
                <div className="settings-form-row is-compact">
                    <span className="settings-row-copy"><strong>{t('settings.cameraSelect')}</strong></span>
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
                <div className="settings-card-footer">
                    <button type="button" onClick={openCameraSettings} className="settings-action is-quiet">
                        {t('settings.cameraGoTo')}
                    </button>
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
    const [updateStatus, setUpdateStatus] = useState('');

    const checkForUpdates = async () => {
        try {
            setIsChecking(true);
            setProgress(0);
            setUpdateInfo(null);
            setInstalled(false);
            setUpdateStatus('');

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
                setUpdateStatus(t('settings.upToDate'));
            }
        } catch (error) {
            console.error(t('settings.updateErrorCheck', 'Update check failed:'), error);
            setIsChecking(false);
            setIsDownloading(false);
            setIsInstalling(false);
            setUpdateStatus(t('settings.updateFailed'));
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
        <div className="settings-form-block">
            <div className="settings-form-row">
                <span className="settings-row-copy">
                    <strong>{t('settings.updateTitle')}</strong>
                    <small>
                        {installed
                            ? t('settings.updateInstalled')
                            : updateInfo
                                ? t('settings.updateFound', { version: updateInfo.version, date: updateInfo.date })
                                : updateStatus || t('settings.updateGuide')}
                    </small>
                </span>
                {installed ? (
                    <button type="button" onClick={handleRestart} className="settings-action is-secondary">
                        {t('settings.restartApp')}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={checkForUpdates}
                        disabled={isChecking || isDownloading || isInstalling}
                        className="settings-action is-secondary"
                    >
                        {isChecking ? t('settings.checkingUpdate') : t('settings.checkUpdate')}
                    </button>
                )}
            </div>
            {isDownloading && (
                <div className="settings-update-progress">
                    <span>{t('settings.updateDownloading', { progress })}</span>
                    <Progress value={progress} className="w-full" />
                </div>
            )}
            {isInstalling && <p className="settings-inline-status">{t('settings.updateInstalling')}</p>}
        </div>
    );
};

const ThemeSettings = () => {
    const { t } = useTranslation();
    const { theme, setTheme } = useTheme();

    const handleThemeChange = (value: string) => {
        setTheme(value);
    };

    return (
        <div className="settings-form-row">
            <span className="settings-row-copy"><strong>{t('settings.themeTitle')}</strong></span>
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
    );
};

const GeneralSettings = () => (
    <section className="settings-card">
        <div className="settings-card-content">
            <div className="settings-list">
                <LanguageSettings />
                <ThemeSettings />
                <UpdateSettings />
            </div>
        </div>
    </section>
);

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
        getLicenseStatus()
            .then((status) => setProEnabled(status.can_use_app || !status.commercial_ready))
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
        <section className="settings-card">
            <div className="settings-card-content">
                <div className="settings-list">
                    <label className="settings-row">
                        <span className="settings-row-icon"><Bell /></span>
                        <span className="settings-row-copy">
                            <strong>{t('settings.channelNative', '系统通知')}</strong>
                            <small>{t('settings.channelNativeDesc', '遵循 macOS / Windows 的通知设置。')}</small>
                        </span>
                        <span className={`settings-permission-pill ${permission === 'granted' ? 'is-granted' : 'is-pending'}`}>
                            {permission === 'granted'
                                ? t('settings.notificationGranted', '系统通知已授权')
                                : t('settings.notificationNotGranted', '系统通知未授权')}
                        </span>
                        <Switch checked={preferences.native_notification} onCheckedChange={(checked) => setChannel('native_notification', checked)} />
                    </label>

                    <label className="settings-row">
                        <span className="settings-row-icon"><MonitorUp /></span>
                        <span className="settings-row-copy">
                            <strong>{t('settings.channelFloating', '顶部悬浮提醒')}</strong>
                            <small>{t('settings.channelFloatingDesc', '系统通知关闭时也能看见。')}</small>
                        </span>
                        <Switch checked={preferences.floating_window} onCheckedChange={(checked) => setChannel('floating_window', checked)} />
                    </label>

                    <label className="settings-row">
                        <span className="settings-row-icon"><Moon /></span>
                        <span className="settings-row-copy">
                            <strong>{t('settings.channelDim', '屏幕柔和变暗')}</strong>
                            <small>{t('settings.channelDimDesc', '用视觉场变化提醒，不打断输入。')}</small>
                        </span>
                        <Switch
                            checked={preferences.screen_dim}
                            disabled={!proEnabled}
                            onCheckedChange={(checked) => setChannel('screen_dim', checked)}
                        />
                    </label>

                    <label className="settings-row">
                        <span className="settings-row-icon"><Volume2 /></span>
                        <span className="settings-row-copy">
                            <strong>{t('settings.channelSound', '提醒声音')}</strong>
                            <small>{t('settings.channelSoundDesc', '仅在发送系统通知时播放。')}</small>
                        </span>
                        <Switch checked={preferences.sound} onCheckedChange={(checked) => setChannel('sound', checked)} />
                    </label>
                </div>

                <div className="settings-card-footer">
                    <div className="settings-card-actions">
                        {permission !== 'granted' && (
                            <button type="button" onClick={requestNotificationPermission} className="settings-action is-primary">
                                {t('settings.notificationRequest', '申请通知权限')}
                            </button>
                        )}
                        <button type="button" onClick={sendTestReminder} className={`settings-action ${permission === 'granted' ? 'is-primary' : 'is-secondary'}`}>
                            {t('settings.notificationTest', '发送测试提醒')}
                        </button>
                        <button type="button" onClick={openNotificationSettings} className="settings-action is-quiet">
                            {t('settings.notificationGoTo', '打开系统设置')}
                        </button>
                    </div>

                    {testStatus && (
                        <p className="settings-test-status" role="status">
                            <CheckCircle2 className="h-4 w-4" />
                            {testStatus}
                        </p>
                    )}
                </div>
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
        getLicenseStatus()
            .then(setStatus)
            .catch((error) => setActivationStatus(String(error)));
    }, []);

    const activate = async () => {
        if (!licenseKey.trim()) return;
        setActivating(true);
        setActivationStatus('');
        try {
            const nextStatus = await activateLicense(licenseKey);
            setStatus(nextStatus);
            announceLicenseStatus(nextStatus);
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
                {status?.trial_active && (
                    <p className="flex items-center gap-2 rounded-xl bg-amber-50 p-4 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                        <Sparkles className="h-5 w-5" />
                        {t('settings.trialActive', { count: status.trial_days_remaining })}
                    </p>
                )}
                {status?.commercial_ready && !status.can_use_app && (
                    <div className="settings-trial-expired" role="status">
                        <BadgeCheck className="h-6 w-6" />
                        <div>
                            <strong>{t('settings.trialExpiredTitle', '7 天完整试用已结束')}</strong>
                            <p>{t('settings.trialExpiredDesc', '解锁 OnePosture Pro，继续使用姿势监控、可靠提醒和全部功能。')}</p>
                        </div>
                    </div>
                )}
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                    <p className="rounded-lg bg-muted/50 px-3 py-2">{t('settings.proFeatureFull', '持续使用全部功能')}</p>
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
                ) : null}

                {activationStatus && <p className="text-sm text-muted-foreground" role="status">{activationStatus}</p>}
            </div>
        </section>
    );
};

type SettingsSection = 'reminders' | 'detection' | 'general' | 'pro';

interface SettingsPageProps {
    initialSection?: SettingsSection;
    accessLocked?: boolean;
}

const SettingsPage = ({ initialSection, accessLocked = false }: SettingsPageProps) => {
    const { t } = useTranslation();
    const [section, setSection] = useState<SettingsSection>(initialSection ?? 'reminders');
    const sections: Array<{
        id: SettingsSection;
        label: string;
    }> = [
        { id: 'reminders', label: t('settings.tabReminders', 'Reminders') },
        { id: 'detection', label: t('settings.tabDetection', 'Detection') },
        { id: 'general', label: t('settings.tabGeneral', 'General') },
        { id: 'pro', label: 'Pro' },
    ];
    const visibleSections = accessLocked
        ? sections.filter((item) => item.id === 'pro' || item.id === 'general')
        : sections;
    const effectiveSection = visibleSections.some((item) => item.id === section) ? section : 'pro';

    useEffect(() => {
        if (accessLocked) setSection('pro');
    }, [accessLocked]);

    return (
        <section className="page-stack settings-page">
            <header className="settings-page-heading">
                <h1>{t('nav.settings', 'Settings')}</h1>
            </header>

            <nav className="settings-tabs" aria-label={t('settings.settingsNavigation', 'Settings sections')}>
                {visibleSections.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={effectiveSection === item.id ? 'is-active' : ''}
                        onClick={() => setSection(item.id)}
                        aria-current={effectiveSection === item.id ? 'page' : undefined}
                    >
                        {item.label}
                    </button>
                ))}
            </nav>

            <div className="settings-panels">
                {effectiveSection === 'reminders' && <NotificationSettings />}
                {effectiveSection === 'detection' && <><DetectionSettings /><CameraSettings /></>}
                {effectiveSection === 'general' && <GeneralSettings />}
                {effectiveSection === 'pro' && <LicenseSettings />}
            </div>
        </section>
    );
};

export default SettingsPage;
