import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { QwenListingProvider, normalizedListingInput, listingInputHash, type QwenOptions, createListingRuntime } from '../providers/qwenListing';
import { MockTextModelProvider, BailianTextModelProvider, type TextRequest, type TextModelProvider } from '../providers/text';
import { listingOutputSchema, validateGeneratedListingAgainstFacts } from '../providers/listingValidation';
import { baseFactCard, pricingFromFacts } from '../../shared/facts';
import { enrichProductEvidence, type ListingInput } from '../../shared/domain';
import { products, demoTask } from '../../src/data/mockData';
import { readConfig } from '../config';
import { AppError } from '../errors';
const input = (): ListingInput => ({ factCard: enrichProductEvidence(products[0], baseFactCard(products[0]), demoTask), pricing: pricingFromFacts(products[0], baseFactCard(products[0]).facts), platform: 'amazon', revision: 1, factRevision: 2,
  context: { market: 'United States', category: 'Home & Kitchen', requirements: [...demoTask.requirements, 'Minimum profit USD 5'], product: { sku: products[0].sku, name: products[0].name } } });
class CountingText extends MockTextModelProvider {
  calls = 0; prompts: TextRequest[] = [];
  override async generateStructured<T>(request: TextRequest & { schema: z.ZodType<T>; example: T }) { this.calls++; this.prompts.push(request); return super.generateStructured(request); }
}
const options = (): QwenOptions => ({ model: 'qwen3.6-flash', liveEnabled: true, configured: true });

test('Qwen inputs contain only authorized public facts, scrubbed sources, no credentials or costs', async () => {
  const s = input();
  for (const f of s.factCard.facts) { f.anchor = 'PRIVATE_FILE_ROW'; f.previousSource = 'PRIVATE_SOURCE'; }
  s.factCard.facts.find(f => f.key === 'supplierCost')!.allowed = true; // Defense in depth against a bad upstream permission.
  s.factCard.facts.find(f => f.key === 'lidType')!.status = 'Rejected';
  s.factCard.facts.find(f => f.key === 'finish')!.status = 'Requires Confirmation';
  const text = new CountingText(); const result = await new QwenListingProvider(text, options()).generate(s);
  const prompt = JSON.parse(text.prompts[0].prompt);
  assert.ok(prompt.ALLOWED_FACTS.every((f: { field: string }) => !['supplierCost', 'declaredValue', 'packagingWeight', 'lidType', 'finish', 'leakproof'].includes(f.field)));
  assert.doesNotMatch(text.prompts[0].prompt, /PRIVATE|password|cookie|session|USD|profit|8\.20|14\.20/);
  // The outgoing allowlist remains safe even when upstream internal permission is malformed.
  assert.equal(result.generationMode, 'qwen');
});

test('valid structured generation is accepted, cached, and reconstructed with current source records', async () => {
  const text = new CountingText(); const provider = new QwenListingProvider(text, options());
  const first = await provider.generate(input()); assert.equal(first.generationMode, 'qwen'); assert.equal(first.generation!.cacheHit, false); assert.equal(first.riskDemoInjected, false);
  const other = input(); other.revision = 9; other.factCard.facts[0].recordId = 'different-user-fact'; other.factCard.facts[0].anchor = 'another-private-file';
  const second = await provider.generate(other); assert.equal(text.calls, 1); assert.equal(second.generation!.cacheHit, true); assert.equal(second.revision, 9);
  assert.equal(second.sources.find(f => f.key === 'color')!.recordId, 'different-user-fact'); assert.doesNotMatch(text.prompts[0].prompt, /another-private-file/);
  assert.equal(first.generation!.inputHash, second.generation!.inputHash);
});

test('simultaneous equivalent inputs share one request; facts, prompt and model changes miss the cache', async () => {
  const text = new CountingText(); const opts = options(); const provider = new QwenListingProvider(text, opts);
  await Promise.all([provider.generate(input()), provider.generate(input())]); assert.equal(text.calls, 1);
  const changed = input(); changed.factRevision++; await provider.generate(changed); assert.equal(text.calls, 2);
  opts.promptVersion = 'listing-qwen-v2-test'; await provider.generate(changed); assert.equal(text.calls, 3);
  opts.model = 'qwen-test-model'; await provider.generate(changed); assert.equal(text.calls, 4);
  assert.notEqual(listingInputHash(input(), 'qwen3.6-flash'), listingInputHash(changed, 'qwen3.6-flash'));
  const shop = input(); shop.platform = 'shopify'; await provider.generate(shop); assert.equal(text.calls, 5);
});

for (const gate of ['disabled', 'missing-key', 'template'] as const) test(`${gate} does not invoke a text provider and keeps a usable template`, async () => {
  const text = new CountingText(); const c = { ...readConfig({ NODE_ENV: 'test' }), NODE_ENV: 'development' as const, LISTING_PROVIDER: gate === 'template' ? 'template' as const : 'qwen' as const, AI_LIVE_ENABLED: gate !== 'disabled', BAILIAN_API_KEY: gate === 'missing-key' ? '' : 'unit-test-key' };
  const result = await createListingRuntime(c, text, undefined).provider.generate(input());
  assert.equal(text.calls, 0); assert.equal(result.generationMode ?? 'template', gate === 'template' ? 'template' : 'template_fallback');
  assert.ok(result.title); assert.equal(result.factRevision, 2);
});

