import { useI18n } from '../i18n/I18nContext';
import { CircleDollarSign, LockKeyhole, RefreshCw } from 'lucide-react';
import type { Pricing, PricingContextSnapshot } from '../types';
import { Badge, Button, Notice } from './ui';
import { useDemo } from './DemoContext';
import { mockApi } from '../services/mockApi';
import { SERVER_MODE } from '../services/apiClient';

/** Only the rate: the fee tables that used to sit here are itemised in the tax row, with their versions. */
function SnapshotDetails({ snapshot }: { snapshot: PricingContextSnapshot }) {
  const { t } = useI18n();
  const dateTime = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <details className="pricing-snapshot-details" data-testid="exchange-rate-snapshot"><summary>{t('Exchange rate snapshot')}</summary><dl>
    <div><dt>{t('Reference exchange rate')}</dt><dd>1 CNY = {snapshot.exchange.rate} USD</dd></div>
    <div><dt>{t('Exchange rate table')}</dt><dd>{t(snapshot.exchange.source)}</dd></div>
    <div><dt>{t('Reference date')}</dt><dd>{snapshot.exchange.referenceDate}</dd></div>
    <div><dt>{t('Rate captured at')}</dt><dd><time dateTime={snapshot.exchange.fetchedAt}>{dateTime(snapshot.exchange.fetchedAt)}</time></dd></div>
  </dl></details>;
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
  // The plan's price calculation reads as four figures: what the goods cost, the taxes and fees the
  // frozen snapshot implies, what the marketplace takes out of the price, and the profit floor.
  const breakdown = pricing.breakdown;
  const taxTotal = breakdown ? breakdown.taxTotal : pricing.shipping + pricing.duty;
  // The parts the total is made of, so the row reads as the sum it is.
  const taxParts = breakdown
    ? [breakdown.logistics, breakdown.exportDuty, breakdown.importDuty, breakdown.importTax]
    : [pricing.shipping, pricing.duty];
  const costs = [ ['Supplier cost', pricing.supplierCost] as const, ['Tax and fee total', taxTotal] as const,
    ['Platform cost', pricing.platformCost] as const, ['Target profit', pricing.targetProfit] as const ];
  const costGrid = <div className="cost-grid">{costs.map(([label, amount]) => <div key={label}><span>{t(label)}</span><strong>{money(amount)}</strong></div>)}</div>;
  /**
   * The taxes and fees the price has to carry, and nothing else: the freight priced on the billable
   * weight, the duty by destination and category, the second tax layer, and what they add up to.
   */
  const taxDetails = <details className="pricing-snapshot-details pricing-tax-details" data-testid="pricing-tax-details">
    <summary>{t('Tax and fee calculation')}</summary>
    <dl>
      <div><dt>{t('Shipping')}</dt><dd>{money(pricing.shipping)}</dd></div>
      <div><dt>{t('Export duty')}</dt><dd>{money(breakdown ? breakdown.exportDuty : 0)}</dd></div>
      <div><dt>{t('Import duty')}</dt><dd>{money(breakdown ? breakdown.importDuty : 0)}</dd></div>
      <div><dt>{t('Import tax')}</dt><dd>{money(breakdown ? breakdown.importTax : 0)}</dd></div>
      <div><dt>{t('Landed cost')}</dt><dd>{money(breakdown ? breakdown.cif : 0)}</dd></div>
      <div><dt>{t('Tax and fee total')}</dt><dd className="tax-formula">{taxParts.map(part => part.toFixed(2)).join(' + ')} = {money(taxTotal)}</dd></div>
    </dl>
  </details>;
  return <section className={`panel pricing-panel ${compact ? 'compact' : ''}`}>{heading}<div className="pricing-layout">{compact ? <details className="cost-disclosure"><summary>{t("Calculation process")}</summary>{costGrid}</details> : costGrid}<div className="suggested-price"><span>{t("Suggested price")}</span><strong>{money(pricing.suggestedPrice!)}</strong><small>{t("Estimated unit profit:")} {money(pricing.suggestedPrice! - pricing.supplierCost - pricing.shipping - pricing.duty - pricing.platformCost)}</small></div></div>{taxDetails}{snapshot && <SnapshotDetails snapshot={snapshot} />}</section>;
}
