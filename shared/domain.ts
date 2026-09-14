import type { Fact, FactCard, Issue, Listing, Platform, Pricing, Product, Recommendation, Task } from '../src/types';
import { HERO_SKU } from '../src/data/mockData';
import { sameCategory } from './categories';
import { formatCapacity, formatLength, formatWeight, systemForMarket, type UnitSystem } from './units';

/**
 * The name the pool shows: brand plus product type, the way a marketplace title leads. A supplier row
 * often carries a marketing claim in front of the brand and the size and colour behind the type
 * ("100% leakproof ET.ELF/外星精灵 咖啡杯 260ml Black"), and none of that is what the product is.
 */
const PRODUCT_TYPE_WORDS = ['保温杯', '咖啡杯', '马克杯', '陶瓷杯', '水杯', '托特包', '台灯', '喷雾套装', '随行杯', 'Travel Bottle', 'Tote Bag'];
export function productDisplayName(product: { name: string; color?: string }): string {
  const colour = (product.color ?? '').trim();
  let name = product.name.trim()
    .replace(/^\s*\d+(?:\.\d+)?\s*%\s*\S+\s+/, '')
    .replace(/[\s,，]*\d+(?:\.\d+)?\s*(?:ml|l|oz|fl\s*oz|g|kg|cm|in)\b.*$/i, '');
  if (colour && colour.toLowerCase() !== 'unspecified') {
    name = name.replace(new RegExp(`[\\s,，]*${colour.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '');
  }
  name = name.replace(/[\s,，;；-]+$/, '').replace(/\s+/g, ' ').trim();
  const type = PRODUCT_TYPE_WORDS.map(word => ({ word, at: name.toLowerCase().indexOf(word.toLowerCase()) }))
    .filter(hit => hit.at >= 0).sort((left, right) => left.at - right.at)[0];
  return type ? name.slice(0, type.at + type.word.length).trim() : name;
}
export function rankProducts(products: Product[], task: Task): Recommendation[] {
  return products.filter(p => ['search_ready', 'missing_data'].includes(p.status) && p.duplicateStatus === 'unique' && sameCategory(p.category, task.category) && ['bottle', 'bag'].includes(p.visual) && !!p.color && !!p.material && (p.visual !== 'bottle' || p.capacity > 0)).map(p => {
    const reasons: string[] = []; const deductions: string[] = []; let score = 94;
    if (p.color === 'Black') reasons.push('Black matches requested color'); else { score -= 23; deductions.push('Color does not match requested black'); }
    if (p.visual === 'bottle') {
      // Reasons name the value, never its unit: the screen writes the number in the unit system the person picked.
      if (p.capacity === 500) reasons.push('{capacity} closely matches target capacity'); else { score -= 16; deductions.push(p.capacity === 750 ? 'Capacity too large: {capacity}' : 'Capacity does not match the requested capacity'); }
      if (!p.straw) reasons.push('No straw'); else { score -= 12; deductions.push('Includes straw: does not meet the no-straw preference'); }
    } else reasons.push('Tote bag matches the requested product type');
    reasons.push('Core product facts are available for selection'); return { sku: p.sku, score, reasons, deductions };
  }).sort((a, b) => b.score - a.score || Number(b.sku === HERO_SKU) - Number(a.sku === HERO_SKU)).slice(0, 3);
}
export function enrichProductEvidence(p: Product, v1: FactCard, task: Task): FactCard {
  const confirmed = p.sku === HERO_SKU;
  const make = (key: string, label: string, value: string, source: string, anchor: string, allowed = true): Fact => ({ key, label, value, source, anchor, sourceKind: 'mock', status: allowed && confirmed ? 'Confirmed' : 'Requires Confirmation', allowed: allowed && confirmed });
  const added = p.visual === 'bag' ? [
    make('packageIncludes', 'Package includes', 'Tote bag, Care card', 'Mock analysis', 'Sample result · no file was parsed'),
    make('finish', 'Finish', 'Natural woven texture', 'Mock analysis', 'Sample result · no file was parsed'),
    make('closureType', 'Closure type', 'Open top', 'Mock analysis', 'Sample result · no file was parsed'),
    make('strapType', 'Strap type', 'Dual shoulder straps', 'Mock analysis', 'Sample result · no file was parsed'),
  ] : [
    make('packageIncludes', 'Package includes', 'Bottle, Lid, Instruction card', 'Mock analysis', 'Sample result · no file was parsed'),
    make('finish', 'Finish', `Matte ${p.color.toLowerCase()}`, 'Mock analysis', 'Sample result · no file was parsed'),
    make('lidType', 'Lid type', 'Screw-top lid', 'Mock analysis', 'Sample result · no file was parsed'),
    make('leakproof', 'Leakproof performance', '100% leakproof', 'Supplier claim', 'Unverified · no supporting test report', false),
  ];
  return { version: 2, sku: p.sku, taskId: task.id, facts: [...structuredClone(v1.facts), ...added] };
}
export type ListingInput = { factCard: FactCard; pricing: Pricing; platform: Platform; revision: number; factRevision: number; context?: { market: string; category: string; requirements: string[]; product: { sku: string; name: string } } };
/**
 * Copy is written in the marketplace language, so a value the supplier (or a picture the text check
 * read) wrote in another script cannot simply be pasted into it: the title came out as
 * "Black 钛含量 >99.8% Travel Bottle". A known material or colour is written with its English term;
 * anything else that is not Latin script stays out of the copy instead of mixing two languages.
 */
const COPY_TERMS: { match: RegExp; wording: string }[] = [
  { match: /不锈钢/, wording: 'Stainless Steel' }, { match: /钛/, wording: 'Titanium' }, { match: /陶瓷/, wording: 'Ceramic' },
  { match: /玻璃/, wording: 'Glass' }, { match: /塑料/, wording: 'Plastic' }, { match: /帆布/, wording: 'Canvas' },
  { match: /硅胶/, wording: 'Silicone' }, { match: /铝/, wording: 'Aluminum' }, { match: /竹/, wording: 'Bamboo' },
  { match: /黑/, wording: 'Black' }, { match: /白/, wording: 'White' }, { match: /象牙/, wording: 'Ivory' }, { match: /米/, wording: 'Beige' },
  { match: /藏青|深蓝|海军蓝/, wording: 'Navy' }, { match: /蓝/, wording: 'Blue' }, { match: /红/, wording: 'Red' },
  { match: /绿/, wording: 'Green' }, { match: /紫/, wording: 'Purple' }, { match: /粉/, wording: 'Pink' }, { match: /灰/, wording: 'Gray' },
  { match: /银/, wording: 'Silver' }, { match: /金/, wording: 'Gold' }, { match: /棕|咖/, wording: 'Brown' }, { match: /橙/, wording: 'Orange' },
  { match: /中国大陆|中国/, wording: 'China' }, { match: /日本/, wording: 'Japan' }, { match: /美国/, wording: 'United States' },
  { match: /德国/, wording: 'Germany' }, { match: /英国/, wording: 'United Kingdom' }, { match: /意大利/, wording: 'Italy' },
  { match: /越南/, wording: 'Vietnam' }, { match: /韩国/, wording: 'South Korea' },
];
/** Wording for the parts of a list value ("杯体、杯盖、说明卡" → "Bottle, Lid, Instruction card"). */
const COPY_PARTS: Record<string, string> = { '杯体': 'Bottle', '杯盖': 'Lid', '说明卡': 'Instruction card', '吸管': 'Straw',
  '保温杯': 'Travel bottle', '陶瓷杯': 'Ceramic mug', '玻璃杯': 'Glass', '包装盒': 'Gift box', '手提袋': 'Carry bag' };
/** The wording the copy may use, or undefined when this value cannot be written in the listing language. */
export function listingWording(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (!/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(value)) return value;
  return COPY_TERMS.find(term => term.match.test(value))?.wording;
}
/** Unit-bearing facts are printed in the marketplace's own units: one system per listing, never both. */
const UNIT_WORDING: Record<string, (value: number, system: UnitSystem) => string> = {
  capacity: formatCapacity, packagingWeight: formatWeight, packageLength: formatLength, packageWidth: formatLength, packageHeight: formatLength };
export function listingUnitWording(key: string, raw: string | undefined, system: UnitSystem): string | undefined {
  if (!raw) return undefined;
  const render = UNIT_WORDING[key];
  const first = Number.parseFloat((raw.match(/\d+(?:\.\d+)?/g) ?? [''])[0]);
  if (render && Number.isFinite(first)) return render(first, system);
  return listingWording(raw);
}
/** A value that lists parts, rendered part by part in the listing language. */
export function listingParts(raw: string | undefined): string | undefined {
  const parts = raw?.split(/[、,，;；]/).map(part => part.trim()).filter(Boolean)
    .map(part => COPY_PARTS[part] ?? listingWording(part)).filter((part): part is string => !!part);
  return parts?.length ? parts.join(', ') : undefined;
}
export function makeTemplateListing(input: ListingInput): Listing {
  const sources = input.factCard.facts.filter(f => f.allowed && f.status === 'Confirmed');
  const value = (key: string) => sources.find(f => f.key === key)?.value;
  // One unit system per marketplace: the stored capacity carries both ("750ml / 25.4 fl oz"), and a US
  // listing prints the fl oz figure only.
  const system = systemForMarket(input.context?.market);
  const color = listingWording(value('color')); const material = listingWording(value('material')); const bagType = listingWording(value('bagType'));
  const capacity = listingUnitWording('capacity', value('capacity'), system);
  if (!value('color') || !value('material') || (!value('capacity') && !value('bagType'))) throw new Error('Required confirmed facts are missing.');
  const lid = listingWording(value('lidType')); const includes = listingParts(value('packageIncludes'));
  if (bagType) {
    const closure = listingWording(value('closureType')); const straps = listingWording(value('strapType')); const finish = listingWording(value('finish')); const origin = listingWording(value('countryOfOrigin'));
    const displayBagType = bagType === 'Tote bag' ? 'Tote Bag' : bagType;
    return { platform: input.platform, revision: input.revision, factRevision: input.factRevision, riskDemoInjected: false,
      title: [color, material, displayBagType].filter(Boolean).join(' '),
      bullets: [material ? `${material} construction${color ? ` in ${color.toLowerCase()}` : ''}.` : null,
        `${bagType} design for everyday carrying.`, origin ? `Country of origin: ${origin}.` : 'Designed for everyday organization.',
        ...(closure ? [`${closure} closure.`] : []), ...(straps ? [`${straps}.`] : [])].filter((line): line is string => !!line).slice(0, 5),
      description: `An everyday ${bagType.toLowerCase()} with a ${[color ? color.toLowerCase() : '', material ? material.toLowerCase() : ''].filter(Boolean).join(' ')} body.${finish ? ` The ${finish.toLowerCase()} is visible in the supplied product image.` : ''}${closure ? ` It has an ${closure.toLowerCase()} design.` : ''}`.replace(/with a  body\./, 'for everyday carrying.'),
      attributes: Object.fromEntries(sources.filter(f => ['color', 'material', 'bagType', 'countryOfOrigin', 'finish', 'closureType', 'strapType'].includes(f.key))
        .map(f => [f.label, listingUnitWording(f.key, f.value, system)] as const).filter((entry): entry is [string, string] => !!entry[1])), sources };
  }
  return {
    platform: input.platform, revision: input.revision, factRevision: input.factRevision, riskDemoInjected: false,
    title: `${[color, material, 'Travel Bottle'].filter(Boolean).join(' ')}${capacity ? `, ${capacity}` : ''}${lid ? `, ${lid === 'Screw-top lid' ? 'Screw-top Lid' : lid}` : ''}`,
    bullets: [...(capacity ? [`${capacity} capacity for your everyday routine.`] : []), material ? `${material} body${listingWording(value('finish')) ? ` with a ${listingWording(value('finish'))!.toLowerCase()} finish` : ''}.` : null,
      ...(lid ? [lid === 'Screw-top lid' ? 'Secure screw-top lid designed for everyday carrying.' : `${lid}.`] : []),
      ...(value('straw') ? value('straw') === 'No straw' ? ['A simple, straw-free design.'] : ['Includes a straw.'] : []),
      ...(includes ? [`In the box: ${includes}.`] : [])].filter((line): line is string => !!line),
    description: `Meet your everyday travel bottle.${color || material ? ` A ${[color ? color.toLowerCase() : '', material ? material.toLowerCase() : ''].filter(Boolean).join(' ')} body holds ${capacity ?? ''}.` : ''}${lid ? ` Finished with a ${lid.toLowerCase()}.` : ''}${includes ? ` Includes ${includes.toLowerCase()}.` : ''}`.replace(/ holds \s*\./g, '.').replace(/with a  body\./, 'for everyday carrying.'),
    attributes: Object.fromEntries(sources.filter(f => ['color', 'capacity', 'material', 'straw', 'countryOfOrigin', 'finish', 'lidType'].includes(f.key))
      .map(f => [f.label, listingUnitWording(f.key, f.value, system)] as const).filter((entry): entry is [string, string] => !!entry[1])), sources,
  };
}
export function reviewAgainstTemplate(listing: Listing, safe: Listing): Issue[] {
  const fields = [listing.title, ...listing.bullets, listing.description]; const expected = [safe.title, ...safe.bullets, safe.description]; const issues: Issue[] = [];
  // A listing is written for one marketplace: copy that drifts back into another language is a defect,
  // not a translation problem, because the platform reads the title and bullets as the product page.
  if (fields.some(text => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(text)))
    issues.push({ id: 'R004', severity: 'HIGH', title: 'Copy is not in the platform language',
      text: fields.find(text => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(text))!.slice(0, 80),
      reason: 'This marketplace is served in English. A fact that cannot be written in English has to be translated, renamed or left out of the copy.' });
  if (fields.some(text => /100%\s*leakproof/i.test(text))) issues.push({ id: 'R001', severity: 'HIGH', title: 'Unsupported performance claim', text: '100% leakproof', reason: 'No verified evidence supports an absolute leakproof claim.' });
  if (fields.some(text => /guaranteed to carry up to 50 kg/i.test(text))) issues.push({ id: 'R003', severity: 'HIGH', title: 'Unsupported load claim', text: 'Guaranteed to carry up to 50 kg', reason: 'No confirmed test or specification supports this carrying-capacity promise.' });
  if (fields.some((text, i) => text !== expected[i] && !/^(?:100% leakproof|Guaranteed to carry up to 50 kg\.?)$/i.test(text)) || fields.length !== expected.length) issues.push({ id: 'R002', severity: 'HIGH', title: 'Unverified edited content', text: 'Text differs from the evidence-backed draft.', reason: 'This mock reviewer only approves the confirmed FactCard wording. Apply the suggested fix to restore supported copy.' });
  return issues;
}
export function demoRiskClaim(visual: Product['visual']) { return visual === 'bag' ? 'Guaranteed to carry up to 50 kg.' : '100% leakproof'; }
