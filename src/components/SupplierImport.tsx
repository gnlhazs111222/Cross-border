import { useRef, useState } from 'react';
import { Download, FileUp, RotateCcw } from 'lucide-react';
import { useDemo } from './DemoContext';
import { Badge, Button, Modal, Notice } from './ui';
import { useI18n } from '../i18n/I18nContext';
import { mockApi } from '../services/mockApi';
import { SERVER_MODE } from '../services/apiClient';
import { matchAssetFiles } from '../../shared/asset-match';
import type { ImportIssue, ImportMode, ImportPreview, ImportReport } from '../types';

function ImportResults({ report }: { report: ImportReport }) {
  const { t } = useI18n();
  const issueText = (issue: ImportIssue) => {
    const messages = {
      required: 'Missing required field: {field}', number: 'Invalid number: {field}',
      boolean: 'Use true/false or 1/0: {field}', formula: 'Use plain values; formulas and error cells are unsupported: {field}',
      extra: 'Unexpected extra values: {field}', long: 'Value exceeds 220 characters: {field}',
      duplicate: 'Duplicate SKU skipped; the first accepted product is retained.',
      missing: 'Missing {field}; pricing is blocked.',
    };
    return t(messages[issue.code], { field: t(issue.field) });
  };
  return <div className="import-results">
    <div className="import-counts" aria-label={t('Import summary')}>
      {([['Rows processed', report.processed], ['Ready', report.ready], ['Missing Data', report.missing], ['Duplicate', report.duplicates], ['Invalid row', report.invalid]] as const).map(([label, count]) => <div key={label}><strong>{count}</strong><span>{t(label)}</span></div>)}
    </div>
    <details className="import-row-details" open={report.invalid > 0}>
      <summary>{t('Row validation details')}</summary>
      <div className="table-scroll"><table className="fact-table"><thead><tr><th>{t('Row')}</th><th>SKU</th><th>{t('Status')}</th><th>{t('Validation result')}</th></tr></thead><tbody>
        {report.rows.map(row => <tr key={row.row}><td>{row.row}</td><td><code>{row.sku || '—'}</code></td><td><Badge tone={row.status === 'ready' ? 'green' : row.status === 'invalid' ? 'red' : 'amber'}>{t(row.status === 'ready' ? 'Ready' : row.status === 'missing_data' ? 'Missing Data' : row.status === 'duplicate' ? 'Duplicate' : 'Invalid row')}</Badge></td><td>{row.issues.length ? row.issues.map((issue, index) => <p key={index}>{issueText(issue)}</p>) : t('Accepted')}</td></tr>)}
      </tbody></table></div>
    </details>
  </div>;
}

