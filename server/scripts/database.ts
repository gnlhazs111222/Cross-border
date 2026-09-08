import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { readConfig } from '../config';
import { createDb } from '../db';
import { seedDemo } from '../seed';

const config = readConfig();
if (process.argv[2] === 'migrate') {
  mkdirSync(dirname(config.DATABASE_URL.slice(5)), { recursive: true });
  closeSync(openSync(config.DATABASE_URL.slice(5), 'a'));
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: config.DATABASE_URL, BAILIAN_API_KEY: '' } });
  process.exitCode = result.status ?? 1;
} else if (process.argv[2] === 'seed') {
  if (config.NODE_ENV === 'production') throw new Error('Demo seed is unavailable in production.');
  const db = createDb(config.DATABASE_URL);
  try { await seedDemo(db); console.log('Demo account and initial products ready: demo@prismlaunch.local'); } finally { await db.$disconnect(); }
} else throw new Error('Expected migrate or seed.');
