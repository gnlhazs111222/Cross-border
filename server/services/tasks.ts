import { invalidateDownstream } from './facts';
import { recommendationContext } from './recommendations';
import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import type { ServerTask } from '../../shared/contracts';
import { taskSchema } from '../validation';
import { AppError } from '../errors';

export async function tasks(db: PrismaClient, userId: string): Promise<ServerTask[]> {
  const rows = await db.launchTask.findMany({ where: { userId }, include: { selections: { include: { product: true } } }, orderBy: { updatedAt: 'desc' } });
  return rows.map(row => ({ id: row.code, recordId: row.id, revision: row.revision, platform: row.platform, market: row.market, category: row.category, requirements: row.requirements as string[], minProfit: row.minimumProfit, selectedSku: row.selections[0]?.product.sku ?? null, selectionPurpose: row.selections[0]?.purpose ?? null }));
}
export async function createTask(db: PrismaClient, userId: string, data: z.infer<typeof taskSchema>) {
  await db.launchTask.upsert({ where: { userId_code: { userId, code: data.code } }, update: {}, create: { ...data, userId } });
  return (await tasks(db, userId)).find(t => t.id === data.code)!;
}
export async function selectProduct(db: PrismaClient, userId: string, taskId: string, productId: string, purpose: 'selected' | 'fact_review') {
  const task = await db.launchTask.findFirst({ where: { userId, OR: [{ id: taskId }, { code: taskId }] } });
  const product = await db.product.findFirst({ where: { userId, OR: [{ id: productId }, { sku: productId }] } });
  if (!task || !product) throw new AppError('not_found', 'Task or product not found.', 404);
  if (purpose === 'selected') {
    const context = await recommendationContext(db, userId, task.id);
    if (!context.eligible.some(p => p.recordId === product.id)) throw new AppError('product_not_eligible', 'This product is not eligible for the task.');
  }
  // Selection establishes the owned relationship required to create a server FactCard.
  await db.taskSelection.upsert({ where: { taskId: task.id }, update: { productId: product.id, purpose, revision: { increment: 1 } }, create: { taskId: task.id, productId: product.id, purpose } });
  return (await tasks(db, userId)).find(t => t.recordId === task.id)!;
}

export async function updateTask(db: PrismaClient, userId: string, taskId: string, data: Omit<z.infer<typeof taskSchema>, 'code'> & { expectedRevision: number }) {
  const row = await db.$transaction(async tx => {
    const task = await tx.launchTask.findFirst({ where: { userId, id: taskId } });
    if (!task) throw new AppError('not_found', 'Task not found.', 404);
    if (task.revision !== data.expectedRevision) throw new AppError('task_changed', 'Task changed. Reload the current task before retrying.', 409);
    const { expectedRevision: _expected, ...fields } = data; void _expected;
    await tx.taskSelection.deleteMany({ where: { taskId: task.id } });
    const products = await tx.factCard.findMany({ where: { taskId: task.id, userId, version: 1 }, select: { productId: true } });
    for (const p of products) await invalidateDownstream(tx, task.id, p.productId);
    return tx.launchTask.update({ where: { id: task.id }, data: { ...fields, revision: { increment: 1 } } });
  }, { timeout: 15000 });
  return (await tasks(db, userId)).find(t => t.recordId === row.id)!;
}
