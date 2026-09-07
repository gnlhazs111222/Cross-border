import { useI18n } from '../i18n/I18nContext';
import { ArrowRight, Check, Minus, SlidersHorizontal, Sparkles, Target } from 'lucide-react';
import { useDemo } from '../components/DemoContext';
import { Badge, Button, Notice, PageHeader, ProductVisual } from '../components/ui';
import { mockApi } from '../services/mockApi';

export function LaunchTasks() {
  const { t } = useI18n();
  const { state, products, busy, act } = useDemo();
  const task = state.task ?? mockApi.getTaskTemplate();
  const recommendations = mockApi.recommendations();
  return <>
    <PageHeader eyebrow={t("02 / LAUNCH PLANNING")} title={t("Find the right product for the brief.")} description={t("A focused shortlist, with every match and tradeoff explained.")} action={<Badge tone={state.task ? 'green' : 'neutral'}>{t(state.task ? 'Task active' : 'Demo template')}</Badge>} />
    <section className="panel task-brief"><div className="panel-title"><Target size={20} /><h2>{t("Commuter essentials · US launch")}</h2><code>{task.id}</code></div><div className="brief-grid"><div><span>{t("Platform")}</span><strong>{t(task.platform)}</strong></div><div><span>{t("Market")}</span><strong>{t(task.market)}</strong></div><div><span>{t("Category")}</span><strong>{t(task.category)}</strong></div><div><span>{t("Minimum unit profit")}</span><strong>USD {task.minProfit.toFixed(2)}</strong></div></div><div className="brief-requirements"><SlidersHorizontal size={17} /><span>{t("Requirements")}</span>{task.requirements.map(r => <Badge key={r}>{t(r)}</Badge>)}</div></section>
    {!state.task ? <div className="empty-state"><div className="empty-icon"><Sparkles size={26} /></div><h2>{t("Your launch brief is ready.")}</h2><p>{t("Create the fixed demo task to rank eligible products against these requirements.")}</p><Button busy={busy === 'create'} disabled={!!busy} onClick={() => void act('create', () => mockApi.createTask(), 'Demo task created. Top 3 recommendations are ready.')}>{t("Create Demo Task")}<ArrowRight size={16} /></Button></div> : <>
      <div className="section-heading shortlist-heading"><div><h2>{t("Recommended Top 3")}</h2><p>{t('{eligible} eligible candidates evaluated · {excluded} products excluded before ranking', { eligible: products.filter(mockApi.isEligible).length, excluded: products.filter(p => !mockApi.isEligible(p)).length })}</p></div><Badge tone="green"><Sparkles size={13} /> {t("Mock Intelligence")}</Badge></div>
      {recommendations.length === 0 && <Notice tone="amber">{t('No eligible products. Check required facts, unique SKUs and the Home & Kitchen category, or load the demo dataset.')}</Notice>}
      <div className="recommendation-grid">{recommendations.map((r, i) => { const p = products.find(p => p.sku === r.sku)!; return <section className={`recommendation-card ${i === 0 ? 'best-match' : ''}`} key={r.sku} data-testid={`recommendation-${i + 1}`}><div className="rec-top"><Badge tone={i === 0 ? 'green' : 'neutral'}>{i === 0 ? t('01 · Best match') : t('{rank} · Alternative', { rank: `0${i + 1}` })}</Badge><span className="match-score"><strong>{r.score}</strong><span>/100</span></span></div><div className="rec-product"><ProductVisual product={p} large /><span>{p.capacity}ml<br />{t(p.color)}<br />{t(p.straw ? 'With straw' : 'No straw')}</span></div><h3>{t(p.name)}</h3><code className="rec-sku">{p.sku}</code><div className="match-meter"><span style={{ width: `${r.score}%` }} /></div><div className="match-reasons">{r.reasons.map(reason => <p key={reason}><Check size={15} /><span>{t(reason)}</span></p>)}{r.deductions.map(reason => <p className="deduction" key={reason}><Minus size={15} /><span>{t(reason)}</span></p>)}</div><Button variant={i === 0 ? 'primary' : 'secondary'} busy={busy === `select-${i}`} disabled={!!busy} onClick={() => void act(`select-${i}`, () => mockApi.selectSku(p.sku), 'Product selected. FactCard V1 is ready.')}>{t(state.selectedSku === p.sku ? 'Continue with this SKU' : 'Select SKU')}<ArrowRight size={16} /></Button></section>; })}</div>
      <Notice><strong>{t("Why these products?")}</strong> {t("Demo scores start at 94 for a complete match. A straw deducts 12 points, oversized capacity 16, and a color mismatch 23. Missing-data, duplicate, possible-duplicate and out-of-category SKUs never enter ranking.")}</Notice>
    </>}
  </>;
}
