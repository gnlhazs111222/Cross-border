import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import App from './App';
import { apiClient, ApiError, SERVER_MODE } from './services/apiClient';
import { mockApi } from './services/mockApi';
import { SessionContext } from './components/SessionContext';
import { Button, Notice } from './components/ui';
import { LanguageSwitcher, useI18n } from './i18n/I18nContext';
import type { PublicUser } from '../shared/contracts';

export default function FullDemo() {
  const { t } = useI18n();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(SERVER_MODE);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('demo@prismlaunch.local');
  const [password, setPassword] = useState('Demo123456');
  useEffect(() => {
    if (!SERVER_MODE) return;
    let active = true;
    void apiClient.auth.me().then(async u => { if (!active) return; await mockApi.connectServer(u.id); if (active) setUser(u); }).catch(e => { if (active && (!(e instanceof ApiError) || e.status !== 401)) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    const expired = () => { mockApi.disconnectServer(); setUser(null); };
    window.addEventListener('prismlaunch:unauthorized', expired);
    return () => { active = false; window.removeEventListener('prismlaunch:unauthorized', expired); };
  }, []);
  const logout = async () => {
    try { await apiClient.auth.logout(); mockApi.disconnectServer(); setUser(null); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Logout failed.'); }
  };
  if (!SERVER_MODE) return <App />;
  if (loading) return <div className="loading-screen" role="status">{t('Connecting to your workspace...')}</div>;
  if (user) return <SessionContext.Provider value={{ user, logout }}>{error && <div className="notice red" role="alert">{t(error)}</div>}<App key={user.id} /></SessionContext.Provider>;
  return <div className="login-screen"><div className="login-language"><LanguageSwitcher /></div><section className="login-card">
    <div className="brand"><img src="/prism.svg" alt="" width={42} height={42} /><span>PrismLaunch<span>{t('Full Demo Workspace')}</span></span></div>
    <h1>{t('Sign in to your workspace')}</h1><p>{t('Products and launch tasks are saved in your local server database.')}</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('');
      try { const u = await apiClient.auth.login(email, password); await mockApi.connectServer(u.id); setUser(u); }
      catch (e) { setError(e instanceof Error ? e.message : 'Sign in failed.'); }
      finally { setBusy(false); }
    }}>
      <label className="form-field">{t('Email')}<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="form-field">{t('Password')}<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <div className="notice red" role="alert">{t(error)}</div>}
      <Button type="submit" busy={busy} disabled={busy}>{t('Sign in')}<ShieldCheck size={16} /></Button>
    </form>
    <Notice>{t('Local demo account: demo@prismlaunch.local / Demo123456')}</Notice>
    <a className="offline-link" href="/?mode=local">{t('Open the offline competition demo')}</a>
    <small>{t('Offline mode uses browser storage and mock workflows. It does not access server account data.')}</small>
  </section></div>;
}
