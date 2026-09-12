import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../config';
import { createDb } from '../db';
import { buildApp } from '../app';
import { seedDemo } from '../seed';
import { demoTask, HERO_SKU } from '../../src/data/mockData';
import type { FactSnapshot, WorkflowSnapshot } from '../../shared/contracts';
import type { Platform } from '../../src/types';

const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(mkdtempSync(join(tmpdir(), 'prismlaunch-listings-')), 'test.db')}` });
const db = createDb(config.DATABASE_URL);
let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; let calls = 0;
before(async () => {
  const m = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' });
  assert.equal(m.status, 0, m.stderr); await seedDemo(db);
  app = await buildApp(config, db, { logger: false, transport: async () => { calls++; throw new Error('No live calls'); } });
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } });
  cookie = String(r.headers['set-cookie']).split(';')[0];
});
after(async () => { assert.equal(calls, 0); assert.equal(await db.aiCall.count(), 0); await app.close(); await db.$disconnect(); });
async function call(url: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', payload?: Record<string, unknown>) {
  const r = await app.inject({ url, method, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
  assert.equal(r.statusCode, 200, r.body); return r.json().data;
}
const path = (s: { taskId: string; productId: string }) => `/api/tasks/${s.taskId}/products/${s.productId}`;
const version = (w: WorkflowSnapshot, p: Platform = 'amazon') => ({ expectedVersion: w.heads[p]!.revision, expectedFactsRevision: w.factsRevision });
async function setup(sku = HERO_SKU): Promise<FactSnapshot> {
  await call('/api/demo/reset', 'POST', {});
  const task = await call('/api/tasks', 'POST', { code: demoTask.id, platform: demoTask.platform, market: demoTask.market, category: demoTask.category, requirements: demoTask.requirements, minimumProfit: demoTask.minProfit });
  await call(`/api/tasks/${task.recordId}/selection`, 'POST', { productId: sku, purpose: 'fact_review' });
  const s = await call(`/api/tasks/${task.recordId}/products/${sku}/fact-cards/v1`, 'POST', {});
  return call(`${path(s)}/analyze`, 'POST', { expectedRevision: s.factsRevision });
}
const create = (s: FactSnapshot | WorkflowSnapshot, platform: Platform = 'amazon', expectedVersion = 0): Promise<WorkflowSnapshot> => call(`${path(s)}/listings`, 'POST', { platform, expectedVersion, expectedFactsRevision: s.factsRevision });
const act = (w: WorkflowSnapshot, action: string, p: Platform = 'amazon'): Promise<WorkflowSnapshot> => call(`/api/listings/${w.heads[p]!.recordId}/${action}`, 'POST', version(w, p));
async function published(platform: Platform = 'amazon') {
  let w = await create(await setup(), platform);
  if (platform === 'amazon') { w = await act(w, 'review'); w = await act(w, 'apply-suggested-fix'); }
  w = await act(w, 'review', platform); return act(w, 'publish', platform);
}

test('server creates independent template versions, stores fact revision and explicit Amazon risk fixture', async () => {
  const s = await setup(); let w = await create(s); w = await create(w, 'shopify');
  assert.equal(w.listings.amazon!.revision, 1); assert.equal(w.listings.shopify!.revision, 1);
  assert.equal(w.listings.amazon!.riskDemoInjected, true); assert.equal(w.listings.shopify!.riskDemoInjected, false);
  assert.match(w.listings.amazon!.bullets.join(' '), /100% leakproof/);
  assert.equal(w.listings.amazon!.factRevision, s.listingFactsRevision); assert.equal(w.listings.amazon!.generationMode, 'template');
  for (const p of ['amazon', 'shopify'] as const) {
    const listing = w.listings[p]!;
    assert.ok(listing.sources.every(f => f.status === 'Confirmed' && f.allowed));
    assert.ok(!listing.sources.some(f => ['supplierCost', 'declaredValue', 'packagingWeight', 'packageLength', 'leakproof'].includes(f.key)));
    assert.doesNotMatch(listing.description + listing.title, /USD|8\.20|3\.10/);
  }
  const reopened = createDb(config.DATABASE_URL);
  try { assert.equal(await reopened.listingDraft.count(), 2); } finally { await reopened.$disconnect(); }
});

test('missing pricing inputs do not block Listing generation or review, but do block publish', async () => {
  const s = await setup('LM-KT-BTL-005-BLK-500');
  assert.equal(s.pricingReadiness.ready, false);
  assert.equal(s.listingReadiness.ready, true);
  let w = await create(s, 'shopify');
  assert.ok(w.listings.shopify);
  w = await act(w, 'review', 'shopify');
  assert.equal(w.reviews.shopify?.status, 'passed');
  assert.equal(w.publishAllowed.shopify, false);
  const response = await app.inject({ method: 'POST', url: `/api/listings/${w.listings.shopify!.recordId}/publish`, headers: { cookie }, payload: version(w, 'shopify') });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'pricing_required_for_publish');
  const listingId = w.listings.shopify!.recordId;
  const reviewId = w.reviews.shopify!.recordId;
  const weight = s.facts.find(f => f.key === 'packagingWeight')!;
  let updated = await call(`/api/facts/${weight.recordId}`, 'PATCH', { value: '0.42', expectedRevision: s.factsRevision });
  updated = await call(`/api/facts/${weight.recordId}/confirm`, 'POST', { expectedRevision: updated.factsRevision });
  assert.equal(updated.pricingReadiness.ready, true);
  w = await call(`${path(s)}/listings`);
  assert.equal(w.listings.shopify!.recordId, listingId);
  assert.equal(w.reviews.shopify!.recordId, reviewId);
  assert.equal(w.publishAllowed.shopify, true);
});

test('unconfirmed and rejected facts cannot enter server Listing; confirmation permits the field', async () => {
  let s = await setup('LM-KT-BTL-002-BLK-500');
  let w = await create(s, 'shopify'); assert.doesNotMatch(w.listings.shopify!.title, /Screw-top/);
  let lid = s.facts.find(f => f.key === 'lidType')!;
  s = await call(`/api/facts/${lid.recordId}/confirm`, 'POST', { expectedRevision: s.factsRevision });
  w = await create(s, 'shopify', 1); assert.match(w.listings.shopify!.title, /Screw-top/);
  lid = s.facts.find(f => f.key === 'lidType')!;
  s = await call(`/api/facts/${lid.recordId}/reject`, 'POST', { expectedRevision: s.factsRevision });
  w = await create(s, 'shopify', 2); assert.doesNotMatch(w.listings.shopify!.title, /Screw-top/);
  assert.equal(w.listings.shopify!.revision, 3);
});

test('R001 blocks direct server publish; fix creates a new version requiring a fresh rules review', async () => {
  let w = await create(await setup()); w = await act(w, 'review');
  assert.equal(w.reviews.amazon!.status, 'blocked'); assert.ok(w.reviews.amazon!.issues.some(i => i.id === 'R001')); assert.ok(w.reviews.amazon!.highRiskCount! > 0);
  const first = w.listings.amazon!.recordId!;
  let r = await app.inject({ method: 'POST', url: `/api/listings/${first}/publish`, headers: { cookie }, payload: version(w) });
  assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'publish_blocked');
  w = await act(w, 'apply-suggested-fix'); assert.equal(w.listings.amazon!.revision, 2); assert.deepEqual(w.reviews, {}); assert.equal(w.publishAllowed.amazon, false);
  assert.match(w.listings.amazon!.bullets.join(' '), /Secure screw-top lid designed for everyday carrying\./);
  assert.equal(w.listings.amazon!.riskDemoInjected, false);
  r = await app.inject({ method: 'POST', url: `/api/listings/${w.listings.amazon!.recordId}/publish`, headers: { cookie }, payload: version(w) }); assert.equal(r.statusCode, 409);
  const old = await call(`/api/listings/${first}`); assert.equal(old.listing.status, 'superseded'); assert.ok(old.reviews[0].invalidatedAt);
  w = await act(w, 'review'); assert.equal(w.reviews.amazon!.status, 'passed'); assert.equal(w.reviews.amazon!.highRiskCount, 0); assert.equal(w.reviews.amazon!.revision, 2);
  w = await act(w, 'publish'); assert.equal(w.publications.amazon!.status, 'Export ready'); assert.equal(await db.publishResult.count(), 1);
  const repeat = await act(w, 'publish'); assert.equal(repeat.publications.amazon!.recordId, w.publications.amazon!.recordId); assert.equal(await db.publishResult.count(), 1);
});

test('editing creates immutable history, invalidates approval/publication, and preserves Shopify', async () => {
  let w = await published(); w = await create(w, 'shopify'); w = await act(w, 'review', 'shopify'); w = await act(w, 'publish', 'shopify');
  const old = w.listings.amazon!; const shop = w.publications.shopify!;
  w = await call(`/api/listings/${old.recordId}`, 'PATCH', { ...version(w), title: 'FDA certified, guaranteed performance', bullets: old.bullets, description: old.description });
  assert.equal(w.listings.amazon!.revision, old.revision + 1); assert.equal(w.listings.amazon!.status, 'review_required'); assert.equal(w.reviews.amazon, undefined); assert.equal(w.publications.amazon, undefined);
  assert.deepEqual(w.publications.shopify, shop); assert.equal(w.publishAllowed.shopify, true);
  const history = await call(`/api/listings/${old.recordId}`); assert.equal(history.listing.title, old.title); assert.equal(history.listing.status, 'superseded'); assert.ok(history.reviews[0].invalidatedAt); assert.ok(history.publications[0].invalidatedAt);
  w = await act(w, 'review'); assert.ok(w.reviews.amazon!.issues.some(i => i.id === 'R002')); assert.equal(w.publishAllowed.amazon, false);
});

test('published CSV is generated from current SQLite data and old versions cannot export', async () => {
  let w = await published(); const pub = w.publications.amazon!;
  const result = await app.inject({ url: `/api/publish/${pub.recordId}/amazon-csv`, headers: { cookie } });
  assert.equal(result.statusCode, 200); assert.match(String(result.headers['content-type']), /text\/csv/); assert.match(String(result.headers['content-disposition']), /Amazon\.csv/);
  // The exported price is the computed one (goods, freight, duty, platform share, profit floor).
  assert.match(result.body, /22\.39/); assert.match(result.body, new RegExp(HERO_SKU)); assert.doesNotMatch(result.body, /100% leakproof|supplier.?cost|declared.?value|8\.20/);
  const oldId = w.listings.amazon!.recordId!;
  w = await act(w, 'regenerate'); assert.equal(w.listings.amazon!.revision, 3); assert.equal(w.reviews.amazon, undefined);
  assert.equal((await app.inject({ url: `/api/publish/${pub.recordId}/amazon-csv`, headers: { cookie } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: `/api/listings/${oldId}/publish`, headers: { cookie }, payload: { expectedVersion: 2, expectedFactsRevision: w.factsRevision } })).statusCode, 409);
});

test('refreshing the pricing snapshot retires publication and binds the next publish to the new snapshot', async () => {
  let w = await published(); const oldPublication = w.publications.amazon!;
  const task = await call(`/api/tasks/${w.taskId}`);
  const stored = await db.publishResult.findUniqueOrThrow({ where: { id: oldPublication.recordId } });
  assert.equal((stored.data as { pricingSnapshotCode: string }).pricingSnapshotCode, task.pricingSnapshot.code);
  const refreshed = await call(`/api/tasks/${w.taskId}/pricing-snapshots`, 'POST', { expectedVersion: task.pricingSnapshot.version });
  assert.equal(refreshed.version, 2);
  w = await call(`${path(w)}/listings`);
  assert.equal(w.publications.amazon, undefined); assert.equal(w.reviews.amazon?.status, 'passed'); assert.equal(w.publishAllowed.amazon, true);
  assert.equal((await app.inject({ url: `/api/publish/${oldPublication.recordId}/amazon-csv`, headers: { cookie } })).statusCode, 409);
  w = await act(w, 'publish');
  const next = await db.publishResult.findUniqueOrThrow({ where: { id: w.publications.amazon!.recordId } });
  assert.equal((next.data as { pricingSnapshotCode: string }).pricingSnapshotCode, refreshed.code);
});

test('fact change marks both platforms and their results stale without deleting history; regenerate repairs the chain', async () => {
  let w = await published(); w = await create(w, 'shopify'); w = await act(w, 'review', 'shopify'); w = await act(w, 'publish', 'shopify');
  const original = w; const rowsBefore = await db.listingDraft.count();
  let s = await call(`${path(w)}/fact-snapshot`); const color = s.facts.find((f: { key: string }) => f.key === 'color');
  s = await call(`/api/facts/${color.recordId}`, 'PATCH', { value: 'Navy', expectedRevision: s.factsRevision });
  assert.equal(s.downstreamInvalidated, true); w = await call(`${path(w)}/listings`); assert.deepEqual(w.listings, {}); assert.deepEqual(w.reviews, {}); assert.deepEqual(w.publications, {});
  assert.equal(await db.listingDraft.count(), rowsBefore);
  for (const p of ['amazon', 'shopify'] as const) {
    const listing = await call(`/api/listings/${original.listings[p]!.recordId}`); assert.equal(listing.listing.status, 'stale'); assert.equal(listing.publishAllowed, false);
    assert.ok(listing.reviews.every((r: { invalidatedAt: string }) => r.invalidatedAt)); assert.ok(listing.publications.every((r: { invalidatedAt: string }) => r.invalidatedAt));
    assert.equal((await app.inject({ method: 'POST', url: `/api/listings/${original.listings[p]!.recordId}/review`, headers: { cookie }, payload: { ...version(original, p), expectedFactsRevision: s.factsRevision } })).statusCode, 409);
  }
  s = await call(`/api/facts/${color.recordId}/confirm`, 'POST', { expectedRevision: s.factsRevision });
  w = await call(`/api/listings/${original.listings.shopify!.recordId}/regenerate`, 'POST', { ...version(original, 'shopify'), expectedFactsRevision: s.factsRevision });
  assert.match(w.listings.shopify!.title, /Navy/); w = await act(w, 'review', 'shopify'); w = await act(w, 'publish', 'shopify'); assert.equal(w.publications.shopify!.status, 'Draft');
});

test('client authorization flags, facts and stale versions are rejected; concurrent edits cannot both win', async () => {
  let w = await create(await setup(), 'shopify'); const l = w.listings.shopify!;
  for (const forged of [{ userId: 'other' }, { ownerId: 'other' }, { reviewPassed: true }, { publishAllowed: true }, { facts: [] }]) {
    assert.equal((await app.inject({ method: 'POST', url: `/api/listings/${l.recordId}/publish`, headers: { cookie }, payload: { ...version(w, 'shopify'), ...forged } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: `${path(w)}/listings`, headers: { cookie }, payload: { ...version(w, 'shopify'), platform: 'shopify', ...forged } })).statusCode, 400);
  }
  const payload = { ...version(w, 'shopify'), title: 'Human edit', bullets: l.bullets, description: l.description };
  const results = await Promise.all([1, 2].map(() => app.inject({ method: 'PATCH', url: `/api/listings/${l.recordId}`, headers: { cookie }, payload })));
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  w = await call(`${path(w)}/listings`); assert.equal(w.listings.shopify!.revision, 2);
  assert.equal((await app.inject({ method: 'POST', url: `${path(w)}/listings`, headers: { cookie }, payload: { platform: 'shopify', expectedVersion: 1, expectedFactsRevision: w.factsRevision } })).statusCode, 409);
});

test('cross-user read/edit/review/publish/CSV and unauthenticated access are denied', async () => {
  const w = await published(); const id = w.listings.amazon!.recordId!; const pub = w.publications.amazon!.recordId!;
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'isolated-listing@local.test', password: 'Demo123456', displayName: 'Other' } });
  const other = String(r.headers['set-cookie']).split(';')[0];
  for (const url of [`/api/listings/${id}`, `${path(w)}/listings`, `/api/publish/${pub}/amazon-csv`]) {
    assert.equal((await app.inject({ url, headers: { cookie: other } })).statusCode, 404);
    assert.equal((await app.inject({ url })).statusCode, 401);
  }
  for (const action of ['review', 'publish', 'regenerate', 'apply-suggested-fix']) assert.equal((await app.inject({ method: 'POST', url: `/api/listings/${id}/${action}`, headers: { cookie: other }, payload: version(w) })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/listings/${id}`, headers: { cookie: other }, payload: { ...version(w), title: 'Other', bullets: ['Other'], description: 'Other' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${path(w)}/listings`, headers: { cookie: other }, payload: { ...version(w), platform: 'amazon' } })).statusCode, 404);
  await app.inject({ method: 'POST', url: '/api/demo/reset', headers: { cookie: other }, payload: {} });
  assert.equal((await call(`/api/listings/${id}`)).publishAllowed, true);
});
