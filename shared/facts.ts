import type { Fact, FactCard, Product, Pricing, PricingContextSnapshot, Evidence } from '../src/types';
import { HERO_SKU } from '../src/data/mockData';
import { COPY_FACTS, editableFact, factEditor, factNumber, normalizeFactValue } from '../src/services/factReview';

function fact(key: string, label: string, value: string, source: string, anchor: string, allowed = true, confirmed = true): Fact {
  return { key, label, value, source, anchor, allowed: confirmed && allowed, status: value === 'Missing' ? 'Missing' : confirmed ? 'Confirmed' : 'Requires Confirmation', sourceKind: 'mock' };
}
export function baseFactCard(p: Product): FactCard {
  const dimensions = p.packagingDimensions?.split(' × ').map(Number.parseFloat);
  const facts = [
    fact('color', 'Color', p.color, 'Supplier Spreadsheet', 'Products · column D'),
    ...(p.visual === 'bottle' ? [fact('capacity', 'Capacity', `${p.capacity}ml / ${p.localizedCapacity}`, 'Specification PDF', 'Page 1 · specifications')] : []),
    fact('material', 'Material', p.material, 'Specification PDF', 'Page 1 · body material'),
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
export function pricingFromFacts(p: Product, facts: Fact[], revision = 0, targetProfit = 5, snapshot?: PricingContextSnapshot): Pricing {
  const confirmed = (key: string) => facts.find(f => f.key === key && f.status === 'Confirmed');
  const missing = [
    ...(!confirmed('packagingWeight') ? ['Packaging Weight'] : []),
    ...(['packageLength', 'packageWidth', 'packageHeight'].some(key => !confirmed(key)) ? ['Packaging Dimensions'] : []),
    ...(!confirmed('supplierCost') ? ['Supplier cost'] : []),
  ];
  const cost = confirmed('supplierCost') ? factNumber(confirmed('supplierCost')!.value) : p.supplierCost;
  const shipping = snapshot?.shipping.amount ?? 3.1;
  const duty = snapshot?.duty.amount ?? 0.7;
  const platformCost = snapshot?.platformFee.amount ?? 2.2;
  const floor = Math.ceil((cost + shipping + duty + platformCost + targetProfit - 1e-9) * 100) / 100;
  return { version: `v${1 + revision}`, status: missing.length ? 'blocked' : 'ready', supplierCost: cost,
    shipping, duty, platformCost, targetProfit,
    suggestedPrice: missing.length ? null : p.sku === HERO_SKU ? Math.max(19.99, floor) : floor, missing, ...(snapshot ? { snapshot } : {}) };
}

export function productEvidence(p: Product): Evidence[] {
    if (p.visual === 'bag') return [
      { id: 'EV-001', type: 'sheet', name: p.importSource ? 'Imported Supplier File' : 'Supplier Spreadsheet', file: p.importSource?.fileName ?? 'supplier_catalog.xlsx', anchor: p.importSource ? `${p.importSource.fileName} · ${p.importSource.sheetName} · row ${p.importSource.row}` : `${p.sku} · Products & Packaging`, extracted: [`Product type: Tote bag`, `Color: ${p.color}`, `Packaging weight: ${p.packagingWeight ? `${p.packagingWeight} kg` : 'Missing'}`] },
      { id: 'EV-002', type: 'pdf', name: p.importSource ? 'Mock Specification PDF' : 'Specification PDF', file: 'canvas_tote_specification.pdf', anchor: 'Page 1 · materials', extracted: [`Body material: ${p.material}`, `Country of origin: ${p.countryOfOrigin}`, 'Load capacity: Not verified'] },
      { id: 'EV-003', type: 'image', name: p.importSource ? 'Mock Product / Packaging Images' : 'Product / Packaging Images', file: 'tote_front.jpg + tote_opening.jpg', anchor: 'Image 1 · exterior; image 2 · opening', extracted: ['Finish: Natural woven texture', 'Closure: Open top', 'Straps: Dual shoulder straps', 'Load capacity: Not verified'] },
    ];
    return [
      { id: 'EV-001', type: 'sheet', name: p.importSource ? 'Imported Supplier File' : 'Supplier Spreadsheet', file: p.importSource?.fileName ?? 'supplier_catalog.xlsx', anchor: p.importSource ? `${p.importSource.fileName} · ${p.importSource.sheetName} · row ${p.importSource.row}` : `${p.sku} · Products & Packaging`, extracted: [`Color: ${p.color}`, `Straw: ${p.straw ? 'Included' : 'No straw'}`, `Packaging weight: ${p.packagingWeight ? `${p.packagingWeight} kg` : 'Missing'}`] },
      { id: 'EV-002', type: 'pdf', name: p.importSource ? 'Mock Specification PDF' : 'Specification PDF', file: 'bottle_specification.pdf', anchor: 'Page 1 · specifications', extracted: [`Capacity: ${p.capacity}ml / ${p.localizedCapacity}`, `Body: ${p.material}`, 'Lid: Screw-top lid'] },
      { id: 'EV-003', type: 'image', name: p.importSource ? 'Mock Product / Packaging Images' : 'Product / Packaging Images', file: 'product_front.jpg + package_contents.jpg', anchor: 'Image 1 · exterior; image 2 · contents', extracted: [`Finish: Matte ${p.color.toLowerCase()}`, 'Package: Bottle, Lid, Instruction card', 'Leakproof performance: Not verified'] },
    ];
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
