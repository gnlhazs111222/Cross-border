import { useEffect, useState } from 'react';
import { Check, FileClock, GitMerge, X } from 'lucide-react';
import type { ImportBatchDetail, ImportBatchDto, ImportOccurrenceDto, ImportResolution, ImportRuleDto } from '../../shared/contracts';
import { SERVER_MODE } from '../services/apiClient';
import { mockApi } from '../services/mockApi';
import { useDemo } from './DemoContext';
import { useI18n } from '../i18n/I18nContext';
import { Badge, Button } from './ui';

const time = (iso: string) => new Date(iso).toLocaleString();
const verdictTone = (verdict: string) => verdict === 'conflict' ? 'red' as const : 'amber' as const;

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

  const refresh = async (batchId?: string) => {
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
      const target = batchId ?? detail?.batch.recordId ?? list[0]?.recordId;
      setDetail(target ? await mockApi.importBatchDetail(target) : null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Import history is unavailable.'); }
    finally { setBusy(false); }
  };

  // serverOwner is only set once the session loads, and the list must also follow new imports.
  useEffect(() => { if (SERVER_MODE) void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refreshToken, state.serverRevision]);

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
          <option value="keep_existing">{t('Keep stored value')}</option><option value="use_incoming">{t('Use incoming value')}</option><option value="separate">{t('Create separate product')}</option><option value="skipped">{t('Skip this row')}</option>
        </select></label>
        <label className="import-remember"><input type="checkbox" checked={remember} disabled={busy} onChange={e => setRemember(e.target.checked)} />{t('Remember this rule')}</label>
        <Button disabled={busy} onClick={() => void applyBulk()}>{t('Apply to matching rows')}</Button>
      </div>
      {waiting.map(occurrence => <article className="import-row" key={occurrence.recordId} data-testid={`import-row-${occurrence.rowNumber}`}>
        <header>
          <Badge tone={verdictTone(occurrence.verdict)}>{t(occurrence.verdict === 'conflict' ? 'Conflict' : 'Uncertain')}</Badge>
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
        <div className="import-row-actions">
          {occurrence.verdict === 'conflict' && <>
            <Button variant="secondary" disabled={busy} onClick={() => void resolve(occurrence, 'keep_existing')}><Check size={14} />{t('Keep stored value')}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void resolve(occurrence, 'use_incoming')}><Check size={14} />{t('Use incoming value')}</Button>
          </>}
          <Button variant="secondary" disabled={busy} onClick={() => void resolve(occurrence, 'separate')}>{t('Create separate product')}</Button>
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
                <td><Badge tone={batch.mode === 'merge' ? 'blue' : 'neutral'}>{t(batch.mode)}</Badge></td>
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