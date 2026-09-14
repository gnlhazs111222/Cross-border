import { useState } from 'react';
import type { Task } from '../types';
import { Button, Modal, Notice } from './ui';
import { useI18n } from '../i18n/I18nContext';
import { useDemo } from './DemoContext';
import { mockApi } from '../services/mockApi';
export function TaskEditor({ task, editing, close }: { task: Task; editing: boolean; close: () => void }) {
  const { t } = useI18n(); const { busy, act } = useDemo();
  const [draft, setDraft] = useState(task); const [requirements, setRequirements] = useState(task.requirements.join('\n'));
  return <Modal open onOpenChange={open => !open && !busy && close()} title={t(editing ? 'Edit Current Task' : 'Create Launch Task')} description={t('Save your requirements, then explicitly run recommendation. Typing does not call AI.')} wide>
    {/* A new brief is created to be ranked: the run follows the save, so the shortlist is on screen the
        moment the task exists instead of waiting for a second click. An edit keeps the explicit run, because
        its saved requirements still have to be reviewed before the products are re-ranked. */}
    <form onSubmit={async event => { event.preventDefault(); const rows = requirements.split('\n').map(r => r.trim()).filter(Boolean); if (!await act('save-task', () => mockApi.saveTask({ ...draft, requirements: rows }, editing), editing ? 'Task saved. Run recommendation for the current requirements.' : 'Task created. Ranking the candidate pool now.')) return; if (!editing) await act('recommend', () => mockApi.runRecommendation(), 'Task created. Recommendations are ready.'); close(); }}>
      <div className="task-form-grid">
        <label className="form-field">{t('Platform')}<select aria-label={t('Platform')} value={draft.platform} onChange={e => setDraft({ ...draft, platform: e.target.value })}><option>Amazon US</option><option>Shopify US</option></select></label>
        <label className="form-field">{t('Market')}<input aria-label={t('Market')} required maxLength={220} value={draft.market} onChange={e => setDraft({ ...draft, market: e.target.value })} /></label>
        <label className="form-field">{t('Category')}<input aria-label={t('Category')} required maxLength={220} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label>
        <label className="form-field">{t('Minimum unit profit')} (USD)<input aria-label={`${t('Minimum unit profit')} (USD)`} required type="number" min="0" max="1000000" step="0.01" value={draft.minProfit} onChange={e => setDraft({ ...draft, minProfit: Number(e.target.value) })} /></label>
      </div>
      <label className="form-field">{t('Requirements')}<textarea aria-label={t('Requirements')} required rows={5} maxLength={5000} value={requirements} onChange={e => setRequirements(e.target.value)} /></label>
      <Notice>{t('Saving changed requirements clears the current selection and invalidates prior recommendation and downstream results. Products are preserved.')}</Notice>
      <p className="footnote">{t('The price target is used only for later pricing and does not affect selection. The complete demo supports bottles and tote bags; lamps remain outside scope.')}</p>
      <div className="modal-actions"><Button type="button" variant="secondary" disabled={!!busy} onClick={close}>{t('Cancel')}</Button><Button type="submit" busy={busy === 'save-task'} disabled={!!busy || !requirements.trim()}>{t(editing ? 'Save Task' : 'Create Task')}</Button></div>
    </form>
  </Modal>;
}
