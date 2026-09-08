import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readConfig } from '../config';
import { createDb } from '../db';
import { buildApp } from '../app';
import { products, demoTask, HERO_SKU } from '../../src/data/mockData';
import { baseFactCard, pricingFromFacts } from '../../shared/facts';
import { enrichProductEvidence } from '../../shared/domain';
import { TemplateListingProvider } from '../providers/domain';
import { LISTING_PROMPT_VERSION } from '../prompts/listing-v1';

const config = readConfig(); const live = process.argv.includes('--live');
const platformIndex = process.argv.indexOf('--platform');
const selectedPlatform = platformIndex >= 0 ? process.argv[platformIndex + 1] : undefined;
if (selectedPlatform && !['amazon', 'shopify'].includes(selectedPlatform)) throw new Error('Platform must be amazon or shopify.');
const platforms = selectedPlatform ? [selectedPlatform as 'amazon' | 'shopify'] : ['amazon', 'shopify'] as const;
const recordPath = '.local/qwen-listing-verification.json';
console.log(JSON.stringify({ provider: live ? config.LISTING_PROVIDER : 'template-dry-run', model: config.BAILIAN_TEXT_MODEL, platforms, promptVersion: LISTING_PROMPT_VERSION, liveEnabled: config.AI_LIVE_ENABLED }));
if (!live) {
  const p = products[0]; const v1 = baseFactCard(p);
  for (const platform of platforms) {
    const draft = await new TemplateListingProvider().generate({ factCard: enrichProductEvidence(p, v1, demoTask), pricing: pricingFromFacts(p, v1.facts), platform, revision: 1, factRevision: 2 });
    console.log(JSON.stringify({ platform, mode: 'template', title: draft.title, authorizedFacts: draft.sources.length, realCalls: 0 }));
  }
} else if (config.LISTING_PROVIDER !== 'qwen' || !config.AI_LIVE_ENABLED || !config.BAILIAN_API_KEY) {
  console.error('Live listing smoke requires LISTING_PROVIDER=qwen, AI_LIVE_ENABLED=true and a configured backend key.'); process.exitCode = 1;
} else {
  const db = createDb(config.DATABASE_URL);
  const count = await db.aiCall.count({ where: { purpose: 'listing_generation' } });
  const remaining = Math.max(0, 6 - count);
  console.log(JSON.stringify({ remainingLocalCallBudget: remaining }));
  config.AI_MAX_LIVE_CALLS_PER_SESSION = Math.max(1, Math.min(config.AI_MAX_LIVE_CALLS_PER_SESSION, remaining));
  const records: Array<Record<string, unknown>> = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : [];
  let app: Awaited<ReturnType<typeof buildApp>> | undefined; let cookie = '';
  try {
    if (!remaining) throw new Error('This verification has reached its six-call limit.');
    app = await buildApp(config, db, { logger: false });
    const email = 'qwen-listing-smoke@prismlaunch.local';
    if (!await db.user.findUnique({ where: { email } })) {
      const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'Demo123456', displayName: 'Qwen Listing Verification' } });
      if (register.statusCode !== 201) throw new Error('Verification account setup failed.');
    }
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Demo123456' } });
    if (login.statusCode !== 200) throw new Error('Verification login failed.'); cookie = String(login.headers['set-cookie']).split(';')[0];
    const call = async (url: string, payload?: Record<string, unknown>) => {
      const result = await app!.inject({ url, method: payload ? 'POST' : 'GET', headers: { cookie }, ...(payload ? { payload } : {}) });
      if (result.statusCode !== 200) throw new Error(`Verification API failed: ${result.json().error?.code ?? result.statusCode}`);
      return result.json().data;
    };
    const task = await call('/api/tasks', { code: demoTask.id, platform: demoTask.platform, market: demoTask.market, category: demoTask.category, requirements: demoTask.requirements, minimumProfit: demoTask.minProfit });
    await call(`/api/tasks/${task.recordId}/selection`, { productId: HERO_SKU, purpose: 'selected' });
    const base = `/api/tasks/${task.recordId}/products/${HERO_SKU}`;
    let snap = await call(`${base}/fact-cards/v1`, {});
    if (!snap.v2) snap = await call(`${base}/analyze`, { expectedRevision: snap.factsRevision });
    for (const platform of platforms) {
      if (records.some(r => r.platform === platform && r.generationMode === 'qwen' && r.mockPublished === true && r.promptVersion === LISTING_PROMPT_VERSION && r.model === config.BAILIAN_TEXT_MODEL)) { console.log(`${platform}: successful verification already recorded; skipped.`); continue; }
      const before = await call(`${base}/listings`);
      let w = await call(`${base}/listings`, { platform, expectedVersion: before.heads[platform]?.revision ?? 0, expectedFactsRevision: snap.factsRevision });
      const listing = w.listings[platform]; const generation = listing.generation;
      const audit = generation?.aiCallId ? await db.aiCall.findUnique({ where: { id: generation.aiCallId } }) : null;
      const row = { timestamp: new Date().toISOString(), sku: HERO_SKU, platform, model: generation?.model, promptVersion: generation?.promptVersion,
        factsRevision: snap.factsRevision, authorizedFacts: snap.facts.filter((f: { allowed: boolean; status: string }) => f.allowed && f.status === 'Confirmed').length,
        generationMode: listing.generationMode, fallbackReason: generation?.fallbackReason ?? null, aiCallId: audit?.id, latencyMs: audit?.latencyMs,
        promptTokens: audit?.promptTokens, completionTokens: audit?.completionTokens, totalTokens: audit?.totalTokens,
        title: listing.title, bullets: listing.bullets, description: listing.description, attributes: listing.attributes, usedFacts: listing.sources.map((f: { key: string; value: string }) => ({ field: f.key, value: f.value })) };
      records.push(row); mkdirSync('.local', { recursive: true }); writeFileSync(recordPath, JSON.stringify(records, null, 2)); console.log(JSON.stringify(row));
      if (listing.generationMode !== 'qwen') { console.error('Template fallback occurred. Inspect the sanitized reason before another explicit attempt.'); process.exitCode = 1; break; }
      w = await call(`/api/listings/${listing.recordId}/review`, { expectedVersion: listing.revision, expectedFactsRevision: snap.factsRevision });
      if (w.reviews[platform]?.status !== 'passed') throw new Error('Generated draft did not pass the explicit rules review.');
      w = await call(`/api/listings/${listing.recordId}/publish`, { expectedVersion: listing.revision, expectedFactsRevision: snap.factsRevision });
      Object.assign(row, { explicitReview: 'passed', mockPublished: !!w.publications[platform] });
      writeFileSync(recordPath, JSON.stringify(records, null, 2));
      console.log(JSON.stringify({ platform, explicitReview: 'passed', mockPublish: !!w.publications[platform] }));
    }
  } catch (error) { console.error(error instanceof Error ? error.message : 'Listing verification failed.'); process.exitCode = 1; }
  finally { if (app && cookie) await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie }, payload: {} }); await app?.close(); await db.$disconnect(); }
}
