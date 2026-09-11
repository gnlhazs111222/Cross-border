import type { Fact, Product, Recommendation, Task } from '../src/types';
import { demoTask } from '../src/data/mockData';
import { rankProducts } from './domain';

export type RecommendationGeneration = { mode: 'rule' | 'qwen' | 'rule_fallback'; model?: string; promptVersion?: string; inputHash?: string; fallbackReason?: string; aiCallId?: string; cacheHit?: boolean };
export type RecommendationContext = { taskRevision: number; catalogRevision: number; candidateVersion: string; facts: Record<string, Fact[]> };
export type RecommendationSnapshot = {
  status: 'not_run' | 'ready' | 'stale'; taskRevision: number; catalogRevision: number; candidateVersion: string;
  eligibleCount: number; excluded: { sku: string; reason: string }[]; recommendations: Recommendation[];
  generation?: RecommendationGeneration; generatedAt?: string;
};
export const RECOMMENDATION_FACT_KEYS = new Set(['color', 'capacity', 'material', 'straw', 'countryOfOrigin', 'finish', 'lidType', 'packageIncludes']);
const REQUIRED_SELECTION_FACT_LABELS = new Set(['Color', 'Capacity', 'Material', 'Straw']);
export function eligibilityReason(p: Product, task: Task): string | null {
  if (p.duplicateStatus === 'duplicate') return 'Duplicate';
  if (p.duplicateStatus === 'possible_duplicate') return 'Possible Duplicate';
  if (p.category !== task.category) return 'Category mismatch';
  if (p.visual !== 'bottle') return 'Unsupported product type';
  // Candidate selection depends on product identity and searchable attributes.
  // Pricing-only inputs are deliberately checked after an operator selects a SKU.
  if (!['search_ready', 'missing_data'].includes(p.status) || p.missing.some(label => REQUIRED_SELECTION_FACT_LABELS.has(label)) || !p.color || !p.material || p.capacity <= 0) return 'Missing candidate facts';
  return null;
}
export function hardFilter(products: Product[], task: Task) {
  const eligible: Product[] = []; const excluded: { sku: string; reason: string }[] = [];
  for (const p of products) { const reason = eligibilityReason(p, task); if (reason) excluded.push({ sku: p.sku, reason }); else eligible.push(p); }
  return { eligible, excluded };
}
export function isClassicTask(task: Task) { return JSON.stringify(task.requirements) === JSON.stringify(demoTask.requirements); }
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
  const material = ['stainless steel', 'glass', 'plastic', 'aluminum', 'ceramic'].find(m => text.includes(m)) ?? (text.includes('不锈钢') ? 'stainless steel' : text.includes('玻璃') ? 'glass' : undefined);
  const capacities = eligible.map(p => p.capacity); const min = Math.min(...capacities); const max = Math.max(...capacities);
  return eligible.map(p => {
    let score = 94; const reasons: string[] = []; const deductions: string[] = [];
    if (color) {
      const matches = p.color.toLowerCase() === color || (color === 'white' && ['ivory', 'white'].includes(p.color.toLowerCase()));
      if (matches) reasons.push(`${p.color} matches the color preference`); else { score -= 23; deductions.push(`Color: ${p.color}; requested ${color}`); }
    }
    if (straw !== undefined) { if (p.straw === straw) reasons.push(p.straw ? 'Includes straw as requested' : 'No straw as requested'); else { score -= 24; deductions.push(p.straw ? 'Includes straw; no straw was requested' : 'No straw; a straw was requested'); } }
    if (target) { const delta = Math.abs(p.capacity - target) / target; if (delta <= 0.1) reasons.push(`${p.capacity}ml capacity matches the target`); else { score -= Math.min(30, Math.round(delta * 24)); deductions.push(`Capacity: ${p.capacity}ml; requested about ${Math.round(target)}ml`); } }
    else if (large || small) { const distance = max === min ? 0 : (large ? max - p.capacity : p.capacity - min) / (max - min); score -= Math.round(distance * 24); reasons.push(`${p.capacity}ml capacity considered for the ${large ? 'large' : 'small'} capacity preference`); }
    if (material) { if (p.material.toLowerCase() === material) reasons.push(`${p.material} matches the material preference`); else { score -= 24; deductions.push(`Material: ${p.material}; requested ${material}`); } }
    if (/accessor|contents|配件|内含/.test(text) && context?.facts[p.sku]?.some(f => f.key === 'packageIncludes' && f.status === 'Confirmed' && f.allowed)) { score += 4; reasons.push('Package contents are confirmed'); }
    reasons.push('Core product facts are available for selection');
    return { sku: p.sku, productId: p.recordId ?? p.sku, score: Math.max(0, Math.min(100, score)), reasons: reasons.slice(0, 5), deductions: deductions.slice(0, 5) };
  }).sort((a, b) => b.score - a.score || a.sku.localeCompare(b.sku)).slice(0, 3);
}
