import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { readConfig } from '../server/config';
import { factSnapshotTx } from '../server/services/facts';
import { QwenReviewProvider, reviewInputHash, reviewOutputSchema, reviewModelInput } from '../server/providers/qwenReview';
import { BailianTextModelProvider } from '../server/providers/text';
import type { ReviewInput } from '../shared/review';

// Bounded diagnostic for the isolated acceptance fixture; never capture arbitrary customer responses.
if (process.argv.slice(2).join(' ') !== '--live' && process.argv.slice(2).join(' ') !== '--live --bag') throw new Error('Explicit --live required; one diagnostic call, no retries.');
const config = readConfig();
const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
try {
  const row = await db.listingDraft.findFirstOrThrow({ where: { taskId: 'cmtssduyf0003qqy054f36fao', revision: 11, platform: 'shopify' } });
  const task = await db.launchTask.findUniqueOrThrow({ where: { id: row.taskId } });
  const snap = await factSnapshotTx(db, row.userId, row.taskId, row.productId);
  let input: ReviewInput = { listing: row.data as unknown as ReviewInput['listing'], facts: snap.facts, context: { market: task.market, category: task.category, taskRevision: task.revision }, listingRevision: row.revision, factsRevision: snap.factsRevision };
  if (process.argv.includes('--bag')) {
    const bytes = readFileSync('evaluation/review/round2/cases.json');
    if (createHash('sha256').update(bytes).digest('hex') !== 'c4d7501eca381d6f0ff8a5abb175d8d877aeead1ce84fca9c215cb213bd59a95') throw new Error('Diagnostic dataset changed');
    input = JSON.parse(bytes.toString('utf8')).cases.find((c: { id: string }) => c.id === 'R2-07').input;
  }
  const hash = reviewInputHash(input, config.BAILIAN_TEXT_MODEL);
  const baseline = JSON.parse(readFileSync('artifacts/b-review/empty-fix-diagnostic/diagnostic-1788949692387.json', 'utf8'));
  if (!process.argv.includes('--bag') && !isDeepStrictEqual(reviewModelInput(input), baseline.modelInput)) throw new Error('Diagnostic input changed');
  const captures: unknown[] = [];
  const transport: typeof fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (response.ok) {
      const body = await response.clone().json() as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (content) { try { const parsed = JSON.parse(content); const check = reviewOutputSchema.safeParse(parsed); captures.push({ parsed, errors: check.success ? [] : check.error.issues }); } catch { captures.push({ jsonSyntaxInvalid: true }); } }
    }
    return response;
  };
  const text = new BailianTextModelProvider(config, data => db.aiCall.create({ data }), transport);
  const result = await new QwenReviewProvider(text, { model: config.BAILIAN_TEXT_MODEL, configured: !!config.BAILIAN_API_KEY, liveEnabled: config.AI_LIVE_ENABLED, maxTokens: config.REVIEW_MAX_TOKENS, rejectedAudit: (id, errorCode) => db.aiCall.update({ where: { id }, data: { success: false, errorCode } }) }).review(input);
  const folder = 'artifacts/b-review/empty-fix-diagnostic';
  mkdirSync(folder, { recursive: true });
  writeFileSync(`${folder}/diagnostic-${Date.now()}.json`, JSON.stringify({ hash, modelInput: reviewModelInput(input), result, captures }, null, 2) + '\n');
  console.log(JSON.stringify({ result, captures }, null, 2));
} finally { await db.$disconnect(); }
