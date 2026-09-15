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
import { demoTask, HERO_SKU, products } from '../../src/data/mockData';
import { IMAGE_CHECK_BATCH_MODE, printedFigureAbsentFromFact, printedStatesTheWhole, reconcileImageFinding } from '../../shared/multimodal';
import { MULTIMODAL_SYSTEM_PROMPT } from '../prompts/multimodal-v2';
import { createMultimodalRuntime, looksLikePictureGenerator } from '../providers/multimodalRuntime';
import type { FactSnapshot, ImportBatchDto, ProductAsset } from '../../shared/contracts';

const root = mkdtempSync(join(tmpdir(), 'prismlaunch-multimodal-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const OTHER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAAH/GBM0RwAAAABJRU5ErkJggg==', 'base64');
const localConfig = readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(root, 'local.db')}`, ASSET_STORAGE_DIR: join(root, 'local-assets') });
const qwenConfig: ServerConfig = { ...readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(root, 'qwen.db')}`, ASSET_STORAGE_DIR: join(root, 'qwen-assets') }),
  NODE_ENV: 'development', MULTIMODAL_PROVIDER: 'qwen' as const, AI_LIVE_ENABLED: true, BAILIAN_API_KEY: 'unit-test-key', BAILIAN_VL_MODEL: 'qwen3.7-plus' };

type App = Awaited<ReturnType<typeof buildApp>>;
const localDb = createDb(localConfig.DATABASE_URL); const qwenDb = createDb(qwenConfig.DATABASE_URL);
let local!: App; let localCookie = ''; let qwen!: App; let qwenCookie = '';
let calls = 0; let reply: string | undefined;

const migrate = (config: ServerConfig) => {
  const m = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' });
  assert.equal(m.status, 0, m.stderr);
};
/** Stands in for the vision model: replies with whatever the test set, so no network is ever used. */
const transport: typeof fetch = async (_url, init) => {
  calls++;
  const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: unknown }[] };
  const content = (body.messages[1].content ?? []) as { type: string }[];
  assert.ok(content.some(part => part.type === 'image_url'), 'the model call must carry pictures');
  return new Response(JSON.stringify({ choices: [{ message: { content: reply ?? '{"findings":[]}' } }], usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 } }),
    { headers: { 'content-type': 'application/json' } });
};

before(async () => {
  migrate(localConfig); migrate(qwenConfig);
  await seedDemo(localDb); await seedDemo(qwenDb);
  local = await buildApp(localConfig, localDb, { logger: false, transport: async () => { throw new Error('No network permitted'); } });
  qwen = await buildApp(qwenConfig, qwenDb, { logger: false, transport });
  const sign = async (app: App) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } })).headers['set-cookie']).split(';')[0];
  localCookie = await sign(local); qwenCookie = await sign(qwen);
});
after(async () => { assert.equal(await localDb.aiCall.count(), 0); await local?.close(); await qwen?.close(); await localDb.$disconnect(); await qwenDb.$disconnect(); });