for (const mode of ['malformed-json', 'invalid-schema', 'empty', 'timeout', 'http', 'unauthorized', 'claim', 'quantity', 'attribute', 'hidden-color', 'token-limit'] as const) {
  test(`${mode} response falls back without retry or sensitive error leakage`, async () => {
    let calls = 0; const audits: Array<Record<string, unknown>> = [];
    const config = { ...readConfig({ NODE_ENV: 'test' }), AI_LIVE_ENABLED: true, BAILIAN_API_KEY: 'unit-test-key', BAILIAN_REQUEST_TIMEOUT_MS: 100 };
    const transport: typeof fetch = async (_url, init) => {
      calls++;
      if (mode === 'timeout') return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('PRIVATE_UPSTREAM_BODY')), { once: true }));
      if (mode === 'http') return new Response('PRIVATE_UPSTREAM_BODY', { status: 503 });
      const mock = await new MockTextModelProvider().generateStructured({ prompt: '', purpose: '', schema: listingOutputSchema('amazon'), example: {
        title: 'Black Stainless Steel Travel Bottle, 500ml / 16.9 fl oz', bullets: ['Black finish.', 'Stainless Steel body.', '500ml / 16.9 fl oz capacity.'], description: 'Black Stainless Steel bottle.', attributes: { Color: 'Black' }, usedFacts: [{ field: 'color', value: 'Black' }, { field: 'material', value: 'Stainless Steel' }, { field: 'capacity', value: '500ml / 16.9 fl oz' }],
      } });
      const data = mock.data;
      if (mode === 'unauthorized') data.usedFacts.push({ field: 'supplierCost', value: 'USD 8.20' });
      if (mode === 'claim') data.description += ' 100% leakproof, guaranteed.';
      if (mode === 'quantity') data.description += ' Holds 750ml.';
      if (mode === 'attribute') data.attributes['Warranty' as 'Color'] = 'Lifetime';
      if (mode === 'hidden-color') data.description += ' Also supplied in red.';
      if (mode === 'invalid-schema') data.bullets = [];
      const content = mode === 'malformed-json' ? '{invalid' : mode === 'empty' ? '' : JSON.stringify(data);
      assert.equal(JSON.parse(String(init?.body)).max_tokens, 1800);
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: mode === 'token-limit' ? 'length' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }), { headers: { 'content-type': 'application/json' } });
    };
    const text = new BailianTextModelProvider(config, async row => { audits.push(row); return { id: 'audit-test' }; }, transport);
    const provider = new QwenListingProvider(text, { ...options(), rejectedAudit: async (_id, errorCode) => { audits.at(-1)!.success = false; audits.at(-1)!.errorCode = errorCode; } });
    const result = await provider.generate(input()); assert.equal(result.generationMode, 'template_fallback'); assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_UPSTREAM_BODY|unit-test-key/); assert.equal(audits.length, 1); assert.equal(audits[0].purpose, 'listing_generation'); assert.equal(audits[0].success, false);
    assert.equal(result.generation!.aiCallId, 'audit-test');
  });
}

test('budget and generic provider errors fall back; failures are not cached', async () => {
  let calls = 0;
  const throwing: TextModelProvider = { generateText: async () => { throw new Error('unused'); }, generateStructured: async () => { calls++; throw new AppError('live_ai_budget_exhausted', 'PRIVATE_BUDGET'); } };
  const provider = new QwenListingProvider(throwing, options());
  const a = await provider.generate(input()); await provider.generate(input()); assert.equal(calls, 2); assert.equal(a.generation!.fallbackReason, 'live_ai_budget_exhausted');
  assert.doesNotMatch(JSON.stringify(a), /PRIVATE_BUDGET/);
});

test('deterministic capacity variants are allowed but invented conversions and commercial attributes are rejected', async () => {
  const result = await new QwenListingProvider(new CountingText(), options()).generate(input());
  assert.equal(result.generationMode, 'qwen');
  const output = structuredClone(result.authorization!.output); output.usedFacts.find(f => f.field === 'capacity')!.value = '16.9 fl oz';
  assert.doesNotThrow(() => validateGeneratedListingAgainstFacts(output, input().factCard.facts));
  output.usedFacts.find(f => f.field === 'capacity')!.value = '20 fl oz';
  assert.throws(() => validateGeneratedListingAgainstFacts(output, input().factCard.facts));
  assert.ok(normalizedListingInput(input()).ALLOWED_FACTS.length > 0);
});

test('a truthful usedFacts list cannot hide a contradictory straw claim; arbitrary provider exceptions use safe fallback', async () => {
  const accepted = await new QwenListingProvider(new CountingText(), options()).generate(input());
  const output = structuredClone(accepted.authorization!.output); output.description += ' Includes a straw.';
  assert.throws(() => validateGeneratedListingAgainstFacts(output, input().factCard.facts), /authorization/);
  const text: TextModelProvider = { generateText: async () => { throw new Error('unused'); }, generateStructured: async () => { throw new Error('PRIVATE_UNKNOWN_ERROR'); } };
  const fallback = await new QwenListingProvider(text, options()).generate(input());
  assert.equal(fallback.generationMode, 'template_fallback'); assert.equal(fallback.generation!.fallbackReason, 'provider_error'); assert.doesNotMatch(JSON.stringify(fallback), /PRIVATE_UNKNOWN_ERROR/);
});
