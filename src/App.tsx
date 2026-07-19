import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import {
  Activity,
  BarChart3,
  Camera,
  CirclePause,
  CirclePlay,
  Info,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Dashboard from '@/components/Dashboard';
import WebcamCapture from '@/components/WebcamCapture';
import SettingsPage from '@/components/SettingsPage';
import AboutPage from '@/components/AboutPage';
import { loadReminderPreferences } from '@/lib/reminders';
import i18n from './i18n';
import './App.css';

type ViewId = 'dashboard' | 'monitoring' | 'settings' | 'about';

const normalizeLanguage = (lang: string | undefined): string => {
  if (!lang) return 'en';
  const lowered = lang.toLowerCase();
  if (lowered.startsWith('ko')) return 'ko';
  if (lowered.startsWith('ja')) return 'ja';
  if (lowered.startsWith('zh-hant') || lowered.startsWith('zh-tw') || lowered.startsWith('zh-hk')) return 'zh-Hant';
  if (lowered.startsWith('zh')) return 'zh';
  if (lowered.startsWith('tr')) return 'tr';
  return 'en';
};

const navigation: Array<{ id: ViewId; icon: typeof Activity }> = [
  { id: 'dashboard', icon: BarChart3 },
  { id: 'monitoring', icon: Camera },
  { id: 'settings', icon: Settings2 },
  { id: 'about', icon: Info },
];

function App() {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState<ViewId>('dashboard');
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [changingMonitoring, setChangingMonitoring] = useState(false);

  useEffect(() => {
    const syncLanguageToBackend = (lang: string | undefined) => {
      const normalized = normalizeLanguage(lang);
      localStorage.setItem('pose_nudge_language', normalized);
      invoke('set_current_language', { lang: normalized }).catch(console.error);
    };

    syncLanguageToBackend(i18n.resolvedLanguage ?? i18n.language);
    i18n.on('languageChanged', syncLanguageToBackend);
    return () => i18n.off('languageChanged', syncLanguageToBackend);
  }, []);

  useEffect(() => {
    const batterySavingMode = localStorage.getItem('pose_nudge_battery_saving_mode') === 'true';
    invoke('set_battery_saving_mode', { mode: batterySavingMode }).catch(console.error);

    const savedCameraIndex = Number.parseInt(localStorage.getItem('pose_nudge_camera_index') || '0', 10);
    if (!Number.isNaN(savedCameraIndex) && savedCameraIndex >= 0) {
      invoke('set_selected_camera', { index: savedCameraIndex }).catch(console.error);
    }

    const monitoringInterval = Number.parseInt(localStorage.getItem('pose_nudge_monitoring_interval') || '3', 10);
    invoke(
      'set_monitoring_interval',
      batterySavingMode ? { intervalMins: monitoringInterval } : { intervalSecs: monitoringInterval },
    ).catch(console.error);

    invoke('set_detection_settings', {
      frequency: batterySavingMode ? 1 : Number.parseInt(localStorage.getItem('pose_nudge_notification_frequency') || '2', 10),
      turtleSensitivity: Number.parseInt(localStorage.getItem('pose_nudge_turtle_neck_sensitivity') || '2', 10),
      shoulderSensitivity: Number.parseInt(localStorage.getItem('pose_nudge_shoulder_sensitivity') || '2', 10),
    }).catch(console.error);

    invoke('set_reminder_preferences', { preferences: loadReminderPreferences() }).catch(console.error);
    invoke<{ active: boolean }>('get_monitoring_status')
      .then((status) => setIsMonitoring(status.active))
      .catch(console.error);

    const ensureNotificationPermission = async () => {
      const preferences = loadReminderPreferences();
      const permissionAsked = localStorage.getItem('oneposture_notification_permission_requested');
      if (preferences.native_notification && !permissionAsked && !(await isPermissionGranted())) {
        localStorage.setItem('oneposture_notification_permission_requested', 'true');
        await requestPermission();
      }
    };
    void ensureNotificationPermission().catch(console.error);

    const monitoringListener = listen<{ active: boolean }>('monitoring-state-changed', (event) => {
      setIsMonitoring(event.payload.active);
    });
    return () => void monitoringListener.then((dispose) => dispose());
  }, []);

  const toggleMonitoring = async () => {
    setChangingMonitoring(true);
    try {
      if (!isMonitoring && loadReminderPreferences().native_notification && !(await isPermissionGranted())) {
        await requestPermission();
      }
      await invoke(isMonitoring ? 'stop_monitoring' : 'start_monitoring');
      setIsMonitoring((current) => !current);
      if (!isMonitoring) setActiveView('monitoring');
    } catch (error) {
      console.error('Failed to change monitoring state:', error);
    } finally {
      setChangingMonitoring(false);
    }
  };

  const content = activeView === 'dashboard'
    ? <Dashboard isMonitoring={isMonitoring} onOpenMonitoring={() => setActiveView('monitoring')} />
    : activeView === 'monitoring'
      ? <WebcamCapture />
      : activeView === 'settings'
        ? <SettingsPage />
        : <AboutPage />;

  return (
    <div className="app-shell">
      <header className="command-bar">
        <button className="brand-lockup" type="button" onClick={() => setActiveView('dashboard')}>
          <span className="brand-mark"><img src="/logo.png" alt="" /></span>
          <span>
            <strong>OnePosture</strong>
            <small>{t('shell.brandLine', 'Calm posture care')}</small>
          </span>
        </button>

        <nav className="primary-navigation" aria-label={t('shell.navigation', 'Primary navigation')}>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={activeView === item.id ? 'is-active' : ''}
                onClick={() => setActiveView(item.id)}
                aria-current={activeView === item.id ? 'page' : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{t(`nav.${item.id}`)}</span>
              </button>
            );
          })}
        </nav>

        <div className="command-actions">
          <span className="privacy-chip"><ShieldCheck aria-hidden="true" />{t('shell.localOnly', 'On-device')}</span>
          <button
            type="button"
            className={`monitoring-command ${isMonitoring ? 'is-live' : ''}`}
            onClick={toggleMonitoring}
            disabled={changingMonitoring}
          >
            {isMonitoring ? <CirclePause aria-hidden="true" /> : <CirclePlay aria-hidden="true" />}
            <span>{isMonitoring ? t('shell.pauseMonitoring', 'Pause') : t('shell.startMonitoring', 'Start')}</span>
          </button>
        </div>
      </header>

      <main className="workspace" id="main-content">
        {content}
      </main>
    </div>
  );
}

export default App;
