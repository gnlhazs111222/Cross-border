import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../config';
import { createDb } from '../db';
import { seedDemo } from '../seed';
import { seedProducts } from '../services/catalog';
import { alignmentRecordsFromCatalog, imageHashCounts } from '../services/alignment';
import { compareRecords } from '../../shared/alignment';

const config = readConfig({ NODE_ENV: 'test', DATABASE_URL: `file:${join(mkdtempSync(join(tmpdir(), 'prismlaunch-align-')), 'test.db')}` });
const db = createDb(config.DATABASE_URL);
const HASH_A = 'a'.repeat(64);
const HERO = 'LM-KT-BTL-001-BLK-500';
const STRAW = 'LM-KT-BTL-002-BLK-500';
const LARGE = 'LM-KT-BTL-003-BLK-750';
let userId = '';

before(async () => {
  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL }, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  await seedDemo(db);
  userId = (await db.user.findUniqueOrThrow({ where: { email: 'demo@prismlaunch.local' } })).id;
});
after(async () => { await db.$disconnect(); });

async function attachImage(sku: string, sha256: string, owner = userId, kind = 'image') {
  const product = await db.product.findFirstOrThrow({ where: { userId: owner, sku } });
  await db.productAsset.create({ data: { userId: owner, productId: product.id, sku, kind, role: kind === 'image' ? 'main' : 'spec',
    fileName: `${sku}.png`, mimeType: kind === 'image' ? 'image/png' : 'application/pdf', byteSize: 128, sha256, storageKey: `${owner}/${sha256}.png` } });
}

test('the catalog produces one alignment record per product with no image evidence by default', async () => {
  const records = await alignmentRecordsFromCatalog(db, userId);
  assert.equal(records.length, 10);
  assert.ok(records.every(record => record.sourceId === 'catalog'));
  assert.ok(records.every(record => record.imageHashes?.length === 0));
  assert.ok(records.some(record => record.sku === HERO));
  assert.deepEqual(await imageHashCounts(db, userId), []);
});

test('the same image bytes on two different SKUs become a confirmed match', async () => {
  await attachImage(HERO, HASH_A);
  await attachImage(STRAW, HASH_A);
  const records = await alignmentRecordsFromCatalog(db, userId);
  const hero = records.find(record => record.sku === HERO)!;
  const straw = records.find(record => record.sku === STRAW)!;
  assert.deepEqual(hero.imageHashes, [HASH_A]);
  const result = compareRecords(hero, straw);
  assert.equal(result.verdict, 'same');
  assert.ok(result.evidence.some(item => item.kind === 'image_hash' && item.verdict === 'agree'));
  const counts = await imageHashCounts(db, userId);
  assert.deepEqual(counts.map(entry => [entry.sku, entry.images]).sort(), [[HERO, 1], [STRAW, 1]].sort());
});

test('shared image evidence plus a conflicting capacity is reported as a conflict', async () => {
  await attachImage(LARGE, HASH_A);
  const records = await alignmentRecordsFromCatalog(db, userId);
  const result = compareRecords(records.find(record => record.sku === HERO)!, records.find(record => record.sku === LARGE)!);
  assert.equal(result.verdict, 'conflict');
  assert.ok(result.differences.some(item => item.field === 'capacity' && item.key));
});

test('a specification PDF is not treated as image identity evidence', async () => {
  await attachImage(LARGE, 'b'.repeat(64), userId, 'pdf');
  const records = await alignmentRecordsFromCatalog(db, userId);
  assert.deepEqual(records.find(record => record.sku === LARGE)!.imageHashes, [HASH_A]);
  assert.ok(!(await imageHashCounts(db, userId)).some(entry => entry.hashes.includes('b'.repeat(64))));
});

test('assets from another user never leak into the alignment records', async () => {
  const other = await db.user.create({ data: { email: 'align-other@prismlaunch.local', displayName: 'Other', passwordHash: 'x' } });
  await seedProducts(db, other.id);
  await attachImage(HERO, 'c'.repeat(64), other.id);
  const records = await alignmentRecordsFromCatalog(db, userId);
  assert.deepEqual(records.find(record => record.sku === HERO)!.imageHashes, [HASH_A]);
  assert.ok(!(await imageHashCounts(db, userId)).some(entry => entry.hashes.includes('c'.repeat(64))));
});
