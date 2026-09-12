import { useI18n } from '../i18n/I18nContext';
import { useState } from 'react';
import { ArrowRight, FileImage, FileSpreadsheet, FileText, ScanLine } from 'lucide-react';
import { useDemo } from '../components/DemoContext';
import { Badge, Button, EmptyState, Modal, NextButton, Notice, PageHeader } from '../components/ui';
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
  if (!state.v1 || !state.selectedSku) return <><PageHeader eyebrow={t("03 / EVIDENCE & FACTS")} title={t("Every fact has a source.")} description={t("Keep supplier facts intact. Build a task-specific version from evidence.")} /><EmptyState title={t("Select a product to inspect its evidence")} description={t("Create a launch task and select a recommended SKU to begin.")} action={<NextButton onClick={() => navigate('tasks')}>{t("Go to Launch Tasks")}</NextButton>} /></>;
  const evidence = mockApi.evidence(state.selectedSku);
  const product = state.catalog.find(p => p.sku === state.selectedSku);
  const imported = !!product?.importSource;
  const bag = product?.visual === 'bag';
  // A quality report on file is required: without one the listing stage stays closed, and the check
  // panel above says exactly that next to the button that opens it.
  const reportReady = !product || reportClearsNextStep({ ...inspectionTargets((state.v2 ?? state.v1)?.facts ?? [], product), report: product.qualityReport, ignored: ignoredRefs(product.checkDecisions, 'quality_report') });
  return <>
    <PageHeader eyebrow={t("03 / EVIDENCE & FACTS")} title={t("Every fact has a source.")} description={t("Keep supplier facts intact. Build a task-specific version from evidence.")} action={state.v2 ? <div className="evidence-heading-actions"><Button variant="secondary" busy={busy === 'image-check'} disabled={!!busy} onClick={() => void act('image-check', () => mockApi.recheckImages(), 'Printed text re-checked against the current facts.')}><ScanLine size={16} />{t("Re-check printed text")}</Button><Button variant="secondary" disabled={!!busy} onClick={() => openFactComparison()?.scrollIntoView({ block: 'start' })}>{t("Review Facts")}</Button><NextButton disabled={!!busy || !reportReady} title={reportReady ? undefined : t('Submit the quality report first: without one the next step stays closed.')} onClick={() => navigate('studio')}>{t("Continue to Listing Studio")}</NextButton></div> : <Button busy={busy === 'analyze'} disabled={!!busy} onClick={() => void act('analyze', () => mockApi.analyzeEvidence(), 'FactCard V2 created. Review the facts before continuing.')}><ScanLine size={16} />{t(busy === 'analyze' ? 'Analyzing product evidence...' : 'Analyze Evidence')}</Button>} />
    {imported && <Notice>{t('Supplier file values and their row references are real imports. No PDF or image parsing: the picture text check only compares the words printed in the uploaded photos with these facts.')}</Notice>}
    <div className="evidence-grid">{evidence.map(e => { const Icon = e.type === 'sheet' ? FileSpreadsheet : e.type === 'pdf' ? FileText : e.type === 'image_check' ? ScanLine : FileImage; return <button className="evidence-card" key={e.id} onClick={() => setSource(e)}><div className={`file-icon ${e.type}`}><Icon size={23} /></div><div><strong>{t(e.name)}</strong><span>{e.file}</span><small>{e.id} {t("· View extracted result")} <ArrowRight size={12} /></small></div></button>; })}</div>
    <CheckAlerts product={product} facts={(state.v2 ?? state.v1)?.facts ?? []} evidence={evidence} />
    {state.pricing && <PricingPanel pricing={state.pricing} compact />}
    <FactReview />
    <Notice><strong>{t("Evidence, with boundaries.")}</strong> {t(bag ? 'The picture text check reads only the words printed in the photos and marks whether they agree with the facts. Printed wording is a claim, not proof of authenticity, durability or performance.' : imported ? 'Supplier rows are imported and traceable to the file. Product pictures are read for printed text only, never parsed; supplier cost and declared value stay internal.' : 'Sheet values are demo data. Product pictures are read for printed text only, never parsed; a picture cannot establish leakproof performance. Supplier cost and declared value remain internal.')}</Notice>
    <Modal open={!!source} onOpenChange={open => !open && setSource(null)} title={t(source?.name ?? 'Evidence')} description={t(source?.name === 'Imported Supplier File' ? 'Parsed supplier values · local file and row reference' : source?.type === 'image_check' ? 'Picture text check result · only the listed pictures were sent' : 'Mock extracted result · no OCR or file processing is performed')}>{source && <div className="source-preview"><Badge tone="blue">{source.id}</Badge><h3>{source.file}</h3><p>{source.name === 'Supplier Spreadsheet' ? t('{sku} · Products & Packaging', { sku: state.selectedSku }) : t(source.anchor)}</p><ul>{source.extracted.map(line => <li key={line}>{t(line)}</li>)}</ul><Notice>{t(source.name === 'Imported Supplier File' ? 'These values were parsed from your supplier file. This is a row preview, not independent verification of the supplier claims.' : source.type === 'image_check' ? 'A picture text check only marks whether the printed words agree with the facts. It never confirms a fact, and printed wording proves nothing about authenticity or performance.' : 'Illustrative evidence only. This preview shows fixed extracted fields, not a downloaded source file.')}</Notice></div>}</Modal>
  </>;
}
