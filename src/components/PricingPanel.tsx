import { useI18n } from '../i18n/I18nContext';
import { CircleDollarSign, LockKeyhole } from 'lucide-react';
import type { Pricing } from '../types';
import { Badge, Notice } from './ui';

export function PricingPanel({ pricing, compact = false }: { pricing: Pricing; compact?: boolean }) {
  const { t } = useI18n();
  const money = (n: number) => `USD ${n.toFixed(2)}`;
  if (pricing.status === 'blocked') return <section className="panel pricing-blocked"><div className="panel-title"><LockKeyhole size={19} /><h3>{t("Pricing Blocked")}</h3><Badge tone="red">{t("Missing fact")}</Badge></div><p className="strong">{t("Missing Fact:")} {pricing.missing.map(fact => t(fact)).join(', ')}</p><p>{t(pricing.missing.includes('Packaging Weight') ? 'Packaging weight is required for logistics estimation.' : pricing.missing.includes('Packaging Dimensions') ? 'Packaging dimensions are required for logistics estimation.' : 'Confirmed supplier cost is required for pricing.')}</p><Notice tone="amber">{t("No suggested price is available until the required facts are confirmed.")}</Notice></section>;
  const costs = [ ['Supplier cost', pricing.supplierCost], ['Shipping', pricing.shipping], ['Estimated duty', pricing.duty], ['Platform cost', pricing.platformCost], ['Target profit', pricing.targetProfit] ] as const;
  const costGrid = <div className="cost-grid">{costs.map(([label, amount]) => <div key={label}><span>{t(label)}</span><strong>{money(amount)}</strong></div>)}</div>;
  return <section className={`panel pricing-panel ${compact ? 'compact' : ''}`}><div className="panel-title"><CircleDollarSign size={19} /><h3>{t("Demo Pricing Snapshot")}</h3><Badge tone="green">{t("Pricing Ready")}</Badge><Badge>{t("Snapshot Version:")} {pricing.version}</Badge></div><div className="pricing-layout">{compact ? <details className="cost-disclosure"><summary>{t("Cost assumptions")}</summary>{costGrid}</details> : costGrid}<div className="suggested-price"><span>{t("Suggested price")}</span><strong>{money(pricing.suggestedPrice!)}</strong><small>{t("Estimated unit profit:")} {money(pricing.suggestedPrice! - pricing.supplierCost - pricing.shipping - pricing.duty - pricing.platformCost)}</small></div></div><p className="footnote">{t("Fixed demo assumptions · no live logistics, tax or marketplace fee lookup. Internal costs stay out of consumer copy.")}</p></section>;
}
