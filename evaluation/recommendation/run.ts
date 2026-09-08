import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { recommendationCases, type EvaluationCase } from './cases';
import { caseMetrics, summarizeMetrics, validateExpected } from './metrics';
import { hardFilter, type RecommendationContext } from '../../shared/recommendation';
import { baseFactCard } from '../../shared/facts';
import { MockRecommendationProvider } from '../../server/providers/domain';
import { QwenRecommendationProvider, normalizedRecommendationInput } from '../../server/providers/qwenRecommendation';
import { MockTextModelProvider, type TextRequest } from '../../server/providers/text';
import { readConfig } from '../../server/config';
import { createDb } from '../../server/db';
import { buildApp } from '../../server/app';
import { hashPassword } from '../../server/auth/password';
import { RECOMMENDATION_PROMPT_VERSION } from '../../server/prompts/recommendation-v1';
import type { Recommendation } from '../../src/types';
import type { Prisma } from '@prisma/client';
const arg = (key: string) => { const i = process.argv.indexOf(key); return i >= 0 ? process.argv[i + 1] : undefined; };
const provider = arg('--provider') ?? 'rule';
if (!['rule', 'qwen-mock', 'qwen-live'].includes(provider)) throw new Error('Provider must be rule, qwen-mock or qwen-live.');
const requestedIds = arg('--case')?.split(',');
const pool = requestedIds ? recommendationCases.filter(c => requestedIds.includes(c.id)) : recommendationCases;
if (requestedIds && pool.length !== new Set(requestedIds).size) throw new Error('Unknown evaluation case id.');
const limitArg = arg('--limit'); const limit = limitArg ? Number(limitArg) : provider === 'qwen-live' ? Math.min(2, pool.length) : pool.length;
if (!Number.isInteger(limit) || limit < 1 || limit > pool.length || (provider === 'qwen-live' && limit > 4)) throw new Error('Use a positive case limit; live evaluation is limited to four cases per explicit run.');
const cases = pool.slice(0, limit); for (const c of cases) validateExpected(c);
const outputDir = resolve(arg('--output') ?? `artifacts/evaluation/recommendation/${provider}`); mkdirSync(outputDir, { recursive: true });
const contextFor = (c: EvaluationCase): RecommendationContext => ({ taskRevision: 1, catalogRevision: 1, candidateVersion: c.id, facts: Object.fromEntries(c.candidates.map(p => [p.sku, [...baseFactCard(p).facts, ...(c.extraFacts?.[p.sku] ?? [])]])) });
class EvalMock extends MockTextModelProvider { override async generateStructured<T>(r: TextRequest & { schema: z.ZodType<T>; example: T }) { return super.generateStructured(r); } }
const rule = new MockRecommendationProvider();
const mocked = new QwenRecommendationProvider(new EvalMock(), { liveEnabled: true, configured: true, model: 'qwen-mock' });
const rows: Array<Record<string, unknown> & { metrics: ReturnType<typeof caseMetrics> }> = [];
let realCalls = 0; let developmentAttempts: Record<string, unknown> | null = null;
if (provider !== 'qwen-live') {
  for (const c of cases) {
    const filtered = hardFilter(c.candidates, c.task); const start = Date.now();
    const actual = await (provider === 'rule' ? rule : mocked).recommend(filtered.eligible, c.task, contextFor(c));
    rows.push({ caseId: c.id, task: c.task, expected: c.expected, notes: c.notes, eligibleCount: filtered.eligible.length, excluded: filtered.excluded, actual, metrics: caseMetrics(c, actual), latencyMs: Date.now() - start, mode: actual[0]?.generation?.mode ?? 'rule' });
  }
} else {
  const config = readConfig();
  if (!config.AI_LIVE_ENABLED || !config.BAILIAN_API_KEY || config.RECOMMENDATION_PROVIDER !== 'qwen') throw new Error('Live evaluation requires RECOMMENDATION_PROVIDER=qwen, AI_LIVE_ENABLED=true and a configured backend key.');
  const db = createDb(config.DATABASE_URL); const before = await db.aiCall.count({ where: { purpose: 'recommendation_generation' } });
  if (before >= 8) { await db.$disconnect(); throw new Error('The eight-call recommendation development budget is exhausted.'); }
  config.AI_MAX_LIVE_CALLS_PER_SESSION = Math.min(config.AI_MAX_LIVE_CALLS_PER_SESSION, 8 - before, limit);
  console.log(JSON.stringify({ provider, model: config.BAILIAN_TEXT_MODEL, promptVersion: RECOMMENDATION_PROMPT_VERSION, caseLimit: limit, remainingLiveBudget: 8 - before }));
  const recordPath = '.local/recommendation-live-records.json';
  const previous: Array<Record<string, unknown> & { metrics: ReturnType<typeof caseMetrics> }> = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : [];
  const app = await buildApp(config, db, { logger: false, recommendationAudit: async record => { mkdirSync('.local/recommendation-diagnostics', { recursive: true }); writeFileSync(`.local/recommendation-diagnostics/${record.inputHash}.json`, JSON.stringify(record, null, 2)); } }); let cookie = '';
  try {
    const email = 'recommendation-evaluation@prismlaunch.local';
    const user = await db.user.upsert({ where: { email }, update: {}, create: { email, displayName: 'Recommendation Evaluation', passwordHash: await hashPassword('Demo123456') } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'Demo123456' } });
    if (login.statusCode !== 200) throw new Error('Evaluation account login failed.'); cookie = String(login.headers['set-cookie']).split(';')[0];
    const request = async (url: string, payload?: Record<string, unknown>) => {
      const r = await app.inject({ url, method: payload ? 'POST' : 'GET', headers: { cookie }, ...(payload ? { payload } : {}) });
      if (r.statusCode !== 200) throw new Error(`Evaluation API failed: ${r.json().error?.code ?? r.statusCode}`); return r.json().data;
    };
    // Evaluation fixtures are trusted server-owned synthetic data, never a browser-provided eligibility override.
    for (const c of cases) {
      const caseFingerprint = createHash('sha256').update(JSON.stringify(normalizedRecommendationInput(hardFilter(c.candidates, c.task).eligible, c.task, contextFor(c)))).digest('hex');
      const saved = previous.find(r => r.caseFingerprint === caseFingerprint && r.caseId === c.id && r.model === config.BAILIAN_TEXT_MODEL && r.promptVersion === RECOMMENDATION_PROMPT_VERSION && r.mode === 'qwen');
      if (saved) { const baseline = await rule.recommend(c.candidates, c.task, contextFor(c)); rows.push({ ...saved, expected: c.expected, notes: c.notes, metrics: caseMetrics(c, saved.actual as Recommendation[]), pairedRuleMetrics: caseMetrics(c, baseline) }); console.log(`${c.id}: reusing previous live verification, no new call.`); continue; }
      await db.$transaction(async tx => {
        await tx.launchTask.deleteMany({ where: { userId: user.id } }); await tx.product.deleteMany({ where: { userId: user.id } });
        await tx.product.createMany({ data: c.candidates.map((p, position) => ({ userId: user.id, sku: p.sku, name: p.name, category: p.category, position, data: JSON.parse(JSON.stringify(p)) as Prisma.InputJsonValue })) });
        await tx.user.update({ where: { id: user.id }, data: { catalogRevision: { increment: 1 } } });
      });
      const task = await request('/api/tasks', { code: `EVAL-${c.id}`, platform: c.task.platform, market: c.task.market, category: c.task.category, requirements: c.task.requirements, minimumProfit: c.task.minProfit });
      for (const [sku, extra] of Object.entries(c.extraFacts ?? {})) {
        await request(`/api/tasks/${task.recordId}/selection`, { productId: sku, purpose: 'fact_review' });
        const base = `/api/tasks/${task.recordId}/products/${sku}`;
        let snap = await request(`${base}/fact-cards/v1`, {}); snap = await request(`${base}/analyze`, { expectedRevision: snap.factsRevision });
        for (const f of extra) {
          const field = snap.facts.find((value: { key: string }) => value.key === f.key);
          const edited = await app.inject({ method: 'PATCH', url: `/api/facts/${field.recordId}`, headers: { cookie }, payload: { value: f.value, expectedRevision: snap.factsRevision } });
          if (edited.statusCode !== 200) throw new Error('Enhanced evaluation fact setup failed.'); snap = edited.json().data;
          snap = await request(`/api/facts/${field.recordId}/confirm`, { expectedRevision: snap.factsRevision });
        }
      }
      const result = await request(`/api/tasks/${task.recordId}/recommendations`, { expectedTaskRevision: task.revision });
      const actual = result.recommendations as Recommendation[];
      const audit = result.generation?.aiCallId ? await db.aiCall.findUnique({ where: { id: result.generation.aiCallId } }) : null;
      const baseline = await rule.recommend(c.candidates, c.task, contextFor(c));
      const row = { caseFingerprint, caseId: c.id, task: c.task, expected: c.expected, notes: c.notes, eligibleCount: result.eligibleCount, excluded: result.excluded, actual,
        metrics: caseMetrics(c, actual), pairedRuleMetrics: caseMetrics(c, baseline), mode: result.generation?.mode ?? 'rule', model: config.BAILIAN_TEXT_MODEL, promptVersion: RECOMMENDATION_PROMPT_VERSION,
        fallbackReason: result.generation?.fallbackReason ?? null, latencyMs: audit?.latencyMs, tokenUsage: audit ? { prompt: audit.promptTokens, completion: audit.completionTokens, total: audit.totalTokens } : null, aiCallId: audit?.id };
      rows.push(row); previous.push(row); mkdirSync('.local', { recursive: true }); writeFileSync(recordPath, JSON.stringify(previous, null, 2));
      console.log(JSON.stringify({ caseId: c.id, mode: row.mode, top3: actual.map(r => r.sku), metrics: row.metrics, latencyMs: row.latencyMs, usage: row.tokenUsage, fallback: row.fallbackReason }));
      if (row.mode !== 'qwen' && result.eligibleCount) { console.log('Fallback observed; inspect before another explicit live attempt.'); break; }
    }
    const attempts = await db.aiCall.findMany({ where: { purpose: 'recommendation_generation' }, select: { success: true, totalTokens: true, errorCode: true } });
    realCalls = attempts.length - before;
    developmentAttempts = { calls: attempts.length, accepted: attempts.filter(a => a.success).length, rejectedOrFailed: attempts.filter(a => !a.success).length, knownTokens: attempts.reduce((n, a) => n + (a.totalTokens ?? 0), 0), missingUsageCount: attempts.filter(a => a.totalTokens === null).length, errorCodes: attempts.filter(a => !a.success).map(a => a.errorCode) };
  } finally { if (cookie) await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie }, payload: {} }); await app.close(); await db.$disconnect(); }
}
const metrics = summarizeMetrics(rows.map(r => r.metrics));
const pairedRuleMetrics = provider === 'qwen-live' ? summarizeMetrics(rows.map(r => r.pairedRuleMetrics as ReturnType<typeof caseMetrics>)) : null;
const report = { date: new Date().toISOString(), provider, model: provider === 'qwen-live' ? rows[0]?.model : provider === 'qwen-mock' ? 'qwen-mock' : null,
  promptVersion: provider === 'rule' ? null : RECOMMENDATION_PROMPT_VERSION, caseCount: rows.length, metrics, pairedRuleMetrics, realCalls, developmentAttempts,
  fallbackCases: rows.filter(r => r.mode === 'rule_fallback').length, disclaimer: provider === 'qwen-mock' ? 'Mock pipeline validation only; not evidence of Qwen ranking quality.' : 'Small synthetic demo evaluation, not a statistical benchmark or sales forecast.', cases: rows };
