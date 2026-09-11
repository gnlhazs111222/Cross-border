import { baseFactCard, pricingFromFacts } from '../../shared/facts';
import type { Prisma, PrismaClient, Product as DbProduct } from '@prisma/client';
import type { z } from 'zod';
import { products as builtInProducts } from '../../src/data/mockData';
import type { Product } from '../../src/types';
import type { CatalogResponse, ServerProduct } from '../../shared/contracts';
import { importSchema } from '../validation';
import { AppError } from '../errors';

type Database = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const toProduct = (row: DbProduct): ServerProduct => ({ ...(row.data as unknown as Product), recordId: row.id });
export async function seedProducts(db: Database, userId: string) {
  await db.product.createMany({ data: builtInProducts.map((p, position) => ({ userId, sku: p.sku, name: p.name, category: p.category, position, data: json(p) })) });
}
export async function catalog(db: Database, userId: string): Promise<CatalogResponse> {
  const [rows, user] = await Promise.all([db.product.findMany({ where: { userId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { sku: 'asc' }] }), db.user.findUniqueOrThrow({ where: { id: userId } })]);
  return { products: rows.map(toProduct), revision: user.catalogRevision, factPreviews: Object.fromEntries(rows.map(row => { const p = toProduct(row); const v1 = baseFactCard(p); return [p.sku, { v1, product: p, pricing: pricingFromFacts(p, v1.facts) }]; })) };
}
export async function resetCatalog(db: PrismaClient, userId: string) {
  return db.$transaction(async tx => {
    await tx.launchTask.deleteMany({ where: { userId } });
    await tx.product.deleteMany({ where: { userId } });
    await seedProducts(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { catalogRevision: { increment: 1 } } });
    return catalog(tx, userId);
  }, { timeout: 15000 });
}
export async function importProducts(db: PrismaClient, userId: string, input: z.infer<typeof importSchema>) {
  return db.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (input.expectedRevision !== user.catalogRevision) throw new AppError('catalog_changed', 'The dataset changed. Reload and preview the file again.', 409);
    const existing = input.mode === 'append' ? await tx.product.findMany({ where: { userId }, select: { sku: true } }) : [];
    const seen = new Set(existing.map(p => p.sku)); const accepted: Product[] = [];
    for (const p of input.products) {
      if (seen.has(p.sku)) throw new AppError('duplicate_sku', 'Duplicate SKU. Preview the file again.', 409);
      seen.add(p.sku);
      const missing = [...(!p.packagingWeight ? ['Packaging Weight'] : []), ...([p.packageLength, p.packageWidth, p.packageHeight].some(n => n === undefined) ? ['Packaging Dimensions'] : [])];
      accepted.push({ ...p, missing, status: missing.length ? 'missing_data' : 'search_ready', localizedCapacity: p.visual === 'bottle' ? `${(p.capacity / 29.5735295625).toFixed(1)} fl oz` : '—', packagingDimensions: missing.includes('Packaging Dimensions') ? undefined : `${p.packageLength} × ${p.packageWidth} × ${p.packageHeight} cm` });
    }
    if (seen.size > 500) throw new AppError('catalog_limit', 'Keep the dataset within 500 products.');
    await tx.launchTask.deleteMany({ where: { userId } });
    if (input.mode === 'replace') await tx.product.deleteMany({ where: { userId } });
    await tx.product.createMany({ data: accepted.map((p, index) => ({ userId, sku: p.sku, name: p.name, category: p.category, position: existing.length + index, data: json(p) })) });
    await tx.user.update({ where: { id: userId }, data: { catalogRevision: { increment: 1 } } });
    return { ...await catalog(tx, userId), report: input.report };
  }, { timeout: 15000 });
}
