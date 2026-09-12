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
import { demoTask } from '../../src/data/mockData';
import type { CatalogResponse, ImportBatchDetail, ImportBatchDto, ImportBulkResult, ImportOccurrenceDto, ImportRuleDto } from '../../shared/contracts';

const root = mkdtempSync(join(tmpdir(), 'prismlaunch-merge-'));
const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(root, 'test.db')}`, ASSET_STORAGE_DIR: join(root, 'assets') });
const db = createDb(config.DATABASE_URL);
let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; let calls = 0;
const HERO = 'LM-KT-BTL-001-BLK-500';

before(async () => {
  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  await seedDemo(db);
  app = await buildApp(config, db, { logger: false, transport: async () => { calls++; throw new Error('No network permitted'); } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
});
after(async () => { assert.equal(calls, 0); await app?.close(); await db.$disconnect(); });

async function call<T>(url: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', payload?: Record<string, unknown>): Promise<T> {
  const response = payload === undefined
    ? await app.inject({ url, method, headers: { cookie } })
    : await app.inject({ url, method, headers: { cookie }, payload });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data as T;
}
const catalog = () => call<CatalogResponse>('/api/products');

type Row = { sku: string; name: string; capacity: number; material?: string; color?: string; cost?: number };
const product = (row: Row, index: number) => ({
  sku: row.sku, name: row.name, category: 'Home & Kitchen', color: row.color ?? 'Black',
  capacity: row.capacity, localizedCapacity: `${(row.capacity / 29.5735295625).toFixed(1)} fl oz`,
  material: row.material ?? 'Stainless Steel', straw: false, countryOfOrigin: 'China',
  packagingWeight: 0.38, packagingDimensions: '8 × 8 × 25 cm', packageLength: 8, packageWidth: 8, packageHeight: 25,
  supplierCost: row.cost ?? 8.2, declaredValue: 8.2,
  importSource: { fileName: 'second.xlsx', sheetName: 'Products', row: index + 2 },
  status: 'search_ready' as const, duplicateStatus: 'unique' as const, missing: [], visual: 'bottle' as const,
});
function importPayload(mode: 'replace' | 'append' | 'merge', rows: Row[], revision: number) {
  return {
    mode, expectedRevision: revision, products: rows.map(product),
    report: { fileName: 'second.xlsx', mode, processed: rows.length, ready: rows.length, missing: 0, duplicates: 0, invalid: 0,
      rows: rows.map((row, index) => ({ row: index + 2, sku: row.sku, status: 'ready' as const, issues: [] })) },
  };
}
const pending = (detail: ImportBatchDetail) => detail.occurrences.filter(occurrence => occurrence.resolution === 'pending');
const resolve = (occurrence: ImportOccurrenceDto, action: string, revision: number) =>
  call<ImportBatchDetail>(`/api/imports/occurrences/${occurrence.recordId}/resolve`, 'POST', { action, expectedRevision: revision });

test('merge keeps an identical row as a duplicate reference without touching the catalog', async () => {
  const before = await catalog();
  const result = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('merge', [{ sku: HERO, name: 'Black Stainless Steel Travel Bottle', capacity: 500 }], before.revision));
  assert.equal(result.batch?.mode, 'merge');
  assert.equal(result.batch?.createdProducts, 0);
  assert.equal(result.batch?.counts.same, 1);
  assert.equal(result.batch?.status, 'completed');
  assert.equal(result.revision, before.revision, 'an unchanged import must not bump the catalog revision');
  assert.equal(result.products.length, before.products.length);
});

test('merge reports a conflicting row instead of overwriting the stored product', async () => {
  const before = await catalog();
  const result = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('merge', [{ sku: HERO, name: 'Black Stainless Steel Travel Bottle', capacity: 750 }], before.revision));
  assert.equal(result.batch?.counts.conflict, 1);
  assert.equal(result.batch?.createdProducts, 0);
  assert.equal(result.batch?.status, 'needs_review');
  const stored = result.products.find(item => item.sku === HERO)!;
  assert.equal(stored.capacity, 500, 'the stored product keeps its value until a human decides');
  const detail = await call<ImportBatchDetail>(`/api/imports/${result.batch!.recordId}`);
  const occurrence = pending(detail)[0];
  assert.equal(occurrence.verdict, 'conflict');
  assert.ok(occurrence.conflicts.some(item => item.field === 'capacity' && item.key));
  assert.equal(occurrence.matchedSku, HERO);
});

test('merge creates only genuinely new rows and bumps the catalog revision once', async () => {
  const before = await catalog();
  const result = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('merge', [{ sku: 'NEW-SKU-001', name: 'Navy Camping Bottle 900ml', capacity: 900, color: 'Navy' }], before.revision));
  assert.equal(result.batch?.counts.new, 1);
  assert.equal(result.batch?.createdProducts, 1);
  assert.equal(result.revision, before.revision + 1);
  assert.equal(result.products.find(item => item.sku === 'NEW-SKU-001')?.name, 'Navy Camping Bottle 900ml');
});

test('merge treats identical data under a different code as grey zone, not a new product', async () => {
  const before = await catalog();
  const result = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('merge', [{ sku: 'RENAMED-001', name: 'Stainless Steel Travel Bottle', capacity: 500 }], before.revision));
  assert.equal(result.batch?.counts.probable, 1);
  assert.equal(result.batch?.createdProducts, 0);
  assert.equal(result.products.some(item => item.sku === 'RENAMED-001'), false);
});

test('a human can keep the stored value, adopt the incoming one, or create a separate product', async () => {
  const before = await catalog();
  const imported = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('merge', [
    { sku: HERO, name: 'Black Stainless Steel Travel Bottle', capacity: 750 },
    { sku: 'RENAMED-001', name: 'Stainless Steel Travel Bottle', capacity: 500 },
  ], before.revision));
  const detail = await call<ImportBatchDetail>(`/api/imports/${imported.batch!.recordId}`);
  const occurrences = pending(detail);
  assert.equal(occurrences.length, 2, 'one conflict and one grey-zone row are waiting');

  const conflict = occurrences.find(occurrence => occurrence.verdict === 'conflict')!;
  const adopted = await resolve(conflict, 'use_incoming', (await catalog()).revision);
  assert.equal(pending(adopted).length, 1);
  const afterAdopt = await catalog();
  assert.equal(afterAdopt.products.find(item => item.sku === HERO)?.capacity, 750, 'adopting the incoming value updates the product');

  const grey = pending(adopted)[0];
  const kept = await resolve(grey, 'keep_existing', afterAdopt.revision);
  assert.equal(pending(kept).length, 0);
  assert.equal(kept.batch.status, 'completed');
  assert.equal((await catalog()).products.some(item => item.sku === 'RENAMED-001'), false, 'keeping the stored value never creates the other code');
});

test('resolving a row twice is rejected and another user cannot touch it', async () => {
  const before = await catalog();
  const imported = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('merge', [{ sku: 'SEPARATE-001', name: 'Stainless Steel Travel Bottle', capacity: 500 }], before.revision));
  const detail = await call<ImportBatchDetail>(`/api/imports/${imported.batch!.recordId}`);
  const occurrence = pending(detail)[0];
  const created = await resolve(occurrence, 'separate', imported.revision);
  assert.equal(pending(created).length, 0);
  assert.ok((await catalog()).products.some(item => item.sku === 'SEPARATE-001'), 'separate creates the product under its own code');

  const again = await app.inject({ url: `/api/imports/occurrences/${occurrence.recordId}/resolve`, method: 'POST', headers: { cookie }, payload: { action: 'skipped', expectedRevision: (await catalog()).revision } });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'already_resolved');

  const other = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'merge-other@prismlaunch.local', password: 'Demo123456', displayName: 'Other' } });
  const otherCookie = String(other.headers['set-cookie']).split(';')[0];
  const foreign = await app.inject({ url: `/api/imports/${imported.batch!.recordId}`, method: 'GET', headers: { cookie: otherCookie } });
  assert.equal(foreign.statusCode, 404);
});

test('replace and append still record a batch, so every import stays traceable', async () => {
  const before = await catalog();
  const appended = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('append', [{ sku: 'APPEND-001', name: 'Ivory Commuter Bottle 480ml', capacity: 480, color: 'Ivory' }], before.revision));
  assert.equal(appended.batch?.mode, 'append');
  assert.equal(appended.batch?.counts.new, 1);
  assert.equal(appended.batch?.createdProducts, 1);
  const batches = await call<ImportBatchDto[]>('/api/imports');
  assert.ok(batches.length >= 4);
  assert.ok(batches[0].createdAt >= batches[batches.length - 1].createdAt);
});

test('tasks still survive an untouched merge but a replace clears them', async () => {
  await call('/api/tasks', 'POST', { code: demoTask.id, platform: demoTask.platform, market: demoTask.market, category: demoTask.category, requirements: demoTask.requirements, minimumProfit: demoTask.minProfit });
  const before = await catalog();
  // Echo the stored product back, whatever earlier tests left it as, so this row must classify as `same`.
  const stored = before.products.find(item => item.sku === HERO)!;
  const merge = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('merge', [{ sku: HERO, name: stored.name, capacity: stored.capacity, color: stored.color, material: stored.material, cost: stored.supplierCost }], before.revision));
  assert.equal(merge.batch?.counts.same, 1);
  assert.ok((await call<{ length: number } & unknown[]>('/api/tasks')).length >= 1, 'merge must not clear tasks');
  const replaced = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('replace', [{ sku: 'ONLY-001', name: 'Only Product', capacity: 500 }], merge.revision));
  assert.equal(replaced.products.length, 1);
  assert.equal((await call<unknown[]>('/api/tasks')).length, 0);
});

test('a bulk decision resolves a whole class of rows and can be remembered as a rule', async () => {
  // Rebuild a batch holding several capacity conflicts plus one unrelated grey-zone row.
  const before = await catalog();
  const rows = [
    { sku: HERO, name: 'Black Stainless Steel Travel Bottle', capacity: 640 },
    { sku: 'BULK-001', name: 'Bulk Supplier Travel Flask', capacity: 500 },
  ];
  await call('/api/products/import', 'POST', importPayload('replace', rows, before.revision));
  const revision = (await catalog()).revision;
  const imported = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('merge', [
    { sku: HERO, name: 'Black Stainless Steel Travel Bottle', capacity: 999 },
    { sku: 'BULK-002', name: 'Stainless Steel Travel Bottle', capacity: 500 },
  ], revision));
  const detail = await call<ImportBatchDetail>(`/api/imports/${imported.batch!.recordId}`);
  assert.equal(pending(detail).length, 2);

  const bulk = await call<ImportBulkResult>(`/api/imports/${imported.batch!.recordId}/resolve-bulk`, 'POST', {
    action: 'keep_existing', verdict: 'conflict', remember: true, expectedRevision: imported.revision,
  });
  assert.equal(bulk.applied, 1, 'only the conflicting row matches the filter');
  assert.equal(pending(bulk.batch).length, 1, 'the grey-zone row still waits for a human');
  assert.equal(bulk.batch.batch.status, 'needs_review');

  const rules = await call<ImportRuleDto[]>('/api/imports/rules');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].verdict, 'conflict');
  assert.equal(rules[0].field, '*');
  assert.equal(rules[0].appliedCount, 1);

  const cleared = await call<ImportRuleDto[]>(`/api/imports/rules/${rules[0].recordId}`, 'DELETE');
  assert.deepEqual(cleared, []);
});

test('one product written twice inside one file is held, so the file creates it once', async () => {
  const before = await catalog();
  // Different codes and different wording, identical facts: one product, written twice in one file.
  const imported = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('merge', [
    { sku: 'TWIN-001', name: 'Ceramic Travel Bottle 320ml', capacity: 320, material: 'Ceramic' },
    { sku: 'TWIN-002', name: 'Ceramic Travel Bottle', capacity: 320, material: 'Ceramic' },
  ], before.revision));
  assert.equal(imported.batch?.counts.new, 1);
  assert.equal(imported.batch?.counts.probable, 1);
  assert.equal(imported.batch?.createdProducts, 1);
  assert.ok(imported.products.some(item => item.sku === 'TWIN-001'), 'the first row is kept');
  assert.equal(imported.products.some(item => item.sku === 'TWIN-002'), false, 'the second row is held');

  const detail = await call<ImportBatchDetail>(`/api/imports/${imported.batch!.recordId}`);
  const held = detail.occurrences.find(occurrence => occurrence.verdict === 'probable')!;
  assert.equal(held.sku, 'TWIN-002');
  assert.equal(held.matchedSku, 'TWIN-001', 'the batch points at the row it duplicates');
  assert.equal(held.matchedProductId, null, 'nothing is stored for the held row yet');

  const resolved = await resolve(held, 'skipped', imported.revision);
  assert.equal(resolved.batch.status, 'completed', 'skipping the duplicate closes the batch');
  const after = await catalog();
  assert.ok(after.products.some(item => item.sku === 'TWIN-001'));
  assert.equal(after.products.some(item => item.sku === 'TWIN-002'), false);
});

test('a bulk decision can be limited to one field and skips rows it cannot apply to', async () => {
  const before = await catalog();
  const stored = before.products.find(item => item.sku === HERO)!;
  const imported = await call<CatalogResponse>('/api/products/import', 'POST', importPayload('merge', [
    { sku: HERO, name: stored.name, capacity: stored.capacity + 100, cost: 12.5 },
  ], before.revision));
  const detail = await call<ImportBatchDetail>(`/api/imports/${imported.batch!.recordId}`);
  const occurrence = detail.occurrences[0];
  assert.ok(occurrence.conflicts.some(item => item.field === 'capacity') && occurrence.conflicts.some(item => item.field === 'supplierCost'));

  const byField = await call<ImportBulkResult>(`/api/imports/${imported.batch!.recordId}/resolve-bulk`, 'POST', {
    action: 'use_incoming', field: 'supplierCost', expectedRevision: imported.revision,
  });
  assert.equal(byField.applied, 1);
  const afterField = await catalog();
  // The filter also narrows what is adopted: only the chosen field moves.
  assert.equal(afterField.products.find(item => item.sku === HERO)?.capacity, stored.capacity, 'the unselected capacity conflict is left alone');
  assert.equal(afterField.products.find(item => item.sku === HERO)?.supplierCost, 12.5);
});

test('the uploaded spreadsheet is stored with the batch and can be downloaded again', async () => {
  const csv = Buffer.from('sku,productName,category,color,capacityMl,material,hasStraw,countryOfOrigin,supplierCost,declaredValue,packagingWeightKg,packageLengthCm,packageWidthCm,packageHeightCm\nSRC-001,Source Bottle,Home & Kitchen,Black,900,Stainless Steel,false,China,5.50,5.50,0.30,7,7,24\n', 'utf8');
  const before = await catalog();
  const payload = importPayload('merge', [{ sku: 'SRC-001', name: 'Source Bottle', capacity: 900 }], before.revision);
  payload.report.fileName = 'source.csv'; // the batch name and the stored file name are the same file
  const result = await call<CatalogResponse>('/api/products/import', 'POST', {
    ...payload, sourceFile: { fileName: 'source.csv', mimeType: 'text/csv', contentBase64: csv.toString('base64') },
  });
  assert.equal(result.batch?.source?.byteSize, csv.byteLength);
  assert.equal(result.batch?.source?.mimeType, 'text/csv');
  const download = await app.inject({ url: `/api/imports/${result.batch!.recordId}/source`, method: 'GET', headers: { cookie } });
  assert.equal(download.statusCode, 200);
  assert.ok(download.rawPayload.equals(csv), 'the stored spreadsheet comes back byte for byte');
  const batches = await call<ImportBatchDto[]>('/api/imports');
  assert.equal(batches[0].source?.fileName, 'source.csv');
});
