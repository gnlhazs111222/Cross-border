import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { QwenRecommendationProvider, normalizedRecommendationInput, type RecommendationOptions } from '../providers/qwenRecommendation';
import { MockTextModelProvider, type TextRequest, type TextModelProvider } from '../providers/text';
import { hardFilter, type RecommendationContext } from '../../shared/recommendation';
import { recommendationCases } from '../../evaluation/recommendation/cases';
import { caseMetrics, summarizeMetrics, validateExpected } from '../../evaluation/recommendation/metrics';
import { baseFactCard } from '../../shared/facts';
import { bagDemoTask, products } from '../../src/data/mockData';
import { AppError } from '../errors';
import { reasonConflict, type RankedOutput } from '../providers/recommendationValidation';
const example = recommendationCases[0];
const context = (): RecommendationContext => ({ taskRevision: 1, catalogRevision: 1, candidateVersion: 'v1', facts: Object.fromEntries(example.candidates.map(p => [p.sku, baseFactCard(p).facts])) });
class Text extends MockTextModelProvider {
  calls = 0; requests: TextRequest[] = []; mutation?: (data: RankedOutput) => void;
  override async generateStructured<T>(r: TextRequest & { schema: z.ZodType<T>; example: T }) { this.calls++; this.requests.push(r); const data = structuredClone(r.example); this.mutation?.(data as RankedOutput); return { ...await this.generateText(), content: JSON.stringify(data), data }; }
}
const options = (): RecommendationOptions => ({ model: 'qwen3.6-flash', configured: true, liveEnabled: true });

