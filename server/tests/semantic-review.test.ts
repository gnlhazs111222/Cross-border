import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QwenReviewProvider, reviewModelInput, reviewInputHash } from '../providers/qwenReview';
import type { ReviewInput } from '../../shared/review';
import { MockTextModelProvider, type TextRequest } from '../providers/text';
import type { z } from 'zod';
import { readFileSync } from 'node:fs';

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

test('captured description index zero preserves its actual issue and references', async () => {
  const capture = JSON.parse(readFileSync('artifacts/b-review/location-diagnostic/diagnostic-1788954665509.json', 'utf8'));
  const i = input(); i.listing = { ...capture.modelInput.COPY, platform: 'shopify' };
  i.facts.push({ key: 'lidType', label: 'Lid type', value: 'Screw-top lid', status: 'Confirmed', allowed: true, source: 'supplier', anchor: '' });
  const model = new ResponseModel(); model.output = capture.captures[0].parsed;
  const result = await new QwenReviewProvider(model, options).review(i);
  assert.equal(result.status, 'blocked'); assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0].location, { field: 'description' });
  assert.deepEqual(result.issues[0].factKeys, ['lidType', 'leakproof']);
  assert.equal(result.issues[0].text, capture.captures[0].parsed.issues[0].text);
});

test('singleton copy fields tolerate only a redundant zero index and still validate the quote', async () => {
  const model = new ResponseModel();
  const i = input();
  i.listing.description = 'The bottle tips over, but every page stays dry.';
  const issue = { category: 'unsupported_claim', location: { field: 'description', index: 0 } as Record<string, unknown>, text: 'every page stays dry', reason: 'No containment evidence supports this promise.', factKeys: [], suggestedFix: 'Remove the dry-page promise.' };
  model.output = { status: 'blocked', issues: [issue] };
  const result = await new QwenReviewProvider(model, options).review(i);
  assert.equal(result.status, 'blocked'); assert.deepEqual(result.issues[0].location, { field: 'description' });
  i.listing.title = issue.text;
  issue.location = { field: 'title', index: 0 };
  assert.equal((await new QwenReviewProvider(model, options).review(i)).status, 'blocked');
  for (const location of [{ field: 'description', index: 1 }, { field: 'description', index: -1 }, { field: 'description', index: '0' }, { field: 'attributes', key: 'Color', index: 0 }]) {
    issue.location = location;
    assert.equal((await new QwenReviewProvider(model, options).review(i)).status, 'failed');
  }
  issue.location = { field: 'description', index: 0 }; issue.text = 'nonexistent phrase';
  assert.equal((await new QwenReviewProvider(model, options).review(i)).status, 'failed');
});

test('captured containment explanation must cite the lid fact it explicitly discusses', async () => {
  const cases = JSON.parse(readFileSync('evaluation/review/round2/cases.json', 'utf8'));
  const report = JSON.parse(readFileSync('artifacts/evaluation/review-round2/2026-09-09T10-32-11-607Z-remaining-a78d4217/report.json', 'utf8'));
  const i = cases.cases.find((c: { id: string }) => c.id === 'R2-09').input;
  const outcome = report.rows.find((r: { id: string }) => r.id === 'R2-09').outcome;
  const model = new ResponseModel();
  const issues = outcome.issues.map(({ id, severity, title, origin, ...issue }: Record<string, unknown>) => issue);
  model.output = { status: 'blocked', issues };
  const missing = await new QwenReviewProvider(model, options).review(i);
  assert.equal(missing.status, 'failed'); assert.equal(missing.metadata.errorCode, 'invalid_review_reference');
  assert.deepEqual(missing.issues, []);
  issues[0].factKeys = ['lidType'];
  const cited = await new QwenReviewProvider(model, options).review(i);
  assert.equal(cited.status, 'blocked'); assert.deepEqual(cited.issues[0].factKeys, ['lidType']);
  assert.equal(cited.issues[0].category, 'unsupported_claim');
});

