import type { Fact, FactCard, Issue, Listing, Platform, Pricing, Product, Recommendation, Task } from '../src/types';
import { HERO_SKU } from '../src/data/mockData';

export function rankProducts(products: Product[], task: Task): Recommendation[] {
  return products.filter(p => ['search_ready', 'missing_data'].includes(p.status) && p.duplicateStatus === 'unique' && p.category === task.category && ['bottle', 'bag'].includes(p.visual) && !!p.color && !!p.material && (p.visual !== 'bottle' || p.capacity > 0)).map(p => {
    const reasons: string[] = []; const deductions: string[] = []; let score = 94;
    if (p.color === 'Black') reasons.push('Black matches requested color'); else { score -= 23; deductions.push('Color does not match requested black'); }
    if (p.visual === 'bottle') {
      if (p.capacity === 500) reasons.push('500ml / 16.9 fl oz closely matches target capacity'); else { score -= 16; deductions.push(p.capacity === 750 ? 'Capacity too large: 750ml / 25.4 fl oz' : 'Capacity does not match the 500ml target'); }
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
export function makeTemplateListing(input: ListingInput): Listing {
  const sources = input.factCard.facts.filter(f => f.allowed && f.status === 'Confirmed');
  const value = (key: string) => sources.find(f => f.key === key)?.value;
  const color = value('color'); const capacity = value('capacity'); const material = value('material'); const bagType = value('bagType');
  if (!color || !material || (!capacity && !bagType)) throw new Error('Required confirmed facts are missing.');
  const lid = value('lidType'); const includes = value('packageIncludes');
  if (bagType) {
    const closure = value('closureType'); const straps = value('strapType'); const finish = value('finish'); const origin = value('countryOfOrigin');
    const displayBagType = bagType === 'Tote bag' ? 'Tote Bag' : bagType;
    return { platform: input.platform, revision: input.revision, factRevision: input.factRevision, riskDemoInjected: false,
      title: `${color} ${material} ${displayBagType}`,
      bullets: [`${material} construction in ${color.toLowerCase()}.`, `${bagType} design for everyday carrying.`, origin ? `Country of origin: ${origin}.` : 'Designed for everyday organization.',
        ...(closure ? [`${closure} closure.`] : []), ...(straps ? [`${straps}.`] : [])].slice(0, 5),
      description: `An everyday ${bagType.toLowerCase()} with a ${color.toLowerCase()} ${material.toLowerCase()} body.${finish ? ` The ${finish.toLowerCase()} is visible in the supplied product image.` : ''}${closure ? ` It has an ${closure.toLowerCase()} design.` : ''}`,
      attributes: Object.fromEntries(sources.filter(f => ['color', 'material', 'bagType', 'countryOfOrigin', 'finish', 'closureType', 'strapType'].includes(f.key)).map(f => [f.label, f.value])), sources };
  }
  return {
    platform: input.platform, revision: input.revision, factRevision: input.factRevision, riskDemoInjected: false,
    title: `${color} ${material} Travel Bottle, ${capacity}${lid ? `, ${lid === 'Screw-top lid' ? 'Screw-top Lid' : lid}` : ''}`,
    bullets: [`${capacity} capacity for your everyday routine.`, `${material} body${value('finish') ? ` with a ${value('finish')!.toLowerCase()} finish` : ''}.`,
      ...(lid ? [lid === 'Screw-top lid' ? 'Secure screw-top lid designed for everyday carrying.' : `${lid}.`] : []),
      ...(value('straw') ? value('straw') === 'No straw' ? ['A simple, straw-free design.'] : ['Includes a straw.'] : []),
      ...(includes ? [`In the box: ${includes}.`] : [])],
    description: `Meet your everyday travel bottle. A ${color.toLowerCase()} ${material.toLowerCase()} body holds ${capacity}.${lid ? ` Finished with a ${lid.toLowerCase()}.` : ''}${includes ? ` Includes ${includes.toLowerCase()}.` : ''}`,
    attributes: Object.fromEntries(sources.filter(f => ['color', 'capacity', 'material', 'straw', 'countryOfOrigin', 'finish', 'lidType'].includes(f.key)).map(f => [f.label, f.value])), sources,
  };
}
export function reviewAgainstTemplate(listing: Listing, safe: Listing): Issue[] {
  const fields = [listing.title, ...listing.bullets, listing.description]; const expected = [safe.title, ...safe.bullets, safe.description]; const issues: Issue[] = [];
  if (fields.some(text => /100%\s*leakproof/i.test(text))) issues.push({ id: 'R001', severity: 'HIGH', title: 'Unsupported performance claim', text: '100% leakproof', reason: 'No verified evidence supports an absolute leakproof claim.' });
  if (fields.some(text => /guaranteed to carry up to 50 kg/i.test(text))) issues.push({ id: 'R003', severity: 'HIGH', title: 'Unsupported load claim', text: 'Guaranteed to carry up to 50 kg', reason: 'No confirmed test or specification supports this carrying-capacity promise.' });
  if (fields.some((text, i) => text !== expected[i] && !/^(?:100% leakproof|Guaranteed to carry up to 50 kg\.?)$/i.test(text)) || fields.length !== expected.length) issues.push({ id: 'R002', severity: 'HIGH', title: 'Unverified edited content', text: 'Text differs from the evidence-backed draft.', reason: 'This mock reviewer only approves the confirmed FactCard wording. Apply the suggested fix to restore supported copy.' });
  return issues;
}
export function demoRiskClaim(visual: Product['visual']) { return visual === 'bag' ? 'Guaranteed to carry up to 50 kg.' : '100% leakproof'; }
