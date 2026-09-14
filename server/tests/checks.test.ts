import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readConfig, type ServerConfig } from '../config';
import { createDb } from '../db';
import { buildApp } from '../app';
import { seedDemo } from '../seed';
import { demoTask, HERO_SKU } from '../../src/data/mockData';
import { assessImageText, assessInspection, adoptedFactValue, appliedFactDecision, inspectionTargets, ignoredRefs, reportClearsNextStep, type CheckDecision, type QualityReport } from '../../shared/checks';
import { IMAGE_CHECK_BATCH_MODE } from '../../shared/multimodal';
import type { FactSnapshot, ImportBatchDetail, ImportBatchDto, ProductAsset } from '../../shared/contracts';
import type { Fact } from '../../src/types';

const report = (overrides: Partial<QualityReport> = {}): QualityReport => ({ reportNo: 'QC-2026-1001', result: 'pass', validUntil: '2028-06-30', stated: { capacity: 500, material: 'Stainless Steel' }, ...overrides });
const facts = (overrides: { capacity?: string; material?: string } = {}) => ([{ key: 'capacity', value: overrides.capacity ?? '500ml / 16.9 fl oz' }, { key: 'material', value: overrides.material ?? 'Stainless Steel' }]);
const product = { capacity: 500, material: 'Stainless Steel' };
const assessment = (input: { report?: QualityReport; facts?: { key: string; value: string }[]; ignored?: string[]; today?: string; product?: { capacity: number; material: string } } = {}) =>
  assessInspection({ ...inspectionTargets(input.facts ?? facts(), input.product ?? product), report: input.report, ignored: input.ignored, today: input.today ?? '2026-09-12' });

test('a report that is on file, valid and consistent raises nothing', () => {
  const result = assessment({ report: report() });
  assert.equal(result.verdict, 'clear');
  assert.equal(result.publishBlocked, false);
  assert.deepEqual(result.problems, []);
});

test('a SKU without a report is a gap in the data, and the listing stage stays closed until one arrives', () => {
  const result = assessment({ report: undefined });
  assert.equal(result.verdict, 'not_registered');
  assert.equal(result.publishBlocked, false);
  assert.equal(result.waivable, false);
  // The assessor has nothing to compare; the flow is what refuses to move on without a report.
  assert.equal(reportClearsNextStep({ ...inspectionTargets(facts(), product) }), false);
  assert.equal(reportClearsNextStep({ ...inspectionTargets(facts(), product), report: report() }), true);
  assert.equal(reportClearsNextStep({ ...inspectionTargets(facts(), product), report: report({ result: 'fail' }) }), false, 'a failed report does not open the step either');
  assert.equal(reportClearsNextStep({ ...inspectionTargets(facts(), product), report: report(), ignored: ['QC-2026-1001'] }), true, 'a report a person dropped from the checks no longer stands in the way');
});

test('an expired report blocks until it is replaced or dropped, and dropping is a recorded decision', () => {
  const expired = assessment({ report: report({ validUntil: '2026-08-31' }) });
  assert.equal(expired.verdict, 'expired');
  assert.equal(expired.publishBlocked, true);
  assert.equal(expired.waivable, true);
  const ignored = assessment({ report: report({ validUntil: '2026-08-31' }), ignored: ['QC-2026-1001'] });
  assert.equal(ignored.verdict, 'not_registered');
  assert.equal(ignored.ignored, true);
  assert.equal(ignored.publishBlocked, false);
});

test('a failed report blocks for good and cannot be waived', () => {
  const result = assessment({ report: report({ result: 'fail' }) });
  assert.equal(result.verdict, 'failed');
  assert.equal(result.publishBlocked, true);
  assert.equal(result.waivable, false);
});

test('a report that certifies other values than we hold is a mismatch, named per field', () => {
  const result = assessment({ report: report({ stated: { capacity: 750, material: 'Ceramic' } }) });
  assert.equal(result.verdict, 'mismatch');
  assert.equal(result.publishBlocked, true);
  assert.deepEqual(result.problems.map(problem => problem.factKey), ['capacity', 'material']);
  assert.equal(result.problems[0].reportValue, '750 ml');
  assert.equal(result.problems[0].factValue, '500 ml');
  assert.equal(assessment({ report: report({ stated: { capacity: 500 } }) }).verdict, 'clear', 'an absent statement is not a disagreement');
});

