import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { readConfig } from '../config';
import { createDb } from '../db';
import { buildApp } from '../app';
import { seedDemo } from '../seed';
import { MockTextModelProvider } from '../providers/text';

const config = readConfig();
console.log(JSON.stringify({ model: config.BAILIAN_TEXT_MODEL, baseURL: config.BAILIAN_BASE_URL, liveEnabled: config.AI_LIVE_ENABLED }));
if (!process.argv.includes('--live')) {
  const provider = new MockTextModelProvider();
  console.log(await provider.generateStructured({ prompt: 'Dry run', purpose: 'smoke-dry-run', schema: z.object({ ok: z.boolean() }), example: { ok: true } }));
  console.log('Mock only. Live requires AI_LIVE_ENABLED=true and --live.');
} else if (existsSync('.local/ai-smoke-success.json') && !process.argv.includes('--force')) {
  console.log('Two live smoke calls already succeeded. No new call made.');
} else if (!config.AI_LIVE_ENABLED || !config.BAILIAN_API_KEY) {
  console.error(config.AI_LIVE_ENABLED ? 'bailian_not_configured' : 'live_ai_disabled'); process.exitCode = 1;
} else {
  // Explicit smoke is capped at two attempted completions; the SDK also has retries disabled.
  config.AI_MAX_LIVE_CALLS_PER_SESSION = 2;
  const db = createDb(config.DATABASE_URL); await seedDemo(db);
  const app = await buildApp(config, db, { logger: false });
  const results: unknown[] = [];
  let cookie = '';
  try {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'demo@prismlaunch.local', password: 'Demo123456' } });
    if (login.statusCode !== 200) throw new Error('Smoke account login failed.');
    cookie = String(login.headers['set-cookie']).split(';')[0];
    for (const payload of [{ message: '你好' }, { message: 'Return exactly this short JSON object: {"ok":true,"service":"prismlaunch"}', structured: true }]) {
      const response = await app.inject({ method: 'POST', url: '/api/ai/smoke-test', headers: { cookie }, payload });
      const body = response.json();
      if (response.statusCode !== 200) { console.error(JSON.stringify(body)); process.exitCode = 1; break; }
      results.push(body.data); console.log(JSON.stringify(body.data));
    }
    mkdirSync('.local', { recursive: true });
    writeFileSync('.local/ai-smoke-last.json', JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
    if (results.length === 2) writeFileSync('.local/ai-smoke-success.json', JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  } finally {
    if (cookie) await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie }, payload: {} });
    await app.close(); await db.$disconnect();
  }
}
