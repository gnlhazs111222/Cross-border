import type { Fact, FactCard, Product, Pricing, PricingContextSnapshot, Evidence } from '../src/types';
import { HERO_SKU } from '../src/data/mockData';
import { COPY_FACTS, editableFact, factEditor, factNumber, normalizeFactValue } from '../src/services/factReview';
import { DEMO_PRICING_RATES, priceFromRates, type PricingRates } from './pricing';

/**
 * The frozen snapshot says which market the task sells into; the rate tables are keyed by country. A brief
 * may name the market in the interface language ("美国"), which has to resolve to the same destination the
 * English name resolves to, so the duty lookup never depends on which language the brief was written in.
 */
export const marketCountry = (market?: string): string => ({
  'United States': 'US', 'United Kingdom': 'GB', Germany: 'DE', Japan: 'JP',
  '美国': 'US', '英国': 'GB', '德国': 'DE', '日本': 'JP',
})[(market ?? '').trim()] ?? 'US';

function fact(key: string, label: string, value: string, source: string, anchor: string, allowed = true, confirmed = true): Fact {
  return { key, label, value, source, anchor, allowed: confirmed && allowed, status: value === 'Missing' ? 'Missing' : confirmed ? 'Confirmed' : 'Requires Confirmation', sourceKind: 'mock' };
}
export function baseFactCard(p: Product): FactCard {
  const dimensions = p.packagingDimensions?.split(' × ').map(Number.parseFloat);
  const facts = [
    fact('color', 'Color', p.color, 'Supplier Spreadsheet', 'Products · column D'),
    ...(p.visual === 'bottle' ? [fact('capacity', 'Capacity', `${p.capacity}ml / ${p.localizedCapacity}`, 'Supplier Spreadsheet', 'Products · capacityMl')] : []),
    fact('material', 'Material', p.material, 'Supplier Spreadsheet', 'Products · material'),
    ...(p.visual === 'bottle' ? [fact('straw', 'Straw', p.straw ? 'Included' : 'No straw', 'Supplier Spreadsheet', 'Products · column F')] : []),
    ...(p.visual === 'bag' ? [fact('bagType', 'Bag type', 'Tote bag', 'Supplier Spreadsheet', 'Products · product name')] : []),
    fact('countryOfOrigin', 'Country of origin', p.countryOfOrigin, 'Supplier Spreadsheet', 'Products · column G'),
    fact('packagingWeight', 'Packaging weight', p.packagingWeight ? `${p.packagingWeight} kg` : 'Missing', 'Supplier Spreadsheet', 'Packaging · column C', false, !!p.packagingWeight),
    ...(['packageLength', 'packageWidth', 'packageHeight'] as const).map((key, i) => {
      const value = p[key] ?? dimensions?.[i];
      return fact(key, ['Package length', 'Package width', 'Package height'][i], value ? `${value} cm` : 'Missing', 'Supplier Spreadsheet', `Packaging · ${key}`, false, !!value);
    }),
    fact('supplierCost', 'Supplier cost', `USD ${p.supplierCost.toFixed(2)}`, 'Supplier Spreadsheet', 'Commercial · column B', false),
    fact('declaredValue', 'Declared value', `USD ${(p.declaredValue ?? 8.2).toFixed(2)}`, 'Supplier Spreadsheet', 'Commercial · column C', false),
  ];
  if (p.importSource) {
    const columns: Record<string, string> = { color: 'color', capacity: 'capacityMl', material: 'material', straw: 'hasStraw', bagType: 'productName', countryOfOrigin: 'countryOfOrigin', packagingWeight: 'packagingWeightKg', packageLength: 'packageLengthCm', packageWidth: 'packageWidthCm', packageHeight: 'packageHeightCm', supplierCost: 'supplierCost', declaredValue: 'declaredValue' };
    for (const f of facts) {
      f.sourceMetadata = { fileName: p.importSource.fileName, sheetName: p.importSource.sheetName, rowNumber: p.importSource.row, fieldName: columns[f.key] };
      f.source = 'Imported Supplier File'; f.sourceKind = 'supplier';
      f.anchor = `${p.importSource.fileName} · ${p.importSource.sheetName} · row ${p.importSource.row} · ${columns[f.key]}`;
    }
  }
  return { version: 1, sku: p.sku, facts };
}
export function effectiveProduct(p: Product, facts: Fact[]): Product {
  const confirmed = (key: string) => facts.find(f => f.key === key && f.status === 'Confirmed');
  const missing = p.missing.filter(label => !['Packaging Weight', 'Packaging Dimensions'].includes(label) && !(label === 'Accessory Information' && facts.find(f => f.key === 'packageIncludes')?.status === 'Confirmed'));
  if (!confirmed('packagingWeight')) missing.push('Packaging Weight');
  if (['packageLength', 'packageWidth', 'packageHeight'].some(key => !confirmed(key))) missing.push('Packaging Dimensions');
  const productKeys = ['color', 'material', 'countryOfOrigin', 'supplierCost', 'declaredValue', ...(p.visual === 'bottle' ? ['capacity', 'straw'] : [])];
  for (const key of productKeys) {
    const supplied = facts.find(f => f.key === key);
    if (supplied && !confirmed(key)) missing.push(supplied.label);
  }
  const value = (key: string) => confirmed(key)?.value;
  const dimensions = ['packageLength', 'packageWidth', 'packageHeight'].map(key => value(key) ? factNumber(value(key)!) : undefined);
  return { ...p, color: value('color') ?? p.color, material: value('material') ?? p.material,
    capacity: value('capacity') ? factNumber(value('capacity')!) : p.capacity,
    localizedCapacity: value('capacity')?.split(' / ')[1] ?? p.localizedCapacity,
    countryOfOrigin: value('countryOfOrigin') ?? p.countryOfOrigin,
    straw: value('straw') ? value('straw') === 'Included' : p.straw,
    supplierCost: value('supplierCost') ? factNumber(value('supplierCost')!) : p.supplierCost,
    declaredValue: value('declaredValue') ? factNumber(value('declaredValue')!) : p.declaredValue,
    packagingWeight: value('packagingWeight') ? factNumber(value('packagingWeight')!) : undefined,
    packagingDimensions: dimensions.every(n => n !== undefined) ? `${dimensions.join(' × ')} cm` : undefined,
    missing: [...new Set(missing)], status: missing.length ? 'missing_data' : 'search_ready',
  };
}
/**
 * Whether a task-card field is more than the confirmed supplier value: added for this task, changed by
 * a person or a check, still waiting for confirmation, or not allowed into copy. The server marks the
 * fields this returns true for, and the UI renders that list instead of deciding field by field.
 */
