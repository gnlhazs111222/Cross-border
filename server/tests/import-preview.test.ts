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
import type { CatalogResponse, ImportVerdict } from '../../shared/contracts';
import type { ImportPreviewResult } from '../services/imports';

const root = mkdtempSync(join(tmpdir(), 'prismlaunch-preview-'));
const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(root, 'test.db')}`, ASSET_STORAGE_DIR: join(root, 'assets') });
const db = createDb(config.DATABASE_URL);
let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
const HERO = 'LM-KT-BTL-001-BLK-500';

before(async () => {
  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  await seedDemo(db);
  app = await buildApp(config, db, { logger: false, transport: async () => { throw new Error('No network permitted'); } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismalunch.local'.replace('prismalunch', 'prismlaunch'), password: 'Demo123456' } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
});
after(async () => { await app?.close(); await db.$disconnect(); });

const product = (sku: string, name: string, capacity: number) => ({
  sku, name, category: 'Home & Kitchen', color: 'Black', capacity, localizedCapacity: `${(capacity / 29.5735295625).toFixed(1)} fl oz`,
  material: 'Stainless Steel', straw: false, countryOfOrigin: 'China', packagingWeight: 0.38, packagingDimensions: '8 × 8 × 25 cm',
  packageLength: 8, packageWidth: 8, packageHeight: 25, supplierCost: 8.2, declaredValue: 8.2,
  importSource: { fileName: 'preview.xlsx', sheetName: 'Products', row: 2 }, status: 'search_ready' as const, duplicateStatus: 'unique' as const, missing: [], visual: 'bottle' as const,
});
const payload = (skus: { sku: string; name: string; capacity: number }[], revision: number) => ({
  mode: 'append', expectedRevision: revision, products: skus.map(row => product(row.sku, row.name, row.capacity)),
  report: { fileName: 'preview.xlsx', mode: 'append', processed: skus.length, ready: skus.length, missing: 0, duplicates: 0, invalid: 0,
    rows: skus.map((row, index) => ({ row: index + 2, sku: row.sku, status: 'ready' as const, issues: [] })) },
});
async function post<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await app.inject({ url, method: 'POST', headers: { cookie }, payload: body });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data as T;
}

test('the preview classifies every row without changing the catalog', async () => {
  const before = await app.inject({ url: '/api/products', method: 'GET', headers: { cookie } }).then(response => response.json().data as CatalogResponse);
  const preview = await post<ImportPreviewResult>('/api/products/import/preview', payload([
    { sku: HERO, name: 'Black Stainless Steel Travel Bottle', capacity: 750 },   // same code, other capacity
    { sku: 'PREVIEW-NEW-1', name: 'Navy Camping Bottle 900ml', capacity: 900 },   // new
    { sku: 'PREVIEW-RENAMED', name: 'Stainless Steel Travel Bottle', capacity: 500 }, // identical data, new code
  ], before.revision));
  const verdicts = preview.rows.map(row => row.verdict) as ImportVerdict[];
  assert.deepEqual(verdicts, ['conflict', 'new', 'probable']);
  assert.equal(preview.rows[0].matchedSku, HERO);
  assert.ok(preview.rows[0].conflicts.some(conflict => conflict.field === 'capacity' && conflict.key));
  assert.equal(preview.counts.conflict, 1);
  assert.equal(preview.counts.new, 1);
  assert.equal(preview.counts.probable, 1);

  const after = await app.inject({ url: '/api/products', method: 'GET', headers: { cookie } }).then(response => response.json().data as CatalogResponse);
  assert.equal(after.revision, before.revision, 'a preview must not bump the catalog revision');
  assert.equal(after.products.length, before.products.length, 'a preview must not create products');
  assert.equal(await db.importBatch.count(), 0, 'a preview must not leave a batch behind');
});

test('a replacement preview reports every row as new because the pool is about to be cleared', async () => {
  const before = await app.inject({ url: '/api/products', method: 'GET', headers: { cookie } }).then(response => response.json().data as CatalogResponse);
  const preview = await post<ImportPreviewResult>('/api/products/import/preview', { ...payload([{ sku: HERO, name: 'Black Stainless Steel Travel Bottle', capacity: 500 }], before.revision), mode: 'replace' });
  assert.deepEqual(preview.rows.map(row => row.verdict), ['new']);
});
