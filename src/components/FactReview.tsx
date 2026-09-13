import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { Fact } from '../types';
import { useDemo } from './DemoContext';
import { projectFactValue } from '../../shared/units';
import { useI18n } from '../i18n/I18nContext';
import { mockApi } from '../services/mockApi';
import { EDIT_FACT_EVENT, requestFactEdit, scrollToFactRow, takePendingFactEdit } from './factCheckActions';
import { Badge, Button, Modal, Notice } from './ui';

/**
 * The two fact cards, left and right.
 *
 * V1 is the supplier card and is never rewritten. V2 shows the task card's own work — the fields the
 * server marked as more than the supplier's confirmed value — written the same way V1 is written, and
 * read-only on purpose: this column reports what a person concluded, it does not carry buttons. Every
 * human decision (a picture value adopted, a value corrected, a weight confirmed) lands here as soon
 * as it is taken.
 *
 * The editor itself lives here, because both this page and the check panel ask for it by fact key.
 */
export function FactReview() {
  const { t } = useI18n();
  const { state, busy, act } = useDemo();
  const [editing, setEditing] = useState<Fact | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  // The editor opened from a picture disagreement closes that disagreement when it saves.
  const [imageEdit, setImageEdit] = useState(false);
  const facts = (state.v2 ?? state.v1)?.facts ?? [];
  const changed = (fact: Fact) => (state.changedFactKeys ?? []).includes(fact.key);
  const taskFacts = facts.filter(changed);
  const editor = editing ? mockApi.factEditor(editing) : null;
  const hadResults = Object.keys(state.listings).length > 0 || Object.keys(state.reviews).length > 0 || Object.keys(state.publications).length > 0;
  const unit = mockApi.unitSystem();
  useEffect(() => {
    const openEditor = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; disputed?: boolean }>).detail;
      const fact = facts.find(candidate => candidate.key === detail.key);
      if (!fact) return;
      scrollToFactRow(detail.key);
      setEditing(fact); setImageEdit(!!detail.disputed); setValue(mockApi.factEditor(fact).value); setError('');
    };
    window.addEventListener(EDIT_FACT_EVENT, openEditor);
    return () => window.removeEventListener(EDIT_FACT_EVENT, openEditor);
  }, [facts]);
  // An edit asked for from another workspace opens here, on the page that owns the editor.
  useEffect(() => { const pending = takePendingFactEdit(); if (pending) requestFactEdit(pending); }, []);
  const closeEditor = () => { setEditing(null); setImageEdit(false); };
  return <details className="panel facts-panel fact-compare" id="fact-review" aria-label={t('Fact card comparison')} data-testid="fact-compare">
      <summary className="fact-version-header">
        <div><h2>{t("Fact card comparison")}</h2></div>
        <Badge tone={state.v2 ? 'green' : 'neutral'}>{t('Click to open')}</Badge>
      </summary>
    <div className="facts-columns">
      <div className="fact-version">
        <div className="section-heading"><h3>{t("FactCard V1")}</h3><Badge>{t(state.v1!.facts.some(f => f.sourceKind === 'manual') ? 'Base facts · manually reviewed' : 'Original · preserved')}</Badge></div>
        <p className="footnote">{t('Supplier facts · {count} fields', { count: state.v1!.facts.length })}</p>
        <dl className="fact-list">{state.v1!.facts.map(f => <div key={f.key}><dt>{t(f.label)}</dt><dd>{t(projectFactValue(f.key, f.value, unit))}</dd></div>)}</dl>
      </div>
      <div className="fact-version v2">
        <div className="section-heading"><h3>{t("FactCard V2")}</h3><Badge tone={state.v2 ? 'green' : 'neutral'}>{state.v2 ? state.v2.taskId : t('Awaiting analysis')}</Badge></div>
        {state.v2 ? <>
          <p className="footnote">{t('Inherits {count} V1 fields + 4 sample fields', { count: state.v1!.facts.length })}</p>
          {/* V2 reports, it does not carry controls: only the fields that say something V1 does not, so the
              right-hand column is the task card's own work rather than a second copy of the supplier card. */}
          {taskFacts.length === 0
            ? <p className="footnote" data-testid="fact-compare-none">{t('No field differs from the supplier card yet.')}</p>
            : <dl className="fact-list">{taskFacts.map(fact => <div key={fact.key} data-testid={`fact-review-${fact.key}`}>
              <dt>{t(fact.label)}</dt>
              <dd>{t(projectFactValue(fact.key, fact.value, unit))}</dd>
            </div>)}</dl>}
        </> : <div className="analysis-empty"><ClipboardCheck size={32} /><h3>{t("Turn evidence into usable facts")}</h3><p>{t('Analyze the evidence to build the task card; it then stands next to V1 field by field.')}</p><Button variant="secondary" busy={busy === 'analyze'} disabled={!!busy} onClick={() => void act('analyze', () => mockApi.analyzeEvidence(), 'FactCard V2 created. Review the facts before continuing.')}>{t("Analyze Evidence")}</Button></div>}
      </div>
    </div>
    <Modal open={!!editing} onOpenChange={open => !open && !busy && closeEditor()} title={t(editing?.status === 'Missing' ? 'Add Missing Value' : imageEdit ? 'Correct the disputed value' : 'Edit Fact')} description={t(imageEdit ? 'Saving closes the picture disagreement this correction came from. The value is recorded as Manual confirmation and stays pending until it is confirmed.' : 'Saving records Manual confirmation as the source and leaves the fact pending. Confirm it where the check that raised it lives.')}>
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