export function variesFromSupplier(fact: Fact, supplierFact?: Pick<Fact, 'value' | 'status'>): boolean {
  // A field the supplier card never had, a value it states differently, a status a person changed, or a
  // value still waiting for a person: that is the task card's own work. An internal field being kept out
  // of copy is not a change, so `listingAllowed` never enters this decision.
  if (!supplierFact) return true;
  if (supplierFact.value !== fact.value || supplierFact.status !== fact.status) return true;
  return fact.status !== 'Confirmed';
}

/**
 * The plan's price calculation: the goods, the freight, the two tax layers and the platform's share,
 * with the profit floor on top. Every amount is computed from a rate table rather than read from a
 * constant, which is what makes weight, size and destination matter.
 */
export function pricingFromFacts(p: Product, facts: Fact[], revision = 0, targetProfit = 5, snapshot?: PricingContextSnapshot, rates: PricingRates = DEMO_PRICING_RATES): Pricing {
  const confirmed = (key: string) => facts.find(f => f.key === key && f.status === 'Confirmed');
  const missing = [
    ...(!confirmed('packagingWeight') ? ['Packaging Weight'] : []),
    ...(['packageLength', 'packageWidth', 'packageHeight'].some(key => !confirmed(key)) ? ['Packaging Dimensions'] : []),
    ...(!confirmed('supplierCost') ? ['Supplier cost'] : []),
  ];
  const number = (key: string, fallback: number) => confirmed(key) ? factNumber(confirmed(key)!.value) : fallback;
  /**
   * A supplier price quoted in the frozen pair's base currency is converted at the frozen rate; a price
   * already in the settlement currency stays as it is, and the rate is only provenance. The demo's rows
   * are all USD, so this branch is what a CNY-priced supplier row would take.
   */
  const quoted = confirmed('supplierCost')?.value ?? '';
  const currency = (quoted.match(/^([A-Z]{3})\s/) ?? [])[1] ?? 'USD';
  const quotedCost = Number.parseFloat(quoted.replace(/^[A-Z]{3}\s*/, '')) || p.supplierCost;
  const cost = snapshot && snapshot.exchange && currency !== snapshot.settlementCurrency && snapshot.exchange.pair.startsWith(currency)
    ? Math.round(quotedCost * snapshot.exchange.rate * 100) / 100 : quotedCost;
  const declaredValue = number('declaredValue', p.declaredValue ?? 0);
  const weightKg = confirmed('packagingWeight') ? factNumber(confirmed('packagingWeight')!.value) : p.packagingWeight;
  const sides = ['packageLength', 'packageWidth', 'packageHeight'].map(key => confirmed(key) ? factNumber(confirmed(key)!.value) : undefined);
  const origin = (confirmed('countryOfOrigin')?.value ?? p.countryOfOrigin ?? '').includes('中国') ? 'CN' : 'US';
  const breakdown = priceFromRates({ supplierCost: cost, declaredValue, weightKg,
    dimensionsCm: sides.every(side => side !== undefined) ? sides as number[] : undefined,
    origin, destination: marketCountry(snapshot?.market), category: p.category, targetProfit, rates,
    floorPrice: p.sku === HERO_SKU ? Math.max(19.99, rates.logistics.base) : undefined });
  return { version: `v${1 + revision}`, status: missing.length ? 'blocked' : 'ready', supplierCost: cost,
    shipping: breakdown.logistics, duty: Math.round((breakdown.exportDuty + breakdown.importDuty) * 100) / 100,
    platformCost: breakdown.platformFee, targetProfit,
    suggestedPrice: missing.length ? null : breakdown.suggestedPrice, missing,
    ...(missing.length ? {} : { breakdown }), ...(snapshot ? { snapshot } : {}) };
}

