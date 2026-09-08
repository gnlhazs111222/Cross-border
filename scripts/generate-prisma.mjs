import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'generate'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'file:../.local/prismlaunch.db', BAILIAN_API_KEY: '' } });
process.exitCode = result.status ?? 1;
