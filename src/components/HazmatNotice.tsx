import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { Product } from '../types';
import { assessHazmat } from '../../shared/hazmat';
import { mockApi } from '../services/mockApi';
import { useDemo } from './DemoContext';
import { useI18n } from '../i18n/I18nContext';
import { Button, Notice } from './ui';

/**
 * Transport verdict for the selected product.
 *
 * It warns while drafting and blocks publishing through the server gate. A "needs documents" verdict
 * can be released by recording the paperwork; a factual shipping ban cannot — there the data is the fix.
 */
export function HazmatNotice({ product }: { product?: Product }) {
  const { t } = useI18n();
  const { setState, notify } = useDemo();
  const [documents, setDocuments] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!product) return null;
  const verdict = assessHazmat(product.transport);
  // A quiet line on purpose: most legacy rows carry no transport columns, publishing never waits for
  // them, and an alert banner here would shout on every product.
  if (!verdict.declared) return <p className="hazmat-hint" data-testid="hazmat-undeclared">{t('Transport attributes are not declared for this product; the shipping check cannot run.')}</p>;
  if (verdict.verdict === 'clear' && !verdict.fragile) return null;
  if (verdict.verdict === 'clear') return <Notice tone="amber">{t('Fragile item: pack accordingly. This does not block publishing.')}</Notice>;

  const release = product.transportRelease;
  const submit = async () => {
    setBusy(true); setError('');
    try { await mockApi.releaseHazmat(product.sku, documents); setState(mockApi.getState()); notify(t('Transport release recorded. Publishing is unlocked for these declarations.')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not record the release.'); }
    finally { setBusy(false); }
  };

  if (verdict.verdict === 'forbidden') return <Notice tone="red">
    <strong>{t('Not shippable: this product is declared as dangerous goods.')}</strong>
    <p>{t('Triggered by: {list}', { list: verdict.triggers.join(' · ') })}</p>
    <p>{t('Publishing stays blocked and there is no manual release. Correct the product data (remove or split the hazardous part) and import it again.')}</p>
  </Notice>;

  return <Notice tone="amber">
    <strong>{t('Transport documents are required before publishing.')}</strong>
    <p>{t('Triggered by: {list}', { list: verdict.triggers.join(' · ') })}</p>
    <p>{t('Required: {list}', { list: verdict.requirements.join(' · ') })}</p>
    {release
      ? <p className="hazmat-release" data-testid="hazmat-release"><CheckCircle2 size={13} /> {t('Released by {by} at {at} · {documents}', { by: release.by, at: release.at, documents: release.documents })}</p>
      : <>
        {error && <p role="alert">{t(error)}</p>}
        <label className="form-field">{t('Document type and reference')}<input value={documents} maxLength={200} disabled={busy} onChange={event => setDocuments(event.target.value)} placeholder={t('For example: UN38.3 report 2026-1234')} /></label>
        <Button disabled={busy || !documents.trim()} onClick={() => void submit()}>{t('Record dispatch paperwork')}</Button>
      </>}
  </Notice>;
}