test('hard filter uses candidate facts and ignores pricing readiness and the price target', () => {
  const filtered = hardFilter(example.candidates, example.task); assert.equal(filtered.eligible.length, 6); assert.equal(filtered.excluded.length, 4);
  for (const reason of ['Duplicate', 'Possible Duplicate', 'Category mismatch']) assert.ok(filtered.excluded.some(r => r.reason === reason));
  assert.ok(filtered.eligible.some(p => p.status === 'missing_data' && !p.packagingWeight));
  const missingSelectionFact = { ...example.candidates[0], status: 'missing_data' as const, missing: ['Material'] };
  assert.equal(hardFilter([missingSelectionFact], example.task).excluded[0].reason, 'Missing candidate facts');
  // A nameless row may sit in the pool as a gap, but nothing can be recommended or written from it.
  const nameless = { ...example.candidates[0], status: 'missing_data' as const, name: '', missing: ['Product name'] };
  assert.equal(hardFilter([nameless], example.task).excluded[0].reason, 'Missing candidate facts');
  assert.equal(hardFilter([{ ...nameless, name: 'Named again' }], example.task).eligible.length, 1);
  const higherTarget = hardFilter(example.candidates, { ...example.task, minProfit: 1000 });
  assert.deepEqual(higherTarget.eligible.map(p => p.sku), filtered.eligible.map(p => p.sku));
  assert.equal(hardFilter(example.candidates, { ...example.task, category: 'home & kitchen' }).eligible.length, 0); // Same canonical category contract as the existing Fact / Listing workflow.
});
test('bag recommendation input uses category fields and keeps lamps excluded', () => {
  const bag = products.find(p => p.visual === 'bag')!;
  const lamp = products.find(p => p.visual === 'lamp')!;
  const filtered = hardFilter([bag, lamp], bagDemoTask);
  assert.deepEqual(filtered.eligible.map(p => p.sku), [bag.sku]);
  const payload = normalizedRecommendationInput(filtered.eligible, bagDemoTask);
  assert.deepEqual(payload.candidates[0].attributes, { productType: 'Tote bag', color: 'Black', material: 'Canvas' });
  assert.doesNotMatch(JSON.stringify(payload), /capacityMl|capacityLocalized|hasStraw/);
});
test('Qwen receives only eligible public confirmed facts and returns authorized structured Top3 metadata', async () => {
  const text = new Text(); const c = context(); c.facts[example.candidates[0].sku].push({ key: 'finish', label: 'finish', value: 'PRIVATE_PENDING', source: 'PRIVATE_FILE', anchor: '/private', status: 'Requires Confirmation', allowed: false });
  const result = await new QwenRecommendationProvider(text, options()).recommend(example.candidates, example.task, c);
  assert.equal(text.calls, 1); assert.equal(result.length, 3); assert.equal(result[0].generation?.mode, 'qwen');
  const data = JSON.parse(text.requests[0].prompt); assert.equal(data.candidates.length, 6);
  assert.doesNotMatch(text.requests[0].prompt, /PRIVATE|supplierCost|declaredValue|packagingWeight|password|cookie|userId|007-BLK|008-BLK/);
  assert.equal(data.task.minimumProfit, undefined); assert.ok(data.candidates.every((p: { productId: string }) => /^C[1-9]\d*$/.test(p.productId)));
  assert.ok(result.every(r => example.candidates.some(p => p.recordId === r.productId && p.sku === r.sku)));
});
for (const mode of ['unknown', 'duplicate', 'score', 'empty-reason', 'color', 'straw', 'capacity', 'order'] as const) test(`${mode} model error causes deterministic fallback`, async () => {
  const text = new Text(); text.mutation = data => {
    if (mode === 'unknown') data.rankedCandidates[0].productId = 'not-eligible';
    if (mode === 'duplicate') data.rankedCandidates[1] = structuredClone(data.rankedCandidates[0]);
    if (mode === 'score') data.rankedCandidates[0].score = 101;
    if (mode === 'empty-reason') data.rankedCandidates[0].matchedReasons = [];
    if (mode === 'color') data.rankedCandidates[0].matchedReasons = ['Ivory matches requested color'];
    if (mode === 'straw') data.rankedCandidates.find(r => r.sku === 'LM-KT-BTL-002-BLK-500')!.matchedReasons = ['No straw'];
    if (mode === 'capacity') data.rankedCandidates[0].matchedReasons = ['750ml capacity'];
    if (mode === 'order') data.rankedCandidates[0].score = 1;
  };
  const result = await new QwenRecommendationProvider(text, options()).recommend(example.candidates, example.task, context());
  assert.equal(result[0].generation?.mode, 'rule_fallback'); assert.equal(result[0].sku, example.expected.preferredTop1[0]); assert.equal(text.calls, 1);
});
for (const code of ['bailian_timeout', 'bailian_http_503', 'invalid_ai_json', 'live_ai_budget_exhausted', 'provider_error']) test(`${code} preserves a usable deterministic ranking`, async () => {
  const text: TextModelProvider = { generateText: async () => { throw new Error('unused'); }, generateStructured: async () => { throw new AppError(code, 'PRIVATE_UPSTREAM'); } };
  const result = await new QwenRecommendationProvider(text, options()).recommend(example.candidates, example.task, context());
  assert.equal(result[0].generation?.mode, 'rule_fallback'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_UPSTREAM/);
});
for (const gate of ['liveEnabled', 'configured'] as const) test(`${gate}=false makes zero text calls`, async () => {
  const text = new Text(); const result = await new QwenRecommendationProvider(text, { ...options(), [gate]: false }).recommend(example.candidates, example.task, context());
  assert.equal(text.calls, 0); assert.equal(result[0].generation?.mode, 'rule_fallback');
});
test('cache keys include task, catalog, candidate facts, prompt and model versions', async () => {
  const text = new Text(); const opts = options(); const provider = new QwenRecommendationProvider(text, opts); const c = context();
  await provider.recommend(example.candidates, example.task, c); const hit = await provider.recommend(example.candidates, example.task, c); assert.equal(text.calls, 1); assert.equal(hit[0].generation?.cacheHit, true);
  c.taskRevision++; await provider.recommend(example.candidates, example.task, c); assert.equal(text.calls, 2);
  c.catalogRevision++; await provider.recommend(example.candidates, example.task, c); assert.equal(text.calls, 3);
  c.candidateVersion = 'v2'; await provider.recommend(example.candidates, example.task, c); assert.equal(text.calls, 4);
  opts.promptVersion = 'recommendation-test-v2'; await provider.recommend(example.candidates, example.task, c); assert.equal(text.calls, 5);
  opts.model = 'qwen-test'; await provider.recommend(example.candidates, example.task, c); assert.equal(text.calls, 6);
});
test('empty and oversized eligible pools do not consume model calls', async () => {
  const text = new Text(); const provider = new QwenRecommendationProvider(text, options());
  assert.deepEqual(await provider.recommend([], example.task), []);
  const many = Array.from({ length: 41 }, (_, i) => ({ ...example.candidates[0], sku: `MANY-${i}`, recordId: `many-${i}` }));
  const result = await provider.recommend(many, example.task); assert.equal(text.calls, 0); assert.equal(result[0].generation?.fallbackReason, 'candidate_limit');
});
test('evaluation labels are valid, metrics handle ties and empty cases without inflated ranking accuracy', () => {
  assert.ok(recommendationCases.length >= 10); recommendationCases.forEach(validateExpected);
  const correct = caseMetrics(example, example.expected.acceptableTop3.map((sku, i) => ({ sku, score: 99-i, reasons: ['Core product facts are available for selection'], deductions: [] })));
  assert.equal(correct.top1Accuracy, 1); assert.equal(correct.hitAt3, 1); assert.equal(correct.ndcgAt3, 1);
  const emptyCase = recommendationCases.find(c => !c.expected.preferredTop1.length)!; const empty = caseMetrics(emptyCase, []); assert.equal(empty.top1Accuracy, null); assert.equal(empty.emptyCaseCorrect, true);
  assert.equal(summarizeMetrics([correct, empty]).labelledCaseCount, 1);
  const invalid = caseMetrics(example, [{ sku: 'unknown', score: 100, reasons: ['No straw'], deductions: [] }]); assert.equal(invalid.invalidCandidates, 1);
  const repeated = caseMetrics(example, Array.from({ length: 3 }, () => ({ sku: example.expected.preferredTop1[0], score: 99, reasons: ['Core product facts are available for selection'], deductions: [] })));
  assert.equal(repeated.invalidCandidates, 2); assert.ok(repeated.ndcgAt3! <= 1);
  assert.equal(normalizedRecommendationInput(hardFilter(example.candidates, example.task).eligible, example.task).candidates.length, 6);
});

