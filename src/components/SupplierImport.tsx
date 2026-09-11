import { useRef, useState } from 'react';
import { Download, FileUp, RotateCcw } from 'lucide-react';
import { useDemo } from './DemoContext';
import { Badge, Button, Modal, Notice } from './ui';
import { useI18n } from '../i18n/I18nContext';
import { mockApi } from '../services/mockApi';
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
  const errorRef = useRef<HTMLDivElement>(null);

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
      <div className="supplier-file-links"><span>{t('Download sample:')}</span><a href="/demo/prismlaunch-supplier-demo.xlsx" download><Download size={13} />{t('Bottle Excel')}</a><a href="/demo/prismlaunch-supplier-demo.csv" download><Download size={13} />{t('Bottle CSV')}</a><a href="/demo/prismlaunch-bag-demo.csv" download><Download size={13} />{t('Bag CSV')}</a><span>{t('Loading a dataset resets launch progress.')}</span></div>
      {state.importReport && <div className="completed-import" data-testid="import-completed"><div className="section-heading"><h3>{t('Import completed')}</h3><Badge tone="green">{t(state.importReport.mode === 'replace' ? 'Dataset replaced' : 'New SKUs added')}</Badge></div><p className="import-filename">{state.importReport.fileName}</p><ImportResults report={state.importReport} /></div>}
    </section>
    <Modal open={open} onOpenChange={value => !busy && setOpen(value)} title={t('Import Supplier File')} description={t('Fixed template only. No automatic column guessing. Maximum 2 MB and 500 data rows.')} wide>
      <label className="form-field">{t('Import mode')}<select aria-label={t('Import mode')} value={mode} disabled={!!busy} onChange={e => { const next = e.target.value as ImportMode; setMode(next); if (file) void inspectFile(file, next); }}><option value="replace">{t('Replace current dataset')}</option><option value="append">{t('Add new SKUs only')}</option></select></label>
      <Notice tone="amber">{t(mode === 'replace' ? 'Import replaces the entire catalog and resets the task, evidence, listings and reviews. Duplicate rows inside the file are skipped.' : 'Import adds only new SKUs and resets launch progress. SKUs already in the catalog or repeated in the file are skipped; existing products are not overwritten.')}</Notice>
      <label className="form-field">{t('Supplier file')}<input type="file" accept=".xlsx,.csv" aria-label={t('Supplier file')} disabled={!!busy} onChange={e => { const chosen = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (chosen) void inspectFile(chosen, mode); }} /></label>
      <details className="template-columns"><summary>{t('Supported template columns')}</summary><code>{mockApi.getSupplierTemplate().join(', ')}</code><p>{t('Use exactly these case-sensitive column names, in any order. XLSX must contain one worksheet; CSV must use UTF-8 and commas. Capacity and straw may be blank for bags; empty packaging fields block pricing after selection.')}</p></details>
      {busy === 'import-preview' && <p role="status" className="notice">{t('Parsing and validating supplier file...')}</p>}
      {error && <div ref={errorRef} className="notice red" role="alert" tabIndex={-1}>{t(error)}</div>}
      {preview && <><h3 className="import-filename">{preview.fileName}</h3><ImportResults report={preview} />{!preview.products.length && <Notice tone="amber">{t('No valid new products to import. The current dataset is unchanged.')}</Notice>}</>}
      <div className="modal-actions"><Button variant="secondary" disabled={!!busy} onClick={() => setOpen(false)}>{t('Cancel')}</Button><Button disabled={!!busy || !preview?.products.length} busy={busy === 'import-save'} onClick={async () => {
        if (await act('import-save', () => mockApi.importSupplierFile(), 'Import completed. Valid products are now in Materials.')) { onDatasetChange(); setOpen(false); }
      }}>{busy === 'import-save' ? t('Importing products...') : t('Import {count} products', { count: preview?.products.length ?? 0 })}</Button></div>
    </Modal>
  </>;
}
