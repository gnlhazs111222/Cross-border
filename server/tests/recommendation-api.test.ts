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
const config = { ...readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(mkdtempSync(join(tmpdir(), 'prismlaunch-rec-api-')), 'test.db')}` }), NODE_ENV: 'development' as const, RECOMMENDATION_PROVIDER: 'qwen' as const, AI_LIVE_ENABLED: true, BAILIAN_API_KEY: 'unit-test-key' };
const db = createDb(config.DATABASE_URL); let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; let calls = 0; let hold: Promise<void> | undefined; let started: (() => void) | undefined;
before(async () => {
  const m = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' }); assert.equal(m.status, 0, m.stderr);
  await seedDemo(db);
  app = await buildApp(config, db, { logger: false, transport: async (_url, init) => {
    calls++; started?.(); if (hold) await hold;
    const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    const wantsStraw = /with a straw/.test(input.task.requirements.join(' '));
    const rows = [...input.candidates].sort((a, b) => wantsStraw ? Number(b.confirmedFacts.some((f: { field: string; value: string }) => f.field === 'straw' && f.value === 'Included')) - Number(a.confirmedFacts.some((f: { field: string; value: string }) => f.field === 'straw' && f.value === 'Included')) : a.sku.localeCompare(b.sku));
    const rankedCandidates = rows.slice(0, 3).map((p, i) => ({ productId: p.productId, sku: p.sku, score: 94-i*8, matchedReasons: [`${p.confirmedFacts.find((f: { field: string }) => f.field === 'color').value} color`, `${p.confirmedFacts.find((f: { field: string }) => f.field === 'capacity').value} capacity`], concerns: [], summary: 'Compared with the requested attributes.' }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ rankedCandidates }) } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } }); cookie = String(login.headers['set-cookie']).split(';')[0];
});
after(async () => { await app.close(); await db.$disconnect(); });
async function call(url: string, payload?: Record<string, unknown>, method: 'GET' | 'POST' | 'PATCH' = payload ? 'POST' : 'GET') {
  const r = await app.inject({ url, method, headers: { cookie }, ...(payload ? { payload } : {}) }); assert.equal(r.statusCode, 200, r.body); return r.json().data;
}
const fields = (requirements = demoTask.requirements) => ({ platform: 'Amazon US', market: 'United States', category: 'Home & Kitchen', requirements, minimumProfit: 5 });
async function setup() { await call('/api/demo/reset', {}); return call('/api/tasks', { code: 'CUSTOM-TASK', ...fields() }); }

test('editable task persists revisions and GET recommendation never invokes Qwen', async () => {
  const task = await setup(); const before = calls;
    const first = await call(`/api/tasks/${task.recordId}/recommendations`); assert.equal(first.status, 'not_run'); assert.equal(first.eligibleCount, 6); assert.equal(first.excluded.length, 4);
  await call(`/api/tasks/${task.recordId}/recommendations`); assert.equal(calls, before);
  const changed = await call(`/api/tasks/${task.recordId}`, { ...fields(['Black 500ml with a straw']), platform: 'Shopify US', expectedRevision: task.revision }, 'PATCH');
  assert.equal(changed.revision, 2); assert.equal(changed.platform, 'Shopify US');
  const reopened = createDb(config.DATABASE_URL); try { assert.deepEqual((await reopened.launchTask.findUniqueOrThrow({ where: { id: task.recordId } })).requirements, ['Black 500ml with a straw']); } finally { await reopened.$disconnect(); }
});
test('POST runs, saves Qwen metadata, GET restores, rule shortcut makes no model calls', async () => {
  const task = await setup(); const before = calls;
  const rule = await call(`/api/tasks/${task.recordId}/recommendations`, { expectedTaskRevision: task.revision, mode: 'rule' }); assert.equal(rule.generation.mode, 'rule'); assert.equal(calls, before);
  const ranked = await call(`/api/tasks/${task.recordId}/recommendations`, { expectedTaskRevision: task.revision });
  assert.equal(calls, before+1); assert.equal(ranked.generation.mode, 'qwen'); assert.ok(ranked.generation.aiCallId); assert.ok(ranked.generation.inputHash); assert.equal(ranked.recommendations[0].sku, HERO_SKU);
  assert.deepEqual(await call(`/api/tasks/${task.recordId}/recommendations`), ranked); assert.equal(calls, before+1);
  const again = await call(`/api/tasks/${task.recordId}/recommendations`, { expectedTaskRevision: task.revision }); assert.equal(again.generation.cacheHit, true); assert.equal(calls, before+1);
});
test('task changes stale recommendation, clear selection and invalidate downstream without deleting products', async () => {
  const task = await setup(); await call(`/api/tasks/${task.recordId}/recommendations`, { expectedTaskRevision: 1 });
  await call(`/api/tasks/${task.recordId}/selection`, { productId: HERO_SKU, purpose: 'selected' });
  const f = await call(`/api/tasks/${task.recordId}/products/${HERO_SKU}/fact-cards/v1`, {});
  const s = await call(`/api/tasks/${task.recordId}/products/${HERO_SKU}/analyze`, { expectedRevision: f.factsRevision });
  const listing = await call(`/api/tasks/${task.recordId}/products/${HERO_SKU}/listings`, { platform: 'shopify', expectedVersion: 0, expectedFactsRevision: s.factsRevision });
  const updated = await call(`/api/tasks/${task.recordId}`, { ...fields(['Black 500ml with a straw']), expectedRevision: 1 }, 'PATCH');
  assert.equal(updated.selectedSku, null); assert.equal((await call(`/api/tasks/${task.recordId}/recommendations`)).status, 'stale'); assert.equal((await call('/api/products')).products.length, 10);
  assert.equal((await db.listingDraft.findUniqueOrThrow({ where: { id: listing.listings.shopify.recordId } })).status, 'stale');
  const before = calls; const ranked = await call(`/api/tasks/${task.recordId}/recommendations`, { expectedTaskRevision: 2 }); assert.equal(calls, before+1); assert.equal(ranked.recommendations[0].sku, 'LM-KT-BTL-002-BLK-500');
});
test('missing pricing facts do not block selection and can be repaired afterward', async () => {
  const task = await setup(); await call(`/api/tasks/${task.recordId}/recommendations`, { expectedTaskRevision: 1, mode: 'rule' });
  const sku = 'LM-KT-BTL-005-BLK-500';
  await call(`/api/tasks/${task.recordId}/selection`, { productId: sku, purpose: 'selected' });
  let snap = await call(`/api/tasks/${task.recordId}/products/${sku}/fact-cards/v1`, {}); const weight = snap.facts.find((f: { key: string }) => f.key === 'packagingWeight');
  assert.equal(snap.pricingReadiness.ready, false);
  snap = await call(`/api/facts/${weight.recordId}`, { expectedRevision: snap.factsRevision, value: '0.42' }, 'PATCH');
  assert.equal((await call(`/api/tasks/${task.recordId}/recommendations`)).status, 'ready');
  snap = await call(`/api/facts/${weight.recordId}/confirm`, { expectedRevision: snap.factsRevision });
  assert.equal(snap.pricingReadiness.ready, true);
  const ranked = await call(`/api/tasks/${task.recordId}/recommendations`, { expectedTaskRevision: 1, mode: 'rule' }); assert.equal(ranked.eligibleCount, 6);
});
test('catalog replacement removes old task ranking; cross-user requests and client trust flags are denied', async () => {
  const task = await setup(); const other = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'other-rec@local.test', password: 'Demo123456', displayName: 'Other' } }); const otherCookie = String(other.headers['set-cookie']).split(';')[0];
  for (const method of ['GET', 'POST'] as const) assert.equal((await app.inject({ url: `/api/tasks/${task.recordId}/recommendations`, method, headers: { cookie: otherCookie }, ...(method === 'POST' ? { payload: { expectedTaskRevision: 1 } } : {}) })).statusCode, 404);
  assert.equal((await app.inject({ url: `/api/tasks/${task.recordId}/recommendations` })).statusCode, 401);
  for (const extra of [{ userId: 'forged' }, { eligible: true }, { trustedFacts: [] }]) assert.equal((await app.inject({ method: 'POST', url: `/api/tasks/${task.recordId}/recommendations`, headers: { cookie }, payload: { expectedTaskRevision: 1, ...extra } })).statusCode, 400);
  await call('/api/demo/reset', {}); assert.equal((await app.inject({ url: `/api/tasks/${task.recordId}/recommendations`, headers: { cookie } })).statusCode, 404);
});
test('task revision conflict and task mutation during ranking prevent stale writes', async () => {
  const task = await setup(); let release!: () => void; hold = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { started = resolve; });
  const ranking = app.inject({ method: 'POST', url: `/api/tasks/${task.recordId}/recommendations`, headers: { cookie }, payload: { expectedTaskRevision: 1 } });
  try { await entered; await call(`/api/tasks/${task.recordId}`, { ...fields(['Prefer a large capacity']), expectedRevision: 1 }, 'PATCH'); } finally { release(); hold = undefined; started = undefined; }
  assert.equal((await ranking).statusCode, 409); assert.equal((await call(`/api/tasks/${task.recordId}/recommendations`)).status, 'not_run');
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/tasks/${task.recordId}`, headers: { cookie }, payload: { ...fields(), expectedRevision: 1 } })).statusCode, 409);
});
