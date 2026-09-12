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
  RECOMMENDATION_PROVIDER: z.enum(['rule', 'qwen']).default('rule'),
  RECOMMENDATION_MAX_TOKENS: z.coerce.number().int().min(300).max(3000).default(1800),
  LISTING_PROVIDER: z.enum(['template', 'qwen']).default('template'),
  REVIEW_PROVIDER: z.enum(['rules', 'qwen']).default('rules'),
  REVIEW_MAX_TOKENS: z.coerce.number().int().min(300).max(3000).default(1800),
  /** Multimodal module: local keeps the image check offline, qwen sends the selected SKU pictures to a vision model. */
  MULTIMODAL_PROVIDER: z.enum(['local', 'qwen']).default('local'),
  MULTIMODAL_MAX_TOKENS: z.coerce.number().int().min(300).max(3000).default(1800),
  BAILIAN_LISTING_MAX_TOKENS: z.coerce.number().int().min(300).max(3000).default(1800),
  BAILIAN_API_KEY: z.string().default(''),
  BAILIAN_BASE_URL: z.string().url().default('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'),
  BAILIAN_TEXT_MODEL: z.string().default('qwen3.6-flash'), BAILIAN_REASONING_MODEL: z.string().default('qwen3.7-plus'), BAILIAN_PREMIUM_MODEL: z.string().default('qwen3.8-max'), BAILIAN_VL_MODEL: z.string().default('qwen3.7-plus'),
  BAILIAN_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  ASSET_STORAGE_DIR: z.string().default('.local/assets'),
  ASSET_MAX_BYTES: z.coerce.number().int().min(1024).max(20 * 1024 * 1024).default(4 * 1024 * 1024),
  ASSET_MAX_PER_PRODUCT: z.coerce.number().int().min(1).max(100).default(20),
  ASSET_URL_ALLOWED_HOSTS: z.string().default('img.alicdn.com'),
  ASSET_URL_MAX_BYTES: z.coerce.number().int().min(1024).max(20 * 1024 * 1024).default(4 * 1024 * 1024),
  ASSET_URL_MAX_PER_IMPORT: z.coerce.number().int().min(1).max(200).default(20),
  ASSET_URL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  /** Test and local-fixture escape hatch: relaxes the https requirement and the private-address block. Never enable in production. */
  ASSET_URL_ALLOW_LOOPBACK: bool(false),
  });
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = schema.parse(env);
  if (!c.DATABASE_URL.startsWith('file:')) throw new Error('Only local SQLite DATABASE_URL values are supported.');
  const file = c.DATABASE_URL.slice(5);
  return { ...c, DATABASE_URL: `file:${isAbsolute(file) ? file : resolve(file)}`,
    ASSET_STORAGE_DIR: isAbsolute(c.ASSET_STORAGE_DIR) ? c.ASSET_STORAGE_DIR : resolve(c.ASSET_STORAGE_DIR),
    RECOMMENDATION_PROVIDER: c.NODE_ENV === 'test' ? 'rule' as const : c.RECOMMENDATION_PROVIDER,
    LISTING_PROVIDER: c.NODE_ENV === 'test' ? 'template' as const : c.LISTING_PROVIDER,
    REVIEW_PROVIDER: c.NODE_ENV === 'test' ? 'rules' as const : c.REVIEW_PROVIDER,
    MULTIMODAL_PROVIDER: c.NODE_ENV === 'test' ? 'local' as const : c.MULTIMODAL_PROVIDER,
    AI_LIVE_ENABLED: c.NODE_ENV === 'test' ? false : c.AI_LIVE_ENABLED,
    BAILIAN_API_KEY: c.NODE_ENV === 'test' ? '' : c.BAILIAN_API_KEY,
  };
}
export type ServerConfig = ReturnType<typeof readConfig>;
