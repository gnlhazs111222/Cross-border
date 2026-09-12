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

const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(mkdtempSync(join(tmpdir(), 'prismlaunch-pricing-snapshot-')), 'test.db')}` });
const db = createDb(config.DATABASE_URL);
let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';

before(async () => {
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' });
  assert.equal(migrated.status, 0, migrated.stderr); await seedDemo(db); app = await buildApp(config, db, { logger: false });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
});
after(async () => { await app.close(); await db.$disconnect(); });

async function call(url: string, payload?: Record<string, unknown>, method: 'GET'|'POST'|'PATCH' = payload ? 'POST' : 'GET') {
  const response = await app.inject({ url, method, headers: { cookie }, ...(payload ? { payload } : {}) });
  assert.equal(response.statusCode, 200, response.body); return response.json().data;
}
const fields = (requirements = demoTask.requirements, market = demoTask.market) => ({ platform: demoTask.platform, market, category: demoTask.category, requirements, minimumProfit: demoTask.minProfit });
async function createTask() { await call('/api/demo/reset', {}); return call('/api/tasks', { code: demoTask.id, ...fields() }); }

test('task creation persists one auditable pricing context snapshot', async () => {
  const task = await createTask(); const snapshot = task.pricingSnapshot;
  assert.equal(snapshot.code, 'PCS-PL-DEMO-001-v1'); assert.equal(snapshot.version, 1);
  assert.equal(snapshot.exchange.pair, 'CNY/USD'); assert.equal(snapshot.exchange.rate, 0.139); assert.equal(snapshot.exchange.appliedToSupplierCost, false);
  assert.deepEqual([snapshot.shipping.amount, snapshot.duty.amount, snapshot.platformFee.amount], [3.1, 0.7, 2.2]);
  assert.match(snapshot.shipping.configVersion, /^shipping-/); assert.match(snapshot.duty.ruleVersion, /^duty-/); assert.match(snapshot.platformFee.configVersion, /^platform-/);
  const rows = await call(`/api/tasks/${task.recordId}/pricing-snapshots`); assert.equal(rows.length, 1); assert.deepEqual(rows[0], snapshot);
  const again = await call('/api/tasks', { code: demoTask.id, ...fields() }); assert.equal(again.pricingSnapshot.recordId, snapshot.recordId);
  assert.equal(await db.pricingSnapshot.count({ where: { taskId: task.recordId } }), 1);
});

test('ordinary requirement edits retain the snapshot while market changes create a new version', async () => {
  let task = await createTask(); const first = task.pricingSnapshot;
  task = await call(`/api/tasks/${task.recordId}`, { ...fields(['Black 500ml bottle']), expectedRevision: task.revision }, 'PATCH');
  assert.equal(task.pricingSnapshot.recordId, first.recordId);
  task = await call(`/api/tasks/${task.recordId}`, { ...fields(['Black 500ml bottle'], 'Canada'), expectedRevision: task.revision }, 'PATCH');
  assert.equal(task.pricingSnapshot.version, 2); assert.equal(task.pricingSnapshot.market, 'Canada');
  const rows = await call(`/api/tasks/${task.recordId}/pricing-snapshots`); assert.deepEqual(rows.map((row: { version: number }) => row.version), [2, 1]);
});

test('selected SKU pricing reads the frozen snapshot and refresh is version guarded', async () => {
  const task = await createTask();
  await call(`/api/tasks/${task.recordId}/selection`, { productId: HERO_SKU, purpose: 'selected' });
  let facts = await call(`/api/tasks/${task.recordId}/products/${HERO_SKU}/fact-cards/v1`, {});
  facts = await call(`/api/tasks/${task.recordId}/products/${HERO_SKU}/analyze`, { expectedRevision: facts.factsRevision });
  assert.equal(facts.pricing.snapshot.code, task.pricingSnapshot.code);
  // The amounts are computed from the frozen rate table: freight band, duty by destination+category,
  // import tax by destination, and the marketplace's share of the price.
  assert.deepEqual([facts.pricing.shipping, facts.pricing.duty, facts.pricing.platformCost], [3.1, 1.66, 3.36]);
  assert.equal(facts.pricing.breakdown!.rates.logistics, 'logistics-demo-v1');
  assert.equal(facts.pricing.breakdown!.rates.divisor, 5000);
  assert.equal(facts.pricing.breakdown!.chargeableWeightKg, 0.38, 'billable weight comes from the facts');
  const refreshed = await call(`/api/tasks/${task.recordId}/pricing-snapshots`, { expectedVersion: 1 }); assert.equal(refreshed.version, 2);
  facts = await call(`/api/tasks/${task.recordId}/products/${HERO_SKU}/fact-snapshot`); assert.equal(facts.pricing.snapshot.code, refreshed.code);
  const stale = await app.inject({ method: 'POST', url: `/api/tasks/${task.recordId}/pricing-snapshots`, headers: { cookie }, payload: { expectedVersion: 1 } });
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'pricing_snapshot_changed');
});

test('pricing snapshot history is owner scoped', async () => {
  const task = await createTask();
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'pricing-other@example.test', password: 'Demo123456', displayName: 'Other' } });
  const otherCookie = String(registered.headers['set-cookie']).split(';')[0];
  for (const method of ['GET', 'POST'] as const) {
    const response = await app.inject({ url: `/api/tasks/${task.recordId}/pricing-snapshots`, method, headers: { cookie: otherCookie }, ...(method === 'POST' ? { payload: { expectedVersion: 1 } } : {}) });
    assert.equal(response.statusCode, 404);
  }
});
