import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';
import { buildProfile, compareProfiles, recordFromProduct, type AlignableRecord, type FieldDifference, type MatchVerdict, type RecordProfile } from '../../shared/alignment';
import type { ImportBatchDetail, ImportBatchDto, ImportBulkResult, ImportOccurrenceDto, ImportResolution, ImportRuleDto, ImportVerdict } from '../../shared/contracts';
import type { Product } from '../../src/types';
import { AppError } from '../errors';
import { assetStoragePath, decodeAssetBase64 } from './assets';
import { storeProductAsset } from './assets';
import { downloadAssetUrls } from './asset-urls';
import type { ServerConfig } from '../config';
import type { importSchema } from '../validation';
import { catalog, normalizeImportedProduct, toProduct } from './catalog';

type DB = Prisma.TransactionClient;
type ImportInput = z.infer<typeof importSchema>;

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? null));
const emptyCounts = (): Record<ImportVerdict, number> => ({ new: 0, same: 0, conflict: 0, probable: 0, duplicate: 0, invalid: 0 });
const RANK: Record<MatchVerdict, number> = { same: 3, conflict: 2, probable: 1, distinct: 0 };

const toBatchDto = (row: { id: string; fileName: string; mode: string; status: string; rowCount: number; createdProducts: number; counts: Prisma.JsonValue; createdAt: Date; sourceKey: string | null; sourceHash: string | null; sourceBytes: number | null; sourceMime: string | null; urlResults: Prisma.JsonValue }): ImportBatchDto => ({
  recordId: row.id, fileName: row.fileName, mode: row.mode, status: row.status, rowCount: row.rowCount,
  createdProducts: row.createdProducts, counts: { ...emptyCounts(), ...(row.counts as Record<string, number>) }, createdAt: row.createdAt.toISOString(),
  source: row.sourceKey && row.sourceHash && row.sourceBytes && row.sourceMime ? { fileName: row.fileName, byteSize: row.sourceBytes, sha256: row.sourceHash, mimeType: row.sourceMime } : null,
  urlDownloads: (row.urlResults as unknown as ImportBatchDto['urlDownloads']) ?? null,
});

const SOURCE_EXTENSIONS: Record<string, string> = { 'text/csv': 'csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/octet-stream': 'bin' };

const toOccurrenceDto = (row: { id: string; rowNumber: number; sku: string; name: string; verdict: string; resolution: string; matchedProductId: string | null; matchedSku: string | null; conflicts: Prisma.JsonValue; payload: Prisma.JsonValue }): ImportOccurrenceDto => ({
  recordId: row.id, rowNumber: row.rowNumber, sku: row.sku, name: row.name, verdict: row.verdict as ImportVerdict,
  resolution: row.resolution as ImportResolution, matchedProductId: row.matchedProductId, matchedSku: row.matchedSku,
  conflicts: (row.conflicts as unknown as FieldDifference[] | null) ?? [], payload: (row.payload as unknown as Record<string, unknown>) ?? {},
  missing: ((row.payload as unknown as { missing?: string[] })?.missing ?? []).filter(Boolean),
});

type CatalogEntry = { id: string; sku: string; profile: RecordProfile };

/** The pool plus the sha256 of every uploaded image, so identity can use content evidence. */
async function catalogEntries(tx: DB, userId: string): Promise<CatalogEntry[]> {
  const [rows, assets] = await Promise.all([
    tx.product.findMany({ where: { userId } }),
    tx.productAsset.findMany({ where: { userId, kind: 'image' }, select: { productId: true, sha256: true } }),
  ]);
  const hashes = new Map<string, string[]>();
  for (const asset of assets) {
    const list = hashes.get(asset.productId);
    if (list) list.push(asset.sha256); else hashes.set(asset.productId, [asset.sha256]);
  }
  return rows.map(row => {
    const product = toProduct(row);
    const record: AlignableRecord = { ...recordFromProduct(product, 'catalog'), imageHashes: hashes.get(row.id) ?? [] };
    return { id: row.id, sku: product.sku, profile: buildProfile(record) };
  });
}

