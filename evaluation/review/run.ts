import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewCases } from './cases';
import { summarizeReviewMetrics, type ActualStatus } from './metrics';
import { reviewAgainstTemplate } from '../../shared/domain';
import type { Listing } from '../../src/types';

const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; if (!v || v.startsWith('--')) throw new Error(`Missing value for ${name}`); return v; };
const provider = value('--provider') ?? 'rule';
const split = value('--split') ?? 'dev';
const live = args.includes('--live');
if (!['rule', 'qwen'].includes(provider) || !['dev', 'holdout', 'all'].includes(split)) throw new Error('Use --provider rule|qwen and --split dev|holdout|all.');
if ((provider === 'qwen') !== live) throw new Error('Qwen evaluation requires explicit --live; rule mode must not use --live.');
const pool = reviewCases.filter(c => split === 'all' || c.split === split);
const limitText = value('--limit');
if (live && !limitText) throw new Error('Live evaluation requires --limit N. Start with 4 or fewer; hard maximum is 12 per invocation.');
const limit = limitText === undefined ? pool.length : Number(limitText);
if (!Number.isInteger(limit) || limit < 1 || limit > pool.length || (live && limit > 12)) throw new Error('Invalid limit; live maximum is 12.');
const allowed = new Set(['--provider', '--split', '--limit', '--live']);
for (let i = 0; i < args.length; i++) { if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`); if (args[i] !== '--live') i++; }
const selected = pool.slice(0, limit);
const datasetHash = createHash('sha256').update(JSON.stringify(reviewCases)).digest('hex');
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${provider}-${randomUUID().slice(0, 8)}`;
const dir = resolve('artifacts/evaluation/review', runId);
mkdirSync(dir, { recursive: true });
type Row = { caseId: string; split: string; category: string; risk: string; expected: typeof reviewCases[number]['expected']; actual: ActualStatus; latencyMs: number; outcome: unknown; audit: unknown; ruleStatus: 'passed' | 'blocked'; ruleIssues: unknown; inputHash: string };
const rows: Row[] = [];
let cleanup = async () => {};
let readAudit: (id: string) => Promise<unknown> = async () => null;
let reviewer: { review(input: typeof reviewCases[number]['input']): Promise<{ status: ActualStatus }> } | undefined;
let model: string | null = null;
const report = () => ({ runId, datasetHash, datasetVersion: 1, labelProvenance: 'AI-authored synthetic; NOT human reviewed',
  independentEvaluationMeaning: 'Separate fixed expected labels and runner; not an independent human benchmark. Holdout fixtures are visible in this repository.',
  provider, model, split, requestedCount: selected.length, completedCount: rows.length,
  metrics: summarizeReviewMetrics(rows.map(r => ({ expected: r.expected, actual: r.actual }))),
  pairedRuleMetrics: summarizeReviewMetrics(rows.map(r => ({ expected: r.expected, actual: r.ruleStatus }))),
  groups: Object.fromEntries([...new Set(rows.map(r => r.risk))].map(risk => [risk, summarizeReviewMetrics(rows.filter(r => r.risk === risk).map(r => ({ expected: r.expected, actual: r.actual })))])),
  limitations: ['Synthetic labels require human review.', 'Small samples do not establish population accuracy.', 'Errors and abstentions are excluded from binary confusion rates; inspect coverage and exact-status accuracy.', 'Baseline compares to a frozen safe draft, and does not inspect attributes.', 'No automatic retries or live claim is made by offline results.'], rows });
try {
  if (live) {
    const [{ readConfig }, { createDb }, { createTextProviders }, { QwenReviewProvider }] = await Promise.all([
      import('../../server/config'), import('../../server/db'), import('../../server/providers/text'), import('../../server/providers/qwenReview'),
    ]);
    const config = readConfig();
    if (!config.AI_LIVE_ENABLED || !config.BAILIAN_API_KEY) throw new Error('Live evaluation requires AI_LIVE_ENABLED=true and a configured backend key.');
    config.AI_MAX_LIVE_CALLS_PER_SESSION = Math.min(config.AI_MAX_LIVE_CALLS_PER_SESSION, limit);
    const db = createDb(config.DATABASE_URL);
    cleanup = () => db.$disconnect();
    readAudit = id => db.aiCall.findUnique({ where: { id }, select: { id: true, provider: true, model: true, purpose: true, success: true, errorCode: true, latencyMs: true, promptTokens: true, completionTokens: true, totalTokens: true } });
    model = config.BAILIAN_TEXT_MODEL;
    reviewer = new QwenReviewProvider(createTextProviders(config, db).bailian, { model, liveEnabled: true, configured: true,
      rejectedAudit: async (id: string, code: string) => { await db.aiCall.update({ where: { id }, data: { success: false, errorCode: code } }); } });
  }
  for (const c of selected) {
    const listing: Listing = { ...c.input.listing, sources: c.input.facts, revision: c.input.listingRevision, factRevision: c.input.factsRevision, riskDemoInjected: false };
    const ruleIssues = reviewAgainstTemplate(listing, c.baseline);
    const ruleStatus = ruleIssues.length ? 'blocked' as const : 'passed' as const;
    const start = Date.now();
    let actual: ActualStatus = ruleStatus;
    let outcome: unknown = { status: ruleStatus, issues: ruleIssues, metadata: { mode: 'rule' } };
    if (reviewer) {
      try { const result = await reviewer.review(structuredClone(c.input)); actual = result.status; outcome = result; }
      catch { actual = 'failed'; outcome = { status: 'failed', errorCode: 'evaluation_provider_error' }; }
    }
    const aiCallId = (outcome as { metadata?: { aiCallId?: string } }).metadata?.aiCallId;
    const audit = aiCallId ? await readAudit(aiCallId) : null;
    const row: Row = { caseId: c.id, split: c.split, category: c.category, risk: c.risk, expected: c.expected, actual, latencyMs: Date.now() - start, outcome, audit, ruleStatus, ruleIssues,
      inputHash: createHash('sha256').update(JSON.stringify(c.input)).digest('hex') };
    rows.push(row);
    writeFileSync(resolve(dir, `${c.id}.json`), JSON.stringify(row, null, 2), { flag: 'wx' });
    console.log(`${c.id}: ${actual} (expected ${c.expected})`);
  }
} finally {
  writeFileSync(resolve(dir, 'report.json'), JSON.stringify(report(), null, 2), { flag: 'wx' });
  await cleanup();
  console.log(JSON.stringify({ output: dir, ...report().metrics }, null, 2));
}
