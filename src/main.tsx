import './recommendation.css';
import './generation.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import FullDemo from './FullDemo';
import './styles.css';
import './presentation.css';
import './full-demo.css';
import { I18nProvider } from './i18n/I18nContext';

createRoot(document.getElementById('root')!).render(<StrictMode><I18nProvider><FullDemo /></I18nProvider></StrictMode>);
