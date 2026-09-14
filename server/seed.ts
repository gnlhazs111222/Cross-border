import type { PrismaClient } from '@prisma/client';
import { hashPassword } from './auth/password';
import { seedProducts } from './services/catalog';

export async function seedDemo(db: PrismaClient) {
  const email = 'demo@prismlaunch.local';
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return ['PrismLaunch Demo', '海淘集市演示账号'].includes(existing.displayName)
    ? db.user.update({ where: { id: existing.id }, data: { displayName: '海淘集市 Demo' } })
    : existing;
  const passwordHash = await hashPassword('Demo123456');
  return db.$transaction(async tx => {
    const user = await tx.user.create({ data: { email, displayName: '海淘集市 Demo', passwordHash } });
    await seedProducts(tx, user.id); return user;
  });
}
