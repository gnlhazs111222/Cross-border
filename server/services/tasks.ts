import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import type { ServerTask } from '../../shared/contracts';
import { taskSchema } from '../validation';
import { AppError } from '../errors';

export async function tasks(db: PrismaClient, userId: string): Promise<ServerTask[]> {
  const rows = await db.launchTask.findMany({ where: { userId }, include: { selections: { include: { product: true } } }, orderBy: { createdAt: 'desc' } });
  return rows.map(row => ({ id: row.code, recordId: row.id, platform: row.platform, market: row.market, category: row.category, requirements: row.requirements as string[], minProfit: row.minimumProfit, selectedSku: row.selections[0]?.product.sku ?? null, selectionPurpose: row.selections[0]?.purpose ?? null }));
}
export async function createTask(db: PrismaClient, userId: string, data: z.infer<typeof taskSchema>) {
  await db.launchTask.upsert({ where: { userId_code: { userId, code: data.code } }, update: {}, create: { ...data, userId } });
  return (await tasks(db, userId)).find(t => t.id === data.code)!;
}
export async function selectProduct(db: PrismaClient, userId: string, taskId: string, productId: string, purpose: 'selected' | 'fact_review') {
  const task = await db.launchTask.findFirst({ where: { userId, OR: [{ id: taskId }, { code: taskId }] } });
  const product = await db.product.findFirst({ where: { userId, OR: [{ id: productId }, { sku: productId }] } });
  if (!task || !product) throw new AppError('not_found', 'Task or product not found.', 404);
  const data = product.data as { duplicateStatus: string };
  if (purpose === 'selected' && (data.duplicateStatus !== 'unique' || task.category !== product.category)) throw new AppError('product_not_eligible', 'This product is not eligible for the task.');
  // Fact completion still belongs to the browser workflow; this stores the owned relationship only.
  await db.taskSelection.upsert({ where: { taskId: task.id }, update: { productId: product.id, purpose, revision: { increment: 1 } }, create: { taskId: task.id, productId: product.id, purpose } });
  return (await tasks(db, userId)).find(t => t.recordId === task.id)!;
}