test('the comparison reads the task card first and the product row only as a fallback', () => {
  assert.deepEqual(inspectionTargets(facts({ capacity: '750ml / 25.4 fl oz' }), product), { capacity: 750, material: 'Stainless Steel' });
  assert.deepEqual(inspectionTargets([], product), product);
  assert.equal(assessment({ report: report({ stated: { capacity: 750 } }), facts: facts({ capacity: '750ml / 25.4 fl oz' }) }).verdict, 'clear');
});

test('dropping evidence is recorded per target and never crosses over', () => {
  const decisions = [{ target: 'quality_report' as const, ref: 'QC-2026-1001', by: 'demo@prismlaunch.local', at: '2026-09-12T00:00:00.000Z' }];
  assert.deepEqual(ignoredRefs(decisions, 'quality_report'), ['QC-2026-1001']);
  assert.deepEqual(ignoredRefs(decisions, 'image_text'), []);
});

const annotated = (value: string, printed: string): Fact => ({ key: 'capacity', label: 'Capacity', value, source: 'Supplier Spreadsheet', anchor: 'Products · capacityMl',
  status: 'Confirmed', allowed: true, sourceKind: 'supplier', revision: 1,
  imageCheck: { factKey: 'capacity', attribute: 'capacityMark', imageValue: printed, factValue: value, verdict: 'differ', confidence: 0.9, asset: 'front.png', region: 'label',
    mode: 'qwen', model: 'qwen3.7-plus', promptVersion: 'multimodal-v2', checkedAt: '2026-09-12T00:00:00.000Z' } });

test('adopting the printed wording stores it in our own format and is that decision alone', () => {
  const adopted = appliedFactDecision(annotated('500ml / 16.9 fl oz', '750 ML'), { action: 'adopt_printed_text' });
  assert.equal(adopted.value, '750ml / 25.4 fl oz');
  // The person who picked the value does not have to confirm it a second time in the listing studio.
  assert.equal(adopted.status, 'Confirmed');
  assert.equal(adopted.allowed, true, 'capacity is copy material, so the decided value may be written into the listing');
  assert.ok(adopted.confirmedAt);
  assert.equal(adopted.imageCheck!.verdict, 'agree');
  assert.equal(adopted.imageCheck!.previousVerdict, 'differ');
  assert.equal(adopted.previousValue, '500ml / 16.9 fl oz');
  assert.equal(adoptedFactValue('capacity', 'Not readable'), 'Not readable', 'an unreadable value is kept as printed instead of being invented');
  // The unit written beside the number travels with it: a label printing grams or ounces is not a fact in
  // kilograms or millilitres, and the stored value is the canonical one.
  assert.equal(adoptedFactValue('capacity', '25.4 fl oz'), '751ml / 25.4 fl oz');
  assert.equal(adoptedFactValue('capacity', '1.2L'), '1200ml / 40.6 fl oz');
  assert.equal(adoptedFactValue('packagingWeight', '420 g'), '0.42 kg');
  assert.equal(adoptedFactValue('packageHeight', '3.15 in'), '8.001 cm');
  assert.equal(adoptedFactValue('packageHeight', '80 mm'), '8 cm');
});

test('a hand correction clears the alarm only when it agrees with the picture', () => {
  const agreed = appliedFactDecision(annotated('500ml / 16.9 fl oz', '750'), { action: 'edited', value: '750' });
  assert.equal(agreed.value, '750ml / 25.4 fl oz');
  assert.equal(agreed.imageCheck!.verdict, 'agree');
  const still = appliedFactDecision(annotated('500ml / 16.9 fl oz', '750'), { action: 'edited', value: '600' });
  assert.equal(still.imageCheck!.verdict, 'differ', 'a third value leaves the disagreement standing');
  assert.equal(still.imageCheck!.factValue, '600ml / 20.3 fl oz');
});

