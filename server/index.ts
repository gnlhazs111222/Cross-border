import { readConfig } from './config';
import { createDb } from './db';
import { buildApp } from './app';

const config = readConfig(); const db = createDb(config.DATABASE_URL);
const app = await buildApp(config, db);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, async () => { await app.close(); await db.$disconnect(); process.exit(0); });
await app.listen({ host: config.API_HOST, port: config.API_PORT });
