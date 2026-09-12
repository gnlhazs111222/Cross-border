import { useEffect, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { Badge, Button, Modal } from './ui';
import { apiClient, SERVER_MODE } from '../services/apiClient';
import type { Capabilities } from '../../shared/contracts';

export function DemoCapabilities() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !SERVER_MODE) return;
    let active = true; setError('');
    void apiClient.capabilities().then(data => { if (active) setCapabilities(data); }).catch(() => { if (active) setError('The local API is unavailable.'); });
    return () => { active = false; };
  }, [open]);
  const local = [
    ['Supplier file import', 'XLSX / CSV parsing and fixed-template field validation run in your browser.'],
    ['Fact editing & confirmation', 'Your edits, confirmation decisions and source records are saved locally.'],
    ['State transitions & review blocking', 'Actual local rules invalidate old results and block unreviewed revisions.'],
    ['Pricing calculation', 'The formula uses your current confirmed cost and required packaging facts.'],
    ['CSV generation', 'A real file is generated and downloaded in the browser.'],
  ];
  if (capabilities?.listing.activeProvider === 'qwen') local.push(['Listing intelligence', 'Listing supports templates and opt-in Qwen generation with validation and template fallback.']);
  if (capabilities?.review.activeProvider === 'qwen') local.push(['Semantic review', 'Hard rules and opt-in Qwen check facts against copy. Failures and ambiguous results keep publishing locked.']);
  const simulated = [
    ['Recommendation', capabilities?.recommendation.activeProvider === 'qwen' ? 'Deterministic eligibility checks run first. Qwen ranks only eligible products.' : 'Deterministic ranking follows the saved task; scores are not model confidence.'],
    ['Evidence enrichment', 'Supplier rows are imported for real. No PDF or image parsing is claimed; the picture text check only marks agreement between the printed words and these facts.'],
    ['Picture text check', capabilities?.evidence.activeProvider === 'qwen' ? 'A vision model reads the words printed in the selected SKU pictures and compares them with the facts; wording it cannot read stays undecided.' : 'Offline mode reports file-level findings only. Every attribute stays "not checked" until a person or a vision model reads the printed words.'],
    ['Pricing external data', 'Shipping, tariffs and platform fees use fixed demo assumptions.'],
    ...(capabilities?.listing.activeProvider === 'qwen' ? [] : [['Listing intelligence', 'English copy is assembled from authorized facts using templates, not an LLM.']]),
    ['Platform publish', 'Amazon / Shopify results are simulated; no marketplace request is sent.'],
  ];
  return <>
    <Button variant="ghost" className="capabilities-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog"><CircleHelp size={15} />{t('Demo Capabilities')}</Button>
    <Modal open={open} onOpenChange={setOpen} title={t('Demo Capabilities')} description={t('What runs locally, and what this competition demo simulates.')} wide>
      {SERVER_MODE && <section className="server-capabilities" data-testid="server-capabilities">
        {error ? <p role="alert">{t(error)}</p> : !capabilities ? <p role="status">{t('Checking backend capabilities...')}</p> : <>
          <div className="server-badges"><Badge tone={capabilities.backend ? 'green' : 'red'}>Fastify API</Badge><Badge tone={capabilities.database ? 'green' : 'red'}>SQLite / Prisma</Badge><Badge tone={capabilities.authentication ? 'green' : 'red'}>{t('Cookie authentication')}</Badge></div>
          <p><strong>{t('Server authoritative:')}</strong> {capabilities.storage.server.join(' · ')}</p>
          <p><strong>{t('Browser persisted:')}</strong> {capabilities.storage.browser.join(' · ')}</p>
          <p><strong>{t('Live text connection:')}</strong> {t(capabilities.textModel.liveAvailable ? 'Available for explicit smoke only' : capabilities.textModel.configured ? 'Configured, live calls disabled' : 'Not configured')} · {capabilities.textModel.model}</p>
          <p><strong>{t('Active business providers:')}</strong> {capabilities.recommendation.activeProvider} / {capabilities.evidence.activeProvider} / {capabilities.listing.activeProvider} / {capabilities.review.activeProvider}</p>
          <small>{t(capabilities.review.liveImplemented ? 'Qwen listing, recommendation and semantic review are implemented and opt-in. Current active providers are shown above. The picture text check is implemented and runs offline or with an opt-in vision model. Automated tests make no live AI calls.' : 'Qwen Listing and Recommendation are implemented and opt-in. The picture text check is implemented; review stays rule-based. Automated tests make no live AI calls.')}</small>
        </>}
      </section>}
      <div className="capability-grid">{([{ title: 'REAL / LOCAL', tone: 'green' as const, items: local }, { title: 'DEMO / MOCK', tone: 'amber' as const, items: simulated }]).map(group => <section key={group.title}><Badge tone={group.tone}>{group.title}</Badge>{group.items.map(([label, detail]) => <div className="capability-row" key={label}><h3>{t(label)}</h3><p>{t(detail)}</p></div>)}</section>)}</div>
      <p className="capability-footnote">{t(capabilities?.review.activeProvider === 'qwen' ? 'Confirmed records an operator decision, not independent product certification. Semantic review checks consistency with supplied facts, not complete platform or legal compliance.' : 'Confirmed records a demo or operator decision, not independent product certification. The review engine checks known wording; it is not general AI compliance review.')}</p>
    </Modal>
  </>;
}
