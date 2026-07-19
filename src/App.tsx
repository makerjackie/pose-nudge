import { lazy, Suspense, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
import { appPreferences, normalizeAppLanguage } from '@/lib/preferences';
import { configureMonitoring, onMonitoringChange, setMonitoringActive } from '@/lib/monitoring';
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

  const toggleMonitoring = async () => {
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
        ? <SettingsPage />
        : <AboutPage />;

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
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

        <div className="sidebar-status">
          <div className="privacy-chip"><ShieldCheck aria-hidden="true" /><span><strong>{t('shell.localOnly', 'On-device')}</strong><small>{t('shell.privateProcessing', 'Video never leaves this Mac')}</small></span></div>
          <p className={isMonitoring ? 'is-live' : ''}><i />{isMonitoring ? t('dashboard.live', 'Monitoring now') : t('dashboard.paused', 'Monitoring paused')}</p>
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