const root = mkdtempSync(join(tmpdir(), 'prismlaunch-checks-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const config: ServerConfig = { ...readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(root, 'checks.db')}`, ASSET_STORAGE_DIR: join(root, 'checks-assets') }),
  NODE_ENV: 'development', MULTIMODAL_PROVIDER: 'qwen' as const, AI_LIVE_ENABLED: true, BAILIAN_API_KEY: 'unit-test-key', BAILIAN_VL_MODEL: 'qwen3.7-plus' };
const db = createDb(config.DATABASE_URL);
let app!: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; let reply = '{"findings":[]}';

const transport: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: unknown }[] };
  const content = (body.messages[1].content ?? []) as { type: string }[];
  assert.ok(content.some(part => part.type === 'image_url'), 'the model call must carry pictures');
  return new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 } }), { headers: { 'content-type': 'application/json' } });
};

before(async () => {
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' });
  assert.equal(migrated.status, 0, migrated.stderr);
  await seedDemo(db);
  app = await buildApp(config, db, { logger: false, transport });
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } })).headers['set-cookie']).split(';')[0];
});
after(async () => { await app?.close(); await db.$disconnect(); });

const call = async <T>(url: string, payload?: Record<string, unknown>, method: 'GET' | 'POST' = payload ? 'POST' : 'GET'): Promise<T> => {
  const r = await app.inject({ url, method, headers: { cookie }, ...(payload ? { payload } : {}) });
  assert.equal(r.statusCode, 200, r.body); return r.json().data as T;
};
const status = async (url: string, payload: Record<string, unknown>) => (await app.inject({ url, method: 'POST', headers: { cookie }, payload })).statusCode;

/** One selected SKU with two pictures and one live disagreement about its printed capacity. */
async function disputed() {
  await call('/api/demo/reset', {});
  const task = await call<{ recordId: string }>('/api/tasks', { code: demoTask.id, platform: demoTask.platform, market: demoTask.market, category: demoTask.category, requirements: demoTask.requirements, minimumProfit: demoTask.minProfit });
  await call(`/api/tasks/${task.recordId}/selection`, { productId: HERO_SKU, purpose: 'selected' });
  const base = `/api/tasks/${task.recordId}/products/${HERO_SKU}`;
  await call<{ asset: ProductAsset }>(`/api/products/${encodeURIComponent(HERO_SKU)}/assets`, { fileName: 'front.png', mimeType: 'image/png', role: 'main', contentBase64: PNG.toString('base64') });
  await call<{ asset: ProductAsset }>(`/api/products/${encodeURIComponent(HERO_SKU)}/assets`, { fileName: 'detail.png', mimeType: 'image/png', role: 'detail', contentBase64: Buffer.concat([PNG, Buffer.from('second')]).toString('base64') });
  await call<FactSnapshot>(`${base}/fact-cards/v1`, {});
  const v1 = await call<FactSnapshot>(`${base}/fact-snapshot`);
  reply = JSON.stringify({ findings: [
    { factKey: 'capacity', attribute: 'capacityMark', imageValue: '750 ML', verdict: 'differ', confidence: 0.9, asset: 'front.png', region: 'label' },
  ] });
  const snap = await call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  return { base, snap };
}
const pendingDisputes = async () => {
  const batches = await call<ImportBatchDto[]>('/api/imports');
  const batch = batches.find(candidate => candidate.mode === IMAGE_CHECK_BATCH_MODE);
  if (!batch) return [];
  const detail = await call<ImportBatchDetail>(`/api/imports/${batch.recordId}`);
  return detail.occurrences.filter(occurrence => occurrence.resolution === 'pending');
};

test('a live disagreement is raised on the card and adopting the printed text closes it', async () => {
  const { base, snap } = await disputed();
  const capacityBefore = snap.facts.find(f => f.key === 'capacity')!;
  assert.equal(capacityBefore.imageCheck!.verdict, 'differ');
  assert.equal(capacityBefore.imageCheck!.imageValue, '750 ML');
  assert.equal((await call<ImportBatchDto[]>('/api/imports')).some(batch => batch.mode === IMAGE_CHECK_BATCH_MODE), false,
    'the upload queue carries what an uploaded file got wrong, never a picture decision');

  const decided = await call<FactSnapshot>(`${base}/check-decisions`, { action: 'adopt_printed_text', factKey: 'capacity', expectedRevision: snap.factsRevision });
  const capacity = decided.facts.find(f => f.key === 'capacity')!;
  assert.equal(capacity.value, '750ml / 25.4 fl oz');
  assert.equal(capacity.status, 'Confirmed');
  assert.equal(capacity.allowed, true);
  assert.equal(capacity.imageCheck!.verdict, 'agree');
  assert.equal(decided.listingReadiness.ready, true, 'the listing stage is open once the dispute is decided');
  assert.equal(decided.v1!.facts.find(f => f.key === 'capacity')!.value, snap.v1!.facts.find(f => f.key === 'capacity')!.value, 'V1 is never rewritten by a check decision');
  assert.equal((await pendingDisputes()).length, 0, 'the queue row is closed by the same action');
});

