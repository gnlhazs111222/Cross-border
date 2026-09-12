import { useEffect, useRef, useState } from 'react';
import { Check, FileClock, GitMerge, X } from 'lucide-react';
import type { ImportBatchDetail, ImportBatchDto, ImportOccurrenceDto, ImportResolution, ImportRuleDto } from '../../shared/contracts';
import { SERVER_MODE } from '../services/apiClient';
import { mockApi } from '../services/mockApi';
import { useDemo } from './DemoContext';
import { useI18n } from '../i18n/I18nContext';
import { Badge, Button } from './ui';

const time = (iso: string) => new Date(iso).toLocaleString();
const verdictTone = (verdict: string) => verdict === 'conflict' ? 'red' as const : 'amber' as const;
/** The columns a reviewer compares when a row is matched to a product that is already in the pool. */
const DETAIL_FIELDS: { key: string; label: string }[] = [
  { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product name' }, { key: 'category', label: 'Category' },
  { key: 'color', label: 'Color' }, { key: 'capacity', label: 'Capacity' }, { key: 'material', label: 'Material' },
  { key: 'straw', label: 'Straw' }, { key: 'countryOfOrigin', label: 'Country of origin' },
  { key: 'packagingWeight', label: 'Packaging Weight' }, { key: 'packagingDimensions', label: 'Packaging Dimensions' },
  { key: 'supplierCost', label: 'Supplier cost' }, { key: 'declaredValue', label: 'Declared value' },
];

/**
 * Which batch the panel opens on. A fresh import always wins, because those are the rows the reviewer
 * just produced; afterwards the selection sticks, and a selection that no longer exists falls back to
 * outstanding work before it falls back to the newest file.
 */
export function preferredBatchId(list: ImportBatchDto[], selected: string | undefined, freshImport: boolean): string | undefined {
  if (!list.length) return undefined;
  if (freshImport) return list[0].recordId;
  if (selected && list.some(batch => batch.recordId === selected)) return selected;
  return (list.find(batch => batch.status === 'needs_review') ?? list[0]).recordId;
}

/**
 * Two independent panels on purpose.
 *
 * 1. Decisions: only the rows that genuinely need a human (conflict / uncertain). It never lists the
 *    "same" and "new" rows, which are recorded for traceability but need no action.
 * 2. Import batches: one row per imported file, collapsed by default, with the newest batch summary.
 */
export function ImportReview({ refreshToken = 0 }: { refreshToken?: number }) {
  const { t } = useI18n();
  const { state, notify } = useDemo();
  /**
   * What the file says about one row, next to what the matched product already holds. Only the columns
   * a reviewer compares are listed, and the ones that disagree get marked.
   */
  const detailRows = (occurrence: ImportOccurrenceDto) => {
    const incoming = occurrence.payload as Record<string, unknown>;
    const stored = state.catalog.find(product => product.sku === occurrence.matchedSku) as unknown as Record<string, unknown> | undefined;
    const shown = (value: unknown) => value === undefined || value === null || value === '' ? '—' : typeof value === 'boolean' ? t(value ? 'Yes' : 'No') : String(value);
    return DETAIL_FIELDS
      .filter(field => shown(incoming[field.key]) !== '—' || (stored ? shown(stored[field.key]) !== '—' : false))
      .map(field => ({ key: field.key, label: field.label, incoming: shown(incoming[field.key]), stored: stored ? shown(stored[field.key]) : t('No match in the pool'),
        conflict: occurrence.conflicts.some(difference => difference.field === field.key) }));
  };
  const [batches, setBatches] = useState<ImportBatchDto[]>([]);
  const [detail, setDetail] = useState<ImportBatchDetail | null>(null);
  const [rules, setRules] = useState<ImportRuleDto[]>([]);
  const [bulkAction, setBulkAction] = useState<Exclude<ImportResolution, 'pending'>>('keep_existing');
  const [bulkVerdict, setBulkVerdict] = useState<'all' | 'conflict' | 'probable'>('all');
  const [bulkField, setBulkField] = useState('');
  const [remember, setRemember] = useState(false);
  const [prefilledFrom, setPrefilledFrom] = useState<ImportRuleDto | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastRefreshToken = useRef(refreshToken);

  const refresh = async (batchId?: string, freshImport = false) => {
    setBusy(true); setError('');
    try {
      const list = await mockApi.importBatches();
      setBatches(list);
      const loadedRules = await mockApi.importRules();
      setRules(loadedRules);
      const prefill = loadedRules.find(rule => rule.field !== '*') ?? loadedRules[0] ?? null;
      if (prefill && !prefilledFrom) {
        if (prefill.action !== 'pending') setBulkAction(prefill.action);
        setBulkVerdict(prefill.verdict === 'probable' ? 'probable' : 'conflict');
        setBulkField(prefill.field === '*' ? '' : prefill.field);
        setPrefilledFrom(prefill);
      }
      const target = batchId ?? preferredBatchId(list, detail?.batch.recordId, freshImport);
      setDetail(target ? await mockApi.importBatchDetail(target) : null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Import history is unavailable.'); }
    finally { setBusy(false); }
  };

  // serverOwner is only set once the session loads, and the list must also follow new imports.
  useEffect(() => {
    if (!SERVER_MODE) return;
    // A new import is the only thing allowed to steal the selection from the batch being reviewed.
    const freshImport = refreshToken !== lastRefreshToken.current;
    lastRefreshToken.current = refreshToken;
    void refresh(undefined, freshImport);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [refreshToken, state.serverRevision]);

  const resolve = async (occurrence: ImportOccurrenceDto, action: Exclude<ImportResolution, 'pending'>) => {
    setBusy(true); setError('');
    try {
      const updated = await mockApi.resolveOccurrence(occurrence.recordId, action);
      setDetail(updated);
      setBatches(await mockApi.importBatches());
      notify(t('Row {row} resolved.', { row: occurrence.rowNumber }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not resolve this row.'); }
    finally { setBusy(false); }
  };

  const applyBulk = async () => {
    if (!detail) return;
    setBusy(true); setError('');
    try {
      const result = await mockApi.resolveOccurrencesBulk(detail.batch.recordId, {
        action: bulkAction, ...(bulkVerdict === 'all' ? {} : { verdict: bulkVerdict }), ...(bulkField ? { field: bulkField } : {}), remember,
      });
      setDetail(result.batch); setRules(await mockApi.importRules()); setBatches(await mockApi.importBatches());
      notify(t('{applied} rows resolved, {skipped} skipped.', { applied: result.applied, skipped: result.skipped }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not apply the bulk decision.'); }
    finally { setBusy(false); }
  };

  if (!SERVER_MODE) return null;
  const waiting = detail?.occurrences.filter(occurrence => occurrence.resolution === 'pending' && (occurrence.verdict === 'conflict' || occurrence.verdict === 'probable')) ?? [];
  const awaitingDecision = batches.filter(batch => batch.status === 'needs_review');
  // The queue carries what an uploaded supplier file got wrong. Rows an older version queued for the
  // picture text check still render with their own wording, so nothing is left dangling while they go.
  const imageCheckBatch = detail?.batch.mode === 'image_check';

  return <>
    {error && <div className="notice red" role="alert">{t(error)}</div>}

    {waiting.length > 0 && <section className="panel import-decisions" data-testid="import-decisions">
      <div className="panel-title"><GitMerge size={19} /><h2>{t('Rows waiting for a decision')}</h2><Badge tone="amber">{waiting.length}</Badge>{detail && <span className="muted">{detail.batch.fileName}</span>}</div>
      <div className="import-bulk" data-testid="import-bulk">
        {prefilledFrom && <p className="import-bulk-hint" data-testid="import-bulk-prefill">{t('Pre-filled from a remembered rule: {verdict} → {action}. Applying it is still your decision.', { verdict: t(prefilledFrom.verdict === 'probable' ? 'Uncertain' : 'Conflict'), action: t(prefilledFrom.action === 'keep_existing' ? 'Keep stored value' : prefilledFrom.action === 'use_incoming' ? 'Use incoming value' : prefilledFrom.action === 'separate' ? 'Create separate product' : 'Skip this row') })}</p>}
        <label className="form-field">{t('Apply to')}<select aria-label={t('Apply to')} value={bulkVerdict} disabled={busy} onChange={e => setBulkVerdict(e.target.value as 'all' | 'conflict' | 'probable')}>
          <option value="all">{t('All waiting rows')}</option><option value="conflict">{t('Conflicts only')}</option><option value="probable">{t('Uncertain only')}</option>
        </select></label>
        <label className="form-field">{t('Field')}<select aria-label={t('Field')} value={bulkField} disabled={busy} onChange={e => setBulkField(e.target.value)}>
          <option value="">{t('Any field')}</option>
          {[...new Set(waiting.flatMap(occurrence => occurrence.conflicts.map(difference => difference.field)))].map(field => <option key={field} value={field}>{t(field)}</option>)}
        </select></label>
        <label className="form-field">{t('Decision')}<select aria-label={t('Decision')} value={bulkAction} disabled={busy} onChange={e => setBulkAction(e.target.value as Exclude<ImportResolution, 'pending'>)}>
          <option value="keep_existing">{t(imageCheckBatch ? 'Keep the stored value' : 'Keep stored value')}</option><option value="use_incoming">{t(imageCheckBatch ? 'Use what the picture prints' : 'Use incoming value')}</option>{!imageCheckBatch && <option value="separate">{t('Create separate product')}</option>}<option value="skipped">{t('Skip this row')}</option>
        </select></label>
        <label className="import-remember"><input type="checkbox" checked={remember} disabled={busy} onChange={e => setRemember(e.target.checked)} />{t('Remember this rule')}</label>
        <Button disabled={busy} onClick={() => void applyBulk()}>{t('Apply to matching rows')}</Button>
      </div>
      {waiting.map(occurrence => <article className="import-row" key={occurrence.recordId} data-testid={`import-row-${occurrence.rowNumber}`}>
        <header>
          <Badge tone={verdictTone(occurrence.verdict)}>{t(imageCheckBatch ? 'Picture text check' : occurrence.verdict === 'conflict' ? 'Conflict' : 'Uncertain')}</Badge>
          <strong>{t('Row {row}', { row: occurrence.rowNumber })}</strong>
          <code>{occurrence.sku || t('No SKU')}</code>
          <span>{occurrence.name}</span>
          {occurrence.matchedSku && <span className="import-row-match">{t('Closest match: {sku}', { sku: occurrence.matchedSku })}</span>}
        </header>
        {occurrence.conflicts.length > 0 && <ul className="import-row-diffs">
          {occurrence.conflicts.map(difference => <li key={`${difference.field}-${difference.a}`} className={difference.key ? 'key' : ''}>
            <strong>{t(difference.field)}</strong>{difference.a} → {difference.b}{difference.key ? ` · ${t('key field')}` : ''}
          </li>)}
        </ul>}
        {/* The row behind the difference: what the file says field by field, next to what the pool holds. */}
        <details className="import-row-details" data-testid={`import-row-details-${occurrence.rowNumber}`}>
          <summary>{t('Row details')}</summary>
          <div className="table-scroll"><table className="fact-table"><thead><tr><th>{t('Field')}</th><th>{t('In this file')}</th><th>{t('In the pool')}</th></tr></thead><tbody>
            {detailRows(occurrence).map(row => <tr key={row.key} className={row.conflict ? 'conflict' : undefined}>
              <th scope="row">{t(row.label)}</th><td>{row.incoming}</td><td>{row.stored}</td>
            </tr>)}
          </tbody></table></div>
          <small className="muted">{t('Read from {file} · row {row}', { file: `${String((occurrence.payload.importSource as { fileName?: string } | undefined)?.fileName ?? detail?.batch.fileName ?? '—')} · ${String((occurrence.payload.importSource as { sheetName?: string } | undefined)?.sheetName ?? '—')}`, row: String((occurrence.payload.importSource as { row?: number } | undefined)?.row ?? occurrence.rowNumber) })}</small>
        </details>
        {imageCheckBatch && <small className="muted">{t('Printed in {asset} · {region}', { asset: String(occurrence.payload.asset ?? '—'), region: String(occurrence.payload.region ?? '—') })}</small>}
        <div className="import-row-actions">
          {imageCheckBatch ? <>
            <Button variant="secondary" disabled={busy} onClick={() => void resolve(occurrence, 'keep_existing')}><Check size={14} />{t('Keep the stored value')}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void resolve(occurrence, 'use_incoming')}><Check size={14} />{t('Use what the picture prints')}</Button>
          </> : <>
            {occurrence.verdict === 'conflict' && <>
              <Button variant="secondary" disabled={busy} onClick={() => void resolve(occurrence, 'keep_existing')}><Check size={14} />{t('Keep stored value')}</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void resolve(occurrence, 'use_incoming')}><Check size={14} />{t('Use incoming value')}</Button>
            </>}
            <Button variant="secondary" disabled={busy} onClick={() => void resolve(occurrence, 'separate')}>{t('Create separate product')}</Button>
          </>}
          <Button variant="ghost" disabled={busy} onClick={() => void resolve(occurrence, 'skipped')}><X size={14} />{t('Skip this row')}</Button>
        </div>
      </article>)}
      {rules.length > 0 && <div className="import-rules" data-testid="import-rules">
        <h3>{t('Remembered rules')}</h3>
        <ul>{rules.map(rule => <li key={rule.recordId}>
          <Badge tone={rule.verdict === 'conflict' ? 'red' : 'amber'}>{t(rule.verdict === 'conflict' ? 'Conflict' : 'Uncertain')}</Badge>
          <span>{rule.field === '*' ? t('Any field') : t(rule.field)}</span>
          <strong>{t(rule.action === 'keep_existing' ? 'Keep stored value' : rule.action === 'use_incoming' ? 'Use incoming value' : rule.action === 'separate' ? 'Create separate product' : 'Skip this row')}</strong>
          <span className="muted">{t('applied {count} times', { count: rule.appliedCount })}</span>
          <Button variant="ghost" disabled={busy} onClick={async () => { setRules(await mockApi.deleteImportRule(rule.recordId)); }}><X size={14} /></Button>
        </li>)}</ul>
      </div>}
    </section>}

    <section className="panel import-review" data-testid="import-review">
      <div className="panel-title"><FileClock size={19} /><h2>{t('Import batches')}</h2>{batches.length > 0 && <Badge>{batches.length}</Badge>}<Button variant="ghost" onClick={() => setOpen(value => !value)}>{t(open ? 'Collapse' : 'Expand')}</Button></div>
      {!open && batches.length > 0 && <p className="import-review-hint">{t('Latest: {file} · {status}', { file: batches[0].fileName, status: t(batches[0].status === 'needs_review' ? 'Needs review' : 'Completed') })}</p>}
      {!open && awaitingDecision.some(batch => batch.recordId !== detail?.batch.recordId) && <p className="import-review-hint">{t('{count} batch(es) in this history still need a decision.', { count: awaitingDecision.length })}</p>}
      {open && <>
        <p className="import-review-hint">{t('Every import is recorded. Rows whose relation to the pool is unresolved stay here until someone decides.')}</p>
        {batches.length === 0
          ? <p className="import-review-empty">{t('No import has been recorded yet.')}</p>
          : <>
            <div className="table-scroll"><table className="fact-table import-batch-table"><thead><tr>
              <th>{t('File')}</th><th>{t('Mode')}</th><th>{t('Rows')}</th><th>{t('New')}</th><th>{t('Same')}</th><th>{t('Conflicts')}</th><th>{t('Uncertain')}</th><th>{t('Status')}</th><th>{t('Imported at')}</th>
            </tr></thead><tbody>
              {batches.map(batch => <tr key={batch.recordId} className={batch.recordId === detail?.batch.recordId ? 'selected' : ''} onClick={() => void refresh(batch.recordId)}>
                <td>{batch.fileName}</td>
                <td><Badge tone={batch.mode === 'merge' ? 'blue' : batch.mode === 'image_check' ? 'amber' : 'neutral'}>{t(batch.mode === 'image_check' ? 'Picture text check' : batch.mode)}</Badge></td>
                <td>{batch.rowCount}</td>
                <td>{batch.counts.new}</td>
                <td>{batch.counts.same}</td>
                <td>{batch.counts.conflict}</td>
                <td>{batch.counts.probable}</td>
                <td><Badge tone={batch.status === 'needs_review' ? 'amber' : 'green'}>{t(batch.status === 'needs_review' ? 'Needs review' : 'Completed')}</Badge></td>
                <td>{time(batch.createdAt)}{batch.source && <a className="import-source-link" href={`/api/imports/${batch.recordId}/source`} download onClick={event => event.stopPropagation()}>{t('Original file')}</a>}</td>
              </tr>)}
            </tbody></table></div>
            {detail && detail.gaps.length > 0 && <div className="import-gaps" data-testid="import-gaps">
              <h3>{t('Data gaps in this batch')}</h3>
              <ul>{detail.gaps.map(gap => <li key={gap.field}><Badge tone="amber">{gap.rows}</Badge><span>{t(gap.field)}</span></li>)}</ul>
              <p className="footnote">{t('Missing data does not block the import: those rows are stored but cannot be priced or ranked until the facts are completed.')}</p>
            </div>}
          </>}
      </>}
    </section>
  </>;
}
