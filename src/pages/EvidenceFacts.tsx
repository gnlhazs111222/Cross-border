import { useI18n } from '../i18n/I18nContext';
import { useState } from 'react';
import { ArrowRight, FileImage, FileSpreadsheet, FileText, ScanLine } from 'lucide-react';
import { useDemo } from '../components/DemoContext';
import { Badge, Button, EmptyState, Modal, NextButton, PageHeader } from '../components/ui';
import { CheckAlerts } from '../components/CheckAlerts';
import { FactReview } from '../components/FactReview';
import { PricingPanel } from '../components/PricingPanel';
import { mockApi } from '../services/mockApi';
import { ignoredRefs, inspectionTargets, reportClearsNextStep } from '../../shared/checks';
import { openFactComparison } from '../components/factCheckActions';
import type { Evidence } from '../types';

export function EvidenceFacts() {
  const { t } = useI18n();
  const { state, busy, act, navigate } = useDemo();
  const [source, setSource] = useState<Evidence | null>(null);
  if (!state.v1 || !state.selectedSku) return <><PageHeader eyebrow={t("03 / EVIDENCE & FACTS")} title={t("Every fact has a source.")} /><EmptyState title={t("Select a product to inspect its evidence")} description={t("Create a launch task and select a recommended SKU to begin.")} action={<NextButton onClick={() => navigate('tasks')}>{t("Go to Launch Tasks")}</NextButton>} /></>;
  const evidence = mockApi.evidence(state.selectedSku);
  const product = state.catalog.find(p => p.sku === state.selectedSku);
  // A quality report on file is required: without one the listing stage stays closed, and the check
  // panel above says exactly that next to the button that opens it.
  const reportReady = !product || reportClearsNextStep({ ...inspectionTargets((state.v2 ?? state.v1)?.facts ?? [], product), report: product.qualityReport, ignored: ignoredRefs(product.checkDecisions, 'quality_report') });
  return <>
    {/* While an action is in flight the button is disabled for that reason, so it does not claim a report is missing. */}
    <PageHeader eyebrow={t("03 / EVIDENCE & FACTS")} title={t("Every fact has a source.")} action={state.v2 ? <div className="evidence-heading-actions"><Button variant="secondary" busy={busy === 'image-check'} disabled={!!busy} onClick={() => void act('image-check', () => mockApi.recheckImages(), 'Printed text re-checked against the current facts.')}><ScanLine size={16} />{t("Re-check printed text")}</Button><Button variant="secondary" disabled={!!busy} onClick={() => openFactComparison()?.scrollIntoView({ block: 'start' })}>{t("Review Facts")}</Button><NextButton disabled={!!busy || !reportReady} title={busy || reportReady ? undefined : t('Submit the quality report first: without one the next step stays closed.')} onClick={() => navigate('studio')}>{t("Continue to Listing Studio")}</NextButton></div> : <Button busy={busy === 'analyze'} disabled={!!busy} onClick={() => void act('analyze', () => mockApi.analyzeEvidence(), 'FactCard V2 created. Review the facts before continuing.')}><ScanLine size={16} />{t(busy === 'analyze' ? 'Analyzing product evidence...' : 'Analyze Evidence')}</Button>} />
    {/* The product code sits on the page so the matching report picture (qc-<code>.jpg) can be found at a glance. */}
    <p className="evidence-sku context-identity" data-testid="evidence-sku"><span>{t('Product code')}</span><code>{state.selectedSku}</code></p>
    <div className="evidence-grid">{evidence.map(e => { const Icon = e.type === 'sheet' ? FileSpreadsheet : e.type === 'pdf' ? FileText : e.type === 'image_check' ? ScanLine : FileImage; return <button className="evidence-card" key={e.id} onClick={() => setSource(e)}><div className={`file-icon ${e.type}`}><Icon size={23} /></div><div><strong>{t(e.name)}</strong><small>{e.id} {t("· View extracted result")} <ArrowRight size={12} /></small></div></button>; })}</div>
    <CheckAlerts product={product} facts={(state.v2 ?? state.v1)?.facts ?? []} evidence={evidence} />
    {state.pricing && <PricingPanel pricing={state.pricing} compact />}
    <FactReview />
    <Modal open={!!source} onOpenChange={open => !open && setSource(null)} title={t(source?.name ?? 'Evidence')}>{source && <div className="source-preview"><Badge tone="blue">{source.id}</Badge><ul>{source.extracted.map(line => <li key={line}>{t(line)}</li>)}</ul></div>}</Modal>
  </>;
}
