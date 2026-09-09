import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { ReviewInput, SemanticReviewResult } from '../../../shared/review';
import { REVIEW_PROMPT_VERSION, REVIEW_RULE_VERSION } from '../../../shared/review';
import { summarizeReviewMetrics, type ExpectedStatus } from '../metrics';

type Case = { id: string; input: ReviewInput; expected: ExpectedStatus; expectedIssues: unknown[]; rationale: string };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dataset = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')) as { datasetVersion: string; cases: Case[] };
const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')) as { datasetHash: string; cases: { id: string; inputHash: string; labelHash: string }[] };
if (hash(dataset) !== manifest.datasetHash) throw new Error('Dataset hash mismatch; review changes before evaluation.');
if (new Set(dataset.cases.map(c => c.id)).size !== dataset.cases.length || manifest.cases.length !== dataset.cases.length) throw new Error('Invalid case inventory.');
for (const c of dataset.cases) {
  const entry = manifest.cases.find(m => m.id === c.id);
  if (!entry || entry.inputHash !== hash(c.input) || entry.labelHash !== hash({ expected: c.expected, expectedIssues: c.expectedIssues, rationale: c.rationale })) throw new Error(`Case integrity failed: ${c.id}`);
}
const args = process.argv.slice(2);
const first = new Set(['R2-01', 'R2-06', 'R2-12', 'R2-14']);
if (args.length === 1 && args[0] === '--check') {
  console.log(JSON.stringify({ validated: dataset.cases.length, datasetHash: manifest.datasetHash, liveCalls: 0 }));
} else {
  if (args.length !== 3 || args[0] !== '--live' || args[1] !== '--batch' || !['first', 'remaining'].includes(args[2])) throw new Error('Use --check or --live --batch first|remaining. No automatic retries.');
  const selected = dataset.cases.filter(c => args[2] === 'first' ? first.has(c.id) : !first.has(c.id));
  if (!selected.length || selected.length > 12) throw new Error('Live batch limit exceeded.');
  const { readConfig } = await import('../../../server/config');
  const { createDb } = await import('../../../server/db');
  const { createTextProviders } = await import('../../../server/providers/text');
  const { QwenReviewProvider } = await import('../../../server/providers/qwenReview');
  const config = readConfig();
  if (!config.AI_LIVE_ENABLED || !config.BAILIAN_API_KEY) throw new Error('Configured and enabled live AI is required.');
  config.AI_MAX_LIVE_CALLS_PER_SESSION = Math.min(config.AI_MAX_LIVE_CALLS_PER_SESSION, selected.length);
  const db = createDb(config.DATABASE_URL);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${args[2]}-${randomUUID().slice(0, 8)}`;
  const output = resolve('artifacts/evaluation/review-round2', runId);
  const rows: { id: string; expected: ExpectedStatus; actual: SemanticReviewResult['status']; outcome: SemanticReviewResult; audit: unknown }[] = [];
  try {
    mkdirSync(output, { recursive: true });
    writeFileSync(resolve(output, 'dataset.json'), JSON.stringify(dataset, null, 2), { flag: 'wx' });
    const reviewer = new QwenReviewProvider(createTextProviders(config, db).bailian, { model: config.BAILIAN_TEXT_MODEL, liveEnabled: true, configured: true, maxTokens: config.REVIEW_MAX_TOKENS,
      rejectedAudit: (id, errorCode) => db.aiCall.update({ where: { id }, data: { success: false, errorCode } }) });
    for (const c of selected) {
      // Expected answers are never sent to the model.
      const outcome = await reviewer.review(structuredClone(c.input));
      const audit = outcome.metadata.aiCallId ? await db.aiCall.findUnique({ where: { id: outcome.metadata.aiCallId } }) : null;
      const row = { id: c.id, expected: c.expected, actual: outcome.status, outcome, audit };
      rows.push(row);
      writeFileSync(resolve(output, `${c.id}.json`), JSON.stringify(row, null, 2), { flag: 'wx' });
      console.log(`${c.id}: ${row.actual} (expected ${c.expected})`);
    }
  } finally {
    try {
      writeFileSync(resolve(output, 'report.json'), JSON.stringify({ runId, datasetHash: manifest.datasetHash, datasetVersion: dataset.datasetVersion, runner: fileURLToPath(import.meta.url), model: config.BAILIAN_TEXT_MODEL, promptVersion: REVIEW_PROMPT_VERSION, ruleVersion: REVIEW_RULE_VERSION, provenance: 'AI-assisted development evaluation; not human blind testing', batch: args[2], requestedIds: selected.map(c => c.id), completedCount: rows.length, metrics: summarizeReviewMetrics(rows), rows }, null, 2), { flag: 'wx' });
      console.log(JSON.stringify({ output, metrics: summarizeReviewMetrics(rows) }));
    } finally { await db.$disconnect(); }
  }
}
