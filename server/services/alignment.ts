import type { PrismaClient } from '@prisma/client';
import { recordFromProduct, type AlignableRecord } from '../../shared/alignment';
import { toProduct } from './catalog';

/**
 * Builds alignment records straight from the stored pool, so the report can use the same
 * evidence the app has: product attributes plus the sha256 of every image uploaded for that SKU.
 * Read-only; no model call, no network.
 */
export async function alignmentRecordsFromCatalog(db: PrismaClient, userId: string, sourceId = 'catalog'): Promise<AlignableRecord[]> {
  const [products, assets] = await Promise.all([
    db.product.findMany({ where: { userId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    db.productAsset.findMany({ where: { userId, kind: 'image' }, select: { productId: true, sha256: true } }),
  ]);
  const hashesByProduct = new Map<string, string[]>();
  for (const asset of assets) {
    const list = hashesByProduct.get(asset.productId);
    if (list) list.push(asset.sha256); else hashesByProduct.set(asset.productId, [asset.sha256]);
  }
  return products.map(row => ({ ...recordFromProduct(toProduct(row), sourceId), imageHashes: hashesByProduct.get(row.id) ?? [] }));
}

export async function imageHashCounts(db: PrismaClient, userId: string): Promise<{ sku: string; images: number; hashes: string[] }[]> {
  const assets = await db.productAsset.findMany({ where: { userId, kind: 'image' }, select: { sku: true, sha256: true }, orderBy: { createdAt: 'asc' } });
  const bySku = new Map<string, string[]>();
  for (const asset of assets) {
    const list = bySku.get(asset.sku);
    if (list) list.push(asset.sha256); else bySku.set(asset.sku, [asset.sha256]);
  }
  return [...bySku.entries()].map(([sku, hashes]) => ({ sku, images: hashes.length, hashes }));
}
