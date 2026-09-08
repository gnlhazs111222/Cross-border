import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QwenReviewProvider } from '../providers/qwenReview';
import type { ReviewInput } from '../../shared/review';
import { MockTextModelProvider, type TextRequest } from '../providers/text';
import type { z } from 'zod';

const input = (): ReviewInput => ({ listing: { platform: 'amazon', title: 'Black bottle', bullets: ['Holds 500ml.'], description: 'Stainless steel body.', attributes: { Color: 'Black' } },
  facts: [
    { key: 'color', label: 'Color', value: 'Black', status: 'Confirmed', allowed: true, source: 'private-file.xlsx', anchor: 'row 2' },
    { key: 'capacity', label: 'Capacity', value: '500ml / 16.9 fl oz', status: 'Confirmed', allowed: true, source: 'supplier', anchor: '' },
    { key: 'material', label: 'Material', value: 'Stainless Steel', status: 'Confirmed', allowed: true, source: 'supplier', anchor: '' },
    { key: 'supplierCost', label: 'Supplier cost', value: 'USD 8.20', status: 'Confirmed', allowed: false, source: 'private', anchor: '' },
    { key: 'leakproof', label: 'Leakproof', value: 'Secret pending claim', status: 'Requires Confirmation', allowed: false, source: 'private', anchor: '' },
  ], context: { market: 'United States', category: 'Home & Kitchen', taskRevision: 1 }, listingRevision: 1, factsRevision: 2 });
class ResponseModel extends MockTextModelProvider {
  calls = 0; prompt = ''; output: unknown = { status: 'passed', issues: [] };
  override async generateStructured<T>(r: TextRequest & { schema: z.ZodType<T>; example: T }) {
    this.calls++; this.prompt = r.prompt;
    return { provider: 'bailian' as const, model: 'qwen-test', aiCallId: 'call-1', latencyMs: 1, content: JSON.stringify(this.output), data: r.schema.parse(this.output) };
  }
}
const options = { model: 'qwen-test', liveEnabled: true, configured: true };
test('semantic review allows supported paraphrase without exposing internal or pending values', async () => {
  const model = new ResponseModel(); const result = await new QwenReviewProvider(model, options).review(input());
  assert.equal(result.status, 'passed'); assert.equal(result.metadata.aiCallId, 'call-1');
  assert.doesNotMatch(model.prompt, /8\.20|Secret pending claim|private-file|supplierCost/);
  assert.match(model.prompt, /500ml/); assert.equal(model.calls, 1);
});
test('internal disclosure is blocked before sending private consumer copy to the model', async () => {
  for (const disclosure of ['Supplier cost: USD 8.20', 'Declared customs value: USD 2.70', 'Unit cost: USD 8.20.', 'Freight: USD 2.10.', 'Profit: 35%.', 'Only USD 8.20 wholesale.']) {
  const i = input(); i.listing.description = disclosure; const model = new ResponseModel();
  const result = await new QwenReviewProvider(model, options).review(i);
  assert.equal(result.status, 'blocked'); assert.equal(result.issues[0].category, 'internal_disclosure'); assert.equal(model.calls, 0);
  }
});
test('unknown fact references and fabricated quotes fail closed with sanitized errors', async () => {
  for (const change of [{ factKeys: ['invented'] }, { text: 'not in the copy' }]) {
    const model = new ResponseModel(); model.output = { status: 'blocked', issues: [{ category: 'unsupported_claim', location: { field: 'title' }, text: 'Black bottle', reason: 'Unsupported claim', factKeys: [], suggestedFix: 'Check facts', ...change }] };
    const r = await new QwenReviewProvider(model, options).review(input());
    assert.equal(r.status, 'failed'); assert.ok(r.metadata.errorCode); assert.equal(r.issues.length, 0);
  }
});
test('inconsistent passed with issues and blocked without issues cannot authorize publishing', async () => {
  for (const output of [{ status: 'blocked', issues: [] }, { status: 'passed', issues: [{ category: 'spec_conflict', location: { field: 'title' }, text: 'Black bottle', reason: 'Conflict', factKeys: ['color'], suggestedFix: 'Check color' }] }]) {
    const m = new ResponseModel(); m.output = output;
    assert.equal((await new QwenReviewProvider(m, options).review(input())).status, 'failed');
  }
});
test('human review stays distinct from failure and preserves checked problem location', async () => {
  const model = new ResponseModel(); model.output = { status: 'needs_human_review', issues: [{ category: 'unsupported_claim', location: { field: 'bullets', index: 0 }, text: 'Holds 500ml.', reason: 'Evidence ambiguous', factKeys: ['capacity'], suggestedFix: 'Verify the capacity' }] };
  const r = await new QwenReviewProvider(model, options).review(input());
  assert.equal(r.status, 'needs_human_review'); assert.equal(r.issues[0].location?.index, 0);
});
test('missing configuration and provider errors do not fall back to passed rules', async () => {
  const m = new ResponseModel();
  assert.equal((await new QwenReviewProvider(m, { ...options, configured: false }).review(input())).status, 'failed');
  assert.equal(m.calls, 0);
  m.generateStructured = async () => { throw new Error('PRIVATE_SECRET_UPSTREAM'); };
  const r = await new QwenReviewProvider(m, options).review(input());
  assert.equal(r.status, 'failed'); assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SECRET/);
});