test('dropping a picture also drops the candidate fields that picture produced', async () => {
  await call('/api/demo/reset', {});
  const task = await call<{ recordId: string }>('/api/tasks', { code: demoTask.id, platform: demoTask.platform, market: demoTask.market, category: demoTask.category, requirements: demoTask.requirements, minimumProfit: demoTask.minProfit });
  await call(`/api/tasks/${task.recordId}/selection`, { productId: HERO_SKU, purpose: 'selected' });
  const base = `/api/tasks/${task.recordId}/products/${HERO_SKU}`;
  await call<{ asset: ProductAsset }>(`/api/products/${encodeURIComponent(HERO_SKU)}/assets`, { fileName: 'front.png', mimeType: 'image/png', role: 'main', contentBase64: PNG.toString('base64') });
  await call<FactSnapshot>(`${base}/fact-cards/v1`, {});
  const v1 = await call<FactSnapshot>(`${base}/fact-snapshot`);
  // One finding is a disagreement about a field the card already had, the other is wording no field
  // covers — that second one joins the card as a candidate.
  reply = JSON.stringify({ findings: [
    { factKey: 'capacity', attribute: 'capacityMark', imageValue: '750 ML', verdict: 'differ', confidence: 0.9, asset: 'front.png', region: 'label' },
    { factKey: null, attribute: 'barcodeText', imageValue: '6901234567890', verdict: 'agree', confidence: 0.6, asset: 'front.png', region: 'base' },
  ] });
  const snap = await call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  const candidate = snap.v2!.facts.find(f => f.key === 'imageVisibleText')!;
  assert.equal(candidate.value, '6901234567890');
  assert.equal(candidate.sourceKind, 'image');

  const dropped = await call<FactSnapshot>(`${base}/check-decisions`, { action: 'discard_image', asset: 'front.png', expectedRevision: snap.factsRevision });
  assert.equal(dropped.v2!.facts.some(f => f.key === 'imageVisibleText'), false, 'the candidate goes with the picture that produced it');
  const kept = dropped.v2!.facts.find(f => f.key === 'capacity')!;
  assert.equal(kept.imageCheck, undefined, 'the verdict the picture left on an existing field is cleared');
  assert.equal(kept.value, snap.v2!.facts.find(f => f.key === 'capacity')!.value, 'and the field itself stays');
});

test('correcting the value by hand re-reads the verdict and only agrees when it matches', async () => {
  const { base, snap } = await disputed();
  const decided = await call<FactSnapshot>(`${base}/check-decisions`, { action: 'edited', factKey: 'capacity', value: '600', expectedRevision: snap.factsRevision });
  const capacity = decided.facts.find(f => f.key === 'capacity')!;
  assert.equal(capacity.value, '600ml / 20.3 fl oz');
  assert.equal(capacity.imageCheck!.verdict, 'differ', 'the picture still prints something else, so the alarm stays honest');
  const agreed = await call<FactSnapshot>(`${base}/check-decisions`, { action: 'edited', factKey: 'capacity', value: '750', expectedRevision: decided.factsRevision });
  assert.equal(agreed.facts.find(f => f.key === 'capacity')!.imageCheck!.verdict, 'agree', 'the same wording closes the disagreement');
});

