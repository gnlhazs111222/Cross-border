import type { PrismaClient } from '@prisma/client';
import { hashPassword } from './auth/password';
import { seedProducts } from './services/catalog';

export async function seedDemo(db: PrismaClient) {
  const email = 'demo@prismlaunch.local';
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  const passwordHash = await hashPassword('Demo123456');
  return db.$transaction(async tx => {
    const user = await tx.user.create({ data: { email, displayName: 'PrismLaunch Demo', passwordHash } });
    await seedProducts(tx, user.id); return user;
  });
}
