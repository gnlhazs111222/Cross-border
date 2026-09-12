import { useI18n } from '../i18n/I18nContext';
import { CircleDollarSign, LockKeyhole, RefreshCw } from 'lucide-react';
import type { Pricing, PricingContextSnapshot } from '../types';
import { Badge, Button, Notice } from './ui';
import { useDemo } from './DemoContext';
import { mockApi } from '../services/mockApi';
import { SERVER_MODE } from '../services/apiClient';

function SnapshotDetails({ snapshot }: { snapshot: PricingContextSnapshot }) {
  const { t } = useI18n();
  const dateTime = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <details className="pricing-snapshot-details"><summary>{t('Snapshot provenance')}</summary><dl>
    <div><dt>{t('Snapshot ID')}</dt><dd><code>{snapshot.code}</code></dd></div>
    <div><dt>{t('Reference exchange rate')}</dt><dd>1 CNY = {snapshot.exchange.rate} USD</dd></div>
    <div><dt>{t('Exchange-rate source')}</dt><dd>{t(snapshot.exchange.source)}</dd></div>
    <div><dt>{t('Reference date')}</dt><dd>{snapshot.exchange.referenceDate}</dd></div>
    <div><dt>{t('Rate captured at')}</dt><dd><time dateTime={snapshot.exchange.fetchedAt}>{dateTime(snapshot.exchange.fetchedAt)}</time></dd></div>
    <div><dt>{t('Shipping configuration')}</dt><dd><code>{snapshot.shipping.configVersion}</code><small>{t(snapshot.shipping.source)}</small></dd></div>
    <div><dt>{t('Duty rule')}</dt><dd><code>{snapshot.duty.ruleVersion}</code><small>{t(snapshot.duty.source)}</small></dd></div>
    <div><dt>{t('Platform-fee configuration')}</dt><dd><code>{snapshot.platformFee.configVersion}</code><small>{t(snapshot.platformFee.source)}</small></dd></div>
    <div><dt>{t('Pricing policy')}</dt><dd><code>{snapshot.policyVersion}</code></dd></div>
    <div><dt>{t('Frozen at')}</dt><dd><time dateTime={snapshot.createdAt}>{dateTime(snapshot.createdAt)}</time></dd></div>
  </dl><p>{t('The exchange rate is retained for provenance only because current supplier costs are already recorded in USD.')}</p></details>;
}

export function PricingPanel({ pricing, compact = false, onRefresh, refreshing = false }: { pricing: Pricing; compact?: boolean; onRefresh?: () => void; refreshing?: boolean }) {
  const { t } = useI18n();
  const { busy, act } = useDemo();
  const money = (n: number) => `USD ${n.toFixed(2)}`;
  const snapshot = pricing.snapshot;
  const isRefreshing = refreshing || busy === 'pricing-snapshot';
  const refresh = onRefresh ?? (() => void act('pricing-snapshot', () => mockApi.refreshPricingSnapshot(), 'A new pricing snapshot was frozen. Existing publication results were retired.'));
  const heading = <div className="panel-title">{pricing.status === 'blocked' ? <LockKeyhole size={19} aria-hidden="true" /> : <CircleDollarSign size={19} aria-hidden="true" />}<h3>{t(pricing.status === 'blocked' ? 'Pricing Blocked' : snapshot ? 'Task Pricing Snapshot' : 'Demo Pricing Preview')}</h3><Badge tone={pricing.status === 'ready' ? 'green' : 'amber'}>{t(pricing.status === 'ready' ? 'Pricing Ready' : 'Suggested price pending')}</Badge>{snapshot && <Badge>{snapshot.code}</Badge>}{snapshot && !compact && SERVER_MODE && <Button variant="ghost" busy={isRefreshing} disabled={!!busy} onClick={refresh}><RefreshCw size={14} aria-hidden="true" />{t('Refresh snapshot')}</Button>}</div>;
  if (pricing.status === 'blocked') return <section className="panel pricing-blocked">{heading}<p className="strong">{t("Missing Fact:")} {pricing.missing.map(fact => t(fact)).join(', ')}</p><p>{t(pricing.missing.includes('Packaging Weight') ? 'Packaging weight is required for logistics estimation.' : pricing.missing.includes('Packaging Dimensions') ? 'Packaging dimensions are required for logistics estimation.' : 'Confirmed supplier cost is required for pricing.')}</p><Notice tone="amber">{t("The suggested price stays pending until these facts are confirmed. Draft generation and review are not blocked by pricing.")}</Notice>{snapshot && <SnapshotDetails snapshot={snapshot} />}</section>;
  const costs = [ ['Supplier cost', pricing.supplierCost], ['Shipping', pricing.shipping], ['Estimated duty', pricing.duty], ['Platform cost', pricing.platformCost], ['Target profit', pricing.targetProfit] ] as const;
  const costGrid = <div className="cost-grid">{costs.map(([label, amount]) => <div key={label}><span>{t(label)}</span><strong>{money(amount)}</strong></div>)}</div>;
  return <section className={`panel pricing-panel ${compact ? 'compact' : ''}`}>{heading}<div className="pricing-layout">{compact ? <details className="cost-disclosure"><summary>{t("Cost assumptions")}</summary>{costGrid}</details> : costGrid}<div className="suggested-price"><span>{t("Suggested price")}</span><strong>{money(pricing.suggestedPrice!)}</strong><small>{t("Estimated unit profit:")} {money(pricing.suggestedPrice! - pricing.supplierCost - pricing.shipping - pricing.duty - pricing.platformCost)}</small></div></div>{snapshot && <SnapshotDetails snapshot={snapshot} />}<p className="footnote">{t(snapshot ? 'Frozen controlled demo configuration · no live logistics, tax or marketplace lookup. Internal costs stay out of consumer copy.' : 'Preview uses current fixed demo assumptions and is not a saved task snapshot.')}</p></section>;
}