test('dropping a picture removes what it contributed and keeps it out of every later check', async () => {
  const { base, snap } = await disputed();
  const decided = await call<FactSnapshot>(`${base}/check-decisions`, { action: 'discard_image', asset: 'front.png', expectedRevision: snap.factsRevision });
  assert.equal(decided.facts.find(f => f.key === 'capacity')!.imageCheck, undefined, 'the verdict this picture contributed is gone');
  const row = await db.product.findFirstOrThrow({ where: { sku: HERO_SKU } });
  const decisions = (row.data as { checkDecisions?: { target: string; ref: string; by: string }[] }).checkDecisions!;
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].target, 'image_text');
  assert.equal(decisions[0].ref, 'front.png');
  assert.equal(decisions[0].by, 'demo@prismlaunch.local', 'the decision names the account that made it');
  assert.equal((await pendingDisputes()).length, 0, 'the pending rows it opened are settled in the same adjudication queue');

  const again = await call<FactSnapshot>(`${base}/image-check`, { expectedRevision: decided.factsRevision });
  const check = again.evidence.find(evidence => evidence.type === 'image_check')!.imageCheck!;
  assert.equal(check.findings.some(finding => finding.asset === 'front.png'), false, 'a dropped picture is not read again');
  assert.ok(check.notes.some(note => note.includes('Dropped from the check by a recorded human decision: front.png')));
  // The picture is still on file, so the run lists it as dropped instead of reporting no picture.
  assert.equal(check.assets.find(asset => asset.fileName === 'front.png')!.status, 'dropped');
  assert.equal(check.assets.filter(asset => asset.status === 'checked').length, 1, 'the other picture still takes part');
  assert.equal((await call<ImportBatchDto[]>('/api/imports')).some(batch => batch.mode === IMAGE_CHECK_BATCH_MODE), false, 'dropping a picture opens no queue row either');

  // Taking the decision back puts the picture on file again: restoring is just the log read the other way.
  const restored = await call<FactSnapshot>(`${base}/check-decisions`, { action: 'restore_image', asset: 'front.png', expectedRevision: again.factsRevision });
  assert.deepEqual(((await db.product.findFirstOrThrow({ where: { sku: HERO_SKU } })).data as { checkDecisions?: unknown[] }).checkDecisions ?? [], []);
  const third = await call<FactSnapshot>(`${base}/image-check`, { expectedRevision: restored.factsRevision });
  const readAgain = third.evidence.find(evidence => evidence.type === 'image_check')!.imageCheck!;
  assert.equal(readAgain.transmitted.some(picture => picture.fileName === 'front.png'), true, 'the picture is read again after the decision is taken back');
});

test('a decision refuses a stale revision instead of overwriting newer facts', async () => {
  const { base, snap } = await disputed();
  assert.equal(await status(`${base}/check-decisions`, { action: 'adopt_printed_text', factKey: 'capacity', expectedRevision: snap.factsRevision - 1 }), 409);
  assert.equal(await status(`${base}/check-decisions`, { action: 'adopt_printed_text', factKey: 'color', expectedRevision: snap.factsRevision }), 409, 'a field with no open disagreement is refused');
  assert.equal(await status(`${base}/check-decisions`, { action: 'discard_image', asset: '', expectedRevision: snap.factsRevision }), 400);
  assert.equal(await status(`${base}/check-decisions`, { action: 'discard_report', reportNo: 'QC-NOPE', expectedRevision: snap.factsRevision }), 404);
});

test('a dropped quality report is recorded on the product and honoured by the checks', async () => {
  const { base } = await disputed();
  const row = await db.product.findFirstOrThrow({ where: { sku: HERO_SKU } });
  await db.product.update({ where: { id: row.id }, data: { data: { ...(row.data as object), qualityReport: report() } } });
  const before = await call<FactSnapshot>(`${base}/fact-snapshot`);
  assert.equal(assessment({ report: before.product.qualityReport }).verdict, 'clear');
  await call<FactSnapshot>(`${base}/check-decisions`, { action: 'discard_report', reportNo: 'QC-2026-1001', expectedRevision: before.factsRevision });
  const reloaded = await db.product.findFirstOrThrow({ where: { sku: HERO_SKU } });
  const saved = (reloaded.data as { checkDecisions?: { target: string; ref: string }[] }).checkDecisions!;
  assert.deepEqual(saved.filter(decision => decision.target === 'quality_report').map(decision => decision.ref), ['QC-2026-1001']);
  assert.equal(assessment({ report: report(), ignored: ignoredRefs(saved as CheckDecision[], 'quality_report') }).publishBlocked, false);
});