/** Best relation between one incoming row and the pool. `new` is the only verdict that creates a product. */
function classify(incoming: RecordProfile, entries: CatalogEntry[]): { verdict: ImportVerdict; matched?: CatalogEntry; conflicts: FieldDifference[] } {
  let best: { entry: CatalogEntry; verdict: Exclude<MatchVerdict, 'distinct'>; score: number; conflicts: FieldDifference[] } | undefined;
  for (const entry of entries) {
    const result = compareProfiles(incoming, entry.profile);
    if (result.verdict === 'distinct') continue;
    if (!best || result.score > best.score || (result.score === best.score && RANK[result.verdict] > RANK[best.verdict])) {
      best = { entry, verdict: result.verdict, score: result.score, conflicts: result.differences };
    }
  }
  if (!best) return { verdict: 'new', conflicts: [] };
  return { verdict: best.verdict, matched: best.entry, conflicts: best.conflicts };
}

async function nextPosition(tx: DB, userId: string): Promise<number> {
  const highest = await tx.product.findFirst({ where: { userId }, orderBy: { position: 'desc' }, select: { position: true } });
  return (highest?.position ?? -1) + 1;
}

/**
 * All three import modes in one place so every import leaves a traceable batch:
 * - replace: a fresh dataset, every accepted row is new
 * - append: adds unknown SKUs only, existing SKUs are recorded as duplicates
 * - merge: aligns each row against the pool; only `new` rows are created, conflicts and grey-zone
 *   rows stay pending for a human instead of silently overwriting or duplicating a product
 */
export async function importWithAlignment(db: PrismaClient, config: ServerConfig, userId: string, input: ImportInput) {
  return db.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (input.expectedRevision !== user.catalogRevision) throw new AppError('catalog_changed', 'The dataset changed. Reload and preview the file again.', 409);

    const existing = await tx.product.findMany({ where: { userId }, select: { sku: true } });
    const existingSkus = new Set(existing.map(row => row.sku));
    // Alignment is not a mode: every import except a full replacement is compared with the pool.
    void existingSkus;
    const entries = input.mode === 'replace' ? [] : await catalogEntries(tx, userId);
    const accepted: Product[] = [];
    const decisions = new Map<string, { verdict: ImportVerdict; matched?: CatalogEntry; conflicts: FieldDifference[] }>();

    for (const row of input.products) {
      const prepared = normalizeImportedProduct(row as Product);
      if (input.mode === 'replace') { decisions.set(row.sku, { verdict: 'new', conflicts: [] }); accepted.push(prepared); continue; }
      const decision = classify(buildProfile(recordFromProduct(row as Product, 'incoming')), entries);
      decisions.set(row.sku, decision);
      if (decision.verdict === 'new') accepted.push(prepared);
    }

    if (input.mode === 'replace') {
      await tx.launchTask.deleteMany({ where: { userId } });
      await tx.product.deleteMany({ where: { userId } });
    }
    const base = input.mode === 'replace' ? 0 : existing.length;
    if (base + accepted.length > 500) throw new AppError('catalog_limit', 'Keep the dataset within 500 products.');
    if (accepted.length) await tx.product.createMany({ data: accepted.map((product, index) => ({ userId, sku: product.sku, name: product.name, category: product.category, position: base + index, data: json(product) })) });
    if (accepted.length) await tx.user.update({ where: { id: userId }, data: { catalogRevision: { increment: 1 } } });

    const counts = emptyCounts();
    const payloadBySku = new Map(input.products.map(product => [product.sku, product as unknown as Record<string, unknown>]));
    const occurrences = input.report.rows.map(row => {
      const decision = decisions.get(row.sku);
      const verdict: ImportVerdict = row.status === 'invalid' ? 'invalid' : row.status === 'duplicate' ? 'duplicate' : decision?.verdict ?? 'new';
      counts[verdict]++;
      return {
        userId, rowNumber: row.row, sku: row.sku, name: String(payloadBySku.get(row.sku)?.name ?? ''), verdict,
        matchedProductId: decision?.matched?.id ?? null, matchedSku: decision?.matched?.sku ?? null,
        conflicts: decision?.conflicts?.length ? json(decision.conflicts) : undefined,
        payload: json(payloadBySku.get(row.sku) ?? { sku: row.sku, row: row.row, status: row.status, issues: row.issues }),
      };
    });

    // Keep the uploaded spreadsheet so the parsed rows can always be checked against the original.
    let source: { sourceKey: string; sourceHash: string; sourceBytes: number; sourceMime: string } | undefined;
    if (input.sourceFile) {
      const bytes = decodeAssetBase64(input.sourceFile.contentBase64);
      if (bytes.byteLength > config.ASSET_MAX_BYTES) throw new AppError('asset_too_large', 'The supplier file is larger than the stored-source limit.', 413);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const extension = SOURCE_EXTENSIONS[input.sourceFile.mimeType] ?? 'bin';
      const sourceKey = `${userId}/import-${sha256}.${extension}`;
      const target = assetStoragePath(config, sourceKey);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { mode: 0o600 });
      source = { sourceKey, sourceHash: sha256, sourceBytes: bytes.byteLength, sourceMime: input.sourceFile.mimeType };
    }

    // Link columns are downloaded now, so the same evidence pipeline works for scraped sheets.
    const urlResults: { downloaded: number; failed: number; failures: { url: string; reason: string }[] } = { downloaded: 0, failed: 0, failures: [] };
    for (const product of accepted) {
      if (!product.assetUrls?.length) continue;
      const row = await tx.product.findFirst({ where: { userId, sku: product.sku } });
      if (!row) continue;
      for (const download of await downloadAssetUrls(config, product.assetUrls)) {
        if (!download.ok) { urlResults.failed++; urlResults.failures.push({ url: download.url, reason: download.reason }); continue; }
        try {
          await storeProductAsset(tx, config, userId, row.id, { fileName: download.fileName, mimeType: download.mimeType, contentBase64: download.bytes.toString('base64') });
          urlResults.downloaded++;
        } catch (error) { urlResults.failed++; urlResults.failures.push({ url: download.url, reason: error instanceof AppError ? error.code : 'store_failed' }); }
      }
    }

    const batch = await tx.importBatch.create({
      data: { userId, fileName: input.report.fileName, mode: input.mode, rowCount: input.report.rows.length, createdProducts: accepted.length,
        status: counts.conflict + counts.probable > 0 ? 'needs_review' : 'completed', counts: json(counts), report: json(input.report),
        ...source,
        urlResults: json(urlResults),
        occurrences: { create: occurrences } },
    });

    const data = await catalog(tx, userId);
    return { ...data, report: input.report, batch: toBatchDto(batch) };
  }, { timeout: 20000 });
}

