import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../config';
import { createDb } from '../db';
import { buildApp } from '../app';
import { seedDemo } from '../seed';
import { demoTask, HERO_SKU } from '../../src/data/mockData';
import { parseSupplierFile } from '../../src/services/supplierImport';
import type { FactSnapshot } from '../../shared/contracts';

const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(mkdtempSync(join(tmpdir(), 'prismlaunch-facts-')), 'test.db')}` });
const db = createDb(config.DATABASE_URL);
let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; let calls = 0;
const missing = 'LM-KT-BTL-005-BLK-500';
before(async () => {
  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr); await seedDemo(db);
  app = await buildApp(config, db, { logger: false, transport: async () => { calls++; throw new Error('No network permitted'); } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
});
after(async () => { assert.equal(calls, 0); assert.equal(await db.aiCall.count(), 0); await app?.close(); await db.$disconnect(); });
async function call(url: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', payload?: Record<string, unknown>) {
  const r = await app.inject({ url, method, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
  assert.equal(r.statusCode, 200, r.body); return r.json().data;
}
const route = (s: FactSnapshot) => `/api/tasks/${s.taskId}/products/${s.productId}`;
async function select(sku = missing, reset = true): Promise<FactSnapshot> {
  if (reset) await call('/api/demo/reset', 'POST', {});
  const task = await call('/api/tasks', 'POST', { code: demoTask.id, platform: demoTask.platform, market: demoTask.market, category: demoTask.category, requirements: demoTask.requirements, minimumProfit: demoTask.minProfit });
  await call(`/api/tasks/${task.recordId}/selection`, 'POST', { productId: sku, purpose: 'fact_review' });
  return call(`/api/tasks/${task.recordId}/products/${sku}/fact-cards/v1`, 'POST', {});
}
async function mutate(s: FactSnapshot, key: string, action: 'edit' | 'confirm' | 'reject', value?: string): Promise<FactSnapshot> {
  const id = s.facts.find(f => f.key === key)!.recordId;
  return call(`/api/facts/${id}${action === 'edit' ? '' : `/${action}`}`, action === 'edit' ? 'PATCH' : 'POST', { expectedRevision: s.factsRevision, ...(action === 'edit' ? { value } : {}) });
}
const analyze = (s: FactSnapshot): Promise<FactSnapshot> => call(`${route(s)}/analyze`, 'POST', { expectedRevision: s.factsRevision });
const template = (s: FactSnapshot) => call(`${route(s)}/listing-template`, 'POST', { platform: 'shopify', revision: 1, expectedRevision: s.factsRevision });

test('V1 is idempotent, source-backed, owner-scoped and stored with evidence in SQLite', async () => {
  const s = await select(); assert.equal(s.v1.facts.length, 11); assert.equal(s.v2, null);
  assert.equal(s.facts.find(f => f.key === 'packagingWeight')!.status, 'Missing');
  assert.equal(s.pricing.status, 'blocked'); assert.equal(s.pricing.suggestedPrice, null);
  assert.deepEqual(await call(`${route(s)}/fact-cards/v1`, 'POST', {}), s);
  assert.equal((await call(`${route(s)}/facts`)).length, 11); assert.equal((await call(`${route(s)}/evidence`)).length, 1);
  const reopened = createDb(config.DATABASE_URL);
  try { assert.equal(await reopened.fact.count(), 11); assert.equal(await reopened.evidence.count(), 1); } finally { await reopened.$disconnect(); }
  assert.equal((await app.inject(`${route(s)}/fact-snapshot`)).statusCode, 401);
});
for (const ext of ['xlsx', 'csv']) test(`${ext} actual parser imports retain file/sheet/row/field provenance and numeric values`, async () => {
  await call('/api/demo/reset', 'POST', {});
  const fileName = `prismlaunch-supplier-demo.${ext}`;
  const preview = await parseSupplierFile(new File([readFileSync(`public/demo/${fileName}`)], fileName), 'replace', []);
  const { products, ...report } = preview;
  const catalog = await call('/api/products');
  await call('/api/products/import', 'POST', { products, report, mode: 'replace', expectedRevision: catalog.revision });
  const s = await select(HERO_SKU, false);
  const f = s.facts.find(f => f.key === 'supplierCost')!;
  assert.equal(f.value, 'USD 8.20'); assert.equal(f.sourceKind, 'supplier');
  assert.deepEqual(f.sourceMetadata, { fileName, sheetName: products[0].importSource!.sheetName, rowNumber: 2, fieldName: 'supplierCost' });
  assert.match(f.anchor, /row 2/); assert.equal(s.evidence.length, 1); assert.equal(s.evidence[0].sourceKind, 'supplier');
  assert.ok(!s.evidence.some(e => e.type === 'pdf' || e.type === 'image'), 'no mock PDF or image evidence card is stored');
});

test('analyze keeps V1 byte-for-byte, persists V2 and does not re-create pending enhanced facts', async () => {
  const first = await select(); const s = await analyze(first);
  assert.deepEqual(s.v1, first.v1); assert.equal(s.v2!.facts.length, 15); assert.equal(s.factsRevision, first.factsRevision + 1);
  for (const key of ['packageIncludes', 'finish', 'lidType', 'leakproof']) assert.equal(s.facts.find(f => f.key === key)!.status, 'Requires Confirmation');
  assert.deepEqual(await analyze(s), { ...s, downstreamInvalidated: false }); assert.equal(await db.factCard.count(), 2);
  const hero = await analyze(await select(HERO_SKU));
  assert.equal(hero.facts.find(f => f.key === 'lidType')!.status, 'Confirmed');
  assert.equal(hero.facts.find(f => f.key === 'leakproof')!.allowed, false);
});

test('edit stays pending; confirm persists manual history and unlocks current cost pricing', async () => {
  let s = await select(); const origin = s.facts.find(f => f.key === 'packagingWeight')!;
  for (const value of ['', '0', '-1', 'NaN']) {
    const r = await app.inject({ method: 'PATCH', url: `/api/facts/${origin.recordId}`, headers: { cookie }, payload: { expectedRevision: s.factsRevision, value } });
    assert.equal(r.statusCode, 400); assert.deepEqual(await call(`${route(s)}/fact-snapshot`), s);
  }
  assert.equal((await app.inject({ method: 'POST', url: `/api/facts/${origin.recordId}/confirm`, headers: { cookie }, payload: { expectedRevision: s.factsRevision } })).statusCode, 400);
  s = await mutate(s, 'packagingWeight', 'edit', '0.42');
  assert.equal(s.facts.find(f => f.key === 'packagingWeight')!.status, 'Requires Confirmation'); assert.equal(s.pricing.status, 'blocked');
  s = await mutate(s, 'packagingWeight', 'confirm');
  const f = s.facts.find(f => f.key === 'packagingWeight')!;
  assert.equal(f.value, '0.42 kg'); assert.equal(f.status, 'Confirmed'); assert.equal(f.sourceKind, 'manual'); assert.equal(f.previousValue, 'Missing');
  assert.match(f.previousSource!, /Supplier Spreadsheet/); assert.ok(f.confirmedAt); assert.equal(f.revision, 3); assert.equal(s.factsRevision, 3);
  assert.equal(s.pricingReadiness.ready, true); assert.equal(s.pricing.suggestedPrice, 19.2);
  s = await mutate(s, 'supplierCost', 'edit', '12'); assert.equal(s.pricing.status, 'blocked');
  s = await mutate(s, 'supplierCost', 'confirm'); assert.equal(s.pricing.suggestedPrice, 23); assert.equal(s.facts.find(f => f.key === 'supplierCost')!.allowed, false);
  const stored = await db.fact.findUniqueOrThrow({ where: { id: f.recordId! } });
  assert.equal((stored.metadata as { previousValue: string }).previousValue, 'Missing');
});

test('pending and rejected facts are excluded from backend template; confirmed permitted facts are included', async () => {
  let s = await select(); s = await mutate(s, 'packagingWeight', 'edit', '0.42'); s = await mutate(s, 'packagingWeight', 'confirm'); s = await analyze(s);
  let listing = await template(s); assert.ok(!listing.sources.some((f: { key: string }) => f.key === 'lidType'));
  const v1 = s.v1;
  s = await mutate(s, 'lidType', 'confirm'); assert.deepEqual(s.v1, v1);
  listing = await template(s); assert.match(listing.title, /Screw-top/);
  s = await mutate(s, 'lidType', 'reject'); assert.equal(s.facts.find(f => f.key === 'lidType')!.allowed, false);
  listing = await template(s); assert.doesNotMatch(listing.title, /Screw-top/);
  assert.ok(listing.sources.every((f: { allowed: boolean; status: string }) => f.allowed && f.status === 'Confirmed'));
  assert.equal(listing.factRevision, s.listingFactsRevision); assert.doesNotMatch(JSON.stringify(listing), /100% leakproof/);
  const claim = s.facts.find(f => f.key === 'leakproof')!;
  assert.equal((await app.inject({ method: 'POST', url: `/api/facts/${claim.recordId}/confirm`, headers: { cookie }, payload: { expectedRevision: s.factsRevision } })).statusCode, 400);
});

test('fact change invalidates retained downstream history, synchronizes base cards and rejects stale writes', async () => {
  const before = await analyze(await select(HERO_SKU));
  const user = await db.user.findUniqueOrThrow({ where: { email: 'demo@prismlaunch.local' } });
  await db.listingDraft.create({ data: { userId: user.id, taskId: before.taskId, productId: before.productId, platform: 'amazon', revision: 1, factRevision: before.factsRevision, data: {},
    reviews: { create: { revision: 1, status: 'passed', issues: [] } }, publications: { create: { revision: 1, platform: 'amazon', status: 'published', data: {} } } } });
  const s = await mutate(before, 'color', 'edit', 'Navy');
  assert.equal(s.downstreamInvalidated, true); assert.equal(s.factsRevision, before.factsRevision + 1);
  assert.equal(s.v1.facts.find(f => f.key === 'color')!.value, 'Navy'); assert.equal(s.v2!.facts.find(f => f.key === 'color')!.value, 'Navy');
  assert.equal(await db.listingDraft.count(), 1); assert.equal((await db.listingDraft.findFirstOrThrow()).status, 'stale');
  assert.ok((await db.reviewResult.findFirstOrThrow()).invalidatedAt); assert.ok((await db.publishResult.findFirstOrThrow()).invalidatedAt);
  const id = before.facts.find(f => f.key === 'color')!.recordId;
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/facts/${id}`, headers: { cookie }, payload: { value: 'White', expectedRevision: before.factsRevision } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: `${route(s)}/listing-template`, headers: { cookie }, payload: { platform: 'amazon', revision: 2, expectedRevision: before.factsRevision } })).statusCode, 409);
});

