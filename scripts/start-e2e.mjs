import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';

mkdirSync('.local', { recursive: true });
const dir = mkdtempSync(resolve('.local/e2e-'));
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: `file:${dir}/test.db`, API_PORT: '3002', API_PROXY_TARGET: 'http://127.0.0.1:3002', AI_LIVE_ENABLED: 'false', AI_ALLOW_PREMIUM: 'false', BAILIAN_API_KEY: '', NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1' };
for (const action of ['migrate', 'seed']) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/database.ts', action], { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const api = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env, stdio: 'inherit' });
let ready = false;
for (let attempt = 0; attempt < 200; attempt++) {
  if (api.exitCode !== null) break;
  try { if ((await fetch('http://127.0.0.1:3002/api/health')).ok) { ready = true; break; } } catch { /* wait for API startup */ }
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!ready) { api.kill('SIGTERM'); throw new Error('Test API did not become ready.'); }
const children = [api, spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { env, stdio: 'inherit' })];
let stopping = false;
const stop = code => { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; };
for (const child of children) child.on('exit', code => stop(code ?? 0));
process.on('SIGTERM', () => stop(0)); process.on('SIGINT', () => stop(0));
