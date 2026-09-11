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
import { demoTask, products } from '../../src/data/mockData';

const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(mkdtempSync(join(tmpdir(), 'prismlaunch-api-')), 'test.db')}` });
const db = createDb(config.DATABASE_URL);
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie = '';
let transportCalls = 0;
before(async () => {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL, AI_LIVE_ENABLED: 'false', BAILIAN_API_KEY: '' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  await seedDemo(db);
  app = await buildApp(config, db, { logger: false, transport: async () => { transportCalls++; throw new Error('Unexpected network'); } });
});
after(async () => { await app?.close(); await db.$disconnect(); });

test('health and unauthenticated boundaries', async () => {
  assert.deepEqual((await app.inject('/api/health')).json(), { status: 'ok', service: 'prismlaunch-api' });
  for (const url of ['/api/auth/me', '/api/products', '/api/tasks']) assert.equal((await app.inject(url)).statusCode, 401);
});
test('seed account is hashed; login failure and cookie login success', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { email: 'demo@prismlaunch.local' } });
  assert.notEqual(user.passwordHash, 'Demo123456'); assert.match(user.passwordHash, /^scrypt\$/);
  assert.equal(await db.product.count({ where: { userId: user.id } }), 10);
  const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: user.email, password: 'wrong' } });
  assert.equal(wrong.statusCode, 401); assert.equal(wrong.json().error.code, 'invalid_credentials');
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: user.email, password: 'Demo123456' } });
  assert.equal(login.statusCode, 200); assert.equal(login.json().data.displayName, 'PrismLaunch Demo');
  const header = String(login.headers['set-cookie']); assert.match(header, /HttpOnly/i); assert.match(header, /SameSite=Lax/i);
  cookie = header.split(';')[0];
  assert.doesNotMatch(login.body, /passwordHash|tokenHash|session/);
  const session = await db.session.findFirstOrThrow({ where: { userId: user.id } });
  assert.notEqual(session.tokenHash, cookie.split('=')[1]);
  assert.equal((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json().data.id, user.id);
});
test('authenticated product read and validated import survive a new Prisma connection', async () => {
  const catalog = (await app.inject({ url: '/api/products', headers: { cookie } })).json().data;
  assert.equal(catalog.products.length, 10);
  assert.deepEqual(catalog.products.map((p: { sku: string }) => p.sku), products.map(p => p.sku));
  const first = catalog.products[0];
  assert.equal((await app.inject({ url: `/api/products/${first.recordId}`, headers: { cookie } })).json().data.sku, first.sku);
  const product = { ...products[0], sku: 'SERVER-IMPORTED-001', name: 'Persisted supplier bottle', packageLength: 8, packageWidth: 8, packageHeight: 25, importSource: { fileName: 'test.csv', sheetName: 'Products', row: 2 } };
  const report = { fileName: 'test.csv', mode: 'replace', processed: 1, ready: 1, missing: 0, duplicates: 0, invalid: 0, rows: [{ row: 2, sku: product.sku, status: 'ready', issues: [] }] };
  const mismatched = await app.inject({ method: 'POST', url: '/api/products/import', headers: { cookie }, payload: { mode: 'replace', expectedRevision: catalog.revision, products: [{ ...product, visual: 'bag' }], report } });
  assert.equal(mismatched.statusCode, 400); assert.equal(mismatched.json().error.code, 'validation_error');
  const imported = await app.inject({ method: 'POST', url: '/api/products/import', headers: { cookie }, payload: { mode: 'replace', expectedRevision: catalog.revision, products: [product], report } });
  assert.equal(imported.statusCode, 200, imported.body); assert.equal(imported.json().data.products.length, 1);
  const reopened = createDb(config.DATABASE_URL);
  try { const row = await reopened.product.findFirstOrThrow({ where: { sku: product.sku } }); assert.equal((row.data as { supplierCost: number }).supplierCost, 8.2); } finally { await reopened.$disconnect(); }
  const stale = await app.inject({ method: 'POST', url: '/api/products/import', headers: { cookie }, payload: { mode: 'replace', expectedRevision: catalog.revision, products: [product], report } });
  assert.equal(stale.statusCode, 409);
  const invalid = await app.inject({ method: 'POST', url: '/api/products/import', headers: { cookie }, payload: { mode: 'replace', products: [{ sku: '' }] } });
  assert.equal(invalid.statusCode, 400); assert.equal(invalid.json().error.code, 'validation_error'); assert.doesNotMatch(invalid.body, /stack|prisma/i);
});
test('tasks and selection persist and user boundaries are enforced', async () => {
  const t = await app.inject({ method: 'POST', url: '/api/tasks', headers: { cookie }, payload: { code: demoTask.id, platform: demoTask.platform, market: demoTask.market, category: demoTask.category, requirements: demoTask.requirements, minimumProfit: demoTask.minProfit } });
  assert.equal(t.statusCode, 200); const id = t.json().data.recordId;
  assert.equal((await app.inject({ method: 'POST', url: `/api/tasks/${id}/selection`, headers: { cookie }, payload: { productId: 'SERVER-IMPORTED-001', purpose: 'selected' } })).statusCode, 200);
  const task = (await app.inject({ url: `/api/tasks/${id}`, headers: { cookie } })).json().data;
  assert.equal(task.selectedSku, 'SERVER-IMPORTED-001'); assert.equal(task.minProfit, 5);
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'other@prismlaunch.local', password: 'Other123456', displayName: 'Other' } });
  assert.equal(registered.statusCode, 201);
  const otherCookie = String(registered.headers['set-cookie']).split(';')[0];
  const otherRows = (await app.inject({ url: '/api/products', headers: { cookie: otherCookie } })).json().data.products;
  assert.equal(otherRows.length, 10);
  const privateProduct = (await app.inject({ url: '/api/products', headers: { cookie } })).json().data.products[0];
  assert.equal((await app.inject({ url: `/api/products/${privateProduct.recordId}`, headers: { cookie: otherCookie } })).statusCode, 404);
  assert.equal((await app.inject({ url: `/api/tasks/${id}`, headers: { cookie: otherCookie } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `/api/tasks/${id}/selection`, headers: { cookie: otherCookie }, payload: { productId: otherRows[0].recordId, purpose: 'selected' } })).statusCode, 404);
});
test('capabilities and live-disabled smoke never access the provider', async () => {
  const capabilities = (await app.inject('/api/capabilities')).json().data;
  assert.equal(capabilities.database, true); assert.equal(capabilities.authentication, true);
  assert.equal(capabilities.textModel.liveAvailable, false); assert.equal(capabilities.listing.activeProvider, 'template');
  assert.equal(capabilities.listing.liveImplemented, true);
  const response = await app.inject({ method: 'POST', url: '/api/ai/smoke-test', headers: { cookie }, payload: { message: 'Hello' } });
  assert.equal(response.json().error.code, 'live_ai_disabled'); assert.equal(transportCalls, 0);
  assert.equal(await db.aiCall.count(), 0);
});
test('reset affects only the current user and leaves authentication intact; logout revokes session', async () => {
  const before = await db.user.count();
  const reset = await app.inject({ method: 'POST', url: '/api/demo/reset', headers: { cookie }, payload: {} });
  assert.equal(reset.statusCode, 200); assert.equal(reset.json().data.products.length, 10);
  assert.equal((await app.inject({ url: '/api/tasks', headers: { cookie } })).json().data.length, 0);
  assert.equal(await db.user.count(), before); assert.equal((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode, 200);
  const blockedOrigin = await app.inject({ method: 'POST', url: '/api/demo/reset', headers: { cookie, origin: 'https://untrusted.example' }, payload: {} }); assert.equal(blockedOrigin.statusCode, 403);
  const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie }, payload: {} }); assert.equal(logout.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode, 401);
});
test('production disables demo reset, registration and smoke endpoints', async () => {
  const production = await buildApp({ ...config, NODE_ENV: 'production' }, db, { logger: false });
  try {
    const login = await production.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } });
    assert.match(String(login.headers['set-cookie']), /Secure/);
    const c = String(login.headers['set-cookie']).split(';')[0];
    assert.equal((await production.inject({ method: 'POST', url: '/api/demo/reset', headers: { cookie: c }, payload: {} })).statusCode, 403);
    assert.equal((await production.inject({ method: 'POST', url: '/api/ai/smoke-test', headers: { cookie: c }, payload: { message: 'Hello' } })).statusCode, 404);
    assert.equal((await production.inject({ method: 'POST', url: '/api/auth/register', payload: {} })).statusCode, 403);
  } finally { await production.close(); }
});
test('live-enabled with no key returns bailian_not_configured without transport activity', async () => {
  let calls = 0;
  const noKey = await buildApp({ ...config, NODE_ENV: 'development', AI_LIVE_ENABLED: true, BAILIAN_API_KEY: '' }, db, { logger: false, transport: async () => { calls++; throw new Error('Unexpected request'); } });
  try {
    const login = await noKey.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } });
    const c = String(login.headers['set-cookie']).split(';')[0];
    const result = await noKey.inject({ method: 'POST', url: '/api/ai/smoke-test', headers: { cookie: c }, payload: { message: 'Hello' } });
    assert.equal(result.statusCode, 503); assert.equal(result.json().error.code, 'bailian_not_configured'); assert.equal(calls, 0);
    assert.equal((await noKey.inject('/api/capabilities')).json().data.textModel.liveAvailable, false);
  } finally { await noKey.close(); }
});
