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
import type { WorkflowSnapshot } from '../../shared/contracts';
const config = { ...readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(mkdtempSync(join(tmpdir(), 'prismlaunch-qwen-')), 'test.db')}` }), NODE_ENV: 'development' as const,
  LISTING_PROVIDER: 'qwen' as const, AI_LIVE_ENABLED: true, BAILIAN_API_KEY: 'unit-test-key' };
const db = createDb(config.DATABASE_URL); let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; let calls = 0; let hold: Promise<void> | undefined; let onModelStart: (() => void) | undefined;
before(async () => {
  const m = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' }); assert.equal(m.status, 0, m.stderr); await seedDemo(db);
  app = await buildApp(config, db, { logger: false, transport: async (_url, init) => {
    calls++; onModelStart?.(); if (hold) await hold; const payload = JSON.parse(String(init?.body)); const data = JSON.parse(payload.messages[1].content); const facts = data.ALLOWED_FACTS as { field: string; value: string }[];
    const value = (key: string) => facts.find(f => f.field === key)!.value;
    const output = { title: `${value('color')} ${value('material')} Bottle, ${value('capacity')}`, bullets: [`Color: ${value('color')}.`, `Material: ${value('material')}.`, `Capacity: ${value('capacity')}.`],
      description: `A ${value('color')} bottle with a ${value('material')} body.`, attributes: { Color: value('color') }, usedFacts: facts.filter(f => ['color', 'material', 'capacity'].includes(f.field)).map(f => ({ field: f.field, value: f.value })) };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } }); cookie = String(login.headers['set-cookie']).split(';')[0];
});
after(async () => { await app.close(); await db.$disconnect(); });
async function call(url: string, data?: Record<string, unknown>, method: 'GET' | 'POST' | 'PATCH' = data ? 'POST' : 'GET') {
  const r = await app.inject({ url, method, headers: { cookie }, ...(data ? { payload: data } : {}) }); assert.equal(r.statusCode, 200, r.body); return r.json().data;
}
async function setup() {
  await call('/api/demo/reset', {});
  const task = await call('/api/tasks', { code: demoTask.id, platform: demoTask.platform, market: demoTask.market, category: demoTask.category, requirements: demoTask.requirements, minimumProfit: demoTask.minProfit });
  await call(`/api/tasks/${task.recordId}/selection`, { productId: HERO_SKU, purpose: 'selected' });
  const base = `/api/tasks/${task.recordId}/products/${HERO_SKU}`;
  const s = await call(`${base}/fact-cards/v1`, {}); const snap = await call(`${base}/analyze`, { expectedRevision: s.factsRevision });
  return { base, snap };
}
const args = (w: WorkflowSnapshot, platform: 'amazon' | 'shopify' = 'amazon') => ({ expectedVersion: w.heads[platform]!.revision, expectedFactsRevision: w.factsRevision });
const act = (w: WorkflowSnapshot, action: string, platform: 'amazon' | 'shopify' = 'amazon') => call(`/api/listings/${w.heads[platform]!.recordId}/${action}`, args(w, platform));

test('Qwen output persists metadata, passes explicit rules review, publishes, and reuses cached generation', async () => {
  const { base, snap } = await setup();
  let w = await call(`${base}/listings`, { platform: 'amazon', expectedVersion: 0, expectedFactsRevision: snap.factsRevision });
  assert.equal(w.listings.amazon.generationMode, 'qwen'); assert.equal(w.listings.amazon.riskDemoInjected, false); assert.equal(w.listings.amazon.generation.promptVersion, 'listing-qwen-v1'); assert.ok(w.listings.amazon.generation.aiCallId);
  assert.equal(w.publishAllowed.amazon, false); assert.equal(w.listings.amazon.authorization, undefined);
  w = await act(w, 'review'); assert.equal(w.reviews.amazon.status, 'passed'); w = await act(w, 'publish'); assert.ok(w.publications.amazon);
  const before = calls; w = await act(w, 'regenerate'); assert.equal(calls, before); assert.equal(w.listings.amazon.generation.cacheHit, true); assert.equal(w.reviews.amazon, undefined);
  w = await call(`${base}/listings`, { platform: 'shopify', expectedVersion: 0, expectedFactsRevision: snap.factsRevision }); assert.equal(w.listings.shopify.generationMode, 'qwen'); assert.equal(calls, before + 1);
  const audit = await db.aiCall.findUniqueOrThrow({ where: { id: w.listings.shopify.generation.aiCallId } }); assert.equal(audit.purpose, 'listing_generation'); assert.equal(audit.promptVersion, 'listing-qwen-v1'); assert.ok(audit.inputHash); assert.equal(audit.totalTokens, 50);
  const caps = await call('/api/capabilities'); assert.equal(caps.listing.activeProvider, 'qwen'); assert.equal(caps.listing.liveImplemented, true);
});

test('manual edits retain validated baseline, R002 blocks, explicit risk injection causes R001 without model calls', async () => {
  const { base, snap } = await setup(); let w = await call(`${base}/listings`, { platform: 'amazon', expectedVersion: 0, expectedFactsRevision: snap.factsRevision }); const l = w.listings.amazon;
  w = await call(`/api/listings/${l.recordId}`, { ...args(w), title: 'Unsupported custom title', bullets: l.bullets, description: l.description }, 'PATCH');
  w = await act(w, 'review'); assert.ok(w.reviews.amazon.issues.some((i: { id: string }) => i.id === 'R002'));
  const before = calls; w = await act(w, 'inject-demo-risk'); assert.equal(w.listings.amazon.riskDemoInjected, true); assert.equal(calls, before);
  w = await act(w, 'review'); assert.ok(w.reviews.amazon.issues.some((i: { id: string }) => i.id === 'R001'));
  assert.equal((await app.inject({ method: 'POST', url: `/api/listings/${w.listings.amazon.recordId}/publish`, headers: { cookie }, payload: args(w) })).statusCode, 409);
  w = await act(w, 'apply-suggested-fix'); assert.equal(w.listings.amazon.generationMode, 'template'); assert.equal(w.reviews.amazon, undefined);
  w = await act(w, 'review'); w = await act(w, 'publish'); assert.equal(calls, before); assert.ok(w.publications.amazon);
});

test('fact revisions invalidate Qwen drafts and cache; foreign users cannot access the result', async () => {
  const { base, snap } = await setup(); let w = await call(`${base}/listings`, { platform: 'amazon', expectedVersion: 0, expectedFactsRevision: snap.factsRevision }); const old = w.listings.amazon;
  const color = snap.facts.find((f: { key: string }) => f.key === 'color');
  let changed = await call(`/api/facts/${color.recordId}`, { value: 'Navy', expectedRevision: snap.factsRevision }, 'PATCH');
  changed = await call(`/api/facts/${color.recordId}/confirm`, { expectedRevision: changed.factsRevision });
  const before = calls;
  w = await call(`${base}/listings`, { platform: 'amazon', expectedVersion: old.revision, expectedFactsRevision: changed.factsRevision }); assert.equal(calls, before + 1); assert.match(w.listings.amazon.title, /Navy/); assert.equal(w.listings.amazon.generation.cacheHit, false);
  assert.equal((await call(`/api/listings/${old.recordId}`)).listing.status, 'superseded');
  const other = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'qwen-other@local.test', password: 'Demo123456', displayName: 'Other' } });
  assert.equal((await app.inject({ url: `/api/listings/${w.listings.amazon.recordId}`, headers: { cookie: String(other.headers['set-cookie']).split(';')[0] } })).statusCode, 404);
});

test('fact edits can proceed during model generation and stale output is never committed', async () => {
  const { base, snap } = await setup(); const color = snap.facts.find((f: { key: string }) => f.key === 'color');
  let s = await call(`/api/facts/${color.recordId}`, { value: 'Blue', expectedRevision: snap.factsRevision }, 'PATCH');
  s = await call(`/api/facts/${color.recordId}/confirm`, { expectedRevision: s.factsRevision });
  let release!: () => void; hold = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { onModelStart = resolve; });
  const generating = app.inject({ method: 'POST', url: `${base}/listings`, headers: { cookie }, payload: { platform: 'amazon', expectedVersion: 0, expectedFactsRevision: s.factsRevision } });
  try {
    await started;
    const updated = await call(`/api/facts/${color.recordId}`, { value: 'Navy', expectedRevision: s.factsRevision }, 'PATCH');
    assert.equal(updated.factsRevision, s.factsRevision + 1);
  } finally { release(); hold = undefined; onModelStart = undefined; }
  const response = await generating; assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'facts_changed');
  assert.equal(await db.listingDraft.count(), 0);
});

test('upstream failure persists template_fallback and the normal review/publish workflow remains usable', async () => {
  const { base, snap } = await setup(); let attempts = 0;
  const failing = await buildApp(config, db, { logger: false, transport: async () => { attempts++; return new Response('PRIVATE_UNAVAILABLE', { status: 503 }); } });
  try {
    const generated = await failing.inject({ method: 'POST', url: `${base}/listings`, headers: { cookie }, payload: { platform: 'amazon', expectedVersion: 0, expectedFactsRevision: snap.factsRevision } });
    assert.equal(generated.statusCode, 200); const draft = generated.json().data.listings.amazon;
    assert.equal(draft.generationMode, 'template_fallback'); assert.equal(draft.generation.fallbackReason, 'bailian_http_503'); assert.equal(draft.riskDemoInjected, false);
    assert.equal((await db.listingDraft.findUniqueOrThrow({ where: { id: draft.recordId } })).generationMode, 'template_fallback');
    const version = { expectedVersion: draft.revision, expectedFactsRevision: snap.factsRevision };
    const reviewed = await failing.inject({ method: 'POST', url: `/api/listings/${draft.recordId}/review`, headers: { cookie }, payload: version });
    assert.equal(reviewed.json().data.reviews.amazon.status, 'passed');
    const published = await failing.inject({ method: 'POST', url: `/api/listings/${draft.recordId}/publish`, headers: { cookie }, payload: version });
    assert.ok(published.json().data.publications.amazon); assert.equal(attempts, 1);
    assert.equal((await failing.inject('/api/capabilities')).json().data.listing.activeProvider, 'qwen');
    assert.doesNotMatch(generated.body, /PRIVATE_UNAVAILABLE/);
  } finally { await failing.close(); }
});
