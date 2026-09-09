import { useCallback, useEffect, useRef, useState } from 'react';
import App from './App';
import { apiClient, ApiError, SERVER_MODE } from './services/apiClient';
import { mockApi } from './services/mockApi';
import { SessionContext } from './components/SessionContext';
import { useI18n } from './i18n/I18nContext';
import type { PublicUser } from '../shared/contracts';

type LoginMessage = { type?: unknown };

export default function FullDemo() {
  const { t } = useI18n();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(SERVER_MODE);
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const loginFrame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!SERVER_MODE) return;
    let active = true;
    void apiClient.auth.me()
      .then(async currentUser => {
        if (!active) return;
        await mockApi.connectServer(currentUser.id);
        if (active) setUser(currentUser);
      })
      .catch(e => {
        if (active && (!(e instanceof ApiError) || e.status !== 401)) setError(e.message);
      })
      .finally(() => { if (active) setLoading(false); });
    const expired = () => { mockApi.disconnectServer(); setUser(null); };
    window.addEventListener('prismlaunch:unauthorized', expired);
    return () => { active = false; window.removeEventListener('prismlaunch:unauthorized', expired); };
  }, []);

  const completeLogin = useCallback(async () => {
    setSigningIn(true);
    setError('');
    try {
      const currentUser = await apiClient.auth.me();
      await mockApi.connectServer(currentUser.id);
      setUser(currentUser);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.');
    } finally {
      setSigningIn(false);
    }
  }, []);

  useEffect(() => {
    if (!SERVER_MODE) return;
    const receiveLogin = (event: MessageEvent<LoginMessage>) => {
      if (event.origin !== window.location.origin || event.source !== loginFrame.current?.contentWindow) return;
      if (event.data?.type === 'prismlaunch:login-success') void completeLogin();
    };
    window.addEventListener('message', receiveLogin);
    return () => window.removeEventListener('message', receiveLogin);
  }, [completeLogin]);

  const logout = async () => {
    try {
      await apiClient.auth.logout();
      mockApi.disconnectServer();
      setUser(null);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Logout failed.');
    }
  };

  if (!SERVER_MODE) return <App />;
  if (loading) return <div className="loading-screen" role="status">{t('Connecting to your workspace...')}</div>;
  if (user) return <SessionContext.Provider value={{ user, logout }}>{error && <div className="notice red" role="alert">{t(error)}</div>}<App key={user.id} /></SessionContext.Provider>;

  return <main className="login-experience" aria-busy={signingIn}>
    <h1 className="visually-hidden">{t('Sign in to your workspace')}</h1>
    <iframe ref={loginFrame} className="login-experience-frame" title={t('Sign in to your workspace')} src="/login-3d/index.html" />
    {signingIn && <div className="login-sync" role="status">{t('Connecting to your workspace...')}</div>}
    {error && <div className="login-sync login-sync-error" role="alert">{t(error)}</div>}
  </main>;
}
