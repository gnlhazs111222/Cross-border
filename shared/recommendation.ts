import type { Fact, Product, Recommendation, Task } from '../src/types';
import { demoTask } from '../src/data/mockData';
import { sameCategory } from './categories';
import { rankProducts } from './domain';

export type RecommendationGeneration = { mode: 'rule' | 'qwen' | 'rule_fallback'; model?: string; promptVersion?: string; inputHash?: string; fallbackReason?: string; aiCallId?: string; cacheHit?: boolean };
export type RecommendationContext = { taskRevision: number; catalogRevision: number; candidateVersion: string; facts: Record<string, Fact[]> };
export type RecommendationSnapshot = {
  status: 'not_run' | 'ready' | 'stale'; taskRevision: number; catalogRevision: number; candidateVersion: string;
  eligibleCount: number; excluded: { sku: string; reason: string }[]; recommendations: Recommendation[];
  generation?: RecommendationGeneration; generatedAt?: string;
};
export const RECOMMENDATION_FACT_KEYS = new Set(['color', 'capacity', 'material', 'straw', 'countryOfOrigin', 'finish', 'lidType', 'packageIncludes', 'bagType', 'closureType', 'strapType']);
const REQUIRED_BOTTLE_SELECTION_FACT_LABELS = new Set(['Color', 'Capacity', 'Material', 'Straw']);
const REQUIRED_BAG_SELECTION_FACT_LABELS = new Set(['Color', 'Material', 'Bag type']);
export function eligibilityReason(p: Product, task: Task): string | null {
  if (p.duplicateStatus === 'duplicate') return 'Duplicate';
  if (p.duplicateStatus === 'possible_duplicate') return 'Possible Duplicate';
  if (!sameCategory(p.category, task.category)) return 'Category mismatch';
  if (!['bottle', 'bag'].includes(p.visual)) return 'Unsupported product type';
  // Candidate selection depends on product identity and searchable attributes.
  // A row may be imported with a gap and shown as "Missing Data", but a product without a name has
  // no identity to recommend or to write copy from, so it stays out of the pool until that gap is
  // filled. Pricing-only inputs are deliberately checked after an operator selects a SKU.
  if (!p.name?.trim()) return 'Missing candidate facts';
  const requiredLabels = p.visual === 'bag' ? REQUIRED_BAG_SELECTION_FACT_LABELS : REQUIRED_BOTTLE_SELECTION_FACT_LABELS;
  if (!['search_ready', 'missing_data'].includes(p.status) || p.missing.some(label => requiredLabels.has(label)) || !p.color || !p.material || (p.visual === 'bottle' && p.capacity <= 0)) return 'Missing candidate facts';
  return null;
}
export function hardFilter(products: Product[], task: Task) {
  const eligible: Product[] = []; const excluded: { sku: string; reason: string }[] = [];
  for (const p of products) { const reason = eligibilityReason(p, task); if (reason) excluded.push({ sku: p.sku, reason }); else eligible.push(p); }
  return { eligible, excluded };
}
export function isClassicTask(task: Task) { return task.category === demoTask.category && JSON.stringify(task.requirements) === JSON.stringify(demoTask.requirements); }
/**
 * The brief is parsed into lowercase keys ("black", "stainless steel") because that is what matching
 * compares. A reason is read by a person, so the labels below are what the sentence shows, and the screen
 * translates the sentence whole, value included, instead of gluing two languages into one line.
 */
