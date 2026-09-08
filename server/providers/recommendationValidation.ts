import { z } from 'zod';
import type { Product } from '../../src/types';
import { AppError } from '../errors';
const line = z.string().trim().min(1).max(220);
export const recommendationOutputSchema = z.object({ rankedCandidates: z.array(z.object({
  productId: z.string().min(1).max(220), sku: z.string().min(1).max(220), score: z.number().finite().int().min(0).max(100),
  matchedReasons: z.array(line).min(1).max(5), concerns: z.array(line).max(5), summary: z.string().trim().min(1).max(260),
}).strict()).max(3) }).strict();
export type RankedOutput = z.infer<typeof recommendationOutputSchema>;
export function reasonConflict(p: Product, text: string, comparison = false): boolean {
  const actualAssertion = (at: number) => [...text.slice(0, at).matchAll(/\b(actual|requested|target|preferred|desired)\b/gi)].at(-1)?.[1].toLowerCase() === 'actual';
  const reference = (at: number) => !actualAssertion(at) && comparison && /request|prefer|target|want|desired|require|compared|instead/i.test(text.slice(Math.max(0, at - 35), at + 75));
  if (/<[^>]+>|https?:\/\/|100\s*%|guarantee|certified|\bFDA\b|sales forecast|conversion rate|success probability|revenue forecast|supplier.?cost|declared.?value/i.test(text)) return true;
  for (const m of text.matchAll(/\b(black|white|ivory|navy|blue|green|red|pink|silver|gold|sage)\b/gi)) {
    if (!p.color.toLowerCase().includes(m[1].toLowerCase()) && (actualAssertion(m.index!) || (!reference(m.index!) && !(comparison && text.toLowerCase().includes(p.color.toLowerCase()) && /\bvs\.?\b|\bversus\b/i.test(text))))) return true;
  }
  const hasActualCapacity = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(ml|(?:fl\s*)?oz)\b/gi)].some(m => Math.abs(Number(m[1]) - (m[2].toLowerCase() === 'ml' ? p.capacity : Number.parseFloat(p.localizedCapacity))) <= 0.11);
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(ml|(?:fl\s*)?oz)\b/gi)) {
    const expected = m[2].toLowerCase() === 'ml' ? p.capacity : Number.parseFloat(p.localizedCapacity);
    const approximateOz = m[2].toLowerCase() !== 'ml' && Number.isInteger(Number(m[1])) && [Math.floor(expected), Math.round(expected)].includes(Number(m[1])) && /(?:~|around|about|approximately|approx\.?|close to)\s*$/i.test(text.slice(Math.max(0, m.index! - 20), m.index));
    const prefix = text.slice(Math.max(0, m.index! - 35), m.index);
    const truthfulComparison = (/(?:larger|bigger|greater|more) than\s*$/i.test(prefix) && expected > Number(m[1])) || (/(?:smaller|less) than\s*$/i.test(prefix) && expected < Number(m[1]));
    if (Math.abs(Number(m[1]) - expected) > 0.11 && (actualAssertion(m.index!) || (!approximateOz && !truthfulComparison && !reference(m.index!) && !(hasActualCapacity && /request|target|requirement|prefer/i.test(text))))) return true;
  }
  if (p.straw) { for (const m of text.matchAll(/no[- ]?straw|straw[- ]free|without (?:a )?straw/gi)) if (!reference(m.index!)) return true; }
  else for (const m of text.matchAll(/\b(?:includes?|with|has) (?:a )?straw\b/gi)) {
    if (!/\b(?:not|no|without)\s*$/i.test(text.slice(Math.max(0, m.index! - 15), m.index)) && !reference(m.index!)) return true;
  }
  for (const m of text.matchAll(/\b(stainless steel|glass|plastic|aluminum|ceramic|titanium)\b/gi)) if (!p.material.toLowerCase().includes(m[1].toLowerCase()) && !reference(m.index!)) return true;
  return false;
}
export function validateCandidateAuthorization(output: RankedOutput, eligible: Product[]): RankedOutput {
  const byId = new Map(eligible.map(p => [p.recordId ?? p.sku, p])); const seen = new Set<string>();
  if (output.rankedCandidates.length !== Math.min(3, eligible.length)) throw new AppError('invalid_ranking_count', 'Invalid candidate result count.', 422);
  if (output.rankedCandidates.some((r, i, rows) => i > 0 && rows[i - 1].score < r.score)) throw new AppError('invalid_score_order', 'Ranking scores must be descending.', 422);
  for (const candidate of output.rankedCandidates) {
    const p = byId.get(candidate.productId);
    if (!p || p.sku !== candidate.sku || seen.has(candidate.sku)) throw new AppError('unauthorized_candidate', 'The ranking contains an unauthorized candidate.', 422);
    seen.add(candidate.sku);
    if (candidate.matchedReasons.some(r => reasonConflict(p, r)) || candidate.concerns.some(r => reasonConflict(p, r, true)) || reasonConflict(p, candidate.summary, true)) throw new AppError('unsupported_recommendation_reason', 'A ranking reason conflicts with candidate facts.', 422);
  }
  return output;
}
