import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Prisma, ProductAsset as StoredAsset } from '@prisma/client';
import type { AssetKind, AssetRole, ProductAsset } from '../../shared/contracts';
import type { ServerConfig } from '../config';
import { AppError } from '../errors';

export const ASSET_ROLES: readonly AssetRole[] = ['main', 'detail', 'packaging', 'spec', 'other'];
export const ASSET_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export type SniffedAsset = { kind: AssetKind; mimeType: (typeof ASSET_MIME_TYPES)[number]; extension: string };
/** PrismaClient satisfies this shape, so the same helpers work inside and outside a transaction. */
type AssetDb = Prisma.TransactionClient;

/** The declared type is never trusted: kind, MIME type and stored extension all come from the bytes. */
export function sniffAssetType(bytes: Buffer): SniffedAsset | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mimeType: 'image/png', extension: 'png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', mimeType: 'image/webp', extension: 'webp' };
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mimeType: 'application/pdf', extension: 'pdf' };
  return null;
}

/** The original name is display metadata only; it never becomes part of a storage path. */
export function sanitizeAssetFileName(name: string, extension: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  const stem = cleaned.replace(/\.[A-Za-z0-9]{1,8}$/, '').trim() || 'asset';
  return `${stem.slice(0, 100)}.${extension}`;
}

export function decodeAssetBase64(value: string): Buffer {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new AppError('invalid_asset_encoding', 'Asset content must be standard base64.', 400);
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (!bytes.length) throw new AppError('invalid_asset_encoding', 'Asset file is empty.', 400);
  return bytes;
}

export function assetStoragePath(config: Pick<ServerConfig, 'ASSET_STORAGE_DIR'>, storageKey: string): string {
  const root = resolve(config.ASSET_STORAGE_DIR);
  const target = resolve(root, storageKey);
  if (target !== root && !target.startsWith(root + sep)) throw new AppError('invalid_asset_path', 'Invalid asset storage path.', 500);
  return target;
}

export const toProductAsset = (row: StoredAsset): ProductAsset => ({
  recordId: row.id, sku: row.sku, kind: row.kind as AssetKind, role: row.role as AssetRole,
  fileName: row.fileName, mimeType: row.mimeType, byteSize: row.byteSize, sha256: row.sha256,
  parseStatus: row.parseStatus as ProductAsset['parseStatus'], uploadedAt: row.createdAt.toISOString(),
});