export type ImportPreviewRow = { row: number; sku: string; name: string; verdict: ImportVerdict; matchedSku: string | null; conflicts: FieldDifference[] };
export type ImportPreviewResult = { rows: ImportPreviewRow[]; counts: Record<ImportVerdict, number> };

/**
 * Runs the same classification the import would run, without writing anything, so the dialog can
 * show "this row will conflict with SKU X" before the operator commits the file.
 */
export async function previewImportAlignment(db: PrismaClient, userId: string, input: ImportInput): Promise<ImportPreviewResult> {
  const counts = emptyCounts();
  const rows: ImportPreviewRow[] = [];
  const entries = input.mode === 'replace' ? [] : await catalogEntries(db, userId);
  const bySku = new Map(input.products.map(product => [product.sku, product as unknown as Product]));
  for (const row of input.report.rows) {
    const payload = bySku.get(row.sku);
    const decision = payload && input.mode !== 'replace' ? classify(buildProfile(recordFromProduct(payload, 'incoming')), entries) : null;
    const verdict: ImportVerdict = row.status === 'invalid' ? 'invalid' : row.status === 'duplicate' ? 'duplicate' : decision?.verdict ?? 'new';
    counts[verdict]++;
    rows.push({ row: row.row, sku: row.sku, name: String(payload?.name ?? ''), verdict, matchedSku: decision?.matched?.sku ?? null, conflicts: decision?.conflicts ?? [] });
  }
  return { rows, counts };
}

export async function listImportBatches(db: PrismaClient, userId: string, limit = 20): Promise<ImportBatchDto[]> {
  const rows = await db.importBatch.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 100) });
  return rows.map(toBatchDto);
}

async function batchDetail(reader: DB, userId: string, batchId: string): Promise<ImportBatchDetail> {
  const batch = await reader.importBatch.findFirst({ where: { id: batchId, userId } });
  if (!batch) throw new AppError('not_found', 'Import batch not found.', 404);
  const occurrences = await reader.importOccurrence.findMany({ where: { batchId: batch.id, userId }, orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }] });
  const mapped = occurrences.map(toOccurrenceDto);
  const gapCounts = new Map<string, number>();
  for (const occurrence of mapped) for (const field of occurrence.missing) gapCounts.set(field, (gapCounts.get(field) ?? 0) + 1);
  const gaps = [...gapCounts.entries()].map(([field, rows]) => ({ field, rows })).sort((left, right) => right.rows - left.rows);
  return { batch: toBatchDto(batch), occurrences: mapped, gaps };
}

export const importBatchDetail = (db: PrismaClient, userId: string, batchId: string): Promise<ImportBatchDetail> => batchDetail(db, userId, batchId);