// The apps only exist after \`before\`, so the client reads them lazily instead of capturing them here.
const client = (app: () => App, cookie: () => string) => ({
  call: async <T>(url: string, payload?: Record<string, unknown>, method: 'GET' | 'POST' | 'PATCH' = payload ? 'POST' : 'GET'): Promise<T> => {
    const r = await app().inject({ url, method, headers: { cookie: cookie() }, ...(payload ? { payload } : {}) });
    assert.equal(r.statusCode, 200, r.body); return r.json().data as T;
  },
  status: async (url: string, payload: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST') =>
    (await app().inject({ url, method, headers: { cookie: cookie() }, payload })).statusCode,
});
const localApi = client(() => local, () => localCookie); const qwenApi = client(() => qwen, () => qwenCookie);

type Ctx = { base: string; snap: FactSnapshot };
async function select(api: ReturnType<typeof client>, sku = HERO_SKU): Promise<Ctx> {
  await api.call('/api/demo/reset', {});
  const task = await api.call<{ recordId: string }>('/api/tasks', { code: demoTask.id, platform: demoTask.platform, market: demoTask.market, category: demoTask.category, requirements: demoTask.requirements, minimumProfit: demoTask.minProfit });
  await api.call(`/api/tasks/${task.recordId}/selection`, { productId: sku, purpose: 'selected' });
  const base = `/api/tasks/${task.recordId}/products/${sku}`;
  const v1 = await api.call<FactSnapshot>(`${base}/fact-cards/v1`, {});
  return { base, snap: v1 };
}
const upload = async (api: ReturnType<typeof client>, productId: string, bytes: Buffer, fileName: string, role: string) => {
  const r = await api.call<{ asset: ProductAsset }>(`/api/products/${encodeURIComponent(productId)}/assets`, { fileName, mimeType: 'image/png', role, contentBase64: bytes.toString('base64') });
  return r.asset;
};
const imageCheckEvidence = (snap: FactSnapshot) => snap.evidence.find(e => e.type === 'image_check')!;

test('offline mode reads no picture content, writes no V1 change and still reports the files it holds', async () => {
  const { base } = await select(localApi);
  const main = await upload(localApi, HERO_SKU, PNG, 'front.png', 'main');
  await upload(localApi, HERO_SKU, OTHER_PNG, 'detail.png', 'detail');
  const v1 = await localApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  const snap = await localApi.call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });

  assert.deepEqual(snap.v1, v1.v1, 'V1 must stay byte-for-byte after an image check');
  const check = imageCheckEvidence(snap);
  assert.equal(check.imageCheck!.mode, 'local');
  assert.deepEqual(check.imageCheck!.transmitted, [], 'offline mode sends nothing anywhere');
  assert.equal(check.imageCheck!.status, 'needs_review');
  assert.ok(snap.v2!.facts.some(f => f.imageCheck), 'the task card carries the verdicts');
  assert.equal(snap.facts.find(f => f.key === 'color')!.imageCheck!.verdict, 'not_checked');
  assert.equal(snap.facts.find(f => f.key === 'color')!.status, 'Confirmed', 'a verdict never confirms or changes a value');
  assert.deepEqual(check.imageCheck!.assets.map(a => a.fileName).sort(), ['detail.png', 'front.png']);
  assert.ok(check.imageCheck!.assets.every(a => a.status === 'checked' && !a.otherSkus));
  assert.ok(check.extracted.some(line => line.includes('no picture content')));
  assert.ok(check.imageCheck!.notes.some(note => note.includes('no image was read or sent')));
  assert.equal(main.role, 'main');
});

test('a product with no picture at all is analysed honestly and adds no adjudication row', async () => {
  const { base } = await select(localApi);
  const v1 = await localApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  const snap = await localApi.call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  const check = imageCheckEvidence(snap).imageCheck!;
  assert.equal(check.status, 'no_images');
  assert.deepEqual(check.assets, []);
  assert.ok(check.notes.some(note => note.includes('No product image is attached yet')));
  assert.equal(check.findings.length > 0, true, 'the attributes still get an honest not_checked verdict');
  assert.ok(check.findings.every(finding => finding.verdict === 'not_checked'));
  assert.equal((await localApi.call<ImportBatchDto[]>('/api/imports')).some(batch => batch.mode === IMAGE_CHECK_BATCH_MODE), false);
});

test('a supplier file that lists a picture nobody uploaded is reported, and a shared picture is flagged', async () => {
  const { base } = await select(localApi);
  const bytes = Buffer.concat([PNG, Buffer.from('second angle')]);
  await upload(localApi, HERO_SKU, bytes, 'reused.png', 'main');
  // The same bytes attached to another SKU: the cheapest sign the picture is not this product's.
  const otherSku = products.find(product => product.sku !== HERO_SKU)!.sku;
  await upload(localApi, otherSku, bytes, 'reused.png', 'main');
  // The supplier file lists two pictures: one that was uploaded and one that never arrived.
  const row = await localDb.product.findFirstOrThrow({ where: { sku: HERO_SKU } });
  await localDb.product.update({ where: { id: row.id }, data: { data: { ...(row.data as object), assetReferences: ['reused.png', 'never_uploaded.png'] } } });
  const v1 = await localApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  const snap = await localApi.call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  const check = imageCheckEvidence(snap).imageCheck!;
  const missing = check.assets.find(asset => asset.status === 'missing')!;
  assert.equal(missing.fileName, 'never_uploaded.png');
  assert.ok(check.notes.some(note => note.includes('never_uploaded.png')));
  const reused = check.assets.find(asset => asset.fileName === 'reused.png')!;
  assert.deepEqual(reused.otherSkus, [otherSku]);
  assert.ok(check.notes.some(note => note.includes('reused.png is also attached to')));
});

