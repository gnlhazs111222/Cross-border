import { LanguageSwitcher, useI18n } from './i18n/I18nContext';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Boxes, Check, CheckCircle2, ChevronRight, CircleHelp, ClipboardList, FilePenLine, FlaskConical, LoaderCircle, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { DemoCapabilities } from './components/DemoCapabilities';
import { stageLabel, nextStepMessage } from './components/presentation';
import { DemoContext } from './components/DemoContext';
import { Badge, Button } from './components/ui';
import { mockApi } from './services/mockApi';
import type { DemoState, Workspace } from './types';
import { Materials } from './pages/Materials';
import { LaunchTasks } from './pages/LaunchTasks';
import { EvidenceFacts } from './pages/EvidenceFacts';
import { ListingStudio } from './pages/ListingStudio';
import { ReviewPublish } from './pages/ReviewPublish';

const workspaces = [
  { id: 'materials', label: 'Materials', Icon: Boxes, caption: 'Supplier catalog' },
  { id: 'tasks', label: 'Launch Tasks', Icon: ClipboardList, caption: 'Select a product' },
  { id: 'evidence', label: 'Evidence & Facts', Icon: ShieldCheck, caption: 'Verify your facts' },
  { id: 'studio', label: 'Listing Studio', Icon: FilePenLine, caption: 'Create your listing' },
  { id: 'review', label: 'Review & Publish', Icon: CheckCircle2, caption: 'Ready for launch' },
] as const;
export default function App() {
  const { t } = useI18n();
  const [state, setState] = useState(mockApi.getState);
  const products = mockApi.catalog();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const lock = useRef(false);
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  useEffect(() => { let active = true; void (async () => { try { await mockApi.getCatalog(); const ready = await mockApi.ready(); if (active) { setState(ready); } } catch { if (active) notify('Could not load demo data. Reload the page to retry.', true); } finally { if (active) setLoading(false); } })(); return () => { active = false; }; }, [notify]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 8000 : 4500); return () => clearTimeout(timer); }, [toast]);
  useLayoutEffect(() => { window.scrollTo({ top: 0 }); document.getElementById('main')?.focus({ preventScroll: true }); }, [state.workspace]);
  const act = async (label: string, action: () => Promise<DemoState>, message: string) => {
    if (lock.current) return false;
    lock.current = true; setBusy(label);
    try { setState(await action()); if (['reset', 'load-dataset', 'import-save'].includes(label)) window.scrollTo({ top: 0 }); notify(message); return true; }
    catch (error) { notify(error instanceof Error ? error.message : 'Something went wrong. Please retry.', true); return false; }
    finally { lock.current = false; setBusy(null); }
  };
  const navigate = (workspace: Workspace) => { if (lock.current) return; setState(mockApi.navigate(workspace)); window.scrollTo({ top: 0 }); };
  const index = workspaces.findIndex(w => w.id === state.workspace);
  const completed = [products.length > 0, !!state.selectedSku, !!state.v2, !!state.listings[state.platform], !!state.publications[state.platform]];
  const pages = { materials: Materials, tasks: LaunchTasks, evidence: EvidenceFacts, studio: ListingStudio, review: ReviewPublish };
  const Page = pages[state.workspace];
  return <DemoContext.Provider value={{ state, products, busy, act, navigate, setState, notify }}><div className="app-shell"><a className="skip-link" href="#main">{t("Skip to workspace")}</a><aside className="sidebar"><a href="#materials" className="brand" onClick={e => { e.preventDefault(); navigate('materials'); }}><img src="/prism.svg" alt="" width="35" height="35" /><span>PrismLaunch<span>{t("PRODUCT LAUNCH WORKSPACE")}</span></span></a><div className="workspace-selector"><span className="workspace-avatar">P</span><div><strong>{t("Prism workspace")}</strong><span>{t("Demo environment")}</span></div><Badge>US</Badge></div><div className="nav-label">{t("WORKSPACE")}</div><nav aria-label={t("Workspaces")}>{workspaces.map(({ id, label, Icon }, i) => <button key={id} className={`nav-item ${state.workspace === id ? 'active' : ''}`} aria-current={state.workspace === id ? 'page' : undefined} onClick={() => navigate(id)} disabled={!!busy}><Icon size={19} /><span>{t(label)}</span>{completed[i] ? <Check size={14} className="nav-check" /> : <small aria-hidden="true">{String(i + 1).padStart(2, '0')}</small>}</button>)}</nav><div className="sidebar-bottom"><div className="demo-guide"><div><FlaskConical size={18} /><strong>{t("A launch, made tangible.")}</strong></div><p>{t("From supplier materials to a reviewed, publishable product.")}</p><span>{t('Local actions are real. Intelligence and platform publishing are simulated.')}</span></div><Button variant="ghost" disabled={!!busy || loading} busy={busy === 'reset'} onClick={() => void act('reset', () => mockApi.reset(), 'Demo reset. Start again from Materials.')}><RotateCcw size={16} />{t("Reset Demo")}</Button><div className="sidebar-footer"><span className="user-avatar">PL</span><div><strong>{t("PrismLaunch Demo")}</strong><span>{t("Local workspace · v1.0")}</span></div></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">{t("Workspace")}<ChevronRight size={14} /><strong>{t(workspaces[index].label)}</strong></div><div className="topbar-badges"><Badge tone="green"><span className="status-dot" />{t(state.datasetSource === 'builtin' ? 'Demo Data' : 'Imported Data')}</Badge><Badge><Sparkles size={13} />{t("Mock Intelligence")}</Badge><DemoCapabilities /><LanguageSwitcher /><span className="topbar-avatar">PL</span></div></header><div className="contextbar"><div>{state.task ? <span className="context-identity"><span>{t("Task")}</span><code>{state.task.id}</code></span> : <span>{t("No active launch task")}</span>}{state.selectedSku && <><ChevronRight size={13} /><span className="context-identity"><span>SKU</span><code>{state.selectedSku}</code></span></>}</div><span className="state-indicator"><span className="status-dot" />{t(stageLabel(state))}</span></div>
    <main id="main" tabIndex={-1} aria-busy={loading || !!busy}><div className="journey-group"><div className="journey" aria-label={t("Launch progress")}>{workspaces.map((w, i) => <button key={w.id} className={`journey-step ${i === index ? 'current' : ''} ${completed[i] ? 'complete' : ''}`} onClick={() => navigate(w.id)} disabled={!!busy} aria-current={i === index ? 'step' : undefined}><span className="step-number">{completed[i] ? <Check size={13} /> : i + 1}</span><span>{t(w.label)}</span>{i < 4 && <ChevronRight size={13} className="step-arrow" />}</button>)}</div><div className="journey-guidance"><strong>{t("Step {step} of 5", { step: index + 1 })}</strong><span>{t(nextStepMessage(state))}</span></div></div>{!mockApi.isStorageAvailable() && <div className="notice amber">{t("Browser storage is unavailable. This session works, but refreshing will reset progress.")}</div>}{loading ? <div className="loading-screen" role="status"><LoaderCircle className="spin" />{t("Loading supplier workspace...")}</div> : <Page />}<footer className="page-footer"><span><ShieldCheck size={14} />{t("Evidence before claims. Review before publish.")}</span><span>PrismLaunch <ArrowUpRight size={12} /></span></footer></main></div>{toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={19} /> : <CheckCircle2 size={19} />}<span>{t(toast.message)}</span><button aria-label={t("Dismiss notification")} onClick={() => setToast(null)}><X size={16} /></button></div>}</div></DemoContext.Provider>;
}
