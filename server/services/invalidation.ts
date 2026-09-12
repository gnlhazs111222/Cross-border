import type { Prisma } from '@prisma/client';

type DB = Prisma.TransactionClient;

/** Shared by every fact mutation: a changed fact makes existing listings, reviews and publish results stale. */
export async function invalidateDownstream(db: DB, taskId: string, productId: string) {
  const where = { taskId, productId };
  const invalidatedAt = new Date();
  await db.reviewResult.updateMany({ where: { listingDraft: where, invalidatedAt: null }, data: { invalidatedAt } });
  await db.publishResult.updateMany({ where: { listingDraft: where, invalidatedAt: null }, data: { invalidatedAt } });
  await db.listingDraft.updateMany({ where: { ...where, status: { not: 'superseded' } }, data: { status: 'stale' } });
}
/** Pricing-only edits keep a reviewed draft in place and only drop the publish result. */
export async function invalidatePricingOutputs(db: DB, taskId: string, productId: string) {
  const where = { taskId, productId };
  await db.publishResult.updateMany({ where: { listingDraft: where, invalidatedAt: null }, data: { invalidatedAt: new Date() } });
  await db.listingDraft.updateMany({ where: { ...where, status: 'published' }, data: { status: 'review_passed' } });
}