test('a live check drops out-of-scope and uncited findings, annotates the task card and queues each disagreement', async () => {
  const { base } = await select(qwenApi);
  await upload(qwenApi, HERO_SKU, PNG, 'front.png', 'main');
  const v1 = await qwenApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  reply = JSON.stringify({ findings: [
    { factKey: 'color', attribute: 'colorMark', imageValue: 'matte black', verdict: 'differ', confidence: 0.9, asset: 'front.png', region: 'body' },
    { factKey: 'lidType', attribute: 'labelText', imageValue: 'flip lid', verdict: 'agree', confidence: 0.8, asset: 'front.png', region: 'lid' },
    // Printed wording may never lend apparent support to a performance or safety claim.
    { factKey: 'leakproof', attribute: 'visibleText', imageValue: 'LEAK PROOF', verdict: 'agree', confidence: 0.9, asset: 'front.png', region: 'body' },
    // A label the pictures cannot be asked about is dropped on its own, not treated as a broken call.
    { factKey: 'brand', attribute: 'logo', imageValue: 'ACME', verdict: 'agree', confidence: 0.5, asset: 'front.png', region: 'body' },
    // Citing a picture that was never sent must not survive.
    { factKey: 'capacity', attribute: 'capacityMark', imageValue: '500 ml', verdict: 'agree', confidence: 0.7, asset: 'other.png', region: 'label' },
  ] });
  calls = 0;
  const snap = await qwenApi.call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  assert.equal(calls, 1);
  const check = imageCheckEvidence(snap).imageCheck!;
  assert.equal(check.mode, 'qwen');
  assert.deepEqual(check.findings.map(f => f.factKey), ['color', 'lidType']);
  assert.deepEqual(check.transmitted.map(t => t.fileName), ['front.png']);
  assert.ok(check.notes.some(note => note.includes('not an attribute the pictures can be asked about')));
  assert.ok(check.notes.filter(note => note.startsWith('Dropped a model finding')).length === 3);
  assert.deepEqual(snap.v1, v1.v1, 'V1 never changes');
  assert.equal(snap.v2!.facts.find(f => f.key === 'color')!.imageCheck!.verdict, 'differ');
  assert.equal(snap.v2!.facts.find(f => f.key === 'color')!.imageCheck!.imageValue, 'matte black');
  assert.equal(snap.v2!.facts.find(f => f.key === 'lidType')!.imageCheck!.verdict, 'agree');
  assert.equal(snap.v2!.facts.find(f => f.key === 'leakproof')!.imageCheck, undefined, 'a picture may not corroborate a performance claim');

  // The disagreement is settled where its evidence is. The upload queue on Materials carries what an
  // uploaded file got wrong, never a picture decision.
  assert.equal((await qwenApi.call<ImportBatchDto[]>('/api/imports')).some(batch => batch.mode === IMAGE_CHECK_BATCH_MODE), false);
  const decided = await qwenApi.call<FactSnapshot>(`${base}/check-decisions`, { action: 'adopt_printed_text', factKey: 'color', expectedRevision: snap.factsRevision });
  const color = decided.v2!.facts.find(f => f.key === 'color')!;
  assert.equal(color.value, 'matte black');
  assert.equal(color.status, 'Confirmed', 'the person who decided the value does not confirm it again in the studio');
  assert.equal(color.imageCheck!.verdict, 'agree', 'the disagreement closes once the value matches what the picture prints');
  assert.equal(decided.v1!.facts.find(f => f.key === 'color')!.value, 'Black', 'V1 keeps what the supplier delivered');
});

