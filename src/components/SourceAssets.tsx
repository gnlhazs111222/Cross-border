import { useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import type { AssetRole, ProductAsset } from '../../shared/contracts';
import { SERVER_MODE } from '../services/apiClient';
import { mockApi } from '../services/mockApi';
import { useDemo } from './DemoContext';
import { useI18n } from '../i18n/I18nContext';
import { Badge, Button, Notice } from './ui';

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';
const ROLE_VALUES: (AssetRole | 'auto')[] = ['auto', 'main', 'detail', 'packaging', 'spec', 'other'];
const ROLE_LABELS: Record<AssetRole | 'auto', string> = {
  auto: 'Automatic', main: 'Main image', detail: 'Detail image', packaging: 'Packaging image', spec: 'Specification PDF', other: 'Other',
};
const MIME_BY_EXTENSION: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };

export const assetMimeType = (file: File) => file.type || MIME_BY_EXTENSION[file.name.toLowerCase().split('.').at(-1) ?? ''] || '';

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => { const result = String(reader.result ?? ''); const comma = result.indexOf(','); resolve(comma < 0 ? '' : result.slice(comma + 1)); };
    reader.readAsDataURL(file);
  });
}

export const formatAssetSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

/** Uploads source material for one SKU. The server keeps the file and returns the authoritative list back. */
export function SourceAssets({ sku }: { sku: string }) {
  const { t } = useI18n();
  const { notify } = useDemo();
  const [assets, setAssets] = useState<ProductAsset[]>(() => mockApi.assetsFor(sku));
  const [role, setRole] = useState<AssetRole | 'auto'>('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    if (!SERVER_MODE) { setAssets([]); return; }
    setError(''); setBusy(true);
    mockApi.listAssets(sku)
      .then(next => { if (live) setAssets(next); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not load source assets.'); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [sku]);

  const upload = async (files: FileList) => {
    setError(''); setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const result = await mockApi.uploadAsset(sku, { fileName: file.name, mimeType: assetMimeType(file), ...(role === 'auto' ? {} : { role }), contentBase64: await fileToBase64(file) });
        setAssets(result.assets);
        notify(t(result.duplicate ? 'This file content already exists for {sku}.' : 'Source asset stored for {sku}.', { sku }));
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const remove = async (asset: ProductAsset) => {
    if (!window.confirm(t('Remove {name}?', { name: asset.fileName }))) return;
    setError(''); setBusy(true);
    try { setAssets(await mockApi.deleteAsset(sku, asset.recordId)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not remove the asset.'); }
    finally { setBusy(false); }
  };

  return <section className="source-assets" data-testid={`source-assets-${sku}`}>
    <div className="source-assets-head"><h4>{t('Source assets')}</h4>{assets.length > 0 && <Badge>{assets.length}</Badge>}</div>
    <p className="source-assets-hint">{t('Images and PDFs attached to this SKU. The server stores the file and keeps the hash. The picture text check compares the words printed in the images with the facts; PDFs are stored but not read yet.')}</p>
    {!SERVER_MODE
      ? <Notice tone="amber">{t('Source assets require the server-backed workspace.')}</Notice>
      : <>
        <div className="source-assets-controls">
          <label className="form-field">{t('Asset role')}<select aria-label={t('Asset role')} value={role} disabled={busy} onChange={e => setRole(e.target.value as AssetRole | 'auto')}>
            {ROLE_VALUES.map(value => <option key={value} value={value}>{t(ROLE_LABELS[value])}</option>)}
          </select></label>
          <label className="form-field">{t('Add images or PDF')}<input ref={inputRef} type="file" accept={ACCEPT} multiple aria-label={t('Add images or PDF')} disabled={busy} onChange={e => { const chosen = e.currentTarget.files; if (chosen?.length) void upload(chosen); }} /></label>
          <Button variant="secondary" disabled={busy} busy={busy} onClick={() => inputRef.current?.click()}><Upload size={15} />{t(busy ? 'Uploading...' : 'Choose files')}</Button>
        </div>
        {error && <div className="notice red" role="alert">{t(error)}</div>}
        {assets.length === 0
          ? <p className="source-assets-empty">{t('No source assets yet. Upload a product image or a specification PDF.')}</p>
          : <div className="table-scroll"><table className="fact-table source-asset-table"><thead><tr><th>{t('Preview')}</th><th>{t('File')}</th><th>{t('Kind')}</th><th>{t('Role')}</th><th>{t('Size')}</th><th>{t('Content hash')}</th><th>{t('Parse status')}</th><th><span className="sr-only">{t('Remove')}</span></th></tr></thead><tbody>
            {assets.map(asset => <tr key={asset.recordId} data-testid={`asset-${asset.fileName}`}>
              <td>{asset.kind === 'image'
                ? <img className="asset-thumb" src={mockApi.assetContentUrl(asset.recordId)} alt={asset.fileName} loading="lazy" />
                : <a className="asset-pdf" href={mockApi.assetContentUrl(asset.recordId)} target="_blank" rel="noreferrer"><FileText size={16} />PDF</a>}</td>
              <td><span className="asset-name">{asset.kind === 'image' ? <ImageIcon size={14} /> : <FileText size={14} />}{asset.fileName}</span><code>{asset.sha256.slice(0, 12)}</code></td>
              <td><Badge>{t(asset.kind === 'image' ? 'Image' : 'PDF')}</Badge></td>
              <td>{t(ROLE_LABELS[asset.role])}</td>
              <td>{formatAssetSize(asset.byteSize)}</td>
              <td><code>{asset.sha256.slice(0, 8)}</code></td>
              <td><Badge tone="amber">{t('Pending parsing')}</Badge></td>
              <td><Button variant="ghost" aria-label={t('Remove {name}', { name: asset.fileName })} disabled={busy} onClick={() => void remove(asset)}><Trash2 size={15} /></Button></td>
            </tr>)}
          </tbody></table></div>}
      </>}
  </section>;
}
