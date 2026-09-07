import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { Fact } from '../types';
import { useDemo } from './DemoContext';
import { useI18n } from '../i18n/I18nContext';
import { mockApi } from '../services/mockApi';
import { Badge, Button, Modal, Notice } from './ui';

export function FactReview() {
  const { t } = useI18n();
  const { state, busy, act, notify } = useDemo();
  const [editing, setEditing] = useState<Fact | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const facts = (state.v2 ?? state.v1)?.facts ?? [];
  const editor = editing ? mockApi.factEditor(editing) : null;
  const hadResults = Object.keys(state.listings).length > 0 || Object.keys(state.reviews).length > 0 || Object.keys(state.publications).length > 0;
  const confirm = async (f: Fact) => {
    const wasBlocked = state.pricing?.status === 'blocked';
    const ok = await act(`confirm-${f.key}`, () => mockApi.confirmFact(f.key), 'Fact confirmed. Downstream eligibility has been recalculated.');
    if (ok && wasBlocked && mockApi.getState().pricing?.status === 'ready') notify('Fact confirmed. Pricing is now available.');
  };
  return <section className="panel fact-review" aria-label={t('Fact Review')}>
    <div className="panel-title"><ClipboardCheck size={20} /><h2>{t('Fact Review')}</h2><Badge>{t('{count} confirmed fields', { count: facts.filter(f => f.status === 'Confirmed').length })}</Badge></div>
    <p className="fact-review-intro">{t('Edit or add a value, then confirm it. Only confirmed, listing-allowed facts may enter normal copy.')}</p>
    <div className="table-scroll"><table className="fact-table fact-review-table"><thead><tr><th>{t('Field')}</th><th>{t('Value')}</th><th>{t('Source:')}</th><th>{t('Status')}</th><th>{t('Listing Use')}</th><th>{t('Action')}</th></tr></thead><tbody>
      {facts.map(f => {
        const editable = mockApi.editableFact(f.key);
        const canConfirm = editable && !['Missing', 'Confirmed'].includes(f.status) && f.value !== 'Missing';
        return <tr key={f.key} data-testid={`fact-review-${f.key}`}>
          <th scope="row">{t(f.label)}</th><td className="review-fact-value">{t(f.value)}</td>
          <td className="review-fact-source"><Badge tone={f.sourceKind === 'manual' ? 'blue' : 'neutral'}>{t(f.sourceKind === 'manual' ? 'Manual Confirmation' : f.sourceKind === 'supplier' ? 'Supplier File' : 'Mock Evidence')}</Badge><details><summary>{t(f.source)}</summary><small>{f.anchor}</small>{f.previousValue !== undefined && <small>{t('Previous value:')} {t(f.previousValue)}</small>}{f.previousSource && <small>{t('Previous source:')} {f.previousSource}</small>}{f.confirmedAt && <small>{t('Confirmed at:')} <time dateTime={f.confirmedAt}>{f.confirmedAt}</time></small>}</details></td>
          <td><Badge tone={f.status === 'Confirmed' ? 'green' : f.status === 'Rejected' ? 'red' : 'amber'}>{t(f.status === 'Requires Confirmation' ? 'Needs confirmation' : f.status)}</Badge></td>
          <td><Badge tone={f.allowed && f.status === 'Confirmed' ? 'green' : 'neutral'}>{t(f.allowed && f.status === 'Confirmed' ? 'Allowed' : 'Not allowed')}</Badge></td>
          <td><div className="fact-actions">
            {editable && <Button variant="secondary" disabled={!!busy} onClick={() => { setEditing(f); setValue(mockApi.factEditor(f).value); setError(''); }}>{t(f.status === 'Missing' ? 'Add Value' : 'Edit')}</Button>}
            {canConfirm && <Button disabled={!!busy} busy={busy === `confirm-${f.key}`} onClick={() => void confirm(f)}>{t('Confirm')}</Button>}
            {f.status !== 'Rejected' && f.status !== 'Missing' && <Button variant="ghost" disabled={!!busy} busy={busy === `reject-${f.key}`} onClick={() => void act(`reject-${f.key}`, () => mockApi.rejectFact(f.key), hadResults ? 'Fact rejected. Previous listings, reviews and publish results were cleared.' : 'Fact rejected. It cannot be used in normal listing copy.')}>{t('Reject')}</Button>}
          </div>{f.key === 'leakproof' && <small className="restricted-claim">{t('Unsupported performance claim; confirmation is unavailable. Demo risk injection remains separate.')}</small>}</td>
        </tr>;
      })}
    </tbody></table></div>
    <p className="footnote fact-change-policy">{t('Fact changes clear existing listings, reviews and publish results for both platforms. Pricing checks confirmed weight, dimensions and supplier cost; its fixed demo fees stay unchanged.')}</p>
    <Modal open={!!editing} onOpenChange={open => !open && !busy && setEditing(null)} title={t(editing?.status === 'Missing' ? 'Add Missing Value' : 'Edit Fact')} description={t('Saving records Manual confirmation as the source and leaves the fact pending. Click Confirm in Fact Review to authorize the value.')}>
      {editing && editor && <form noValidate onSubmit={async event => {
        event.preventDefault(); setError('');
        const ok = await act(`edit-fact-${editing.key}`, async () => {
          try { return await mockApi.editFact(editing.key, value); }
          catch (e) { setError(e instanceof Error ? e.message : 'A value is required before confirmation.'); throw e; }
        }, hadResults ? 'Fact updated. Previous listings, reviews and publish results were cleared. Confirm the new value.' : 'Fact updated. Confirm the value before use.');
        if (ok) setEditing(null);
      }}>
        <label className="form-field">{t(editing.label)}{editor.kind === 'select' ? <select value={value} disabled={!!busy} onChange={event => setValue(event.target.value)}><option value="Included">{t('Included')}</option><option value="No straw">{t('No straw')}</option></select> : <input autoFocus aria-invalid={!!error} aria-describedby={error ? 'fact-error' : undefined} type={editor.kind} min={editor.kind === 'number' ? editor.min : undefined} max={editor.kind === 'number' ? 1000000 : undefined} step={editor.step} maxLength={220} value={value} disabled={!!busy} onChange={event => setValue(event.target.value)} />}</label>
        {editor.unit && <p className="fact-unit">{t('Unit:')} {editor.unit}</p>}
        {error && <div className="notice red" role="alert" id="fact-error">{t(error)}</div>}
        <Notice>{t('Manual confirmation records an operator decision. It does not create independent evidence or certify product performance.')}</Notice>
        <div className="modal-actions"><Button type="button" variant="secondary" disabled={!!busy} onClick={() => setEditing(null)}>{t('Cancel')}</Button><Button type="submit" disabled={!!busy} busy={busy === `edit-fact-${editing.key}`}>{t('Save Value')}</Button></div>
      </form>}
    </Modal>
  </section>;
}