test('printed wording agrees on material and origin, and a claim without a quote is refused', async () => {
  const { base } = await select(qwenApi);
  await upload(qwenApi, HERO_SKU, PNG, 'front.png', 'main');
  const v1 = await qwenApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  // The reading is asked to cover the wording it can see: a printed composition figure is a material mark,
  // and a field whose wording is on the label may not be passed over in silence.
  assert.match(MULTIMODAL_SYSTEM_PROMPT, /A composition mark is a material mark/);
  assert.match(MULTIMODAL_SYSTEM_PROMPT, /Never pass over wording you can read/);
  reply = JSON.stringify({ findings: [
    // Words printed on the product may be compared with the material and the country facts.
    { factKey: 'material', attribute: 'materialMark', imageValue: 'Stainless Steel', verdict: 'agree', confidence: 0.9, asset: 'front.png', region: 'base' },
    { factKey: 'countryOfOrigin', attribute: 'originMark', imageValue: 'Made in China', verdict: 'agree', confidence: 0.9, asset: 'front.png', region: 'base' },
    // An agreement without the printed words behind it is a guess, not a comparison.
    { factKey: 'capacity', attribute: 'capacityMark', imageValue: '', verdict: 'agree', confidence: 0.9, asset: 'front.png', region: 'label' },
    // Wording no fact covers joins the card as a machine observation, never as a confirmed value.
    { factKey: null, attribute: 'barcodeText', imageValue: '6901234567890', verdict: 'agree', confidence: 0.6, asset: 'front.png', region: 'base' },
  ] });
  const snap = await qwenApi.call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  const check = imageCheckEvidence(snap).imageCheck!;
  assert.equal(check.mode, 'qwen');
  assert.deepEqual(check.findings.map(f => f.factKey), ['material', 'countryOfOrigin', null]);
  assert.ok(check.notes.some(note => note.includes('without quoting the printed text')));
  assert.deepEqual(snap.v1, v1.v1, 'V1 never changes');
  const material = snap.v2!.facts.find(f => f.key === 'material')!;
  assert.equal(material.value, v1.facts.find(f => f.key === 'material')!.value, 'an agreement annotates, it never rewrites the value');
  assert.equal(material.imageCheck!.verdict, 'agree');
  assert.equal(material.imageCheck!.imageValue, 'Stainless Steel');
  assert.equal(snap.v2!.facts.find(f => f.key === 'countryOfOrigin')!.imageCheck!.imageValue, 'Made in China');
  // Nothing read in a picture may enter copy: the candidate stays pending and never listing-allowed.
  const candidate = snap.v2!.facts.find(f => f.key === 'imageVisibleText')!;
  assert.equal(candidate.value, '6901234567890');
  assert.equal(candidate.status, 'Requires Confirmation');
  assert.equal(candidate.allowed, false);
  assert.equal(candidate.sourceKind, 'image');
});

test('a picture that comes back with no finding is named in the evidence instead of looking like agreement', async () => {
  const { base } = await select(qwenApi);
  await upload(qwenApi, HERO_SKU, PNG, 'front.png', 'main');
  await upload(qwenApi, HERO_SKU, OTHER_PNG, 'back.png', 'detail');
  const v1 = await qwenApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  // The reading answers about the main picture only; the second picture is silent.
  reply = JSON.stringify({ findings: [
    { factKey: 'material', attribute: 'materialMark', imageValue: 'Stainless Steel', verdict: 'agree', confidence: 0.9, asset: 'front.png', region: 'base' },
  ] });
  const analyzed = await qwenApi.call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  const check = imageCheckEvidence(analyzed).imageCheck!;
  assert.equal(check.transmitted.length, 2, 'both pictures were sent');
  assert.ok(check.notes.some(note => note.includes('back.png') && note.includes('no finding')), `the silent picture is named: ${JSON.stringify(check.notes)}`);
});

