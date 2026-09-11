import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../config';
import { createDb } from '../db';
import { buildApp } from '../app';
import { seedDemo } from '../seed';
import { demoTask } from '../../src/data/mockData';
import { assetStoragePath } from '../services/assets';
import type { FactSnapshot, ProductAsset } from '../../shared/contracts';

const root = mkdtempSync(join(tmpdir(), 'prismlaunch-assets-'));
const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(root, 'test.db')}`,
  ASSET_STORAGE_DIR: join(root, 'assets'), ASSET_MAX_BYTES: '4096', ASSET_MAX_PER_PRODUCT: '3' });
const db = createDb(config.DATABASE_URL);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; let calls = 0;
const sku = 'LM-KT-BTL-001-BLK-500';

before(async () => {
  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  await seedDemo(db);
  app = await buildApp(config, db, { logger: false, transport: async () => { calls++; throw new Error('No network permitted'); } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
});
after(async () => { assert.equal(calls, 0); assert.equal(await db.aiCall.count(), 0); await app?.close(); await db.$disconnect(); });

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
async function inject(url: string, method: Method, payload?: Record<string, unknown>) {
  return payload === undefined
    ? app.inject({ url, method, headers: { cookie } })
    : app.inject({ url, method, headers: { cookie }, payload });
}
async function call<T>(url: string, method: Method = 'GET', payload?: Record<string, unknown>): Promise<T> {
  const response = await inject(url, method, payload);
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data as T;
}
const reset = () => call('/api/demo/reset', 'POST', {});
const upload = (productId: string, bytes: Buffer, fileName: string, mimeType: string, role?: string) =>
  inject(`/api/products/${encodeURIComponent(productId)}/assets`, 'POST', { fileName, mimeType, ...(role ? { role } : {}), contentBase64: bytes.toString('base64') });
const list = (productId: string) => call<{ sku: string; assets: ProductAsset[] }>(`/api/products/${encodeURIComponent(productId)}/assets`);

test('assets start empty and a real PNG is stored with metadata, hash and file on disk', async () => {
  await reset();
  assert.deepEqual((await list(sku)).assets, []);
  const response = await upload(sku, PNG, 'front view.png', 'image/png');
  assert.equal(response.statusCode, 200, response.body);
  const { asset, duplicate, assets } = response.json().data as { asset: ProductAsset; duplicate: boolean; assets: ProductAsset[] };
  assert.equal(duplicate, false);
  assert.equal(assets.length, 1);
  assert.equal(asset.kind, 'image');
  assert.equal(asset.mimeType, 'image/png');
  assert.equal(asset.role, 'main');
  assert.equal(asset.parseStatus, 'pending');
  assert.equal(asset.fileName, 'front view.png');
  assert.equal(asset.byteSize, PNG.byteLength);
  assert.equal(asset.sha256, createHash('sha256').update(PNG).digest('hex'));
  const row = await db.productAsset.findUniqueOrThrow({ where: { id: asset.recordId } });
  assert.equal(row.sku, sku);
  assert.ok(row.storageKey.endsWith(`${asset.sha256}.png`));
  assert.ok(existsSync(assetStoragePath(config, row.storageKey)), 'stored file should exist on disk');
});

test('re-uploading identical bytes is idempotent and keeps one row and one file', async () => {
  const again = await upload(sku, PNG, 'renamed.png', 'image/png');
  assert.equal(again.statusCode, 200, again.body);
  const data = again.json().data as { asset: ProductAsset; duplicate: boolean; assets: ProductAsset[] };
  assert.equal(data.duplicate, true);
  assert.equal(data.assets.length, 1);
  assert.equal(data.asset.fileName, 'front view.png');
  assert.equal(await db.productAsset.count({ where: { sku } }), 1);
  assert.equal(readdirSync(join(config.ASSET_STORAGE_DIR, (await db.productAsset.findFirstOrThrow({ where: { sku } })).userId)).length, 1);
});

test('a PDF is accepted and defaults to the specification role', async () => {
  const response = await upload(sku, PDF, 'spec.pdf', 'application/pdf');
  assert.equal(response.statusCode, 200, response.body);
  const { asset, assets } = response.json().data as { asset: ProductAsset; assets: ProductAsset[] };
  assert.equal(asset.kind, 'pdf');
  assert.equal(asset.role, 'spec');
  assert.equal(assets.length, 2);
  assert.deepEqual(assets.map(item => item.role), ['main', 'spec']);
});

test('declared type, unsupported bytes, oversize and the per-SKU cap are all rejected', async () => {
  const mismatch = await upload(sku, PDF, 'fake.png', 'image/png');
  assert.equal(mismatch.statusCode, 400);
  assert.equal(mismatch.json().error.code, 'asset_type_mismatch');
  const unsupported = await upload(sku, Buffer.from('plain text, not an asset'), 'notes.txt', 'image/png');
  assert.equal(unsupported.statusCode, 400);
  assert.equal(unsupported.json().error.code, 'unsupported_asset_type');
  const oversize = await upload(sku, Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(config.ASSET_MAX_BYTES)]), 'huge.png', 'image/png');
  assert.equal(oversize.statusCode, 413);
  assert.equal(oversize.json().error.code, 'asset_too_large');
  const third = await upload(sku, Buffer.concat([PNG.subarray(0, 8), Buffer.from([1, 2, 3, 4])]), 'detail.png', 'image/png');
  assert.equal(third.statusCode, 200, third.body);
  const fourth = await upload(sku, Buffer.concat([PNG.subarray(0, 8), Buffer.from([9, 9, 9, 9])]), 'extra.png', 'image/png');
  assert.equal(fourth.statusCode, 409);
  assert.equal(fourth.json().error.code, 'asset_limit');
  await db.productAsset.deleteMany({ where: { sku, role: 'detail' } });
});

test('content is served back byte-for-byte with its real MIME type', async () => {
  const { assets } = await list(sku);
  const png = assets.find(item => item.kind === 'image')!;
  const response = await inject(`/api/assets/${png.recordId}/content`, 'GET');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/png');
  assert.ok(response.rawPayload.equals(PNG));
  const pdf = assets.find(item => item.kind === 'pdf')!;
  const pdfResponse = await inject(`/api/assets/${pdf.recordId}/content`, 'GET');
  assert.equal(pdfResponse.headers['content-type'], 'application/pdf');
  assert.ok(pdfResponse.rawPayload.equals(PDF));
});

test('assets are owner-scoped for listing, download and delete', async () => {
  const productId = (await db.product.findFirstOrThrow({ where: { sku } })).id;
  const assetId = (await list(sku)).assets[0].recordId;
  const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'asset-other@prismlaunch.local', password: 'Demo123456', displayName: 'Other' } });
  assert.equal(register.statusCode, 201, register.body);
  const otherCookie = String(register.headers['set-cookie']).split(';')[0];
  for (const [url, method] of [[`/api/products/${productId}/assets`, 'GET'], [`/api/assets/${assetId}/content`, 'GET'], [`/api/assets/${assetId}`, 'DELETE']] as const) {
    const response = await app.inject({ url, method, headers: { cookie: otherCookie } });
    assert.equal(response.statusCode, 404, `${method} ${url} should not be visible to another user`);
  }
});

test('the fact snapshot exposes the same assets the Materials page uploaded', async () => {
  const uploaded = (await list(sku)).assets;
  const task = await call<{ recordId: string }>('/api/tasks', 'POST', { code: demoTask.id, platform: demoTask.platform, market: demoTask.market, category: demoTask.category, requirements: demoTask.requirements, minimumProfit: demoTask.minProfit });
  await call(`/api/tasks/${task.recordId}/selection`, 'POST', { productId: sku, purpose: 'fact_review' });
  const snapshot = await call<FactSnapshot>(`/api/tasks/${task.recordId}/products/${sku}/fact-cards/v1`, 'POST', {});
  assert.deepEqual(snapshot.assets.map(item => item.recordId), uploaded.map(item => item.recordId));
  assert.equal(snapshot.assets[0].parseStatus, 'pending');
});

test('deleting an asset removes the row and the file, and a catalog reset prunes leftovers', async () => {
  const { assets } = await list(sku);
  const target = assets.find(item => item.kind === 'pdf')!;
  const row = await db.productAsset.findUniqueOrThrow({ where: { id: target.recordId } });
  const path = assetStoragePath(config, row.storageKey);
  const removed = await call<{ deleted: true; assets: ProductAsset[] }>(`/api/assets/${target.recordId}`, 'DELETE');
  assert.equal(removed.assets.length, assets.length - 1);
  assert.equal(await db.productAsset.count({ where: { id: target.recordId } }), 0);
  assert.equal(existsSync(path), false, 'deleted asset file should be unlinked');
  const remaining = await db.productAsset.findMany({ where: { sku } });
  assert.ok(remaining.length > 0);
  await reset();
  assert.equal(await db.productAsset.count(), 0);
  for (const item of remaining) assert.equal(existsSync(assetStoragePath(config, item.storageKey)), false, 'reset should prune orphaned files');
});
