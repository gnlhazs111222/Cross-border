import type { LaunchTask, PricingSnapshot as StoredPricingSnapshot, Prisma, PrismaClient } from '@prisma/client';
import type { PricingContextSnapshot } from '../../src/types';
import { AppError } from '../errors';

type DB = Prisma.TransactionClient;

const DEMO_CONTEXT = {
  settlementCurrency: 'USD' as const,
  exchangePair: 'CNY/USD', exchangeRate: 0.139, exchangeSource: 'Demo approved exchange-rate table', exchangeReferenceDate: '2026-09-01',
  shippingAmount: 3.10, shippingConfigVersion: 'shipping-us-demo-v1', shippingSource: 'Demo US parcel profile',
  dutyAmount: 0.70, dutyRuleVersion: 'duty-us-demo-v1', dutySource: 'Demo landed-cost rule table',
  platformFeeAmount: 2.20, platformFeeVersion: 'platform-us-demo-v1', platformFeeSource: 'Demo marketplace fee profile',
  policyVersion: 'pricing-context-demo-v1',
};

const safeCode = (value: string) => value.slice(0, 120) || 'TASK';
const dataFor = (task: LaunchTask, version: number) => ({
  userId: task.userId, taskId: task.id, code: `PCS-${safeCode(task.code)}-v${version}`, version, platform: task.platform, market: task.market,
  ...DEMO_CONTEXT, fetchedAt: new Date(),
});

export function pricingSnapshotDto(row: StoredPricingSnapshot): PricingContextSnapshot {
  return {
    recordId: row.id, taskId: row.taskId, code: row.code, version: row.version, platform: row.platform, market: row.market,
    settlementCurrency: row.settlementCurrency as 'USD', policyVersion: row.policyVersion, createdAt: row.createdAt.toISOString(),
    exchange: { pair: row.exchangePair, rate: row.exchangeRate, source: row.exchangeSource, referenceDate: row.exchangeReferenceDate, fetchedAt: row.fetchedAt.toISOString(), appliedToSupplierCost: false },
    shipping: { amount: row.shippingAmount, currency: 'USD', configVersion: row.shippingConfigVersion, source: row.shippingSource },
    duty: { amount: row.dutyAmount, currency: 'USD', ruleVersion: row.dutyRuleVersion, source: row.dutySource },
    platformFee: { amount: row.platformFeeAmount, currency: 'USD', configVersion: row.platformFeeVersion, source: row.platformFeeSource },
  };
}

export function createPricingSnapshotTx(db: DB, task: LaunchTask, version: number) {
  return db.pricingSnapshot.create({ data: dataFor(task, version) });
}

export async function ensurePricingSnapshotTx(db: DB, task: LaunchTask) {
  const existing = await db.pricingSnapshot.findFirst({ where: { userId: task.userId, taskId: task.id }, orderBy: { version: 'desc' } });
  return existing ?? createPricingSnapshotTx(db, task, 1);
}

export async function latestPricingSnapshotTx(db: DB, task: LaunchTask) {
  return ensurePricingSnapshotTx(db, task);
}

async function ownedTask(db: DB, userId: string, taskId: string) {
  const task = await db.launchTask.findFirst({ where: { userId, OR: [{ id: taskId }, { code: taskId }] } });
  if (!task) throw new AppError('not_found', 'Task not found.', 404);
  return task;
}

export async function pricingSnapshotHistory(db: PrismaClient, userId: string, taskId: string) {
  return db.$transaction(async tx => {
    const task = await ownedTask(tx, userId, taskId);
    await ensurePricingSnapshotTx(tx, task);
    return (await tx.pricingSnapshot.findMany({ where: { userId, taskId: task.id }, orderBy: { version: 'desc' } })).map(pricingSnapshotDto);
  }, { timeout: 15000 });
}

export async function refreshPricingSnapshot(db: PrismaClient, userId: string, taskId: string, expectedVersion: number) {
  return db.$transaction(async tx => {
    const task = await ownedTask(tx, userId, taskId);
    const current = await ensurePricingSnapshotTx(tx, task);
    if (current.version !== expectedVersion) throw new AppError('pricing_snapshot_changed', 'Pricing snapshot changed. Reload before refreshing.', 409);
    const next = await createPricingSnapshotTx(tx, task, current.version + 1);
    const listings = await tx.listingDraft.findMany({ where: { userId, taskId: task.id }, select: { id: true } });
    if (listings.length) {
      const listingDraftId = { in: listings.map(row => row.id) };
      await tx.publishResult.updateMany({ where: { listingDraftId, invalidatedAt: null }, data: { invalidatedAt: new Date() } });
      await tx.listingDraft.updateMany({ where: { id: listingDraftId, status: 'published' }, data: { status: 'review_passed' } });
    }
    return pricingSnapshotDto(next);
  }, { timeout: 15000 });
}