const INCOMING_FIELDS = ['name', 'category', 'color', 'capacity', 'material', 'straw', 'countryOfOrigin', 'supplierCost', 'declaredValue', 'packagingWeight', 'packageLength', 'packageWidth', 'packageHeight', 'visual'] as const;
/** Conflict field names are not always product field names; dimensions expand to the three columns. */
const CONFLICT_TO_PRODUCT_FIELDS: Record<string, string[]> = {
  capacity: ['capacity'], color: ['color'], material: ['material'], category: ['category'], straw: ['straw'],
  countryOfOrigin: ['countryOfOrigin'], supplierCost: ['supplierCost'], packagingWeight: ['packagingWeight'],
  dimensions: ['packageLength', 'packageWidth', 'packageHeight'],
};

/** The existing SKU always wins during a merge; only the data fields can be taken from the incoming row. */
function mergePayload(existing: Product, incoming: Record<string, unknown>, only?: string[]): Product {
  const allowed = only ? new Set(only.flatMap(field => CONFLICT_TO_PRODUCT_FIELDS[field] ?? [field])) : undefined;
  const merged: Product = { ...existing };
  for (const field of INCOMING_FIELDS) {
    if (allowed && !allowed.has(field)) continue;
    const value = incoming[field];
    if (value === undefined || value === null || value === '') continue;
    (merged as unknown as Record<string, unknown>)[field] = value;
  }
  return normalizeImportedProduct(merged);
}

export type ResolveAction = Exclude<ImportResolution, 'pending'>;

const toRuleDto = (row: { id: string; verdict: string; field: string; action: string; appliedCount: number; createdAt: Date }): ImportRuleDto =>
  ({ recordId: row.id, verdict: row.verdict, field: row.field, action: row.action as ImportResolution, appliedCount: row.appliedCount, createdAt: row.createdAt.toISOString() });

/** Applies one decision to a single occurrence. Returns the product it affected, if any. */
async function applyResolution(tx: DB, userId: string, occurrence: { id: string; matchedProductId: string | null; payload: Prisma.JsonValue; sku: string }, action: ResolveAction, only?: string[]): Promise<{ resolvedProductId: string | null; catalogChanged: boolean }> {
  const payload = occurrence.payload as unknown as Product;
  let resolvedProductId: string | null = occurrence.matchedProductId;
  let catalogChanged = false;
  if (action === 'use_incoming') {
    if (!occurrence.matchedProductId) throw new AppError('no_match', 'This row has no matched product to update.', 409);
    const target = await tx.product.findFirst({ where: { id: occurrence.matchedProductId, userId } });
    if (!target) throw new AppError('not_found', 'The matched product no longer exists.', 404);
    const merged = mergePayload(toProduct(target), payload as unknown as Record<string, unknown>, only);
    await tx.product.update({ where: { id: target.id }, data: { name: merged.name, category: merged.category, data: json(merged), revision: { increment: 1 } } });
    resolvedProductId = target.id; catalogChanged = true;
  } else if (action === 'separate') {
    const sku = String(payload.sku ?? occurrence.sku);
    if (!sku) throw new AppError('invalid_payload', 'This row has no SKU to create a product from.', 409);
    if (await tx.product.findFirst({ where: { userId, sku } })) throw new AppError('duplicate_sku', 'A product with this SKU already exists.', 409);
    const created = await tx.product.create({ data: { userId, sku, name: payload.name, category: payload.category, position: await nextPosition(tx, userId), data: json(normalizeImportedProduct(payload)) } });
    resolvedProductId = created.id; catalogChanged = true;
  }
  await tx.importOccurrence.update({ where: { id: occurrence.id }, data: { resolution: action, resolvedProductId, resolvedAt: new Date() } });
  return { resolvedProductId, catalogChanged };
}

export async function resolveImportOccurrence(db: PrismaClient, userId: string, occurrenceId: string, action: ResolveAction, expectedRevision: number): Promise<ImportBatchDetail> {
  return db.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.catalogRevision !== expectedRevision) throw new AppError('catalog_changed', 'The dataset changed. Reload before resolving.', 409);
    const occurrence = await tx.importOccurrence.findFirst({ where: { id: occurrenceId, userId } });
    if (!occurrence) throw new AppError('not_found', 'Import row not found.', 404);
    if (occurrence.resolution !== 'pending') throw new AppError('already_resolved', 'This row has already been resolved.', 409);
    const { catalogChanged } = await applyResolution(tx, userId, occurrence, action);
    if (catalogChanged) await tx.user.update({ where: { id: userId }, data: { catalogRevision: { increment: 1 } } });
    const pending = await tx.importOccurrence.count({ where: { batchId: occurrence.batchId, resolution: 'pending', verdict: { in: ['conflict', 'probable'] } } });
    await tx.importBatch.update({ where: { id: occurrence.batchId }, data: { status: pending ? 'needs_review' : 'completed' } });
    return batchDetail(tx, userId, occurrence.batchId);
  }, { timeout: 20000 });
}