test('capacity comparison can mention a requested target but cannot assert it as the candidate capacity', () => {
  const hero = example.candidates[0]; const large = example.candidates[2];
  assert.equal(reasonConflict(hero, '500ml / 16.9 fl oz matches the requested 16 oz target'), false);
  assert.equal(reasonConflict(large, '500ml capacity'), true);
  assert.equal(reasonConflict(large, 'Actual: 500ml; requested: 750ml.', true), true);
  assert.equal(reasonConflict(example.candidates[3], 'Actual color: Black; requested: Ivory.', true), true);
  assert.equal(reasonConflict(large, 'Actual: 750ml; requested: 500ml.', true), false);
  assert.equal(reasonConflict(hero, 'Best match: Black, ~16oz, no straw, complete info.', true), false);
  assert.equal(reasonConflict(large, 'Best match: Black, ~16oz, no straw.', true), true);
  assert.equal(reasonConflict(hero, 'Capacity is 16oz.'), true);
  assert.equal(reasonConflict(hero, '500ml / 16.9 fl oz, close to 16 oz.'), false);
  assert.equal(reasonConflict(large, 'Significantly larger than 16oz.', true), false);
  assert.equal(reasonConflict(hero, 'Significantly larger than 50oz.', true), true);
  assert.equal(reasonConflict(example.candidates[3], 'Black matches requested color'), true);
  assert.equal(reasonConflict(example.candidates[3], 'Wrong color (Ivory vs Black).', true), false);
});