const listRows = async (db: AssetDb, userId: string, productId: string): Promise<ProductAsset[]> =>
  (await db.productAsset.findMany({ where: { userId, productId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(toProductAsset);

/** Used by the fact snapshot so downstream parsing reads the same asset list as the Materials page. */
export const assetsForProduct = (db: AssetDb, userId: string, productId: string): Promise<ProductAsset[]> => listRows(db, userId, productId);

async function ownedProduct(db: AssetDb, userId: string, productId: string) {
  const product = await db.product.findFirst({ where: { userId, OR: [{ id: productId }, { sku: productId }] } });
  if (!product) throw new AppError('not_found', 'Product not found.', 404);
  return product;
}

export async function listProductAssets(db: AssetDb, userId: string, productId: string) {
  const product = await ownedProduct(db, userId, productId);
  return { sku: product.sku, assets: await listRows(db, userId, product.id) };
}

function defaultRole(kind: AssetKind, existing: StoredAsset[]): AssetRole {
  if (kind === 'pdf') return 'spec';
  return existing.some(asset => asset.kind === 'image' && asset.role === 'main') ? 'detail' : 'main';
}

export type AssetUploadInput = { fileName: string; mimeType: string; role?: AssetRole; contentBase64: string };

export async function storeProductAsset(db: AssetDb, config: ServerConfig, userId: string, productId: string, input: AssetUploadInput) {
  const product = await ownedProduct(db, userId, productId);
  const bytes = decodeAssetBase64(input.contentBase64);
  if (bytes.byteLength > config.ASSET_MAX_BYTES) {
    throw new AppError('asset_too_large', `Each asset must stay within ${Math.floor(config.ASSET_MAX_BYTES / 1024 / 1024 * 10) / 10} MB.`, 413);
  }
  const sniffed = sniffAssetType(bytes);
  if (!sniffed) throw new AppError('unsupported_asset_type', 'Only PNG, JPEG, WebP images and PDF documents are supported.', 400);
  if (input.mimeType !== sniffed.mimeType) throw new AppError('asset_type_mismatch', 'File content does not match the declared type.', 400);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const existing = await db.productAsset.findUnique({ where: { productId_sha256: { productId: product.id, sha256 } } });
  // Re-uploading identical bytes is idempotent and never creates a second copy on disk.
  if (existing) return { asset: toProductAsset(existing), duplicate: true, assets: await listRows(db, userId, product.id) };
  const current = await db.productAsset.findMany({ where: { userId, productId: product.id } });
  if (current.length >= config.ASSET_MAX_PER_PRODUCT) throw new AppError('asset_limit', `Keep at most ${config.ASSET_MAX_PER_PRODUCT} assets per SKU.`, 409);
  const storageKey = `${userId}/${sha256}.${sniffed.extension}`;
  const target = assetStoragePath(config, storageKey);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { mode: 0o600 });
  const row = await db.productAsset.create({ data: { userId, productId: product.id, sku: product.sku, kind: sniffed.kind,
    role: input.role ?? defaultRole(sniffed.kind, current), fileName: sanitizeAssetFileName(input.fileName, sniffed.extension),
    mimeType: sniffed.mimeType, byteSize: bytes.byteLength, sha256, storageKey } });
  return { asset: toProductAsset(row), duplicate: false, assets: await listRows(db, userId, product.id) };
}

export async function deleteProductAsset(db: AssetDb, config: ServerConfig, userId: string, assetId: string) {
  const row = await db.productAsset.findFirst({ where: { id: assetId, userId, product: { userId } } });
  if (!row) throw new AppError('not_found', 'Asset not found.', 404);
  await db.productAsset.delete({ where: { id: row.id } });
  // The same bytes can be shared by several products through one storage key, so unlink only when unreferenced.
  if (!await db.productAsset.count({ where: { storageKey: row.storageKey } })) await unlink(assetStoragePath(config, row.storageKey)).catch(() => undefined);
  return { deleted: true as const, assets: await listRows(db, userId, row.productId) };
}

export async function readProductAsset(db: AssetDb, config: ServerConfig, userId: string, assetId: string) {
  const row = await db.productAsset.findFirst({ where: { id: assetId, userId, product: { userId } } });
  if (!row) throw new AppError('not_found', 'Asset not found.', 404);
  const bytes = await readFile(assetStoragePath(config, row.storageKey)).catch(() => { throw new AppError('asset_missing', 'The stored asset file is unavailable.', 410); });
  return { bytes, mimeType: row.mimeType, fileName: row.fileName };
}

/**
 * Replacing or resetting a catalog cascades rows away; this removes the matching files from the
 * user's own folder. Import batches keep their own source key, so their files must be counted as
 * referenced too — otherwise an import would delete the spreadsheet it just stored.
 */
export async function pruneOrphanAssetFiles(db: AssetDb, config: ServerConfig, userId: string) {
  const dir = resolve(config.ASSET_STORAGE_DIR, userId);
  const entries = await readdir(dir).catch(() => [] as string[]);
  if (!entries.length) return;
  const [assets, batches] = await Promise.all([
    db.productAsset.findMany({ where: { userId }, select: { storageKey: true } }),
    db.importBatch.findMany({ where: { userId, sourceKey: { not: null } }, select: { sourceKey: true } }),
  ]);
  const referenced = new Set([...assets.map(row => row.storageKey), ...batches.map(row => row.sourceKey!)].map(key => key.split('/').pop()!));
  for (const name of entries) if (!referenced.has(name)) await unlink(resolve(dir, name)).catch(() => undefined);
}
