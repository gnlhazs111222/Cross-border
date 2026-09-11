import { baseFactCard, pricingFromFacts } from '../../shared/facts';
import type { Prisma, PrismaClient, Product as DbProduct } from '@prisma/client';
import { products as builtInProducts } from '../../src/data/mockData';
import type { Product } from '../../src/types';
import type { CatalogResponse, ServerProduct } from '../../shared/contracts';

type Database = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const toProduct = (row: DbProduct): ServerProduct => ({ ...(row.data as unknown as Product), recordId: row.id });
/** Shared by the importer and by import conflict resolution so both produce identical derived fields. */
export function normalizeImportedProduct(p: Product): Product {
  const missing = [...new Set([...p.missing, ...(!p.capacity ? ['Capacity'] : []), ...(!p.packagingWeight ? ['Packaging Weight'] : []), ...([p.packageLength, p.packageWidth, p.packageHeight].some(n => n === undefined) ? ['Packaging Dimensions'] : [])])];
  return { ...p, missing, status: missing.length ? 'missing_data' : 'search_ready',
    localizedCapacity: p.visual === 'bottle' && p.capacity ? `${(p.capacity / 29.5735295625).toFixed(1)} fl oz` : '—',
    packagingDimensions: missing.includes('Packaging Dimensions') ? undefined : `${p.packageLength} × ${p.packageWidth} × ${p.packageHeight} cm` };
}
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