test('a figure printed on the product that the fact does not state is raised, never filed as agreement', async () => {
  const { base, snap } = await select(qwenApi);
  // The material a person stands behind: a word, with no figure in it.
  const materialFact = snap.facts.find(f => f.key === 'material')!;
  const edited = await qwenApi.call<FactSnapshot>(`/api/facts/${materialFact.recordId}`, { value: '纯钛', expectedRevision: snap.factsRevision }, 'PATCH');
  await qwenApi.call<FactSnapshot>(`/api/facts/${materialFact.recordId}/confirm`, { expectedRevision: edited.factsRevision });
  await upload(qwenApi, HERO_SKU, PNG, 'front.png', 'main');
  const v1 = await qwenApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  reply = JSON.stringify({ findings: [
    // The picture states how much titanium the product contains; the fact says only that it is titanium.
    { factKey: 'material', attribute: 'materialMark', imageValue: '钛含量 >99.8%', verdict: 'agree', confidence: 0.95, asset: 'front.png', region: 'overlay' },
    // The same reading on a fact that does carry the figure stays an agreement.
    { factKey: 'capacity', attribute: 'capacityMark', imageValue: '500 ml', verdict: 'agree', confidence: 0.9, asset: 'front.png', region: 'label' },
  ] });
  const analyzed = await qwenApi.call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  const material = analyzed.v2!.facts.find(f => f.key === 'material')!;
  assert.equal(material.value, '纯钛', 'the printed figure never rewrites the fact');
  assert.equal(material.imageCheck!.verdict, 'differ', 'an over-generous reading may not file a stronger printed claim as agreement');
  assert.equal(material.imageCheck!.imageValue, '钛含量 >99.8%');
  assert.equal(analyzed.v2!.facts.find(f => f.key === 'capacity')!.imageCheck!.verdict, 'agree');
  assert.equal(imageCheckEvidence(analyzed).imageCheck!.counts.differ, 1);
  assert.ok(analyzed.facts.filter(f => f.imageCheck?.verdict === 'differ').some(f => f.key === 'material'), 'the check panel reads the dispute off the facts');

  // The same content stated as the whole is what the fact says: "钛含量 =100%" and 纯钛 are one claim.
  reply = JSON.stringify({ findings: [
    { factKey: 'material', attribute: 'materialMark', imageValue: '钛含量 =100%', verdict: 'agree', confidence: 0.9, asset: 'front.png', region: 'overlay' },
  ] });
  const whole = await qwenApi.call<FactSnapshot>(`${base}/image-check`, { expectedRevision: analyzed.factsRevision });
  assert.equal(whole.v2!.facts.find(f => f.key === 'material')!.imageCheck!.verdict, 'agree', 'whole equals whole');
  assert.equal(whole.v2!.facts.find(f => f.key === 'material')!.imageCheck!.previousVerdict, 'differ', 'the run stays auditable');
});

test('the printed figure rule reads wholes and parts apart, and leaves unit forms alone', () => {
  // A fact that states the whole: the picture has to say the whole too.
  assert.equal(printedFigureAbsentFromFact('钛含量 >99.8%', '纯钛'), true);
  assert.equal(printedFigureAbsentFromFact('钛含量 =100%', '纯钛'), false);
  assert.equal(printedFigureAbsentFromFact('100% 纯钛', '纯钛'), false);
  assert.equal(printedFigureAbsentFromFact('99.8% titanium', 'Pure Titanium'), true);
  assert.equal(printedFigureAbsentFromFact('Titanium 100%', 'Pure Titanium'), false);
  assert.equal(printedFigureAbsentFromFact('纯钛', '纯钛'), false, 'no figure printed is the model reading, not this rule');
  // A fact that states no figure at all cannot match a picture that states one.
  assert.equal(printedFigureAbsentFromFact('SUS304', 'Stainless Steel'), true);
  assert.equal(printedFigureAbsentFromFact('Made in China', '中国大陆'), false);
  // Both sides carrying figures stays with the model, which is what reconciles unit forms.
  assert.equal(printedFigureAbsentFromFact('500 ml', '500ml / 16.9 fl oz'), false);
  assert.equal(printedFigureAbsentFromFact('16.9 fl oz', '500ml / 16.9 fl oz'), false);
  // The same whole is the same claim whichever verdict the model returned: the alarm does not fire for
  // "100% titanium" against 纯钛, and the rule puts it right even when the reading says "differ".
  assert.equal(printedStatesTheWhole('钛含量 =100%', '纯钛'), true);
  assert.equal(printedStatesTheWhole('钛含量 >99.8%', '纯钛'), false);
  assert.deepEqual(reconcileImageFinding({ factKey: 'material', imageValue: '钛含量 =100%', verdict: 'differ' }, '纯钛'),
    { factKey: 'material', imageValue: '钛含量 =100%', verdict: 'agree' });
  assert.deepEqual(reconcileImageFinding({ factKey: 'material', imageValue: '钛含量 =100%', verdict: 'agree' }, '纯钛'),
    { factKey: 'material', imageValue: '钛含量 =100%', verdict: 'agree' });
});

