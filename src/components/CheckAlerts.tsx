import { useRef, useState } from 'react';
import { CircleAlert, ScanLine, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { Evidence, Fact, Product } from '../types';
import { assessImageText, assessInspection, ignoredRefs, inspectionTargets, type InspectionProblem } from '../../shared/checks';
import { assessHazmat } from '../../shared/hazmat';
import { mockApi } from '../services/mockApi';
import { useDemo } from './DemoContext';
import { useI18n } from '../i18n/I18nContext';
import { Badge, Button, Modal, Notice } from './ui';
import { HazmatNotice } from './HazmatNotice';
import { openFactComparison, requestFactEdit, useFactCheckActions } from './factCheckActions';
import { assetMimeType, fileToBase64 } from './SourceAssets';

/**
 * One problem, one decision. When a check offers more than two answers they live in a select instead
 * of a row of buttons, so the cell stays a line of text plus one control.
 */
export function CheckDecision({ label, options, busy }: { label: string; options: { label: string; run: () => void | Promise<void> }[]; busy: string | null }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState(0);
  if (!options.length) return null;
  const chosen = options[Math.min(picked, options.length - 1)];
  return <div className="check-decision">
    <select aria-label={t('Decision')} value={picked} disabled={!!busy} onChange={event => setPicked(Number(event.target.value))}>
      {options.map((option, index) => <option key={option.label} value={index}>{label} · {option.label}</option>)}
    </select>
    <Button variant="secondary" disabled={!!busy} onClick={() => void chosen.run()}>{t('Apply')}</Button>
  </div>;
}

/**
 * The checks that sit around the fact card.
 *
 * Three of them run here: the text printed in the pictures, the quality report on file, and the
 * declared transport attributes. They are laid out the way the fact table below is laid out — a
 * header row of columns, one column per check — and the picture check carries two sub-columns of its
 * own: what the evidence says, and the one decision that closes each of its problems.
 *
 * Every cell says one short thing and offers the way out; nothing here is a paragraph, and nothing is
 * repaired silently. No check ever writes a fact on its own.
 */
export function CheckAlerts({ product, facts, evidence }: { product?: Product; facts: Fact[]; evidence?: Evidence[] }) {
  const { t } = useI18n();
  const { state, busy, act, navigate } = useDemo();
  const { adoptPrintedText, discardPicture, editDisputedFact } = useFactCheckActions();
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNo, setReportNo] = useState('');
  const [reportResult, setReportResult] = useState<'pass' | 'fail'>('pass');
  const [reportValidUntil, setReportValidUntil] = useState('');
  const [reportError, setReportError] = useState('');
  const [reportFile, setReportFile] = useState<File | null>(null);
  const reportFileRef = useRef<HTMLInputElement>(null);
  if (!product) return null;
  const report = assessInspection({ ...inspectionTargets(facts, product), report: product.qualityReport, ignored: ignoredRefs(product.checkDecisions, 'quality_report') });
  const hazmat = assessHazmat(product.transport);
  const disputes = facts.filter(fact => fact.imageCheck?.verdict === 'differ');
  // The panel reads the run itself, so "ran without a picture" never looks like "never ran".
  const run = evidence?.find(item => item.type === 'image_check')?.imageCheck;
  const imageText = assessImageText(run);
  const droppedPicture = (run?.assets ?? []).find(asset => asset.status === 'dropped');

  const discardReport = async (reportNo: string) => {
    await act('report-discard', () => mockApi.discardQualityReport(reportNo), t('Quality report {report} is dropped from the checks. The decision is recorded on the product.', { report: reportNo }));
  };
  // A report states "750 ml" where the fact editor expects the number: the unit is our formatting.
  const reportValueFor = (problem: InspectionProblem) => problem.reportValue.match(/\d+(?:\.\d+)?/)?.[0] ?? problem.reportValue;
  const adoptReportValue = async (problem: InspectionProblem) => {
    await act(`report-adopt-${problem.factKey}`, () => mockApi.editFact(problem.factKey, reportValueFor(problem)), 'The stored value now follows the quality report. Confirm it before it can enter copy.');
  };
  /**
   * Submitting a report stores the document with the product and records what the laboratory states.
   * The number without its file would be a claim with nothing behind it, so the file comes first.
   */
  const submitReport = async () => {
    setReportError('');
    const submitted = reportNo.trim();
    const ok = await act('quality-report', async () => {
      try {
        if (!reportFile) throw new Error('Attach the report file before submitting.');
        await mockApi.uploadAsset(product.sku, { fileName: reportFile.name, mimeType: assetMimeType(reportFile), role: 'spec', contentBase64: await fileToBase64(reportFile) });
        await mockApi.submitQualityReport(product.sku, { reportNo: submitted, result: reportResult, ...(reportValidUntil ? { validUntil: reportValidUntil } : {}) });
      }
      catch (error) { setReportError(error instanceof Error ? error.message : 'Could not record the report.'); throw error; }
      return mockApi.getState();
    }, t('Report {report} is on file. The next step is open again.', { report: submitted }));
    if (ok) { setReportOpen(false); setReportNo(''); setReportValidUntil(''); setReportResult('pass'); setReportFile(null); if (reportFileRef.current) reportFileRef.current.value = ''; }
  };
  const submitReportButton = <Button variant="secondary" disabled={!!busy} onClick={() => setReportOpen(true)}>{t('Submit a quality report')}</Button>;

  // One row per problem: each piece of evidence sits on the same table line as the decision that closes
  // it, so a second disagreement never pushes the first one's control out of sight.
  const imageDecision = (fact: Fact) => <CheckDecision key={fact.key} label={t(fact.label)} busy={busy} options={[
    { label: t('Save what the picture prints'), run: () => adoptPrintedText(fact) },
    { label: t('Edit and save'), run: () => editDisputedFact(fact) },
    { label: t('Discard the picture'), run: () => discardPicture(fact) },
  ]} />;
  const imageStateEvidence = imageText.verdict === 'dropped' ? <p className="check-line" data-testid="check-alert-image_text-dropped">{t('The picture on file was dropped from the checks.')}</p>
    : imageText.verdict === 'no_pictures' ? <p className="check-line" data-testid="check-alert-image_text-no-pictures">{t('No picture is on file for this SKU.')}{imageText.referenced > 0 ? ` ${t('The sheet references {count} file name(s) that never arrived.', { count: imageText.referenced })}` : ''}</p>
    : imageText.verdict === 'not_read' ? <p className="check-line" data-testid="check-alert-image_text-not-read">{t('The picture on file was not read this time.')}{imageText.fallbackReason ? ` (${imageText.fallbackReason})` : ''}</p>
    : imageText.verdict === 'not_run' ? <p className="check-line" data-testid="check-clear-image_text">{t('Not run yet.')}</p>
    : <p className="check-line" data-testid="check-clear-image_text">{t('The picture agrees with the stored facts.')}</p>;
  const imageStateActions = imageText.verdict === 'dropped' && droppedPicture ? <div className="fact-actions"><Button variant="secondary" busy={busy === 'image-restore'} disabled={!!busy} onClick={() => void act('image-restore', () => mockApi.restoreImageCheck(droppedPicture.fileName), t('The picture takes part in the check again on the next run.'))}>{t('Restore this picture')}</Button></div>
    : imageText.verdict === 'no_pictures' ? <div className="fact-actions"><Button variant="secondary" disabled={!!busy} onClick={() => navigate('materials')}>{t('Upload pictures in Materials')}</Button></div>
    : imageText.verdict === 'not_read' || imageText.verdict === 'not_run' ? <div className="fact-actions"><Button variant="secondary" busy={busy === 'image-check'} disabled={!!busy} onClick={() => void act('image-check', () => mockApi.recheckImages(), t('Printed text re-checked against the current facts.'))}><ScanLine size={16} />{t('Re-check printed text')}</Button></div>
    : null;
  const imageRows = disputes.length
    ? disputes.map(fact => ({ evidence: <p className="check-line" key={fact.key} data-testid={`check-dispute-${fact.key}`}>{t('{field}: the picture prints “{image}”, the fact says “{fact}”.', { field: t(fact.label), image: fact.imageCheck?.imageValue || '—', fact: t(fact.imageCheck?.factValue || fact.value) })}</p>, action: imageDecision(fact) }))
    : [{ evidence: imageStateEvidence, action: imageStateActions }];

  // A report on file is required: without one the task cannot move on, so its absence is raised and
  // the column carries the way to produce one.
  const reportEvidence = !report.declared ? <p className="check-line" data-testid="check-alert-quality_report-missing">{t('No quality report has been submitted for this SKU.')}</p>
    : report.verdict === 'not_registered' ? <p className="check-line">{t('Report {report} is no longer checked.', { report: report.reportNo })}</p>
    : report.verdict === 'expired' ? <p className="check-line">{t('Report {report} expired on {until}.', { report: report.reportNo, until: product.qualityReport?.validUntil ?? '—' })}</p>
    : report.verdict === 'failed' ? <p className="check-line">{t('Report {report} failed.', { report: report.reportNo })}</p>
    : report.verdict === 'mismatch' ? <>{report.problems.map(problem => <p className="check-line" key={problem.factKey} data-testid={`report-mismatch-${problem.factKey}`}>{t('{field}: the report states “{reportValue}”, the fact says “{factValue}”.', { field: t(problem.label), reportValue: problem.reportValue, factValue: t(problem.factValue) })}</p>)}</>
    : <p className="check-line" data-testid="check-clear-quality_report">{t('Report {report} is on file, valid until {until}.', { report: report.reportNo, until: product.qualityReport?.validUntil ?? t('no expiry stated') })}</p>;
  const reportActions = !report.declared ? <div className="fact-actions">{submitReportButton}</div>
    : report.verdict === 'expired' ? <div className="fact-actions">{submitReportButton}<Button variant="ghost" disabled={!!busy} busy={busy === 'report-discard'} onClick={() => void discardReport(report.reportNo)}>{t('Discard this report')}</Button></div>
    : report.verdict === 'failed' ? <div className="fact-actions">{submitReportButton}</div>
    : report.verdict === 'mismatch' ? (report.problems.length > 1
      ? <CheckDecision label={t('Quality report')} busy={busy} options={[...report.problems.map(problem => ({ label: `${t('Adopt the report value')} · ${t(problem.label)}`, run: () => adoptReportValue(problem) })), { label: t('Discard this report'), run: () => discardReport(report.reportNo) }]} />
      : <div className="fact-actions">{report.problems.map(problem => <Button key={problem.factKey} variant="secondary" disabled={!!busy} busy={busy === `report-adopt-${problem.factKey}`} onClick={() => void adoptReportValue(problem)}>{t('Adopt the report value')}</Button>)}<Button variant="ghost" disabled={!!busy} busy={busy === 'report-discard'} onClick={() => void discardReport(report.reportNo)}>{t('Discard this report')}</Button></div>)
    : null;

  // The transport verdict is already one line plus its own form, so it stays whole in its column.
  const hazmatCell = product.transport && hazmat.verdict === 'clear' && !hazmat.fragile
    ? <p className="check-line" data-testid="check-clear-transport">{t('Declared and clear.')}</p>
    : <HazmatNotice product={product} />;

  // The pricing facts are the fourth check. A missing weight blocks the price, so it is raised here and
  // closed here — the same place every other alarm is decided, instead of a button buried in a card.
  const pricingChecks = state.pricing?.status === 'blocked' ? [
    { label: 'Packaging Weight', keys: ['packagingWeight'] },
    { label: 'Packaging Dimensions', keys: ['packageLength', 'packageWidth', 'packageHeight'] },
    { label: 'Supplier cost', keys: ['supplierCost'] },
  ].filter(entry => state.pricing!.missing.includes(entry.label)).map(entry => ({
    label: entry.label,
    rows: entry.keys.map(key => facts.find(candidate => candidate.key === key)).filter((fact): fact is Fact => !!fact),
  })).filter(entry => entry.rows.length > 0) : [];
  const pricingCell = pricingChecks.length ? <Notice tone="amber">
    <p className="check-line" data-testid="check-alert-pricing">{t('Pricing stays closed until {list} is confirmed.', { list: pricingChecks.map(entry => t(entry.label)).join(' · ') })}</p>
    <div className="fact-actions">{pricingChecks.map(entry => {
      const gap = entry.rows.find(row => row.value === 'Missing');
      return gap
        ? <Button key={entry.rows[0].key} variant="secondary" disabled={!!busy} onClick={() => requestFactEdit(gap.key)}>{t('Add Value')} · {t(entry.label)}</Button>
        : <Button key={entry.rows[0].key} variant="secondary" disabled={!!busy} busy={busy === `confirm-${entry.rows[0].key}`} onClick={() => void act(`confirm-${entry.rows[0].key}`, async () => {
            for (const row of entry.rows) if (row.status !== 'Confirmed') await mockApi.confirmFact(row.key);
            return mockApi.getState();
          }, 'Fact confirmed. Downstream eligibility has been recalculated.')}>{t('Confirm')} · {t(entry.label)}</Button>;
    })}</div>
  </Notice>
    : <p className="check-line" data-testid="check-clear-pricing">{state.pricing ? t('Priced from the confirmed facts.') : t('No pricing data for this product yet.')}</p>;
  const pricingTone = pricingChecks.length ? 'amber' : 'clear';

  const imageTone = disputes.length ? 'red' : disputes.length === 0 && (imageText.verdict === 'read' || imageText.verdict === 'not_run') ? 'clear' : 'amber';
  const reportTone = !report.declared || report.verdict === 'expired' ? 'amber' : report.verdict === 'failed' || report.verdict === 'mismatch' ? 'red' : 'clear';
  const hazmatTone = hazmat.verdict === 'forbidden' ? 'red' : hazmat.verdict === 'needs_documents' ? 'amber' : 'clear';
  // Each disagreement is its own alarm; a picture state that needs a decision counts once.
  const alarms = disputes.length + (imageTone !== 'clear' && !disputes.length ? 1 : 0) + (reportTone !== 'clear' ? 1 : 0) + (hazmatTone !== 'clear' ? 1 : 0) + (pricingTone !== 'clear' ? 1 : 0);
  const name = (title: string, tone: string) => <span className="check-name">{tone !== 'clear' && (tone === 'red' ? <TriangleAlert size={14} /> : <CircleAlert size={14} />)}{title}</span>;

  return <section className="panel check-alerts" aria-label={t('Check alerts')} data-testid="check-alerts">
    <div className="panel-title"><ShieldCheck size={20} /><h2>{t('Check alerts')}</h2><Badge tone={alarms ? 'red' : 'green'}>{t(alarms ? '{count} alarm(s) to decide' : 'No alarm', { count: alarms })}</Badge></div>
    <div className="check-table-wrap"><table className="check-table">
      <colgroup><col className="col-evidence" /><col className="col-action" /><col className="col-report" /><col className="col-transport" /><col className="col-pricing" /></colgroup>
      <thead>
        <tr>
          <th colSpan={2} rowSpan={2} className={imageTone}>{name(t('Picture information check'), imageTone)}</th>
          <th rowSpan={2} className={reportTone}>{name(t('Quality report'), reportTone)}</th>
          <th rowSpan={2} className={hazmatTone}>{name(t('Transport attributes'), hazmatTone)}</th>
          <th rowSpan={2} className={pricingTone}>{name(t('Pricing facts'), pricingTone)}</th>
        </tr>
        <tr><th className={`check-sub ${imageTone}`}>{t('Evidence description')}</th><th className={`check-sub ${imageTone}`}>{t('Action')}</th></tr>
      </thead>
      <tbody>{imageRows.map((row, index) => <tr key={index}>
        <td className={imageTone} data-label={`${t('Picture information check')} · ${t('Evidence description')}`} data-testid="check-row-image-text">{row.evidence}</td>
        <td className={imageTone} data-label={`${t('Picture information check')} · ${t('Action')}`} data-testid="check-actions-image-text">{row.action}
          {disputes.length > 0 && index === imageRows.length - 1 && <div className="fact-actions"><Button variant="ghost" disabled={!!busy} onClick={() => openFactComparison()?.scrollIntoView({ block: 'start' })}>{t('Show them in Fact Review')}</Button></div>}
        </td>
        {index === 0 && <td rowSpan={imageRows.length} className={reportTone} data-label={t('Quality report')} data-testid="check-row-quality-report">{reportEvidence}{reportActions}</td>}
        {index === 0 && <td rowSpan={imageRows.length} className={hazmatTone} data-label={t('Transport attributes')} data-testid="check-row-transport">{hazmatCell}</td>}
        {index === 0 && <td rowSpan={imageRows.length} className={pricingTone} data-label={t('Pricing facts')} data-testid="check-row-pricing">{pricingCell}</td>}
      </tr>)}</tbody>
    </table></div>
    <Modal open={reportOpen} onOpenChange={value => !value && !busy && setReportOpen(false)} title={t('Submit a quality report')} description={t('The report is the laboratory statement, not our own reading: nothing in it changes the product facts.')}>
      <form noValidate onSubmit={event => { event.preventDefault(); void submitReport(); }}>
        <label className="form-field">{t('Report number')}<input autoFocus maxLength={120} value={reportNo} disabled={!!busy} onChange={event => setReportNo(event.target.value)} placeholder={t('For example: QC-2026-1001')} /></label>
        <label className="form-field">{t('Report file')}<input ref={reportFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={!!busy} onChange={event => setReportFile(event.target.files?.[0] ?? null)} /></label>
        <label className="form-field">{t('Report verdict')}<select value={reportResult} disabled={!!busy} onChange={event => setReportResult(event.target.value === 'fail' ? 'fail' : 'pass')}><option value="pass">{t('Qualified')}</option><option value="fail">{t('Unqualified')}</option></select></label>
        <label className="form-field">{t('Valid until')}<input type="date" value={reportValidUntil} disabled={!!busy} onChange={event => setReportValidUntil(event.target.value)} /></label>
        {reportError && <div className="notice red" role="alert">{t(reportError)}</div>}
        <div className="modal-actions"><Button type="button" variant="secondary" disabled={!!busy} onClick={() => setReportOpen(false)}>{t('Cancel')}</Button><Button type="submit" disabled={!!busy || !reportNo.trim() || !reportFile} busy={busy === 'quality-report'}>{t('Submit the report')}</Button></div>
      </form>
    </Modal>
  </section>;
}