writeFileSync(`${outputDir}/summary.json`, JSON.stringify(report, null, 2)+'\n');
const percent = (n: number | null) => n === null ? 'N/A' : `${(100*n).toFixed(1)}%`;
writeFileSync(`${outputDir}/summary.md`, `# Recommendation evaluation: ${provider}\n\nDate: ${report.date}\n\n${report.disclaimer}\n\nCases: ${rows.length}; rank-labelled: ${metrics.labelledCaseCount}; real calls in this run: ${realCalls}.\n\n| Metric | Value |\n| --- | ---: |\n| Top1 Accuracy | ${percent(metrics.top1Accuracy)} |\n| Hit@3 | ${percent(metrics.hitAt3)} |\n| NDCG@3 | ${metrics.ndcgAt3?.toFixed(4) ?? 'N/A'} |\n| Invalid Candidate Rate | ${percent(metrics.invalidCandidateRate)} |\n| Unsupported Reason Rate (limited checks) | ${percent(metrics.unsupportedReasonRate)} |\n\n${pairedRuleMetrics ? `Paired rule baseline on the same cases: Top1 ${percent(pairedRuleMetrics.top1Accuracy)}, Hit@3 ${percent(pairedRuleMetrics.hitAt3)}, NDCG@3 ${pairedRuleMetrics.ndcgAt3?.toFixed(4)}.\n\n` : ''}Hit@3 means a preferred Top1 appears in the returned Top3. Empty cases are excluded from ranking metrics and checked separately. Rates describe validated/fallback outputs; they do not prove raw model output is always valid.\n\n| Case | Preferred Top1 | Actual Top1 | Mode |\n| --- | --- | --- | --- |\n${rows.map(r => `| ${r.caseId} | ${(r.expected as EvaluationCase['expected']).preferredTop1.join(', ') || 'none'} | ${(r.actual as Recommendation[])[0]?.sku ?? 'none'} | ${r.mode} |`).join('\n')}\n`);
console.log(JSON.stringify({ provider, caseCount: rows.length, metrics, pairedRuleMetrics, realCalls, developmentAttempts, outputDir }));
