import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readConfig } from '../server/config';
import { factSnapshotTx } from '../server/services/facts';
import { QwenReviewProvider, reviewInputHash, reviewOutputSchema, reviewModelInput } from '../server/providers/qwenReview';
import { BailianTextModelProvider } from '../server/providers/text';
import type { ReviewInput } from '../shared/review';

// Bounded diagnostic for the isolated acceptance fixture; never capture arbitrary customer responses.
const config = readConfig();
const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
try {
  const row = await db.listingDraft.findFirstOrThrow({ where: { taskId: 'cmtssduyf0003qqy054f36fao', revision: 7, platform: 'shopify' } });
  const task = await db.launchTask.findUniqueOrThrow({ where: { id: row.taskId } });
  const snap = await factSnapshotTx(db, row.userId, row.taskId, row.productId);
  const input: ReviewInput = { listing: row.data as unknown as ReviewInput['listing'], facts: snap.facts, context: { market: task.market, category: task.category, taskRevision: task.revision }, listingRevision: row.revision, factsRevision: snap.factsRevision };
  const hash = reviewInputHash(input, config.BAILIAN_TEXT_MODEL);
  if (hash !== 'cddb8a53c094eaff741480c2ffc5f916b44256a2c7bfb9d8a55a8bda6c6da5e1') throw new Error('Diagnostic input changed');
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
  const result = await new QwenReviewProvider(text, { model: config.BAILIAN_TEXT_MODEL, configured: !!config.BAILIAN_API_KEY, liveEnabled: config.AI_LIVE_ENABLED }).review(input);
  const folder = 'artifacts/b-review/browser-acceptance-2026-09-09';
  mkdirSync(folder, { recursive: true });
  writeFileSync(`${folder}/diagnostic-${Date.now()}.json`, JSON.stringify({ hash, modelInput: reviewModelInput(input), result, captures }, null, 2) + '\n');
  console.log(JSON.stringify({ result, captures }, null, 2));
} finally { await db.$disconnect(); }
