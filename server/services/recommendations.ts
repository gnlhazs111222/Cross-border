import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Product, Task, Fact, Recommendation } from '../../src/types';
import { hardFilter, RECOMMENDATION_FACT_KEYS, type RecommendationContext, type RecommendationSnapshot } from '../../shared/recommendation';
import { baseFactCard } from '../../shared/facts';
import { catalog } from './catalog';
import { factSnapshotTx } from './facts';
import { AppError } from '../errors';
import { MockRecommendationProvider } from '../providers/domain';
import type { RecommendationRuntime } from '../providers/qwenRecommendation';
const ruleRuntime: RecommendationRuntime = { requested: 'rule', provider: new MockRecommendationProvider() };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function recommendationContext(db: Prisma.TransactionClient, userId: string, taskId: string) {
  const row = await db.launchTask.findFirst({ where: { userId, OR: [{ id: taskId }, { code: taskId }] } });
  if (!row) throw new AppError('not_found', 'Task not found.', 404);
  const task: Task = { id: row.code, recordId: row.id, revision: row.revision, platform: row.platform, market: row.market, category: row.category, requirements: row.requirements as string[], minProfit: row.minimumProfit };
  const data = await catalog(db, userId); const products: Product[] = []; const facts: Record<string, Fact[]> = {}; const versions: unknown[] = [];
  const cards = await db.factCard.findMany({ where: { userId, taskId: row.id, version: 1 }, select: { productId: true } });
  const ids = new Set(cards.map(c => c.productId));
  for (const p of data.products) {
    const snap = ids.has(p.recordId) ? await factSnapshotTx(db, userId, row.id, p.recordId) : null;
    products.push(snap?.product ?? p); facts[p.sku] = snap?.facts ?? baseFactCard(p).facts;
    versions.push({ id: p.recordId, sku: p.sku, duplicate: p.duplicateStatus, category: p.category, visual: p.visual,
      facts: facts[p.sku].filter(f => RECOMMENDATION_FACT_KEYS.has(f.key)).map(f => ({ key: f.key, value: f.value, status: f.status, allowed: f.allowed, revision: f.revision ?? 1 })) });
  }
  const context: RecommendationContext = { taskRevision: row.revision, catalogRevision: data.revision, candidateVersion: createHash('sha256').update(JSON.stringify(versions)).digest('hex'), facts };
  const filtered = hardFilter(products, task);
  return { row, task, products, context, ...filtered };
}
function view(current: Awaited<ReturnType<typeof recommendationContext>>): RecommendationSnapshot {
  const old = current.row.recommendationSnapshot as unknown as RecommendationSnapshot | null;
  const base = { taskRevision: current.context.taskRevision, catalogRevision: current.context.catalogRevision, candidateVersion: current.context.candidateVersion, eligibleCount: current.eligible.length, excluded: current.excluded };
  if (!old) return { ...base, status: 'not_run', recommendations: [] };
  const stale = old.taskRevision !== base.taskRevision || old.catalogRevision !== base.catalogRevision || old.candidateVersion !== base.candidateVersion;
  return stale ? { ...old, ...base, status: 'stale', recommendations: [] } : { ...old, ...base, status: 'ready' };
}
export function getRecommendations(db: PrismaClient, userId: string, taskId: string) {
  return db.$transaction(async tx => view(await recommendationContext(tx, userId, taskId)), { timeout: 15000 });
}
export async function runRecommendations(db: PrismaClient, userId: string, taskId: string, expectedTaskRevision: number, runtime = ruleRuntime) {
  const prepared = await db.$transaction(tx => recommendationContext(tx, userId, taskId), { timeout: 15000 });
  if (prepared.task.revision !== expectedTaskRevision) throw new AppError('task_changed', 'Task changed. Reload the current task before retrying.', 409);
  const rows = prepared.eligible.length ? await runtime.provider.recommend(prepared.eligible, prepared.task, prepared.context) : [];
  const validIds = new Set(prepared.eligible.map(p => p.sku));
  if (rows.length > 3 || rows.some(r => !validIds.has(r.sku)) || new Set(rows.map(r => r.sku)).size !== rows.length) throw new AppError('invalid_recommendation', 'The provider returned an invalid candidate set.', 422);
  return db.$transaction(async tx => {
    const now = await recommendationContext(tx, userId, taskId);
    if (now.context.taskRevision !== prepared.context.taskRevision || now.context.catalogRevision !== prepared.context.catalogRevision || now.context.candidateVersion !== prepared.context.candidateVersion) throw new AppError('recommendation_changed', 'Task or candidate facts changed. Run recommendation again.', 409);
    const result: RecommendationSnapshot = { status: 'ready', taskRevision: now.context.taskRevision, catalogRevision: now.context.catalogRevision, candidateVersion: now.context.candidateVersion,
      eligibleCount: now.eligible.length, excluded: now.excluded, recommendations: rows.map((r: Recommendation) => ({ ...r, productId: now.eligible.find(p => p.sku === r.sku)!.recordId })),
      generation: rows[0]?.generation ?? { mode: 'rule' }, generatedAt: new Date().toISOString() };
    await tx.launchTask.update({ where: { id: now.row.id }, data: { recommendationSnapshot: json(result) } });
    return result;
  }, { timeout: 15000 });
}
