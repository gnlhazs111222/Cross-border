import { PrismaClient } from '@prisma/client';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

export function createDb(databaseUrl: string) {
  mkdirSync(dirname(databaseUrl.slice(5)), { recursive: true });
  closeSync(openSync(databaseUrl.slice(5), 'a'));
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
