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
  const simulated = [
    ['Recommendation', 'Fixed demo scoring; 94 is a match score, not model confidence.'],
    ['Evidence enrichment', 'Supplemental PDF and image facts are seeded examples, not OCR results.'],
    ['Pricing external data', 'Shipping, tariffs and platform fees use fixed demo assumptions.'],
    ['Listing intelligence', 'English copy is assembled from authorized facts using templates, not an LLM.'],
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
          <small>{t('Live connection availability does not mean the Qwen business adapters are implemented. Normal workflows and all automated tests stay mock/template/rules.')}</small>
        </>}
      </section>}
      <div className="capability-grid">{([{ title: 'REAL / LOCAL', tone: 'green' as const, items: local }, { title: 'DEMO / MOCK', tone: 'amber' as const, items: simulated }]).map(group => <section key={group.title}><Badge tone={group.tone}>{group.title}</Badge>{group.items.map(([label, detail]) => <div className="capability-row" key={label}><h3>{t(label)}</h3><p>{t(detail)}</p></div>)}</section>)}</div>
      <p className="capability-footnote">{t('Confirmed records a demo or operator decision, not independent product certification. The review engine checks known wording; it is not general AI compliance review.')}</p>
    </Modal>
  </>;
}
