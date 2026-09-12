import type { Prisma, PrismaClient, Fact as StoredFact } from '@prisma/client';
import type { Fact, FactCard, Evidence, Platform } from '../../src/types';
import type { FactSnapshot } from '../../shared/contracts';
import { baseFactCard, effectiveProduct, pricingFromFacts, productEvidence, reviewFact } from '../../shared/facts';
import { COPY_FACTS, PRICING_FACTS, requiredCopyFactsFor } from '../../src/services/factReview';
import { AppError } from '../errors';
import { domainProviders } from '../providers/domain';
import type { ImageCheckProvider } from '../providers/multimodal';
import type { ServerConfig } from '../config';
import { runImageCheck, storeImageCheck } from './multimodal';
import { invalidateDownstream, invalidatePricingOutputs } from './invalidation';
import { toProduct } from './catalog';
import { assetsForProduct } from './assets';

type DB = Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const storedFact = (f: Fact) => ({ key: f.key, value: f.value, source: f.source, anchor: f.anchor, status: f.status, listingAllowed: f.allowed, revision: f.revision ?? 1,
  metadata: json({ label: f.label, sourceKind: f.sourceKind, sourceMetadata: f.sourceMetadata, previousValue: f.previousValue, previousSource: f.previousSource, confirmedAt: f.confirmedAt, imageCheck: f.imageCheck,
    valueType: ['capacity', 'packagingWeight', 'packageLength', 'packageWidth', 'packageHeight', 'supplierCost', 'declaredValue'].includes(f.key) ? 'number' : f.key === 'straw' ? 'boolean' : 'string' }) });
export const readFact = (f: StoredFact): Fact => ({ ...(f.metadata as object ?? {}), recordId: f.id, key: f.key, label: (f.metadata as { label?: string })?.label ?? f.key, value: f.value, source: f.source, anchor: f.anchor, status: f.status as Fact['status'], allowed: f.listingAllowed, revision: f.revision, updatedAt: f.updatedAt.toISOString() });