test('adopting what the picture shows is the confirmation and never touches V1', async () => {
  const { base } = await select(qwenApi);
  await upload(qwenApi, HERO_SKU, PNG, 'front.png', 'main');
  reply = JSON.stringify({ findings: [
    { factKey: 'color', attribute: 'colorMark', imageValue: 'matte black', verdict: 'differ', confidence: 0.9, asset: 'front.png', region: 'body' },
  ] });
  const v1 = await qwenApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  const snap = await qwenApi.call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  const adopted = await qwenApi.call<FactSnapshot>(`${base}/check-decisions`, { action: 'adopt_printed_text', factKey: 'color', expectedRevision: snap.factsRevision });
  const after = await qwenApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  assert.equal(after.v1.facts.find(f => f.key === 'color')!.value, 'Black');
  assert.deepEqual(after.v1, snap.v1);
  const color = after.v2!.facts.find(f => f.key === 'color')!;
  assert.equal(color.value, 'matte black');
  assert.equal(color.status, 'Confirmed');
  assert.equal(color.allowed, true, 'the decided value is what the copy is written from');
  assert.equal(color.sourceKind, 'image');
  assert.equal(color.previousValue, 'Black');
  assert.ok(color.anchor.includes('front.png'));
  assert.equal(adopted.v2!.facts.find(f => f.key === 'color')!.imageCheck!.verdict, 'agree');
  assert.equal((await qwenApi.call<ImportBatchDto[]>('/api/imports')).some(batch => batch.mode === IMAGE_CHECK_BATCH_MODE), false, 'no upload row is opened by a picture decision');
});

test('re-running the check replaces its evidence and re-reads the verdict against the current value', async () => {
  const { base } = await select(qwenApi);
  await upload(qwenApi, HERO_SKU, PNG, 'front.png', 'main');
  reply = JSON.stringify({ findings: [
    { factKey: 'color', attribute: 'colorMark', imageValue: 'matte black', verdict: 'differ', confidence: 0.9, asset: 'front.png', region: 'body' },
  ] });
  const v1 = await qwenApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  const first = await qwenApi.call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  assert.equal(first.v2!.facts.find(f => f.key === 'color')!.imageCheck!.verdict, 'differ');
  const adopted = await qwenApi.call<FactSnapshot>(`${base}/check-decisions`, { action: 'adopt_printed_text', factKey: 'color', expectedRevision: first.factsRevision });
  assert.equal(adopted.v2!.facts.find(f => f.key === 'color')!.imageCheck!.verdict, 'agree');

  const callsBeforeRerun = calls;
  const second = await qwenApi.call<FactSnapshot>(`${base}/image-check`, { expectedRevision: adopted.factsRevision });
  assert.equal(calls, callsBeforeRerun + 1, 'a re-run asks the model once more');
  assert.equal(second.evidence.filter(e => e.type === 'image_check').length, 1, 'a re-run replaces its own evidence row');
  assert.notEqual(imageCheckEvidence(second).recordId, imageCheckEvidence(first).recordId, 'the new run gets its own evidence row');
  assert.equal(second.v2!.facts.find(f => f.key === 'color')!.imageCheck!.verdict, 'differ', 'the new run reports what it read itself, not what an earlier run concluded');
  assert.equal((await qwenApi.call<ImportBatchDto[]>('/api/imports')).some(batch => batch.mode === IMAGE_CHECK_BATCH_MODE), false);
});

