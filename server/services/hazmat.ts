import type { PrismaClient } from '@prisma/client';
import { AppError } from '../errors';
import { toProduct } from './catalog';

/**
 * Records that a human checked the transport paperwork for a declared-dangerous product.
 *
 * The release stores which attributes it was based on, so changing the declarations later invalidates
 * it automatically: the publish gate only trusts a release whose snapshot still matches.
 */
export async function recordHazmatRelease(db: PrismaClient, userId: string, productId: string, documents: string) {
  const product = await db.product.findFirst({ where: { userId, OR: [{ id: productId }, { sku: productId }] } });
  if (!product) throw new AppError('not_found', 'Product not found.', 404);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const data = toProduct(product) as unknown as Record<string, unknown>;
  const transport = data.transport as Record<string, boolean> | undefined;
  if (!transport) throw new AppError('hazmat_not_declared', 'Declare the transport attributes before recording a release.', 409);
  await db.product.update({ where: { id: product.id }, data: { revision: { increment: 1 }, data: {
    ...data,
    transportRelease: { by: user.email, at: new Date().toISOString(), documents, attributes: JSON.stringify(transport) },
  } as never } });
  return toProduct(await db.product.findUniqueOrThrow({ where: { id: product.id } }));
}