test('reference completeness requires only unambiguous supplied multiword values, not arbitrary facts', async () => {
  const i = input(); i.listing.description = 'Keeps belongings dry.';
  const model = new ResponseModel();
  const issue = { category: 'unsupported_claim', location: { field: 'description' }, text: i.listing.description, reason: 'Stainless-steel alone cannot establish containment.', factKeys: [] as string[], suggestedFix: 'Remove the containment promise.' };
  model.output = { status: 'blocked', issues: [issue] };
  assert.equal((await new QwenReviewProvider(model, options).review(i)).status, 'failed');
  issue.factKeys = ['material'];
  assert.equal((await new QwenReviewProvider(model, options).review(i)).status, 'blocked');
  issue.factKeys = []; issue.reason = 'No containment evidence is supplied.';
  assert.equal((await new QwenReviewProvider(model, options).review(i)).status, 'blocked');
  // Unknown or private values must not be inferred into consumer-facing references.
  i.facts.find(f => f.key === 'material')!.allowed = false;
  issue.reason = 'Stainless-steel alone cannot establish containment.';
  assert.equal((await new QwenReviewProvider(model, options).review(i)).status, 'blocked');
  i.facts.find(f => f.key === 'material')!.allowed = true;
  i.facts.push({ ...i.facts.find(f => f.key === 'material')!, key: 'finish' });
  assert.equal((await new QwenReviewProvider(model, options).review(i)).status, 'blocked');
});

test('blank suggestions and revision-marker reasoning cannot become final findings', async () => {
  const model = new ResponseModel();
  const issue = { category: 'spec_conflict', location: { field: 'bullets', index: 0 }, text: '500ml', reason: 'The capacity differs from the fact.', factKeys: ['capacity'], suggestedFix: 'Use the authorized capacity.' };
  for (const patch of [{ suggestedFix: ' \n\t ' }, { reason: 'Wait, the values agree.' }, { reason: 'Wait: the attribute is correct.' }]) {
    model.output = { status: 'blocked', issues: [{ ...issue, ...patch }] };
    const result = await new QwenReviewProvider(model, options).review(input());
    assert.equal(result.status, 'failed', JSON.stringify(patch));
    assert.deepEqual(result.issues, []);
  }
});

test('captured empty-fix response fails as a whole; only the complete true conflict is valid', async () => {
  const captured = JSON.parse(readFileSync('artifacts/b-review/empty-fix-diagnostic/diagnostic-1788949692387.json', 'utf8'));
  const i = input(); i.listing.title = 'Black stainless steel bottle, 750ml';
  i.listing.attributes.Capacity = '500ml / 16.9 fl oz';
  const model = new ResponseModel(); model.output = captured.captures[0].parsed;
  const failed = await new QwenReviewProvider(model, options).review(i);
  assert.equal(failed.status, 'failed'); assert.deepEqual(failed.issues, []);
  model.output = { status: 'blocked', issues: [captured.captures[0].parsed.issues[0]] };
  const valid = await new QwenReviewProvider(model, options).review(i);
  assert.equal(valid.status, 'blocked'); assert.equal(valid.issues.length, 1);
  assert.equal(valid.issues[0].location?.field, 'title');
});

test('rejects the captured self-correcting false title accusation instead of presenting it or silently approving', async () => {
  const cases = JSON.parse(readFileSync('evaluation/review/round2/cases.json', 'utf8'));
  const report = JSON.parse(readFileSync('artifacts/evaluation/review-round2/2026-09-09T08-30-23-715Z-remaining-1cad93f7/report.json', 'utf8'));
  const model = new ResponseModel();
  const captured = report.rows.find((r: { id: string }) => r.id === 'R2-07').outcome;
  model.output = { status: captured.status, issues: captured.issues.map(({ id, severity, title, origin, ...issue }: Record<string, unknown>) => issue) };
  const result = await new QwenReviewProvider(model, options).review(cases.cases.find((c: { id: string }) => c.id === 'R2-07').input);
  assert.equal(result.status, 'failed');
  assert.equal(result.metadata.errorCode, 'invalid_review_reason');
  assert.deepEqual(result.issues, []);
});

test('rejects exact fact agreement alleged as a conflict but retains actual differing values', async () => {
  const i = input(); i.listing.attributes.Material = 'stainless steel';
  const model = new ResponseModel();
  const issue = { category: 'spec_conflict', location: { field: 'attributes', key: 'Material' }, text: 'stainless steel', reason: 'The material contradicts the fact.', factKeys: ['material'], suggestedFix: 'Use the authorized material.' };
  model.output = { status: 'blocked', issues: [issue] };
  assert.equal((await new QwenReviewProvider(model, options).review(i)).status, 'failed');
  i.listing.attributes.Material = 'Glass'; issue.text = 'Glass';
  assert.equal((await new QwenReviewProvider(model, options).review(i)).status, 'blocked');
});

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
