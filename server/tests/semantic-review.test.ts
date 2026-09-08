import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QwenReviewProvider, reviewModelInput, reviewInputHash } from '../providers/qwenReview';
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

test('review normalizes only irrelevant null location fields, retaining mandatory location checks', async () => {
  const i = input(); i.listing.title = '750ml bottle'; i.listing.bullets = ['750ml capacity']; i.listing.attributes.Capacity = '750ml';
  for (const [location, expected] of [
    [{ field: 'title', key: null, index: null, occurrence: null }, 'blocked'],
    [{ field: 'bullets', index: 0, key: null }, 'blocked'],
    [{ field: 'attributes', key: 'Capacity', index: null }, 'blocked'],
    [{ field: 'bullets', index: null }, 'failed'],
    [{ field: 'attributes', key: null }, 'failed'],
    [{ field: 'title', key: 'Capacity' }, 'failed'],
    [{ field: 'title', extra: null }, 'failed'],
  ] as const) {
    const model = new ResponseModel();
    model.output = { status: 'blocked', issues: [{ category: 'spec_conflict', location, text: '750ml', reason: 'Capacity is 500ml.', factKeys: ['capacity'], suggestedFix: 'Use 500ml.' }] };
    const result = await new QwenReviewProvider(model, options).review(i);
    assert.equal(result.status, expected, JSON.stringify(location));
    if (result.status === 'blocked') assert.ok(Object.values(result.issues[0].location!).every(v => v !== null));
  }
});

test('review rejects invented numeric evidence while retaining supplied conflict values', async () => {
  const i = input(); i.facts.find(f => f.key === 'capacity')!.value = '750ml';
  i.listing.title = '900ml bottle';
  const m = new ResponseModel();
  const issue = { category: 'spec_conflict', location: { field: 'title' }, text: '900ml', reason: 'The copy says 900ml but the fact is 750ml.', factKeys: ['capacity'], suggestedFix: 'Use 500ml.' };
  m.output = { status: 'blocked', issues: [issue] };
  assert.equal((await new QwenReviewProvider(m, options).review(i)).status, 'failed');
  issue.suggestedFix = 'Use 750ml.';
  assert.equal((await new QwenReviewProvider(m, options).review(i)).status, 'blocked');
  issue.reason = 'The confirmed capacity is 600ml.';
  assert.equal((await new QwenReviewProvider(m, options).review(i)).status, 'failed');
});

test('review supplies exact copy locations and requires evidence for conflict and authorization issues', async () => {
  const i = input(); i.listing.attributes.Capacity = '750ml';
  const p = reviewModelInput(i);
  assert.ok(p.COPY_FIELDS.some(f => f.location.field === 'attributes' && f.location.key === 'Capacity' && f.text === '750ml'));
  for (const category of ['spec_conflict', 'unauthorized_fact']) {
    const m = new ResponseModel();
    m.output = { status: 'blocked', issues: [{ category, location: { field: 'attributes', key: 'Capacity' }, text: '750ml', reason: 'Contradicts capacity', factKeys: [], suggestedFix: 'Use 500ml.' }] };
    assert.equal((await new QwenReviewProvider(m, options).review(i)).status, 'failed');
    (m.output as { issues: { factKeys: string[] }[] }).issues[0].factKeys = ['capacity'];
    const result = await new QwenReviewProvider(m, options).review(i);
    assert.equal(result.status, category === 'spec_conflict' ? 'blocked' : 'failed');
  }
});

test('review accepts authorized consumer performance but never private keys or nonconfirmed values', () => {
  for (const key of ['coldRetention', 'dishwasherSafe', 'foodSafe', 'power', 'supply']) {
    const i = input();
    const f = { key, label: key, value: 'AUTHORIZED_PERFORMANCE', status: 'Confirmed' as const, allowed: true, source: 'private.pdf', anchor: '' };
    i.facts.push(f);
    i.facts.find(f => f.key === 'supplierCost')!.allowed = true;
    let p = reviewModelInput(i);
    assert.ok(p.ALLOWED_FACTS.some(a => a.field === key && a.value === f.value));
    assert.ok(!p.UNAUTHORIZED_FIELDS.some(a => a.field === key));
    assert.doesNotMatch(JSON.stringify(p), /supplierCost|8\.20|private.pdf/);
    const before = reviewInputHash(i, 'test');
    f.allowed = false;
    p = reviewModelInput(i);
    assert.ok(!p.ALLOWED_FACTS.some(a => a.field === key));
    assert.ok(p.UNAUTHORIZED_FIELDS.some(a => a.field === key));
    assert.notEqual(reviewInputHash(i, 'test'), before);
    f.allowed = true;
    i.facts[i.facts.length - 1].status = 'Requires Confirmation';
    assert.doesNotMatch(JSON.stringify(reviewModelInput(i)), /AUTHORIZED_PERFORMANCE/);
  }
});

test('review transmits consumer safety authorization states without private or unconfirmed values', () => {
  const i = input();
  for (const [key, status] of [['bpaFree', 'Requires Confirmation'], ['foodSafe', 'Rejected'], ['dishwasherSafe', 'Requires Confirmation']] as const) {
    i.facts.push({ key, label: key, value: 'PRIVATE_UNCONFIRMED_VALUE', status, allowed: false, source: 'private.pdf', anchor: 'secret' });
  }
  const payload = reviewModelInput(i);
  for (const key of ['bpaFree', 'foodSafe', 'dishwasherSafe']) {
    assert.ok(payload.UNAUTHORIZED_FIELDS.some(f => f.field === key));
    assert.ok(!payload.ALLOWED_FACTS.some(f => f.field === key));
  }
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_UNCONFIRMED_VALUE|private.pdf|supplierCost|8\.20/);
  const before = reviewInputHash(i, 'test');
  i.facts.find(f => f.key === 'bpaFree')!.status = 'Rejected';
  assert.notEqual(reviewInputHash(i, 'test'), before);
});
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