const COLOR_LABELS: Record<string, string> = { black: 'Black', white: 'White', ivory: 'Ivory', navy: 'Navy', blue: 'Blue', green: 'Green', red: 'Red', silver: 'Silver' };
const MATERIAL_LABELS: Record<string, string> = { 'stainless steel': 'Stainless Steel', glass: 'Glass', plastic: 'Plastic', aluminum: 'Aluminum', ceramic: 'Ceramic', canvas: 'Canvas', leather: 'Leather', nylon: 'Nylon', polyester: 'Polyester' };
export function ruleRank(products: Product[], task: Task, context?: RecommendationContext): Recommendation[] {
  const eligible = hardFilter(products, task).eligible;
  if (isClassicTask(task)) return rankProducts(eligible, { ...task, category: eligible[0]?.category ?? task.category });
  const text = task.requirements.join(' ').toLowerCase();
  const colors = ['black', 'white', 'ivory', 'navy', 'blue', 'green', 'red', 'silver'];
  const color = colors.find(c => new RegExp(`\\b${c}\\b`).test(text)) ?? (text.includes('黑色') ? 'black' : /白色|浅色|light.colou?r/.test(text) ? 'white' : undefined);
  const straw = /no[- ]?straw|without (?:a )?straw|无吸管|不带吸管/.test(text) ? false : /\bwith (?:a )?straw|\bincludes? (?:a )?straw|带吸管|有吸管/.test(text) ? true : undefined;
  const ml = text.match(/(\d+(?:\.\d+)?)\s*(?:ml|毫升)/); const oz = text.match(/(\d+(?:\.\d+)?)\s*(?:fl\s*)?(?:oz|ounces?)/);
  const target = ml ? Number(ml[1]) : oz ? Number(oz[1]) * 29.5735295625 : undefined;
  const large = /\blarg(?:e|er|est)\b|大容量/.test(text); const small = /\bsmall(?:er|est)?\b|\bcompact\b|小容量/.test(text);
  const material = ['stainless steel', 'glass', 'plastic', 'aluminum', 'ceramic', 'canvas', 'leather', 'nylon', 'polyester'].find(m => text.includes(m)) ?? (text.includes('不锈钢') ? 'stainless steel' : text.includes('玻璃') ? 'glass' : text.includes('帆布') ? 'canvas' : undefined);
  const capacities = eligible.map(p => p.capacity); const min = Math.min(...capacities); const max = Math.max(...capacities);
  const requested = { ...(color ? { color: COLOR_LABELS[color] ?? color } : {}), ...(material ? { material: MATERIAL_LABELS[material] ?? material } : {}) };
  return eligible.map(p => {
    let score = 94; const reasons: string[] = []; const deductions: string[] = [];
    if (color) {
      const matches = p.color.toLowerCase() === color || (color === 'white' && ['ivory', 'white'].includes(p.color.toLowerCase()));
      if (matches) reasons.push('{color} matches the color preference'); else { score -= 23; deductions.push('Color: {color}; requested {requestedColor}'); }
    }
    if (p.visual === 'bottle' && straw !== undefined) { if (p.straw === straw) reasons.push(p.straw ? 'Includes straw as requested' : 'No straw as requested'); else { score -= 24; deductions.push(p.straw ? 'Includes straw; no straw was requested' : 'No straw; a straw was requested'); } }
    if (p.visual === 'bottle' && target) { const delta = Math.abs(p.capacity - target) / target; if (delta <= 0.1) reasons.push('{capacity} capacity matches the target'); else { score -= Math.min(30, Math.round(delta * 24)); deductions.push('Capacity: {capacity}; does not match the requested capacity'); } }
    else if (p.visual === 'bottle' && (large || small)) { const distance = max === min ? 0 : (large ? max - p.capacity : p.capacity - min) / (max - min); score -= Math.round(distance * 24); reasons.push(`{capacity} capacity considered for the ${large ? 'large' : 'small'} capacity preference`); }
    if (p.visual === 'bag') reasons.push('Tote bag matches the requested product type');
    if (material) { if (p.material.toLowerCase() === material) reasons.push('{material} matches the material preference'); else { score -= 24; deductions.push('Material: {material}; requested {requestedMaterial}'); } }
    if (/accessor|contents|配件|内含/.test(text) && context?.facts[p.sku]?.some(f => f.key === 'packageIncludes' && f.status === 'Confirmed' && f.allowed)) { score += 4; reasons.push('Package contents are confirmed'); }
    reasons.push('Core product facts are available for selection');
    return { sku: p.sku, productId: p.recordId ?? p.sku, score: Math.max(0, Math.min(100, score)), reasons: reasons.slice(0, 5), deductions: deductions.slice(0, 5), ...(Object.keys(requested).length ? { requested } : {}) };
  }).sort((a, b) => b.score - a.score || a.sku.localeCompare(b.sku)).slice(0, 3);
}
