import type { Product, Recommendation } from '../../src/types';
import type { EvaluationCase } from './cases';
import { hardFilter } from '../../shared/recommendation';

// Evaluation labels are independent of provider code. The reason audit is a limited observable-field check, not a semantic judge.
function explanationUnsupported(product: Product, text: string) {
  if (/100%|guaranteed|certified|sales prediction/i.test(text)) return true;
  if (product.straw && /^(?:no straw|straw.free|without a straw)/i.test(text.trim())) return true;
  if (!product.straw && /^(?:includes?|has|with) (?:a )?straw/i.test(text.trim())) return true;
  const color = text.match(/^(black|ivory|white|navy|red|blue|green|sage) (?:matches|color|bottle)/i);
  if (color && !product.color.toLowerCase().includes(color[1].toLowerCase())) return true;
  const capacity = text.match(/^(?:capacity:?\s*)?(\d+(?:\.\d+)?)\s*ml/i);
  if (capacity && Number(capacity[1]) !== product.capacity) return true;
  return false;
}
export function validateExpected(c: EvaluationCase) {
  const eligible = new Set(hardFilter(c.candidates, c.task).eligible.map(p => p.sku));
  for (const sku of [...c.expected.preferredTop1, ...c.expected.acceptableTop3, ...Object.keys(c.expected.relevance)]) if (!eligible.has(sku)) throw new Error(`${c.id}: expected label contains excluded or unknown SKU ${sku}`);
}
export function caseMetrics(c: EvaluationCase, actual: Recommendation[]) {
  validateExpected(c); const eligible = hardFilter(c.candidates, c.task).eligible; const bySku = new Map(eligible.map(p => [p.sku, p])); const seen = new Set<string>();
  let invalid = 0; let unsupported = 0; let reasonCount = 0;
  for (const r of actual) {
    const p = bySku.get(r.sku); if (!p || seen.has(r.sku)) invalid++; seen.add(r.sku);
    for (const reason of r.reasons) { reasonCount++; if (!p || explanationUnsupported(p, reason)) unsupported++; }
  }
  const credited = new Set<string>();
  const gains = actual.slice(0, 3).map(r => { if (credited.has(r.sku) || !bySku.has(r.sku)) return 0; credited.add(r.sku); return c.expected.relevance[r.sku] ?? 0; });
  const ideal = Object.values(c.expected.relevance).sort((a, b) => b - a).slice(0, 3);
  const dcg = (grades: number[]) => grades.reduce((sum, grade, i) => sum + (2 ** grade - 1) / Math.log2(i + 2), 0);
  const labelled = c.expected.preferredTop1.length > 0;
  return { top1Accuracy: labelled ? Number(c.expected.preferredTop1.includes(actual[0]?.sku)) : null,
    hitAt3: labelled ? Number(actual.slice(0, 3).some(r => c.expected.preferredTop1.includes(r.sku))) : null,
    ndcgAt3: dcg(ideal) ? dcg(gains) / dcg(ideal) : null,
    invalidCandidates: invalid, returnedCandidates: actual.length, unsupportedReasons: unsupported, checkedReasons: reasonCount,
    emptyCaseCorrect: labelled ? null : actual.length === 0 };
}
export function summarizeMetrics(rows: ReturnType<typeof caseMetrics>[]) {
  const mean = (key: 'top1Accuracy' | 'hitAt3' | 'ndcgAt3') => { const values = rows.map(r => r[key]).filter((v): v is number => v !== null); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; };
  const sum = (key: 'invalidCandidates' | 'returnedCandidates' | 'unsupportedReasons' | 'checkedReasons') => rows.reduce((n, r) => n + r[key], 0);
  return { top1Accuracy: mean('top1Accuracy'), hitAt3: mean('hitAt3'), ndcgAt3: mean('ndcgAt3'), labelledCaseCount: rows.filter(r => r.top1Accuracy !== null).length,
    invalidCandidateRate: sum('returnedCandidates') ? sum('invalidCandidates') / sum('returnedCandidates') : 0,
    unsupportedReasonRate: sum('checkedReasons') ? sum('unsupportedReasons') / sum('checkedReasons') : 0,
    emptyCaseCount: rows.filter(r => r.emptyCaseCorrect !== null).length, correctEmptyCaseCount: rows.filter(r => r.emptyCaseCorrect === true).length };
}