test('a quality report can be submitted from the check area, and the product is what carries it', async () => {
  const { base } = await disputed();
  const recorded = await call<{ report: QualityReport }>(`/api/products/${HERO_SKU}/quality-report`, { reportNo: 'QC-2026-2002', result: 'pass', validUntil: '2027-01-31' });
  assert.equal(recorded.report.reportNo, 'QC-2026-2002');
  const reloaded = (await db.product.findFirstOrThrow({ where: { sku: HERO_SKU } })).data as { qualityReport?: QualityReport };
  assert.deepEqual(reloaded.qualityReport, { reportNo: 'QC-2026-2002', result: 'pass', validUntil: '2027-01-31' });
  assert.equal(assessment({ report: reloaded.qualityReport }).verdict, 'clear');
  assert.equal(reportClearsNextStep({ ...inspectionTargets(facts(), product), report: reloaded.qualityReport }), true);
  const snapshot = await call<FactSnapshot>(`${base}/fact-snapshot`);
  assert.equal(snapshot.product.qualityReport?.reportNo, 'QC-2026-2002', 'the check panel reads it from the product');
  // What a report is, is not something the caller decides: no number, no report, and the verdict has limits.
  assert.equal(await status(`/api/products/${HERO_SKU}/quality-report`, { reportNo: '   ', result: 'pass' }), 400);
  assert.equal(await status(`/api/products/${HERO_SKU}/quality-report`, { reportNo: 'QC-1', result: 'maybe' }), 400);
  assert.equal(await status(`/api/products/${HERO_SKU}/quality-report`, { reportNo: 'QC-1', result: 'pass', validUntil: '31/01/2027' }), 400);
});

test('a picture disagreement never lands in the upload queue, before or after it is decided', async () => {
  const { base, snap } = await disputed();
  const queued = async () => (await call<ImportBatchDto[]>('/api/imports')).some(batch => batch.mode === IMAGE_CHECK_BATCH_MODE);
  assert.equal(await queued(), false, 'raising the disagreement opens no queue row');
  const decided = await call<FactSnapshot>(`${base}/check-decisions`, { action: 'edited', factKey: 'capacity', value: '600', expectedRevision: snap.factsRevision });
  assert.equal(decided.facts.find(f => f.key === 'capacity')!.value, '600ml / 20.3 fl oz');
  assert.equal(await queued(), false, 'deciding it opens none either');
});

test('the picture-text panel tells apart never run, no picture, picture not read and picture read', () => {
  const asset = (status: string) => ({ fileName: status + '.png', status });
  assert.equal(assessImageText(undefined).verdict, 'not_run', 'a check that never ran is not an empty result');
  const none = assessImageText({ status: 'no_images', mode: 'qwen', transmitted: [], assets: [] });
  assert.equal(none.verdict, 'no_pictures');
  assert.equal(none.attached, 0);
  const referenced = assessImageText({ status: 'no_images', mode: 'qwen', transmitted: [], assets: [asset('missing'), asset('missing')] });
  assert.equal(referenced.verdict, 'no_pictures', 'file names the sheet references are not pictures we hold');
  assert.equal(referenced.referenced, 2);
  // A picture a person dropped is a third thing again: it is on file, so "no picture" would be a lie.
  const dropped = assessImageText({ status: 'needs_review', mode: 'qwen', transmitted: [], assets: [asset('dropped')] });
  assert.equal(dropped.verdict, 'dropped');
  assert.equal(dropped.dropped, 1);
  assert.equal(dropped.attached, 0);
  const unread = assessImageText({ status: 'needs_review', mode: 'local', transmitted: [], assets: [asset('checked'), asset('skipped')] });
  assert.equal(unread.verdict, 'not_read');
  assert.deepEqual([unread.attached, unread.skipped, unread.sent], [1, 1, 0]);
  const read = assessImageText({ status: 'enhanced', mode: 'qwen', transmitted: [{ fileName: 'main.png' }], assets: [asset('checked')] });
  assert.equal(read.verdict, 'read');
  assert.equal(read.sent, 1);
  const degraded = assessImageText({ status: 'needs_review', mode: 'local', transmitted: [], assets: [asset('checked')], fallbackReason: 'bailian_timeout' });
  assert.equal(degraded.fallbackReason, 'bailian_timeout', 'a degraded run says why no picture was read');
});
