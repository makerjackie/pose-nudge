import { useCallback, useEffect, useMemo, useState } from 'react';
import { isPermissionGranted } from '@tauri-apps/plugin-notification';
import {
  ArrowRight,
  BellRing,
  Camera,
  Check,
  Clock3,
  Eye,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { getDb } from '@/lib/db';
import { loadReminderPreferences } from '@/lib/reminders';
import { appPreferences } from '@/lib/preferences';

interface DashboardStats {
  totalSessions: number;
  averageScore: number;
  detectionCountToday: number;
  sessionTime: number;
  goodPostureTime: number;
}

interface DailyScore {
  name: string;
  score: number;
}

const formatMinutes = (minutes: number, t: ReturnType<typeof useTranslation>['t']) => {
  if (minutes < 60) return t('dashboard.timeFormat.minutes', { count: minutes });
  return t('dashboard.timeFormat.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
};

const Dashboard = ({ isMonitoring, onOpenMonitoring }: { isMonitoring: boolean; onOpenMonitoring: () => void }) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<DashboardStats>({
    totalSessions: 0,
    averageScore: 0,
    detectionCountToday: 0,
    sessionTime: 0,
    goodPostureTime: 0,
  });
  const [chartData, setChartData] = useState<DailyScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [notificationsReady, setNotificationsReady] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
      const sixDaysAgo = Math.floor(new Date(new Date().setDate(new Date().getDate() - 5)).setHours(0, 0, 0, 0) / 1000);
      const [rows, trend] = await Promise.all([
        db.select<any[]>(`
          SELECT
            (SELECT COUNT(DISTINCT date(timestamp, 'unixepoch')) FROM posture_log) AS total_sessions,
            AVG(CASE WHEN timestamp >= $1 THEN score ELSE NULL END) AS average_score,
            SUM(CASE WHEN (is_turtle_neck = 1 OR is_shoulder_misaligned = 1) AND timestamp >= $1 THEN 1 ELSE 0 END) AS detections_today,
            COUNT(CASE WHEN timestamp >= $1 THEN 1 ELSE NULL END) AS records_today,
            SUM(CASE WHEN score >= 80 AND timestamp >= $1 THEN 1 ELSE 0 END) AS good_records_today
          FROM posture_log
        `, [todayStart]),
        db.select<DailyScore[]>(`
          SELECT strftime('%m-%d', datetime(timestamp, 'unixepoch', 'localtime')) AS name,
                 ROUND(AVG(score)) AS score
          FROM posture_log
          WHERE timestamp >= $1
          GROUP BY name
          ORDER BY name ASC
          LIMIT 6
        `, [sixDaysAgo]),
      ]);
      const row = rows[0] || {};
      const secondsPerRecord = appPreferences.recordIntervalSeconds();
      setStats({
        totalSessions: row.total_sessions || 0,
        averageScore: Math.round(row.average_score || 0),
        detectionCountToday: row.detections_today || 0,
        sessionTime: Math.floor(((row.records_today || 0) * secondsPerRecord) / 60),
        goodPostureTime: Math.floor(((row.good_records_today || 0) * secondsPerRecord) / 60),
      });
      setChartData(trend);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    isPermissionGranted().then(setNotificationsReady).catch(() => setNotificationsReady(false));
  }, [loadData]);

  const goodShare = stats.sessionTime > 0 ? Math.round((stats.goodPostureTime / stats.sessionTime) * 100) : 0;
  const reminderChannels = useMemo(() => {
    const prefs = loadReminderPreferences();
    return [prefs.native_notification, prefs.floating_window, prefs.screen_dim].filter(Boolean).length;
  }, []);

  const scoreMessage = stats.averageScore >= 80
    ? t('dashboard.motivation.excellent')
    : stats.averageScore >= 60
      ? t('dashboard.motivation.good')
      : t('dashboard.motivation.bad');

  const tips = ['tip1', 'tip2', 'tip3'];

  return (
    <section className="page-stack dashboard-page">
      <header className="page-heading dashboard-heading">
        <div>
          <h1>{t('nav.dashboard', 'Dashboard')}</h1>
          <p>{t('dashboard.subtitle', 'OnePosture watches for sustained posture drift and only nudges you when the signal is reliable.')}</p>
        </div>
        <button type="button" className="icon-action" onClick={() => void loadData()} aria-label={t('dashboard.refresh')}>
          <RefreshCw className={loading ? 'is-spinning' : ''} />
        </button>
      </header>

      <article className={`session-overview ${isMonitoring ? 'is-live' : ''}`}>
        <div className="session-copy">
          <span className="live-indicator"><i />{isMonitoring ? t('dashboard.live', 'Monitoring now') : t('dashboard.paused', 'Ready when you are')}</span>
          <h2>{isMonitoring ? t('dashboard.liveTitle', 'Your posture field is active') : t('dashboard.pausedTitle', 'Start a focused posture session')}</h2>
          <p>{isMonitoring ? t('dashboard.liveDesc', 'You can close this window. OnePosture keeps working from the menu bar.') : t('dashboard.pausedDesc', 'Preview the camera, set a comfortable baseline, then let OnePosture stay quietly in the menu bar.')}</p>
          <button type="button" className="session-action" onClick={onOpenMonitoring}>
            <Camera />{t('dashboard.openMonitoring', 'Open live posture')}<ArrowRight />
          </button>
        </div>
        <div className="score-summary" aria-label={t('dashboard.scoreTitle')}>
          <span>{t('dashboard.today', 'Today')}</span>
          <strong>{stats.averageScore || '—'}</strong>
          <small>{t('dashboard.scoreUnit')}</small>
          <small>{scoreMessage}</small>
        </div>
      </article>

      <div className="summary-grid">
        <div><span><Clock3 /></span><p><small>{t('dashboard.stats.totalTime', 'Session time')}</small><strong>{formatMinutes(stats.sessionTime, t)}</strong></p></div>
        <div><span><Target /></span><p><small>{t('dashboard.goodPosture', 'Good posture')}</small><strong>{goodShare}%</strong></p></div>
        <div><span><BellRing /></span><p><small>{t('dashboard.stats.todayDetectionCount', 'Posture drifts')}</small><strong>{stats.detectionCountToday}</strong></p></div>
        <div><span><Eye /></span><p><small>{t('dashboard.stats.totalSessions', 'Days tracked')}</small><strong>{stats.totalSessions}</strong></p></div>
      </div>

      <div className="dashboard-grid">
        <section className="insight-card trend-card">
          <div className="section-heading"><div><h2>{t('dashboard.chartTitle')}</h2><p>{t('dashboard.lastSixDays', 'Last six days')}</p></div></div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={chartData} margin={{ top: 18, right: 8, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="postureArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2f765e" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#2f765e" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#dbe3db" strokeDasharray="4 6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={11} />
                <YAxis domain={[0, 100]} axisLine={false} tickLine={false} fontSize={11} />
                <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #dbe3db' }} />
                <Area type="monotone" dataKey="score" stroke="#1f644e" strokeWidth={3} fill="url(#postureArea)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="chart-empty"><span><Target /></span><strong>{t('dashboard.chartEmptyTitle', 'Your trend starts with the first session')}</strong><p>{t('dashboard.chartEmptyDesc', 'A few posture checks are enough to begin drawing a useful pattern.')}</p></div>
          )}
        </section>

        <section className="insight-card readiness-card" aria-label={t('dashboard.readiness', 'Readiness')}>
          <div className="section-heading"><div><h2>{t('dashboard.readiness', 'Readiness')}</h2><p>{t('dashboard.localAnalysisDesc', 'Frames stay on this device')}</p></div><ShieldCheck /></div>
          <div className="readiness-list">
            <div><span><Eye /></span><p><strong>{t('dashboard.localAnalysis', 'Local analysis')}</strong><small>{t('dashboard.localAnalysisDesc', 'Frames stay on this device')}</small></p><Check /></div>
            <div><span><BellRing /></span><p><strong>{t('dashboard.reminderSetup', 'Reminder coverage')}</strong><small>{t('dashboard.reminderSetupDesc', '{{count}} channels enabled', { count: reminderChannels })}</small></p><Check /></div>
            <div><span><ShieldCheck /></span><p><strong>{t('dashboard.systemNotice', 'System notification')}</strong><small>{notificationsReady ? t('dashboard.permissionReady', 'Permission ready') : t('dashboard.permissionOptional', 'Optional — floating reminders still work')}</small></p><b className={notificationsReady ? 'state-ready' : 'state-optional'}>{notificationsReady ? t('dashboard.ready', 'Ready') : t('dashboard.optional', 'Optional')}</b></div>
          </div>
        </section>
      </div>

      <section className="micro-coaching">
        <div className="section-heading"><div><h2>{t('dashboard.coachingTitle', 'Small resets, lasting comfort')}</h2><p>{t('dashboard.tipsTitle')}</p></div><Sparkles /></div>
        <div className="coaching-grid">
          {tips.map((tip, index) => <div key={tip}><span>0{index + 1}</span><p>{t(`dashboard.tips.${tip}`)}</p></div>)}
        </div>
      </section>
    </section>
  );
};

export default Dashboard;
