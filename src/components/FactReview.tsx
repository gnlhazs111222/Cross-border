import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { Fact } from '../types';
import { useDemo } from './DemoContext';
import { projectFactValue } from '../../shared/units';
import { useI18n } from '../i18n/I18nContext';
import { mockApi } from '../services/mockApi';
import { EDIT_DISPUTED_FACT_EVENT, useFactCheckActions } from './factCheckActions';
import { Badge, Button, Modal, Notice } from './ui';

/**
 * The two fact cards, side by side.
 *
 * V1 keeps what the supplier delivered and is never rewritten; V2 is the task card the launch is built
 * on. Every field is shown twice, so a value a check or a person changed is visible as a change — a
 * card that only listed its own new fields could look untouched right after someone adopted what a
 * picture printed. The block is collapsed by default: it is the reference behind the checks, not the
 * first thing to read.
 */
export function FactReview() {
  const { t } = useI18n();
  const { state, busy, act, notify } = useDemo();
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Fact | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  // The editor opened from a picture disagreement closes that disagreement when it saves.
  const [imageEdit, setImageEdit] = useState(false);
  const facts = (state.v2 ?? state.v1)?.facts ?? [];
  const before = new Map((state.v1?.facts ?? []).map(fact => [fact.key, fact]));
  const priority = (fact: Fact) => fact.key === focusedKey ? -1 : fact.status === 'Missing' ? 0 : fact.status === 'Requires Confirmation' ? 1 : 2;
  const orderedFacts = [...facts].sort((left, right) => priority(left) - priority(right));
  const changed = (fact: Fact) => { const original = before.get(fact.key); return !!original && original.value !== fact.value; };
  const source = (fact: Fact) => t(fact.sourceKind === 'manual' ? 'Manual Confirmation' : fact.sourceKind === 'image' ? 'Product Picture' : fact.sourceKind === 'supplier' ? 'Supplier File' : 'Mock Evidence');
  const editor = editing ? mockApi.factEditor(editing) : null;
  const hadResults = Object.keys(state.listings).length > 0 || Object.keys(state.reviews).length > 0 || Object.keys(state.publications).length > 0;
  const unit = mockApi.unitSystem();
  const confirm = async (fact: Fact) => {
    setFocusedKey(fact.key);
    const wasBlocked = state.pricing?.status === 'blocked';
    const ok = await act(`confirm-${fact.key}`, () => mockApi.confirmFact(fact.key), 'Fact confirmed. Downstream eligibility has been recalculated.');
    if (ok && wasBlocked && mockApi.getState().pricing?.status === 'ready') notify('Fact confirmed. Pricing is now available.');
  };
  /**
   * Correcting a disputed value by hand opens the editor here: the check area asks for it through the
   * same event, so one form serves both places and a person can write a third value if neither fits.
   */
  const { scrollToFact } = useFactCheckActions(setFocusedKey);
  useEffect(() => {
    const openEditor = (event: Event) => {
      const fact = facts.find(candidate => candidate.key === (event as CustomEvent<string>).detail);
      if (!fact) return;
      scrollToFact(fact.key);
      setFocusedKey(fact.key); setEditing(fact); setImageEdit(true); setValue(mockApi.factEditor(fact).value); setError('');
    };
    window.addEventListener(EDIT_DISPUTED_FACT_EVENT, openEditor);
    return () => window.removeEventListener(EDIT_DISPUTED_FACT_EVENT, openEditor);
  }, [facts, scrollToFact]);
  const closeEditor = () => { setEditing(null); setImageEdit(false); };
  return <details className="panel facts-panel fact-compare" id="fact-review" aria-label={t('Fact card comparison')} data-testid="fact-compare">
    <summary className="fact-version-header">
      <div>
        <span className="eyebrow">{t('VERSIONED PRODUCT KNOWLEDGE')}</span>
        <h2>{t('Fact card comparison')}</h2>
        <p>{t('V1 keeps what the supplier delivered. V2 is the task card: every value a check or a person changed is marked here, since V2 never rewrites V1.')}</p>
      </div>
      <Badge tone={state.v2 ? 'green' : 'neutral'}>{t(state.v2 ? 'Click to open' : 'Awaiting analysis')}</Badge>
    </summary>
    {state.v2 ? <>
      <p className="footnote fact-compare-count">{t('{count} field(s) · {changed} changed for this task', { count: facts.length, changed: facts.filter(fact => changed(fact)).length })}</p>
      <div className="table-scroll"><table className="fact-table fact-compare-table">
        <thead><tr><th>{t("Field")}</th><th>{t("FactCard V1")}</th><th>{t("FactCard V2")}</th><th>{t("Status")}</th><th>{t("Action")}</th></tr></thead>
        <tbody>{orderedFacts.map(fact => {
          const original = before.get(fact.key);
          const editable = mockApi.editableFact(fact.key);
          const canConfirm = editable && !['Missing', 'Confirmed'].includes(fact.status) && fact.value !== 'Missing';
          return <tr key={fact.key} className={fact.key === focusedKey ? 'focused-fact' : undefined} data-testid={`fact-review-${fact.key}`}>
            <th scope="row">{t(fact.label)}</th>
            <td data-label={t("FactCard V1")} className="compare-before">{original ? t(projectFactValue(fact.key, original.value, unit)) : t('Not on V1')}</td>
            <td data-label={t("FactCard V2")} className="compare-after">
              <span>{t(projectFactValue(fact.key, fact.value, unit))}</span>
              {changed(fact) && <Badge tone="amber">{t('Changed')}</Badge>}
              <Badge tone={fact.sourceKind === 'manual' ? 'blue' : fact.sourceKind === 'image' ? 'amber' : 'neutral'}>{source(fact)}</Badge>
              {fact.previousValue !== undefined && <small>{t('Previous value:')} {t(fact.previousValue)}</small>}
            </td>
            <td data-label={t("Status")} className="compare-status">
              <Badge tone={fact.status === 'Confirmed' ? 'green' : fact.status === 'Rejected' ? 'red' : 'amber'}>{t(fact.status === 'Requires Confirmation' ? 'Needs confirmation' : fact.status)}</Badge>
              <Badge tone={fact.allowed && fact.status === 'Confirmed' ? 'green' : 'neutral'}>{t(fact.allowed && fact.status === 'Confirmed' ? 'Allowed' : 'Not allowed')}</Badge>
            </td>
            <td className="review-fact-actions"><div className="fact-actions">
              {editable && <Button variant="secondary" disabled={!!busy} onClick={() => { setFocusedKey(fact.key); setEditing(fact); setImageEdit(false); setValue(mockApi.factEditor(fact).value); setError(''); }}>{t(fact.status === 'Missing' ? 'Add Value' : 'Edit')}</Button>}
              {canConfirm && <Button variant="secondary" disabled={!!busy} busy={busy === `confirm-${fact.key}`} onClick={() => void confirm(fact)}>{t('Confirm')}</Button>}
              {fact.status !== 'Rejected' && fact.status !== 'Missing' && <Button variant="ghost" disabled={!!busy} busy={busy === `reject-${fact.key}`} onClick={() => void act(`reject-${fact.key}`, () => mockApi.rejectFact(fact.key), hadResults ? 'Fact rejected. Previous listings, reviews and publish results were cleared.' : 'Fact rejected. It cannot be used in normal listing copy.')}>{t('Reject')}</Button>}
            </div>{fact.key === 'leakproof' && <small className="restricted-claim">{t('Unsupported performance claim; confirmation is unavailable. Demo risk injection remains separate.')}</small>}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="footnote fact-change-policy">{t('Fact changes clear existing listings, reviews and publish results for both platforms. Pricing checks confirmed weight, dimensions and supplier cost; its fixed demo fees stay unchanged.')}</p>
    </> : <div className="analysis-empty"><ClipboardCheck size={32} /><h3>{t("Turn evidence into usable facts")}</h3><p>{t('Analyze the evidence to build the task card; it then stands next to V1 field by field.')}</p><Button busy={busy === 'analyze'} disabled={!!busy} onClick={() => void act('analyze', () => mockApi.analyzeEvidence(), 'FactCard V2 created. Review the facts before continuing.')}>{t("Analyze Evidence")}</Button></div>}
    <Modal open={!!editing} onOpenChange={open => !open && !busy && closeEditor()} title={t(editing?.status === 'Missing' ? 'Add Missing Value' : imageEdit ? 'Correct the disputed value' : 'Edit Fact')} description={t(imageEdit ? 'Saving closes the picture disagreement this correction came from. The value is recorded as Manual confirmation and stays pending until it is confirmed.' : 'Saving records Manual confirmation as the source and leaves the fact pending. Click Confirm in the comparison to authorize the value.')}>
      {editing && editor && <form noValidate onSubmit={async event => {
        event.preventDefault(); setError('');
        const ok = await act(`edit-fact-${editing.key}`, async () => {
          try { return imageEdit ? await mockApi.saveImageCheckEdit(editing.key, value) : await mockApi.editFact(editing.key, value); }
          catch (e) { setError(e instanceof Error ? e.message : 'A value is required before confirmation.'); throw e; }
        }, imageEdit ? 'Value corrected. The picture verdict was re-read against it.' : hadResults ? 'Fact updated. Previous listings, reviews and publish results were cleared. Confirm the new value.' : 'Fact updated. Confirm the value before use.');
        if (ok) closeEditor();
      }}>
        {imageEdit && editing.imageCheck && <p className="image-mismatch" role="alert">{t('The picture prints “{image}”. Write the value that should stand, then save.', { image: editing.imageCheck.imageValue || '—' })}</p>}
        <label className="form-field">{t(editing.label)}{editor.kind === 'select' ? <select value={value} disabled={!!busy} onChange={event => setValue(event.target.value)}><option value="Included">{t('Included')}</option><option value="No straw">{t('No straw')}</option></select> : <input autoFocus aria-invalid={!!error} aria-describedby={error ? 'fact-error' : undefined} type={editor.kind} min={editor.kind === 'number' ? editor.min : undefined} max={editor.kind === 'number' ? 1000000 : undefined} step={editor.step} maxLength={220} value={value} disabled={!!busy} onChange={event => setValue(event.target.value)} />}</label>
        {editor.unit && <p className="fact-unit">{t('Unit:')} {editor.unit}</p>}
        {error && <div className="notice red" role="alert" id="fact-error">{t(error)}</div>}
        <Notice>{t('Manual confirmation records an operator decision. It does not create independent evidence or certify product performance.')}</Notice>
        <div className="modal-actions"><Button type="button" variant="secondary" disabled={!!busy} onClick={() => closeEditor()}>{t('Cancel')}</Button><Button type="submit" disabled={!!busy} busy={busy === `edit-fact-${editing.key}`}>{t('Save Value')}</Button></div>
      </form>}
    </Modal>
  </details>;
}
