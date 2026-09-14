import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import zh from './zh.json';

export type Language = 'en' | 'zh';
export const LANGUAGE_KEY = 'prismlaunch.language';
type Params = Record<string, string | number>;
const dictionary: Record<string, string> = zh;

export function translate(language: Language, message: string, params: Params = {}) {
  const template = language === 'zh' ? dictionary[message] ?? message : message;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
}

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch { /* Continue in memory when browser storage is unavailable. */ }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

type I18n = { language: Language; setLanguage: (language: Language) => void; t: (message: string, params?: Params) => string };
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(initialLanguage);
  useLayoutEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = language === 'zh' ? '海淘集市 · 商品上新工作台' : '海淘集市 · Product launch workspace';
    try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* Language switching remains available in memory. */ }
  }, [language]);
  return <I18nContext.Provider value={{ language, setLanguage, t: (message, params) => translate(language, message, params) }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('I18n provider missing');
  return context;
}

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return <div className="language-switcher" role="group" aria-label={t('Interface language')}>
    <button type="button" lang="zh-CN" aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
    <button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
  </div>;
}