export function SupplierImport({ onDatasetChange }: { onDatasetChange: () => void }) {
  const { t } = useI18n();
  const { state, busy, act } = useDemo();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>('replace');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [folder, setFolder] = useState<File[]>([]);
  const [attachment, setAttachment] = useState<{ attached: number; missing: string[]; unreferenced: string[]; grouped: string[] } | null>(null);
  const [alignment, setAlignment] = useState<import('../../server/services/imports').ImportPreviewResult | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const batch = mockApi.importBatch();

  const inspectFile = async (selectedFile: File, selectedMode: ImportMode) => {
    setFile(selectedFile); setPreview(null); setError('');
    await act('import-preview', async () => {
      try { setPreview(await mockApi.previewSupplierFile(selectedFile, selectedMode)); return mockApi.getState(); }
      catch (e) {
        const message = e instanceof Error ? e.message : 'Could not read supplier file. Use a valid .xlsx workbook or UTF-8 CSV.';
        setError(message);
        requestAnimationFrame(() => errorRef.current?.focus());
        throw new Error(message);
      }
    }, 'File checked. Review the rows before importing.');
  };

  return <>
    <section className="panel supplier-import-panel">
      <div className="supplier-import-toolbar"><div><h2>{t('Supplier materials')}</h2><p>{t('Use the built-in demo or import a fixed-template supplier file. Files stay in this browser.')}</p></div><div className="supplier-import-actions">
        <Button variant="secondary" disabled={!!busy} onClick={() => { setFile(null); setPreview(null); setError(''); setMode('replace'); setOpen(true); }}><FileUp size={16} />{t('Import Supplier File')}</Button>
        <Button variant="secondary" disabled={!!busy} busy={busy === 'load-dataset'} onClick={async () => { if (await act('load-dataset', () => mockApi.loadBuiltInDataset(), 'Built-in demo dataset loaded. Launch progress has been reset.')) onDatasetChange(); }}><RotateCcw size={15} />{t('Load Demo Dataset')}</Button>
      </div></div>
      <div className="supplier-file-links"><span>{t('Download sample:')}</span><a href="/demo/prismlaunch-supplier-demo.xlsx" download><Download size={13} />Excel (.xlsx)</a><a href="/demo/prismlaunch-supplier-demo.csv" download><Download size={13} />CSV (.csv)</a><span>{t('Loading a dataset resets launch progress.')}</span></div>
      {state.importReport && <div className="completed-import" data-testid="import-completed"><div className="section-heading"><h3>{t('Import completed')}</h3><Badge tone="green">{t(state.importReport.mode === 'replace' ? 'Dataset replaced' : 'New SKUs added')}</Badge></div><p className="import-filename">{state.importReport.fileName}</p><ImportResults report={state.importReport} /></div>}
      {batch && <div className="import-batch-summary" data-testid="import-batch-summary">
        <Badge tone={batch.status === 'needs_review' ? 'amber' : 'green'}>{t(batch.status === 'needs_review' ? 'Needs review' : 'Completed')}</Badge>
        <span>{t('Mode: {mode}', { mode: t(batch.mode) })}</span>
        <span>{t('New: {count}', { count: batch.counts.new })}</span>
        <span>{t('Same: {count}', { count: batch.counts.same })}</span>
        <span>{t('Conflicts: {count}', { count: batch.counts.conflict })}</span>
        <span>{t('Uncertain: {count}', { count: batch.counts.probable })}</span>
        {batch.counts.duplicate + batch.counts.invalid > 0 && <span>{t('Skipped: {count}', { count: batch.counts.duplicate + batch.counts.invalid })}</span>}
        {attachment && <div className="notice" data-testid="attachment-result-panel">{t('Attached {count} file(s) to products.', { count: attachment.attached })}{attachment.missing.length > 0 && <> {t('Missing: {list}', { list: attachment.missing.join(', ') })}</>}{attachment.unreferenced.length > 0 && <> {t('Not referenced by any row: {list}', { list: attachment.unreferenced.join(', ') })}</>}</div>}
        {batch.urlDownloads && <span data-testid="url-downloads">{t('Links downloaded: {ok} · failed: {failed}', { ok: batch.urlDownloads.downloaded, failed: batch.urlDownloads.failed })}</span>}
      </div>}
      {batch?.urlDownloads && batch.urlDownloads.failures.length > 0 && <Notice tone="amber">{t('Some links could not be downloaded: {list}', { list: batch.urlDownloads.failures.slice(0, 3).map(failure => `${failure.reason} (${failure.url.slice(0, 48)})`).join('; ') })}</Notice>}
    </section>
    <Modal open={open} onOpenChange={value => !busy && setOpen(value)} title={t('Import Supplier File')} description={t('Fixed template only. No automatic column guessing. Maximum 2 MB and 500 data rows.')} wide>
      <label className="form-field">{t('Import mode')}<select aria-label={t('Import mode')} value={mode} disabled={!!busy} onChange={e => { const next = e.target.value as ImportMode; setMode(next); if (file) void inspectFile(file, next); }}><option value="replace">{t('Replace current dataset')}</option><option value="append">{t('Add to the current pool')}</option></select></label>
      <Notice tone="amber">{t(mode === 'replace' ? 'Import replaces the entire catalog and resets the task, evidence, listings and reviews. Duplicate rows inside the file are still reported.' : 'Import keeps the current catalog and aligns every row with it. Data that agrees is recorded as a duplicate reference; contradictory or uncertain rows stay in the import batch for a human decision instead of overwriting anything.')}</Notice>
      <label className="form-field">{t('Supplier file')}<input type="file" accept=".xlsx,.csv" aria-label={t('Supplier file')} disabled={!!busy} onChange={e => { const chosen = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (chosen) void inspectFile(chosen, mode); }} /></label>
      <label className="form-field">{t('Material folder (optional)')}<input type="file" multiple aria-label={t('Material folder (optional)')} disabled={!!busy} onChange={e => { setFolder(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = ''; }}
        {...({ webkitdirectory: '' } as Record<string, string>)} /></label>
      {preview && <p className="footnote" data-testid="reference-summary">{t('References listed in the sheet: {count}. Files chosen: {files}.', { count: preview.products.reduce((sum, product) => sum + (product.assetReferences?.length ?? 0), 0), files: folder.length })}{folder.length > 0 && <>{' '}{t('They will be matched by file name when you import.')}</>}</p>}
      {preview && folder.length > 0 && (() => {
        // Alignment is shown before anything is written, so a wrong folder is caught here rather
        // than after the import. Same tested function the upload path uses.
        const match = matchAssetFiles(preview.products.map(product => ({ sku: product.sku, assetReferences: product.assetReferences })), folder.map(file => file.name));
        const rowsWithFiles = preview.products.filter(product => match.assignments.some(assignment => assignment.sku === product.sku)).length;
        return <div className="notice" data-testid="asset-preview">
          <strong>{t('File alignment preview')}</strong>
          <p>{t('{matched} of {files} chosen files will be attached, covering {rows} of {total} rows.', { matched: match.assignments.length, files: folder.length, rows: rowsWithFiles, total: preview.products.length })}</p>
          {match.missing.length > 0 && <p>{t('Missing: {list}', { list: match.missing.join(', ') })}</p>}
          {match.unreferenced.length > 0 && <p>{t('Not referenced by any row: {list}', { list: match.unreferenced.join(', ') })}</p>}
          {match.grouped.length > 0 && <p>{t('Several files claimed by one row, please confirm: {list}', { list: match.grouped.join('; ') })}</p>}
        </div>;
      })()}
      {preview && SERVER_MODE && <div className="import-alignment" data-testid="import-alignment"><Button variant="secondary" disabled={!!busy} busy={busy === 'alignment'} onClick={() => void act('alignment', async () => { setAlignment(await mockApi.previewImportAlignment()); return mockApi.getState(); }, 'Rows compared with the current pool. Nothing has been imported yet.')}>{t('Check alignment with the pool')}</Button>{alignment && <div className="notice" data-testid="alignment-result"><strong>{t('Pool alignment preview')}</strong><p>{t('New {new} · same {same} · conflicts {conflict} · uncertain {probable} · skipped {skipped}', { new: alignment.counts.new, same: alignment.counts.same, conflict: alignment.counts.conflict, probable: alignment.counts.probable, skipped: alignment.counts.duplicate + alignment.counts.invalid })}</p>{alignment.rows.filter(row => row.verdict === 'conflict' || row.verdict === 'probable').slice(0, 6).map(row => <p key={row.row + row.sku}>{t('Row {row}', { row: row.row })} · {row.sku || t('No SKU')} · <strong>{t(row.verdict === 'conflict' ? 'Conflict' : 'Uncertain')}</strong>{row.matchedSku ? ' · ' + t('closest {sku}', { sku: row.matchedSku }) : ''}{row.conflicts.filter(conflict => conflict.key).map(conflict => ' · ' + t(conflict.field) + ': ' + conflict.a + ' → ' + conflict.b).join('')}</p>)}<p className="footnote">{t('Nothing is written until you import. Conflicts and uncertain rows stay in the batch for a decision.')}</p></div>}</div>}
      {attachment && <div className="notice" data-testid="attachment-result">{t('Attached {count} file(s) to products.', { count: attachment.attached })}{attachment.missing.length > 0 && <> {t('Missing: {list}', { list: attachment.missing.join(', ') })}</>}{attachment.unreferenced.length > 0 && <> {t('Not referenced by any row: {list}', { list: attachment.unreferenced.join(', ') })}</>}{attachment.grouped.length > 0 && <> {t('Several files claimed by one row, please confirm: {list}', { list: attachment.grouped.join('; ') })}</>}</div>}
      <details className="template-columns"><summary>{t('Supported template columns')}</summary><code>{mockApi.getSupplierTemplate().join(', ')}</code><p>{t('Use exactly these case-sensitive column names, in any order. XLSX must contain one worksheet; CSV must use UTF-8 and commas. Empty packaging fields are allowed but block pricing.')}</p></details>
      {busy === 'import-preview' && <p role="status" className="notice">{t('Parsing and validating supplier file...')}</p>}
      {error && <div ref={errorRef} className="notice red" role="alert" tabIndex={-1}>{t(error)}</div>}
      {preview && <><h3 className="import-filename">{preview.fileName}</h3><ImportResults report={preview} />{!preview.products.length && <Notice tone="amber">{t('No valid new products to import. The current dataset is unchanged.')}</Notice>}</>}
      <div className="modal-actions"><Button variant="secondary" disabled={!!busy} onClick={() => setOpen(false)}>{t('Cancel')}</Button><Button disabled={!!busy || !preview?.products.length} busy={busy === 'import-save'} onClick={async () => {
        if (await act('import-save', async () => { const state = await mockApi.importSupplierFile(); if (folder.length) setAttachment(await mockApi.attachReferencedAssets(folder)); return state; }, folder.length ? 'Import completed and referenced files were matched by name.' : 'Import completed. Valid products are now in Materials.')) { onDatasetChange(); setOpen(false); }
      }}>{busy === 'import-save' ? t('Importing products...') : t('Import {count} products', { count: preview?.products.length ?? 0 })}</Button></div>
    </Modal>
  </>;
}