test('another user cannot read, analyze, create or mutate owned facts; reset preserves other users', async () => {
  const s = await select(); const id = s.facts[0].recordId;
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'other-facts@local.test', password: 'Demo123456', displayName: 'Other' } });
  const other = String(registered.headers['set-cookie']).split(';')[0];
  for (const resource of ['fact-snapshot', 'fact-cards', 'facts', 'evidence']) assert.equal((await app.inject({ url: `${route(s)}/${resource}`, headers: { cookie: other } })).statusCode, 404);
  for (const action of ['confirm', 'reject']) assert.equal((await app.inject({ method: 'POST', url: `/api/facts/${id}/${action}`, headers: { cookie: other }, payload: { expectedRevision: s.factsRevision } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/facts/${id}`, headers: { cookie: other }, payload: { value: 'Navy', expectedRevision: s.factsRevision } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${route(s)}/fact-cards/v1`, headers: { cookie: other }, payload: {} })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${route(s)}/analyze`, headers: { cookie: other }, payload: { expectedRevision: s.factsRevision } })).statusCode, 404);
  await app.inject({ method: 'POST', url: '/api/demo/reset', headers: { cookie: other }, payload: {} });
  assert.deepEqual(await call(`${route(s)}/fact-snapshot`), s);
  await call('/api/demo/reset', 'POST', {}); assert.equal(await db.fact.count(), 0); assert.equal(await db.evidence.count(), 0);
});

test('incomplete pricing no longer blocks draft generation', async () => {
  const snap = await select(missing);
  assert.equal(snap.pricing.status, 'blocked', 'this demo product really is missing pricing data');
  const analyzed = await analyze(snap);
  assert.equal(analyzed.pricing.suggestedPrice, null);
  const draft = await template(analyzed);
  assert.ok(draft.title.length > 0, 'a draft is produced even though the price is still pending');
});
