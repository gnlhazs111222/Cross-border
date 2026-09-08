import { useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { Badge, Button, Modal } from './ui';

export function DemoCapabilities() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
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
      <div className="capability-grid">{([{ title: 'REAL / LOCAL', tone: 'green' as const, items: local }, { title: 'DEMO / MOCK', tone: 'amber' as const, items: simulated }]).map(group => <section key={group.title}><Badge tone={group.tone}>{group.title}</Badge>{group.items.map(([label, detail]) => <div className="capability-row" key={label}><h3>{t(label)}</h3><p>{t(detail)}</p></div>)}</section>)}</div>
      <p className="capability-footnote">{t('Confirmed records a demo or operator decision, not independent product certification. The review engine checks known wording; it is not general AI compliance review.')}</p>
    </Modal>
  </>;
}