export function productEvidence(p: Product): Evidence[] {
  const extracted = p.visual === 'bag'
    ? [`Product type: Tote bag`, `Color: ${p.color}`, `Packaging weight: ${p.packagingWeight ? `${p.packagingWeight} kg` : 'Missing'}`]
    : [`Color: ${p.color}`, `Straw: ${p.straw ? 'Included' : 'No straw'}`, `Packaging weight: ${p.packagingWeight ? `${p.packagingWeight} kg` : 'Missing'}`];
  return [{ id: 'EV-001', type: 'sheet', name: p.importSource ? 'Imported Supplier File' : 'Supplier Spreadsheet',
    file: p.importSource?.fileName ?? 'supplier_catalog.xlsx',
    anchor: p.importSource ? `${p.importSource.fileName} · ${p.importSource.sheetName} · row ${p.importSource.row}` : `${p.sku} · Products & Packaging`,
    extracted }];
}
export function reviewFact(before: Fact, action: 'edit' | 'confirm' | 'reject', input?: string): Fact {
  const key = before.key;
  if (action !== 'reject' && !editableFact(key)) throw new Error('This claim cannot be edited or confirmed in the demo.');
  if (action === 'confirm' && (before.status === 'Missing' || !before.value.trim())) throw new Error('A value is required before confirmation.');
  const value = action === 'edit' ? normalizeFactValue(key, input ?? '') : action === 'confirm' ? normalizeFactValue(key, factEditor(before).value) : before.value;
  const status: Fact['status'] = action === 'edit' ? 'Requires Confirmation' : action === 'confirm' ? 'Confirmed' : 'Rejected';
  const now = new Date().toISOString();
  return { ...before, value, status, allowed: status === 'Confirmed' && COPY_FACTS.includes(key),
    source: 'Manual confirmation', sourceKind: 'manual', anchor: `Fact Review · ${key}`,
    previousValue: action === 'edit' ? before.value : before.previousValue ?? before.value,
    previousSource: before.sourceKind === 'manual' ? before.previousSource : `${before.source} · ${before.anchor}`,
    updatedAt: now, confirmedAt: action === 'confirm' ? now : undefined, revision: (before.revision ?? 0) + 1,
  };
}