test('a re-run drops the verdicts it did not produce instead of leaving them behind', async () => {
  const { base } = await select(qwenApi);
  await upload(qwenApi, HERO_SKU, PNG, 'front.png', 'main');
  reply = JSON.stringify({ findings: [
    { factKey: 'color', attribute: 'colorMark', imageValue: 'matte black', verdict: 'differ', confidence: 0.9, asset: 'front.png', region: 'body' },
    { factKey: 'material', attribute: 'materialMark', imageValue: 'tritan', verdict: 'differ', confidence: 0.9, asset: 'front.png', region: 'body' },
  ] });
  const v1 = await qwenApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  const first = await qwenApi.call<FactSnapshot>(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  assert.equal(first.facts.find(f => f.key === 'material')!.imageCheck!.verdict, 'differ');

  // The same picture is read again, but this run only reports the colour: the material verdict is gone.
  reply = JSON.stringify({ findings: [
    { factKey: 'color', attribute: 'colorMark', imageValue: 'matte black', verdict: 'differ', confidence: 0.9, asset: 'front.png', region: 'body' },
  ] });
  const second = await qwenApi.call<FactSnapshot>(`${base}/image-check`, { expectedRevision: first.factsRevision });
  assert.equal(second.facts.find(f => f.key === 'color')!.imageCheck!.verdict, 'differ');
  assert.equal(second.facts.find(f => f.key === 'material')!.imageCheck, undefined, 'a verdict nobody re-checked must not outlive its run');
  assert.equal(second.facts.filter(f => f.imageCheck).length, 1, 'only the field this run compared carries a verdict');
});

test('a failed vision call degrades to the offline verdicts instead of losing the fact card', async () => {
  const { base } = await select(qwenApi);
  await upload(qwenApi, HERO_SKU, PNG, 'front.png', 'main');
  const v1 = await qwenApi.call<FactSnapshot>(`${base}/fact-snapshot`);
  const failing = await buildApp({ ...qwenConfig, DATABASE_URL: qwenConfig.DATABASE_URL }, qwenDb, { logger: false, transport: async () => { calls++; throw new Error('network down'); } });
  const cookie = String((await failing.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } })).headers['set-cookie']).split(';')[0];
  const r = await failing.inject({ method: 'POST', url: `${base}/analyze`, headers: { cookie }, payload: { expectedRevision: v1.factsRevision } });
  assert.equal(r.statusCode, 200, r.body);
  const check = imageCheckEvidence(r.json().data as FactSnapshot).imageCheck!;
  assert.equal(check.mode, 'local', 'a degraded run must never claim a vision model saw the pictures');
  assert.equal(check.model, 'local-resource-check');
  assert.ok(check.fallbackReason);
  assert.ok(check.notes.some(note => note.includes('Live image check did not complete')));
  assert.ok(check.findings.every(finding => finding.verdict === 'not_checked'));
  const audit = await qwenDb.aiCall.findFirstOrThrow({ where: { purpose: 'image_check', success: false } });
  assert.ok(audit.errorCode);
  await failing.close();
});

test('capabilities and the offline runtime never pretend a vision model is in use', async () => {
  const offlineCaps = await localApi.call<{ evidence: { activeProvider: string; liveImplemented: boolean; liveModel: string } }>('/api/capabilities');
  assert.equal(offlineCaps.evidence.activeProvider, 'local');
  assert.equal(offlineCaps.evidence.liveImplemented, true);
  const qwenCaps = await qwenApi.call<{ evidence: { activeProvider: string; liveModel: string } }>('/api/capabilities');
  assert.equal(qwenCaps.evidence.activeProvider, 'qwen');
  assert.equal(qwenCaps.evidence.liveModel, 'qwen3.7-plus');
});

test('a picture-generating model name is called out at startup, not discovered as a 400 later', async () => {
  // This endpoint's "image" names draw pictures; they refuse the chat request a check needs.
  for (const name of ['qwen-image-2.0', 'qwen-image-2.0-pro', 'wan2.7-image', 'wan2.7-image-pro']) assert.equal(looksLikePictureGenerator(name), true, name);
  for (const name of ['qwen3.7-plus', 'qwen3.6-plus', 'qwen3.8-max', 'qwen-vl-max']) assert.equal(looksLikePictureGenerator(name), false, name);
  const warnings: string[] = []; const original = console.warn;
  console.warn = (...data: unknown[]) => { warnings.push(data.map(String).join(' ')); };
  try {
    // The name still travels through untouched: the warning is advice, never a silent rewrite.
    assert.equal(createMultimodalRuntime({ ...qwenConfig, BAILIAN_VL_MODEL: 'qwen-image-2.0-pro' }, {} as never).model, 'qwen-image-2.0-pro');
    assert.equal(createMultimodalRuntime(qwenConfig, {} as never).model, 'qwen3.7-plus');
  } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /picture-generating/);
});
