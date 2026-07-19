import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { open } from '@tauri-apps/plugin-shell';
import { BadgeCheck, ExternalLink, FileText, GitFork, Github, RefreshCw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const SOURCE_URL = 'https://github.com/makerjackie/pose-nudge';
const LICENSE_URL = `${SOURCE_URL}/blob/main/LICENSE`;
const UPSTREAM_URL = 'https://github.com/DDULDDUCK/pose-nudge';

const AboutPage = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState('—');
  const [updateMessage, setUpdateMessage] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(t('about.unknown', 'Unknown')));
  }, [t]);

  const checkForUpdates = async () => {
    setChecking(true);
    setUpdateMessage(t('about.checkingUpdate', 'Checking for updates…'));
    try {
      const update = await check();
      setUpdateMessage(update
        ? t('about.updateAvailable', 'Version {{version}} is available.', { version: update.version, date: update.date })
        : t('about.upToDate', 'You are up to date.'));
    } catch (error) {
      console.error(error);
      setUpdateMessage(t('about.updateFailed', 'Update check failed.'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="page-stack about-page">
      <header className="page-heading">
        <p className="eyebrow">OnePosture · One Apps Studio</p>
        <h1>{t('about.title', 'Open by design')}</h1>
        <p>{t('about.subtitle', 'A privacy-first posture companion, built in the open and designed to stay out of your way.')}</p>
      </header>

      <div className="about-hero">
        <div className="about-brand-panel">
          <img src="/logo.png" alt={t('app.logoAlt', 'OnePosture logo')} />
          <div>
            <p className="eyebrow">OnePosture</p>
            <h2>{t('about.versionLabel', 'Version {{version}}', { version })}</h2>
            <p>{t('about.developerLine', 'Maintained by One Apps Studio and the open-source community.')}</p>
          </div>
        </div>
        <div className="about-principles">
          <div><ShieldCheck /><strong>{t('about.privateTitle', 'Private by default')}</strong><span>{t('about.privateDesc', 'Camera analysis stays on this device.')}</span></div>
          <div><BadgeCheck /><strong>{t('about.reliableTitle', 'Reliable reminders')}</strong><span>{t('about.reliableDesc', 'Multiple reminder channels with a built-in fallback.')}</span></div>
        </div>
      </div>

      <div className="about-grid">
        <article className="open-source-card">
          <div className="section-icon"><GitFork /></div>
          <p className="eyebrow">AGPL-3.0</p>
          <h2>{t('about.openSourceTitle', 'Open source and credited')}</h2>
          <p>{t('about.openSourceDesc', 'OnePosture is released under the GNU AGPL v3. We preserve the original Pose Nudge attribution and publish every desktop-app change.')}</p>
          <div className="link-row">
            <button type="button" onClick={() => void open(SOURCE_URL)}><Github />{t('about.sourceCode', 'Source code')}<ExternalLink /></button>
            <button type="button" onClick={() => void open(LICENSE_URL)}><FileText />{t('about.license', 'AGPL license')}<ExternalLink /></button>
            <button type="button" onClick={() => void open(UPSTREAM_URL)}><GitFork />{t('about.upstream', 'Original project')}<ExternalLink /></button>
          </div>
        </article>

        <article className="update-card">
          <div className="section-icon"><RefreshCw /></div>
          <p className="eyebrow">Updates</p>
          <h2>{t('about.updateTitle', 'Keep your posture toolkit current')}</h2>
          <p>{t('about.updateDesc', 'Signed updates are delivered from the public GitHub release feed.')}</p>
          <button type="button" className="secondary-action" onClick={checkForUpdates} disabled={checking}>
            <RefreshCw className={checking ? 'is-spinning' : ''} />
            {checking ? t('about.checking', 'Checking…') : t('about.checkUpdate', 'Check for updates')}
          </button>
          {updateMessage && <p className="status-copy" role="status">{updateMessage}</p>}
        </article>
      </div>
    </section>
  );
};

export default AboutPage;