export type BulkResolutionInput = { action: ResolveAction; verdict?: 'conflict' | 'probable'; field?: string; remember?: boolean };

/**
 * Applies one decision to every pending row of a batch that matches the filter.
 *
 * This is the bulk half of "layered conflict handling": the layer decides what needs a human, the
 * human still decides, but one click covers a whole class of identical conflicts. `remember` stores
 * the choice as a rule for later batches — it never auto-applies anything by itself.
 */
export async function resolveImportOccurrencesBulk(db: PrismaClient, userId: string, batchId: string, input: BulkResolutionInput, expectedRevision: number): Promise<ImportBulkResult> {
  return db.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.catalogRevision !== expectedRevision) throw new AppError('catalog_changed', 'The dataset changed. Reload before resolving.', 409);
    const batch = await tx.importBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) throw new AppError('not_found', 'Import batch not found.', 404);
    const candidates = await tx.importOccurrence.findMany({ where: { batchId: batch.id, userId, resolution: 'pending', ...(input.verdict ? { verdict: input.verdict } : { verdict: { in: ['conflict', 'probable'] } }) }, orderBy: { rowNumber: 'asc' } });
    let applied = 0; let skipped = 0; let catalogChanged = false;
    for (const occurrence of candidates) {
      if (input.field && input.field !== '*' && !(occurrence.conflicts as unknown as FieldDifference[] | null)?.some(difference => difference.field === input.field)) continue;
      try {
        const outcome = await applyResolution(tx, userId, occurrence, input.action, input.field && input.field !== '*' ? [input.field] : undefined);
        catalogChanged = catalogChanged || outcome.catalogChanged;
        applied++;
      } catch { skipped++; }
    }
    if (catalogChanged) await tx.user.update({ where: { id: userId }, data: { catalogRevision: { increment: 1 } } });
    if (input.remember && applied) {
      const field = input.field && input.field !== '*' ? input.field : '*';
      const verdict = input.verdict ?? 'conflict';
      await tx.importResolutionRule.upsert({
        where: { userId_verdict_field: { userId, verdict, field } },
        update: { action: input.action, appliedCount: { increment: applied } },
        create: { userId, verdict, field, action: input.action, appliedCount: applied },
      });
    }
    const pending = await tx.importOccurrence.count({ where: { batchId: batch.id, resolution: 'pending', verdict: { in: ['conflict', 'probable'] } } });
    await tx.importBatch.update({ where: { id: batch.id }, data: { status: pending ? 'needs_review' : 'completed' } });
    return { batch: await batchDetail(tx, userId, batch.id), applied, skipped };
  }, { timeout: 20000 });
}

export async function listImportRules(db: PrismaClient, userId: string): Promise<ImportRuleDto[]> {
  const rows = await db.importResolutionRule.findMany({ where: { userId }, orderBy: [{ appliedCount: 'desc' }, { createdAt: 'asc' }] });
  return rows.map(toRuleDto);
}

/** Reads back the spreadsheet that produced a batch. Nothing else in the system keeps that file. */
export async function importBatchSourceFile(db: PrismaClient, config: ServerConfig, userId: string, batchId: string) {
  const batch = await db.importBatch.findFirst({ where: { id: batchId, userId } });
  if (!batch?.sourceKey) throw new AppError('not_found', 'This batch has no stored source file.', 404);
  const bytes = await readFile(assetStoragePath(config, batch.sourceKey)).catch(() => { throw new AppError('asset_missing', 'The stored supplier file is unavailable.', 410); });
  return { bytes, fileName: batch.fileName, mimeType: batch.sourceMime ?? 'application/octet-stream' };
}

export async function deleteImportRule(db: PrismaClient, userId: string, ruleId: string): Promise<ImportRuleDto[]> {
  const rule = await db.importResolutionRule.findFirst({ where: { id: ruleId, userId } });
  if (!rule) throw new AppError('not_found', 'Rule not found.', 404);
  await db.importResolutionRule.delete({ where: { id: rule.id } });
  return listImportRules(db, userId);
}
