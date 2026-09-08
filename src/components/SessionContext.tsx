import { LogOut } from 'lucide-react';
import { Button } from './ui';
import { useI18n } from '../i18n/I18nContext';
import { SERVER_MODE } from '../services/apiClient';
import { createContext, useContext } from 'react';
import type { PublicUser } from '../../shared/contracts';

export const SessionContext = createContext<{ user: PublicUser | null; logout: () => Promise<void> }>({ user: null, logout: async () => {} });
export const useSession = () => useContext(SessionContext);

export function UserMenu() {
  const { user, logout } = useSession(); const { t } = useI18n();
  if (!SERVER_MODE) return <span className="offline-indicator">{t('Offline competition demo')}</span>;
  return <div className="account-menu"><span>{user?.displayName}</span><Button variant="ghost" onClick={() => void logout()}><LogOut size={14} />{t('Logout')}</Button></div>;
}
