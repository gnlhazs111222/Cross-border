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

const config = { ...readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(mkdtempSync(join(tmpdir(), 'review-flow-')), 'test.db')}` }), NODE_ENV: 'development' as const, REVIEW_PROVIDER: 'qwen' as const, AI_LIVE_ENABLED: true, BAILIAN_API_KEY: 'unit-test-only' };
const db = createDb(config.DATABASE_URL);
let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; let calls = 0; let fail = false; let hold: Promise<void> | undefined; let started: (() => void) | undefined;
before(async () => {
  const m = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' }); assert.equal(m.status, 0, m.stderr);
  await seedDemo(db);
  app = await buildApp(config, db, { logger: false, transport: async () => { calls++; started?.(); if (hold) await hold;
    return fail ? new Response('PRIVATE_ERROR', { status: 503 }) : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: 'passed', issues: [] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }), { headers: { 'content-type': 'application/json' } }); } });
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } }); cookie = String(r.headers['set-cookie']).split(';')[0];
});
after(async () => { await app.close(); await db.$disconnect(); });
async function call(url: string, payload?: object, method: 'GET' | 'POST' | 'PATCH' = payload ? 'POST' : 'GET') {
  const r = await app.inject({ url, method, headers: { cookie }, ...(payload ? { payload } : {}) }); assert.equal(r.statusCode, 200, r.body); return r.json().data;
}
async function setup() {
  await call('/api/demo/reset', {}); fail = false;
  const task = await call('/api/tasks', { code: demoTask.id, platform: demoTask.platform, market: demoTask.market, category: demoTask.category, requirements: demoTask.requirements, minimumProfit: demoTask.minProfit });
  await call(`/api/tasks/${task.recordId}/selection`, { productId: HERO_SKU, purpose: 'fact_review' });
  const base = `/api/tasks/${task.recordId}/products/${HERO_SKU}`;
  const v1 = await call(`${base}/fact-cards/v1`, {}); const snap = await call(`${base}/analyze`, { expectedRevision: v1.factsRevision });
  const w = await call(`${base}/listings`, { platform: 'shopify', expectedVersion: 0, expectedFactsRevision: snap.factsRevision });
  const draft = w.listings.shopify;
  const edit = await call(`/api/listings/${draft.recordId}`, { expectedVersion: draft.revision, expectedFactsRevision: w.factsRevision, title: 'Black bottle holding 500ml', bullets: draft.bullets, description: draft.description }, 'PATCH');
  return { task, base, snap, w: edit, id: edit.listings.shopify.recordId, args: { expectedVersion: edit.listings.shopify.revision, expectedFactsRevision: edit.factsRevision } };
}
test('semantic approval of a paraphrase persists and GET/publish do not call Qwen again', async () => {
  const s = await setup(); const before = calls;
  const w = await call(`/api/listings/${s.id}/review`, s.args);
  assert.equal(w.reviews.shopify.status, 'passed'); assert.equal(w.reviews.shopify.reviewMode, 'rules_qwen'); assert.equal(w.publishAllowed.shopify, true); assert.equal(calls, before + 1);
  await call(`${s.base}/listings`); await call(`/api/listings/${s.id}`); await call(`/api/listings/${s.id}/publish`, s.args); assert.equal(calls, before + 1);
  const caps = await call('/api/capabilities'); assert.equal(caps.review.activeProvider, 'qwen');
});
test('failed re-review retires prior approval and publication instead of silently allowing rules fallback', async () => {
  const s = await setup(); await call(`/api/listings/${s.id}/review`, s.args); await call(`/api/listings/${s.id}/publish`, s.args);
  fail = true; const w = await call(`/api/listings/${s.id}/review`, s.args);
  assert.equal(w.reviews.shopify.status, 'failed'); assert.equal(w.publishAllowed.shopify, false); assert.equal(w.publications.shopify, undefined);
  const denied = await app.inject({ url: `/api/listings/${s.id}/publish`, method: 'POST', headers: { cookie }, payload: s.args }); assert.equal(denied.statusCode, 409);
  assert.doesNotMatch(JSON.stringify(w), /PRIVATE_ERROR/); fail = false;
});
test('review releases SQLite during network wait, rejects concurrent review and stale facts', async () => {
  const s = await setup(); let release!: () => void; hold = new Promise(resolve => { release = resolve; }); const began = new Promise<void>(resolve => { started = resolve; });
  const request = app.inject({ url: `/api/listings/${s.id}/review`, method: 'POST', headers: { cookie }, payload: s.args });
  try {
    await began;
    const dupe = await app.inject({ url: `/api/listings/${s.id}/review`, method: 'POST', headers: { cookie }, payload: s.args }); assert.equal(dupe.statusCode, 409);
    const visible = await call(`${s.base}/listings`); assert.equal(visible.publishAllowed.shopify, false); assert.equal(visible.reviews.shopify.status, 'running');
    const color = s.snap.facts.find((f: { key: string }) => f.key === 'color');
    await call(`/api/facts/${color.recordId}`, { value: 'Navy', expectedRevision: s.snap.factsRevision }, 'PATCH');
  } finally { release(); hold = undefined; started = undefined; }
  assert.equal((await request).statusCode, 409);
  assert.equal(await db.reviewResult.count({ where: { listingDraftId: s.id, status: 'passed', invalidatedAt: null } }), 0);
});
test('task edits and foreign users cannot authorize an in-flight review', async () => {
  const s = await setup(); let release!: () => void; hold = new Promise(resolve => { release = resolve; }); const began = new Promise<void>(resolve => { started = resolve; });
  const request = app.inject({ url: `/api/listings/${s.id}/review`, method: 'POST', headers: { cookie }, payload: s.args });
  try { await began;
    await call(`/api/tasks/${s.task.recordId}`, { platform: s.task.platform, market: s.task.market, category: s.task.category, requirements: ['White bottle'], minimumProfit: 5, expectedRevision: s.task.revision }, 'PATCH');
  } finally { release(); hold = undefined; started = undefined; }
  assert.equal((await request).statusCode, 409);
  const other = await app.inject({ url: '/api/auth/register', method: 'POST', payload: { email: 'other-review@example.test', displayName: 'Other', password: 'Demo123456' } });
  const foreign = await app.inject({ url: `/api/listings/${s.id}/review`, method: 'POST', headers: { cookie: String(other.headers['set-cookie']).split(';')[0] }, payload: s.args }); assert.equal(foreign.statusCode, 404);
});

test('editing copy during review rejects the old response and leaves the new version unapproved', async () => {
  const s = await setup(); let release!: () => void; hold = new Promise(resolve => { release = resolve; }); const began = new Promise<void>(resolve => { started = resolve; });
  const request = app.inject({ url: `/api/listings/${s.id}/review`, method: 'POST', headers: { cookie }, payload: s.args });
  try { await began;
    const copy = s.w.listings.shopify;
    const changed = await call(`/api/listings/${s.id}`, { ...s.args, title: 'Black 500ml bottle', bullets: copy.bullets, description: copy.description }, 'PATCH');
    assert.equal(changed.listings.shopify.revision, s.args.expectedVersion + 1); assert.equal(changed.publishAllowed.shopify, false);
  } finally { release(); hold = undefined; started = undefined; }
  assert.equal((await request).statusCode, 409);
});

test('review mode or model changes cannot reuse an approval, and checks do not call the model', async () => {
  const s = await setup(); await call(`/api/listings/${s.id}/review`, s.args);
  const baselineCalls = calls;
  for (const override of [{ REVIEW_PROVIDER: 'rules' as const }, { BAILIAN_TEXT_MODEL: 'qwen-other' }]) {
    let unexpected = 0;
    const changed = await buildApp({ ...config, ...override }, db, { logger: false, transport: async () => { unexpected++; throw new Error('No network on authorization'); } });
    try {
      const r = await changed.inject({ url: `${s.base}/listings`, headers: { cookie } });
      assert.equal(r.statusCode, 200); assert.equal(r.json().data.publishAllowed.shopify, false);
      const p = await changed.inject({ url: `/api/listings/${s.id}/publish`, method: 'POST', headers: { cookie }, payload: s.args }); assert.equal(p.statusCode, 409); assert.equal(unexpected, 0);
    } finally { await changed.close(); }
  }
  const record = await db.reviewResult.findFirstOrThrow({ where: { listingDraftId: s.id, status: 'passed', invalidatedAt: null } });
  await db.reviewResult.update({ where: { id: record.id }, data: { metadata: { ...(record.metadata as object), promptVersion: 'old-review-prompt' } } });
  assert.equal((await call(`${s.base}/listings`)).publishAllowed.shopify, false); assert.equal(calls, baselineCalls);
});

test('enabling Qwen expires a saved rules approval without making a model call', async () => {
  const s = await setup(); const before = calls;
  const rulesApp = await buildApp({ ...config, REVIEW_PROVIDER: 'rules' }, db, { logger: false, transport: async () => { throw new Error('Rules mode must stay offline'); } });
  try {
    const fixed = await rulesApp.inject({ url: `/api/listings/${s.id}/apply-suggested-fix`, method: 'POST', headers: { cookie }, payload: s.args });
    assert.equal(fixed.statusCode, 200, fixed.body);
    const workflow = fixed.json().data;
    const id = workflow.listings.shopify.recordId;
    const args = { expectedVersion: workflow.listings.shopify.revision, expectedFactsRevision: workflow.factsRevision };
    const reviewed = await rulesApp.inject({ url: `/api/listings/${id}/review`, method: 'POST', headers: { cookie }, payload: args });
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    assert.equal(reviewed.json().data.publishAllowed.shopify, true);
    const changed = await call(`${s.base}/listings`);
    assert.equal(changed.reviews.shopify.status, 'passed');
    assert.equal(changed.reviews.shopify.reviewMode, 'rules');
    assert.equal(changed.publishAllowed.shopify, false);
    const publish = await app.inject({ url: `/api/listings/${id}/publish`, method: 'POST', headers: { cookie }, payload: args });
    assert.equal(publish.statusCode, 409);
    assert.equal(calls, before);
  } finally { await rulesApp.close(); }
});

test('semantic Amazon review keeps the hard block and invalidates CSV after failed re-review', async () => {
  const s = await setup(); const before = calls;
  let w = await call(`${s.base}/listings`, { platform: 'amazon', expectedVersion: 0, expectedFactsRevision: s.snap.factsRevision });
  const args = () => ({ expectedVersion: w.listings.amazon.revision, expectedFactsRevision: w.factsRevision });
  let id = w.listings.amazon.recordId;
  w = await call(`/api/listings/${id}/review`, args());
  assert.equal(w.reviews.amazon.status, 'blocked');
  assert.equal(w.reviews.amazon.metadata.modelCalled, false);
  assert.equal(w.publishAllowed.amazon, false);
  assert.equal(calls, before);
  w = await call(`/api/listings/${id}/apply-suggested-fix`, args());
  id = w.listings.amazon.recordId;
  w = await call(`/api/listings/${id}/review`, args());
  assert.equal(w.publishAllowed.amazon, true);
  assert.equal(calls, before + 1);
  w = await call(`/api/listings/${id}/publish`, args());
  const csvUrl = `/api/publish/${w.publications.amazon.recordId}/amazon-csv`;
  const csv = await app.inject({ url: csvUrl, headers: { cookie } });
  assert.equal(csv.statusCode, 200);
  assert.match(csv.body, /LM-KT-BTL-001-BLK-500/);
  assert.equal(calls, before + 1);
  fail = true;
  try {
    w = await call(`/api/listings/${id}/review`, args());
    assert.equal(w.reviews.amazon.status, 'failed');
    assert.equal(w.publications.amazon, undefined);
    assert.equal((await app.inject({ url: csvUrl, headers: { cookie } })).statusCode, 409);
    assert.equal(calls, before + 2);
  } finally { fail = false; }
});