async function owned(db: DB, userId: string, taskId: string, productId: string) {
  const task = await db.launchTask.findFirst({ where: { userId, OR: [{ id: taskId }, { code: taskId }] } });
  const product = await db.product.findFirst({ where: { userId, OR: [{ id: productId }, { sku: productId }] } });
  if (!task || !product) throw new AppError('not_found', 'Task or product not found.', 404);
  return { task, product };
}
export { invalidateDownstream };
export async function factSnapshotTx(db: DB, userId: string, taskId: string, productId: string, invalidated = false): Promise<FactSnapshot> {
  const { task, product } = await owned(db, userId, taskId, productId);
  const cards = await db.factCard.findMany({ where: { userId, taskId: task.id, productId: product.id }, include: { facts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, evidence: { orderBy: { createdAt: 'asc' } } }, orderBy: { version: 'asc' } });
  const base = cards.find(c => c.version === 1); const enhanced = cards.find(c => c.version === 2);
  if (!base) throw new AppError('facts_not_found', 'Select the product to create its facts.', 404);
  const card = (row: typeof base): FactCard => ({ recordId: row.id, revision: row.revision, productRevision: row.productRevision, version: row.version as 1 | 2, sku: product.sku, ...(row.version === 2 ? { taskId: task.code } : {}), facts: row.facts.map(readFact) });
  const v1 = card(base); const v2 = enhanced ? card(enhanced) : null; const facts = (v2 ?? v1).facts;
  const p = toProduct(product); const view = effectiveProduct(p, facts); const pricing = pricingFromFacts(p, facts, facts.filter(f => PRICING_FACTS.includes(f.key)).reduce((sum, f) => sum + Math.max(0, (f.revision ?? 1) - 1), 0), task.minimumProfit);
  const blockedFacts = requiredCopyFactsFor(p.visual).filter(key => !facts.some(f => f.key === key && f.status === 'Confirmed' && f.allowed));
  const listingFactsRevision = facts.filter(f => COPY_FACTS.includes(f.key)).reduce((sum, f) => sum + (f.revision ?? 1), 0);
  return { productId: product.id, taskId: task.id, product: view, v1, v2, facts, factsRevision: Math.max(base.revision, enhanced?.revision ?? 0), listingFactsRevision, downstreamInvalidated: invalidated, pricing,
    evidence: [...base.evidence, ...(enhanced?.evidence ?? [])].map(e => ({ ...(e.data as unknown as Evidence), recordId: e.id })), assets: await assetsForProduct(db, userId, product.id),
    pricingReadiness: { ready: pricing.status === 'ready', missing: pricing.missing },
    listingReadiness: { ready: !!v2 && !blockedFacts.length && p.duplicateStatus === 'unique' && p.category === task.category, blockedFacts } };
}
export function factSnapshot(db: PrismaClient, userId: string, taskId: string, productId: string) {
  return db.$transaction(tx => factSnapshotTx(tx, userId, taskId, productId));
}
export async function taskFactSnapshots(db: PrismaClient, userId: string, taskId: string) {
  return db.$transaction(async tx => {
    const task = await tx.launchTask.findFirst({ where: { id: taskId, userId } });
    if (!task) throw new AppError('not_found', 'Task not found.', 404);
    const cards = await tx.factCard.findMany({ where: { taskId: task.id, userId, version: 1 } });
    return Promise.all(cards.map(c => factSnapshotTx(tx, userId, task.id, c.productId)));
  });
}
export async function createV1(db: PrismaClient, userId: string, taskId: string, productId: string) {
  return db.$transaction(async tx => {
    const { task, product } = await owned(tx, userId, taskId, productId);
    const existing = await tx.factCard.findUnique({ where: { taskId_productId_version: { taskId: task.id, productId: product.id, version: 1 } } });
    if (!existing) {
      const selection = await tx.taskSelection.findFirst({ where: { taskId: task.id, productId: product.id } });
      if (!selection) throw new AppError('selection_required', 'Open the selected product or Fact Review first.', 409);
      const p = toProduct(product); const card = baseFactCard(p);
      await tx.factCard.create({ data: { userId, taskId: task.id, productId: product.id, productRevision: product.revision, version: 1,
        facts: { create: card.facts.map(storedFact) }, evidence: { create: productEvidence(p).map(e => ({ kind: e.type, source: e.name, data: json({ ...e, sourceKind: e.type === 'sheet' && p.importSource ? 'supplier' : 'mock', ...(e.type === 'sheet' && p.importSource ? { sourceMetadata: p.importSource } : {}) }) })) } } });
    }
    return factSnapshotTx(tx, userId, task.id, product.id);
  });
}
/**
 * Runs the multimodal module once per task and SKU. The proposed V2 facts are compared with the
 * pictures before anything is written, and live vision runs outside the transaction so a slow model
 * call never holds a database write open.
 */
