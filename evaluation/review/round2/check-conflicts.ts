import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readConfig } from '../../../server/config';
import { createDb } from '../../../server/db';
import { createTextProviders } from '../../../server/providers/text';
import { QwenReviewProvider } from '../../../server/providers/qwenReview';
import type { ReviewInput } from '../../../shared/review';

if (process.argv.slice(2).join(' ') !== '--live') throw new Error('Explicit --live required; six calls maximum, no retries.');
const dataset = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const original = dataset.cases.find((c: { id: string }) => c.id === 'R2-07').input as ReviewInput;
const controls = [
  { id: 'correct-title-wrong-attribute', input: structuredClone(original), expected: 'blocked', field: 'attributes' },
  { id: 'wrong-title-correct-attribute', input: structuredClone(original), expected: 'blocked', field: 'title' },
  { id: 'both-correct', input: structuredClone(original), expected: 'passed', field: null },
];
controls[1].input.listing.title = 'Beige leather bag';
controls[1].input.listing.attributes.Material = 'Canvas';
controls[2].input.listing.attributes.Material = 'Canvas';
const output = resolve('artifacts/evaluation/review-conflict-controls', `${Date.now()}-${randomUUID().slice(0, 8)}`);
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'inputs.json'), JSON.stringify(controls, null, 2), { flag: 'wx' });
const inputHash = createHash('sha256').update(JSON.stringify(controls)).digest('hex');
const config = readConfig();
if (!config.AI_LIVE_ENABLED || !config.BAILIAN_API_KEY) throw new Error('Live AI unavailable.');
config.AI_MAX_LIVE_CALLS_PER_SESSION = Math.min(config.AI_MAX_LIVE_CALLS_PER_SESSION, 6);
const db = createDb(config.DATABASE_URL);
const rows: unknown[] = [];
try {
  const reviewer = new QwenReviewProvider(createTextProviders(config, db).bailian, { model: config.BAILIAN_TEXT_MODEL, liveEnabled: true, configured: true, maxTokens: config.REVIEW_MAX_TOKENS, rejectedAudit: (id, errorCode) => db.aiCall.update({ where: { id }, data: { success: false, errorCode } }) });
  for (let repetition = 1; repetition <= 2; repetition++) for (const control of controls) {
    const outcome = await reviewer.review(structuredClone(control.input));
    const audit = outcome.metadata.aiCallId ? await db.aiCall.findUnique({ where: { id: outcome.metadata.aiCallId } }) : null;
    const locationMatch = control.field === null ? outcome.issues.length === 0 : outcome.issues.length === 1 && outcome.issues[0].location?.field === control.field && outcome.issues[0].category === 'spec_conflict' && outcome.issues[0].factKeys?.includes('material');
    const row = { id: control.id, repetition, expected: control.expected, matched: outcome.status === control.expected && !!locationMatch, outcome, audit };
    rows.push(row);
    writeFileSync(resolve(output, `${control.id}-${repetition}.json`), JSON.stringify(row, null, 2), { flag: 'wx' });
    console.log(`${control.id}/${repetition}: ${outcome.status}, matched=${row.matched}`);
  }
} finally {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ inputHash, provenance: 'AI-authored development controls, not independent human evaluation', rows }, null, 2), { flag: 'wx' });
  await db.$disconnect();
  console.log(output);
}
