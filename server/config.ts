import { config as dotenv } from 'dotenv';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

dotenv({ quiet: true });
const bool = (fallback: boolean) => z.enum(['true', 'false']).default(String(fallback) as 'true' | 'false').transform(v => v === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('file:./.local/prismlaunch.db'),
  API_HOST: z.string().default('127.0.0.1'), API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173'),
  ENABLE_DEMO_RESET: bool(true), ALLOW_REGISTRATION: bool(true), AI_LIVE_ENABLED: bool(false), AI_ALLOW_PREMIUM: bool(false),
  AI_MAX_LIVE_CALLS_PER_SESSION: z.coerce.number().int().min(1).max(100).default(20),
  LISTING_PROVIDER: z.enum(['template', 'qwen']).default('template'),
  BAILIAN_LISTING_MAX_TOKENS: z.coerce.number().int().min(300).max(3000).default(1800),
  BAILIAN_API_KEY: z.string().default(''),
  BAILIAN_BASE_URL: z.string().url().default('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'),
  BAILIAN_TEXT_MODEL: z.string().default('qwen3.6-flash'), BAILIAN_REASONING_MODEL: z.string().default('qwen3.7-plus'), BAILIAN_PREMIUM_MODEL: z.string().default('qwen3.8-max'),
  BAILIAN_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = schema.parse(env);
  if (!c.DATABASE_URL.startsWith('file:')) throw new Error('Only local SQLite DATABASE_URL values are supported.');
  const file = c.DATABASE_URL.slice(5);
  return { ...c, DATABASE_URL: `file:${isAbsolute(file) ? file : resolve(file)}`,
    LISTING_PROVIDER: c.NODE_ENV === 'test' ? 'template' as const : c.LISTING_PROVIDER,
    AI_LIVE_ENABLED: c.NODE_ENV === 'test' ? false : c.AI_LIVE_ENABLED,
    BAILIAN_API_KEY: c.NODE_ENV === 'test' ? '' : c.BAILIAN_API_KEY,
  };
}
export type ServerConfig = ReturnType<typeof readConfig>;