export async function analyzeFacts(db: PrismaClient, config: ServerConfig, userId: string, taskId: string, productId: string, expectedRevision: number, provider: ImageCheckProvider) {
  const before = await factSnapshot(db, userId, taskId, productId);
  if (before.factsRevision !== expectedRevision) throw new AppError('facts_changed', 'Facts changed. Reload the current facts before retrying.', 409);
  if (before.v2) return before;
  const { task, product } = await owned(db, userId, taskId, productId);
  const v2 = await domainProviders.evidence.enrich(toProduct(product), before.v1, { id: task.code, platform: task.platform, market: task.market, category: task.category, requirements: task.requirements as string[], minProfit: task.minimumProfit });
  const check = await runImageCheck(db, config, userId, { snapshot: before, facts: v2.facts, baseVersion: 2 }, provider);
  return db.$transaction(async tx => {
    const card = await tx.factCard.create({ data: { userId, taskId: task.id, productId: product.id, productRevision: product.revision, version: 2, revision: before.factsRevision + 1, facts: { create: v2.facts.map(storedFact) } } });
    // Only the task card is annotated: V1 must stay byte-for-byte as the supplier delivered it.
    await storeImageCheck(tx, { v2Id: card.id, userId, taskId: task.id, productId: product.id, sku: product.sku }, check);
    await invalidateDownstream(tx, task.id, product.id);
    return factSnapshotTx(tx, userId, task.id, product.id, true);
  });
}
export async function recheckImages(db: PrismaClient, config: ServerConfig, userId: string, taskId: string, productId: string, expectedRevision: number, provider: ImageCheckProvider) {
  const before = await factSnapshot(db, userId, taskId, productId);
  if (before.factsRevision !== expectedRevision) throw new AppError('facts_changed', 'Facts changed. Reload the current facts before retrying.', 409);
  if (!before.v2) throw new AppError('facts_not_analyzed', 'Create the enhanced fact card before rechecking images.', 409);
  const check = await runImageCheck(db, config, userId, { snapshot: before }, provider);
  return db.$transaction(async tx => {
    await tx.factCard.updateMany({ where: { id: { in: [before.v1.recordId!, before.v2!.recordId!] } }, data: { revision: before.factsRevision + 1 } });
    await storeImageCheck(tx, { v2Id: before.v2!.recordId!, userId, taskId: before.taskId, productId: before.productId, sku: before.product.sku }, check);
    await invalidateDownstream(tx, before.taskId, before.productId);
    return factSnapshotTx(tx, userId, before.taskId, before.productId, true);
  });
}
export async function mutateFact(db: PrismaClient, userId: string, factId: string, action: 'edit' | 'confirm' | 'reject', expectedRevision: number, value?: string) {
  return db.$transaction(async tx => {
    const row = await tx.fact.findFirst({ where: { id: factId, factCard: { userId, task: { userId }, product: { userId } } }, include: { factCard: true } });
    if (!row) throw new AppError('not_found', 'Fact not found.', 404);
    const { taskId, productId } = row.factCard;
    const before = await factSnapshotTx(tx, userId, taskId, productId);
    if (before.factsRevision !== expectedRevision) throw new AppError('facts_changed', 'Facts changed. Reload the current facts before retrying.', 409);
    let updated: Fact;
    try { updated = reviewFact(readFact(row), action, value); } catch (error) { throw new AppError('invalid_fact', error instanceof Error ? error.message : 'Invalid fact.'); }
    // Shared base facts are synchronized into both cards; enhanced keys never overwrite V1.
    const rows = await tx.fact.findMany({ where: { key: row.key, factCard: { userId, taskId, productId } } });
    for (const f of rows) await tx.fact.update({ where: { id: f.id }, data: storedFact(updated) });
    await tx.factCard.updateMany({ where: { id: { in: rows.map(f => f.factCardId) } }, data: { revision: before.factsRevision + 1 } });
    const pricingOnly = PRICING_FACTS.includes(row.key) && !COPY_FACTS.includes(row.key);
    if (!pricingOnly) await invalidateDownstream(tx, taskId, productId);
    else await invalidatePricingOutputs(tx, taskId, productId);
    return factSnapshotTx(tx, userId, taskId, productId, !pricingOnly);
  });
}
export async function templateFromFacts(db: PrismaClient, userId: string, taskId: string, productId: string, platform: Platform, revision: number, expectedRevision: number) {
  const snap = await factSnapshot(db, userId, taskId, productId);
  if (snap.factsRevision !== expectedRevision) throw new AppError('facts_changed', 'Facts changed. Reload the current facts before retrying.', 409);
  if (!snap.listingReadiness.ready) throw new AppError('listing_blocked', 'Confirm the required listing facts before generating a listing.', 409);
  return domainProviders.listing.generate({ factCard: snap.v2!, pricing: snap.pricing, platform, revision, factRevision: snap.listingFactsRevision });
}
