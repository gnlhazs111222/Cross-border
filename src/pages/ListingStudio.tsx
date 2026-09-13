import { SERVER_MODE } from '../services/apiClient';
import { useI18n } from '../i18n/I18nContext';
import { HazmatNotice } from '../components/HazmatNotice';
import { useEffect, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useDemo } from '../components/DemoContext';
import { ListingPreview } from '../components/ListingPreview';
import { requestFactEditAfterNavigation } from '../components/factCheckActions';
import { Badge, Button, EmptyState, Modal, NextButton, Notice, PageHeader } from '../components/ui';
import { mockApi } from '../services/mockApi';
import type { Listing } from '../types';

export function ListingStudio() {
  const { t } = useI18n();
  const { state, busy, act, navigate, setState } = useDemo();
  const [edit, setEdit] = useState<Pick<Listing, 'title' | 'bullets' | 'description'> | null>(null);
  const taskPlatform = state.task?.platform === 'Shopify US' ? 'shopify' : 'amazon';
  useEffect(() => {
    if (state.task && state.platform !== taskPlatform && !busy) {
      setEdit(null);
      setState(mockApi.setPlatform(taskPlatform));
    }
  }, [state.task, state.platform, taskPlatform, busy, setState]);
  const listing = state.listings[taskPlatform];
  const heading = <PageHeader eyebrow={t("04 / LISTING STUDIO")} title={t("From verified facts to a clear story.")} description={t("Build platform-ready copy from the facts you can stand behind.")} action={listing && <NextButton disabled={!!busy || !!edit} onClick={() => navigate('review')}>{t("Continue to Review")}</NextButton>} />;
  if (state.task && state.platform !== taskPlatform) return <Notice>{t("Connecting to your workspace...")}</Notice>;
  if (!state.v2) return <>{heading}<HazmatNotice product={mockApi.getState().catalog.find(item => item.sku === state.selectedSku)} /><EmptyState title={t("Your evidence comes first")} description={t("Select a SKU and analyze its evidence to unlock listing generation.")} action={<NextButton onClick={() => navigate('evidence')}>{t("Go to Evidence & Facts")}</NextButton>} /></>;
  return <>{heading}{!mockApi.listingReady() && <Notice tone="amber">
      {t('Confirm color, capacity and material before generating a listing. Duplicate and out-of-category products cannot generate listings.')}
      <div className="fact-actions">{mockApi.listingBlockedFacts().map(fact => fact.missing
        ? <Button key={fact.key} variant="secondary" disabled={!!busy} onClick={() => { requestFactEditAfterNavigation(fact.key); navigate('evidence'); }}>{t('Add Value')} · {t(fact.label)}</Button>
        : <Button key={fact.key} variant="secondary" disabled={!!busy} busy={busy === `confirm-${fact.key}`} onClick={() => void act(`confirm-${fact.key}`, () => mockApi.confirmFact(fact.key), 'Fact confirmed. Downstream eligibility has been recalculated.')}>{t('Confirm')} · {t(fact.label)}</Button>)}<Button variant="ghost" disabled={!!busy} onClick={() => navigate('evidence')}>{t('Go to Evidence & Facts')}</Button></div>
    </Notice>}<div className="studio-toolbar"><span data-testid="task-listing-platform"><Badge>{t(taskPlatform === 'amazon' ? 'Amazon US' : 'Shopify US')}</Badge></span><Badge>{t("FactCard V2 connected")}</Badge></div><div className="studio-grid"><div>{listing ? <ListingPreview listing={listing} disabled={!!busy} onEdit={() => setEdit({ title: listing.title, bullets: [...listing.bullets], description: listing.description })} /> : <div className="panel"><EmptyState title={t('Your {platform} listing starts here', { platform: state.platform === 'amazon' ? 'Amazon' : 'Shopify' })} description={t("Generate a concise title, product highlights, description and attributes from confirmed facts.")} action={<Button busy={busy === 'generate'} disabled={!!busy || !mockApi.listingReady()} onClick={() => void act('generate', () => mockApi.generateListing(), 'Listing generated. Run a review before publishing.')}><Sparkles size={16} />{busy === 'generate' ? t('Generating listing...') : t('Generate {platform} Listing', { platform: state.platform === 'amazon' ? 'Amazon' : 'Shopify' })}</Button>} /></div>}</div><aside className="studio-aside">{listing?.recordId && !listing.riskDemoInjected && <Button variant="secondary" disabled={!!busy} busy={busy === 'inject-risk'} onClick={() => void act('inject-risk', () => mockApi.injectDemoRisk(), 'Demo risk added explicitly. Run Review to see the block.')}>{t('Inject Demo Risk')}</Button>}{listing && <Button variant="secondary" disabled={!!busy} busy={busy === 'regenerate'} onClick={() => void act('regenerate', () => mockApi.generateListing(), 'Listing regenerated. A fresh review is required.')}>{t("Regenerate from facts")}</Button>}</aside></div>
    <Modal open={!!edit} onOpenChange={open => !open && !busy && setEdit(null)} title={t("Edit listing copy")} description={t("Saving creates a new revision and clears the previous review result.")} wide>{edit && <form onSubmit={async e => { e.preventDefault(); if (await act('edit', () => mockApi.editListing(edit), 'Changes saved. Run review again for this revision.')) setEdit(null); }}><label className="form-field">{t("Title")}<input lang="en" required maxLength={220} value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></label><label className="form-field">{t("Bullet points · one per line")}<textarea lang="en" required rows={7} value={edit.bullets.join('\n')} onChange={e => setEdit({ ...edit, bullets: e.target.value.split('\n') })} /></label><label className="form-field">{t("Description")}<textarea lang="en" required rows={4} value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} /></label><Notice>{t(SERVER_MODE ? 'Saving requires a new review against confirmed facts. Review mode is shown on Review & Publish.' : 'Mock review checks the known evidence-backed wording and the seeded risk. Any other wording requires confirmation and is blocked in this demo.')}</Notice><div className="modal-actions"><Button variant="secondary" type="button" disabled={!!busy} onClick={() => setEdit(null)}>{t("Cancel")}</Button><Button type="submit" busy={busy === 'edit'} disabled={!!busy}>{t("Save revision")}<ArrowRight size={16} /></Button></div></form>}</Modal>
  </>;
}
