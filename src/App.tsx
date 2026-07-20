import { lazy, Suspense, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Camera,
  CirclePause,
  CirclePlay,
  Clock3,
  Info,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { appPreferences, normalizeAppLanguage } from '@/lib/preferences';
import { configureMonitoring, onMonitoringChange, setMonitoringActive } from '@/lib/monitoring';
import {
  getLicenseStatus,
  LICENSE_STATUS_CHANGED_EVENT,
  type LicenseStatus,
} from '@/lib/licensing';
import i18n from './i18n';
import './App.css';

type ViewId = 'dashboard' | 'monitoring' | 'settings' | 'about';

const Dashboard = lazy(() => import('@/components/Dashboard'));
const WebcamCapture = lazy(() => import('@/components/WebcamCapture'));
const SettingsPage = lazy(() => import('@/components/SettingsPage'));
const AboutPage = lazy(() => import('@/components/AboutPage'));

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
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const accessLocked = Boolean(
    licenseStatus?.commercial_ready && !licenseStatus.can_use_app,
  );

  useEffect(() => {
    const syncLanguageToBackend = (lang: string | undefined) => {
      const normalized = normalizeAppLanguage(lang);
      appPreferences.writeLanguage(normalized);
      invoke('set_current_language', { lang: normalized }).catch(console.error);
    };

    syncLanguageToBackend(i18n.resolvedLanguage ?? i18n.language);
    i18n.on('languageChanged', syncLanguageToBackend);
    return () => i18n.off('languageChanged', syncLanguageToBackend);
  }, []);

  useEffect(() => {
    void configureMonitoring().then(setIsMonitoring).catch(console.error);
    const monitoringListener = onMonitoringChange(setIsMonitoring);
    return () => void monitoringListener.then((dispose) => dispose());
  }, []);

  useEffect(() => {
    const refreshLicense = () => void getLicenseStatus().then(setLicenseStatus).catch(console.error);
    const handleLocalChange = (event: Event) => {
      setLicenseStatus((event as CustomEvent<LicenseStatus>).detail);
    };
    refreshLicense();
    const intervalId = window.setInterval(refreshLicense, 60_000);
    window.addEventListener(LICENSE_STATUS_CHANGED_EVENT, handleLocalChange);
    const backendListeners = Promise.all([
      listen<LicenseStatus>('license-status-changed', (event) => setLicenseStatus(event.payload)),
      listen('license-access-required', () => {
        refreshLicense();
        setActiveView('settings');
      }),
    ]);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(LICENSE_STATUS_CHANGED_EVENT, handleLocalChange);
      void backendListeners.then((disposeListeners) => disposeListeners.forEach((dispose) => dispose()));
    };
  }, []);

  useEffect(() => {
    if (!accessLocked) return;
    setActiveView('settings');
    if (isMonitoring) void setMonitoringActive(false).catch(console.error);
  }, [accessLocked, isMonitoring]);

  const toggleMonitoring = async () => {
    if (accessLocked) {
      setActiveView('settings');
      return;
    }
    setChangingMonitoring(true);
    try {
      await setMonitoringActive(!isMonitoring);
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
        ? <SettingsPage initialSection={accessLocked ? 'pro' : undefined} accessLocked={accessLocked} />
        : <AboutPage />;

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <button className="brand-lockup" type="button" onClick={() => setActiveView(accessLocked ? 'settings' : 'dashboard')}>
          <span className="brand-mark"><img src="/logo.png" alt="" /></span>
          <span>
            <strong>OnePosture</strong>
            <small>{t('shell.brandLine', 'Calm posture care')}</small>
          </span>
        </button>

        <nav className="primary-navigation" aria-label={t('shell.navigation', 'Primary navigation')}>
          {navigation.map((item) => {
            const Icon = item.icon;
            const disabled = accessLocked && (item.id === 'dashboard' || item.id === 'monitoring');
            return (
              <button
                key={item.id}
                type="button"
                className={activeView === item.id ? 'is-active' : ''}
                onClick={() => setActiveView(item.id)}
                disabled={disabled}
                aria-current={activeView === item.id ? 'page' : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{t(`nav.${item.id}`)}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <div className="privacy-chip"><ShieldCheck aria-hidden="true" /><span><strong>{t('shell.localOnly', 'On-device')}</strong><small>{t('shell.privateProcessing', 'Video never leaves this Mac')}</small></span></div>
          {licenseStatus?.trial_active && (
            <button type="button" className="trial-status-chip" onClick={() => setActiveView('settings')}>
              <Clock3 aria-hidden="true" />
              <span>{t('shell.trialRemaining', { count: licenseStatus.trial_days_remaining })}</span>
            </button>
          )}
          <p className={isMonitoring ? 'is-live' : ''}><i />{isMonitoring ? t('dashboard.live', 'Monitoring now') : t('dashboard.paused', 'Monitoring paused')}</p>
          <button
            type="button"
            className={`monitoring-command ${isMonitoring ? 'is-live' : ''}`}
            onClick={toggleMonitoring}
            disabled={changingMonitoring}
          >
            {accessLocked ? <BadgeCheck aria-hidden="true" /> : isMonitoring ? <CirclePause aria-hidden="true" /> : <CirclePlay aria-hidden="true" />}
            <span>{accessLocked ? t('shell.unlockPro', '解锁 Pro') : isMonitoring ? t('shell.pauseMonitoring', 'Pause') : t('shell.startMonitoring', 'Start')}</span>
          </button>
        </div>
      </aside>

      <main className="workspace" id="main-content">
        <Suspense fallback={<div className="view-loading" role="status">{t('shell.loading', 'Loading…')}</div>}>
          {content}
        </Suspense>
      </main>
    </div>
  );
}

export default App;
