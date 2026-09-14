import type { Prisma } from '@prisma/client';
import { IMAGE_CHECK_BATCH_MODE, IMAGE_CHECK_MAX_ASSETS, IMAGE_CHECK_MAX_BYTES, IMAGE_CHECK_SOURCE, IMAGE_ONLY_FACTS, MULTIMODAL_PROMPT_VERSION,
  describeImageAssets, factImageCheck, imageCheckCounts, imageCheckFindingText, reconcileImageFinding, type ImageCheckAsset, type ImageCheckFinding, type ImageCheckMode, type ImageCheckResult } from '../../shared/multimodal';
import { ignoredRefs } from '../../shared/checks';
import type { FactSnapshot } from '../../shared/contracts';
import type { Fact, Task } from '../../src/types';
import type { ServerConfig } from '../config';
import { AppError } from '../errors';
import { readProductAsset } from './assets';
import type { ImageCheckProvider, ImageCheckRequest } from '../providers/multimodal';
import { imageOnlyFactKey } from '../providers/multimodalValidation';
import { invalidateDownstream } from './invalidation';

type Writer = Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const ROLE_ORDER = ['main', 'detail', 'packaging', 'spec', 'other'];
/** A disagreement outranks an agreement, and a confident finding outranks a vague one. */
const RANK: Record<string, number> = { differ: 4, agree: 3, not_visible: 2, unreadable: 1, not_checked: 0 };

/**
 * Multimodal module (business-flow module 4). Reads the selected SKU only: its own pictures and its
 * own facts, never the catalogue, and never cost or declared value. The result is a proposal — the
 * module annotates facts for a person and adds pending candidates, but changes no V1 fact.
 */
export type ImageCheckInput = { snapshot: FactSnapshot; /** Facts the pictures are compared against; defaults to the card in force. */ facts?: Fact[]; baseVersion?: 1 | 2 };

export async function runImageCheck(reader: Writer, config: ServerConfig, userId: string, input: ImageCheckInput, provider: ImageCheckProvider): Promise<ImageCheckResult> {
  const { snapshot } = input; const facts = input.facts ?? snapshot.facts;
  const row = await reader.launchTask.findUnique({ where: { id: snapshot.taskId } });
  if (!row) throw new AppError('not_found', 'Task not found.', 404);
  const task: Task = { id: row.code, platform: row.platform, market: row.market, category: row.category, requirements: row.requirements as string[], minProfit: row.minimumProfit };

  // A picture a person dropped from the check is not read again and not sent again: the decision is
  // recorded on the product, so a later run cannot quietly resurrect a rejected picture.
  const dropped = ignoredRefs(snapshot.product.checkDecisions, 'image_text');
  const pictures = snapshot.assets.filter(asset => asset.kind === 'image' && asset.mimeType.startsWith('image/'))
    .filter(asset => !dropped.includes(asset.fileName))
    .sort((left, right) => ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role));
  // A dropped picture is still on file, so the run says that instead of reporting that the SKU has no
  // picture at all. It is listed as dropped, never sent, and never read again.
  const keptOnFile = snapshot.assets.filter(asset => asset.kind === 'image' && asset.mimeType.startsWith('image/') && dropped.includes(asset.fileName));
  // One photo reused by another SKU is the cheapest honest sign that it is not this product's picture.
  const shared = pictures.length ? await reader.productAsset.findMany({ where: { userId, sha256: { in: pictures.map(asset => asset.sha256) }, productId: { not: snapshot.productId } }, select: { sha256: true, sku: true } }) : [];
  const reuseByHash: Record<string, string[]> = {};
  for (const asset of shared) (reuseByHash[asset.sha256] ??= []).push(asset.sku);
  const described = describeImageAssets({ references: snapshot.product.assetReferences ?? [], assets: [...pictures, ...keptOnFile], reuseByHash, dropped });
  const assets: ImageCheckAsset[] = described.assets.map(asset => ({ ...asset }));
  // The evidence says which picture was left out and why, instead of silently checking fewer files.
  const leftOut = dropped.filter(name => snapshot.assets.some(asset => asset.fileName === name));
  if (leftOut.length) described.notes.push(`Dropped from the check by a recorded human decision: ${leftOut.join(', ')}.`);

  const images: ImageCheckRequest['images'] = []; let bytes = 0;
  // An offline provider reads the files as files, so their bytes never have to be loaded at all.
  if (!provider.readsPictures && pictures.length) described.notes.push('Offline mode compares the files themselves, not the picture content: no image was read or sent.');
  for (const picture of provider.readsPictures ? pictures : []) {
    const entry = assets.find(candidate => candidate.assetId === picture.recordId);
    if (!entry) continue;
    if (images.length >= IMAGE_CHECK_MAX_ASSETS || bytes + picture.byteSize > IMAGE_CHECK_MAX_BYTES) {
      entry.status = 'skipped'; entry.note = 'Not sent: the check keeps the smallest necessary picture set'; continue;
    }
    try {
      const stored = await readProductAsset(reader, config, userId, picture.recordId!);
      images.push({ asset: picture, mimeType: stored.mimeType, dataUrl: `data:${stored.mimeType};base64,${stored.bytes.toString('base64')}` });
      bytes += stored.bytes.byteLength;
    } catch (error) {
      entry.status = 'skipped';
      entry.note = error instanceof AppError && error.code === 'asset_missing' ? 'Stored file is missing on disk' : 'Picture could not be read';
    }
  }

  const outcome = await provider.analyze({ product: snapshot.product, task, facts, images, assets, notes: described.notes });
  // The words are the model's reading; whether a printed figure the fact does not state counts as an
  // agreement is not — that comparison is deterministic, so an over-generous reading cannot file it away.
  const findings = outcome.findings.map(finding => reconcileImageFinding(finding, facts.find(fact => fact.key === finding.factKey)?.value));
  // A degraded run reports itself as local, so the stored evidence never claims a vision model looked at the pictures.
  const mode: ImageCheckMode = provider.name === 'qwen' && !outcome.fallbackReason ? 'qwen' : 'local';
  return { sku: snapshot.product.sku, mode, provider: provider.name, model: mode === 'qwen' ? provider.model : 'local-resource-check',
    fallbackReason: outcome.fallbackReason,
    // Attached pictures count even offline: the files were checked, only their content was not read.
    status: !pictures.length ? 'no_images' : mode === 'qwen' ? 'enhanced' : 'needs_review',
    promptVersion: MULTIMODAL_PROMPT_VERSION, baseVersion: input.baseVersion ?? (snapshot.v2 ? 2 : 1), findings, assets, notes: outcome.notes,
    transmitted: mode === 'qwen' ? images.map(image => ({ fileName: image.asset.fileName, byteSize: image.asset.byteSize, sha256: image.asset.sha256 })) : [],
    counts: imageCheckCounts(findings), aiCallId: outcome.aiCallId, latencyMs: outcome.latencyMs, checkedAt: new Date().toISOString() };
}

const findingText = imageCheckFindingText;

/**
 * Writes one check back into the task-level card: the verdict lands on the task facts it compared,
 * image-only observations become pending candidates, and the run itself stays visible as evidence
 * together with the exact pictures that were sent. V1 is never touched: annotating it would be
 * rewriting the base facts the module is forbidden to change.
 */
export type ImageCheckContext = { v2Id: string; userId: string; taskId: string; productId: string; sku: string };

export async function storeImageCheck(tx: Writer, context: ImageCheckContext, result: ImageCheckResult) {
  const { v2Id } = context;
  await tx.evidence.deleteMany({ where: { factCardId: v2Id, kind: 'image_check' } });
  const best = new Map<string, ImageCheckFinding>();
  for (const finding of result.findings) {
    if (!finding.factKey) continue;
    const current = best.get(finding.factKey);
    if (!current || RANK[finding.verdict] > RANK[current.verdict] || (RANK[finding.verdict] === RANK[current.verdict] && finding.confidence > current.confidence)) best.set(finding.factKey, finding);
  }
  const stored = await tx.fact.findMany({ where: { factCardId: v2Id } });
  for (const fact of stored) {
    const finding = best.get(fact.key);
    // A run owns the annotations it writes. A field this run never compared must not keep the verdict
    // an earlier run left behind, or the card would report a comparison that no longer happened.
    if (!finding) {
      const stale = { ...(fact.metadata as object ?? {}) } as Record<string, unknown>;
      if (!('imageCheck' in stale)) continue;
      delete stale.imageCheck;
      await tx.fact.update({ where: { id: fact.id }, data: { metadata: json(stale) } });
      continue;
    }
    const metadata = { ...(fact.metadata as object ?? {}) } as Record<string, unknown>;
    const previous = (metadata.imageCheck as { verdict?: string } | undefined)?.verdict;
    const annotation = factImageCheck(finding, { mode: result.mode, model: result.model, checkedAt: result.checkedAt }) as unknown as Record<string, unknown>;
    // Keeping the earlier verdict makes a re-run auditable instead of silently replacing a judgement.
    if (previous && previous !== finding.verdict) annotation.previousVerdict = previous;
    metadata.imageCheck = annotation;
    await tx.fact.update({ where: { id: fact.id }, data: { metadata: json(metadata) } });
  }
  const existing = new Set((await tx.fact.findMany({ where: { factCardId: v2Id }, select: { key: true } })).map(fact => fact.key));
  for (const finding of result.findings) {
    if (finding.factKey || finding.verdict !== 'agree' || !finding.imageValue) continue;
    const key = imageOnlyFactKey(finding.attribute);
    // A key a person already owns is never overwritten by a machine observation.
    if (!key || existing.has(key)) continue;
    existing.add(key);
    const label = IMAGE_ONLY_FACTS.find(fact => fact.key === key)?.label ?? key;
    await tx.fact.create({ data: { factCardId: v2Id, key, value: finding.imageValue, source: IMAGE_CHECK_SOURCE,
      anchor: [finding.asset, finding.region].filter(Boolean).join(' · '), status: 'Requires Confirmation', listingAllowed: false,
      metadata: json({ label, sourceKind: 'image', valueType: 'string', imageCheck: factImageCheck(finding, { mode: result.mode, model: result.model, checkedAt: result.checkedAt }) }) } });
  }
  await tx.evidence.create({ data: { factCardId: v2Id, kind: 'image_check', source: IMAGE_CHECK_SOURCE, data: json({
    id: `IMGCHK-${result.mode.toUpperCase()}`, name: 'Multimodal picture text check', type: 'image_check', sourceKind: 'image',
    file: `${result.model} · ${result.transmitted.length} of ${result.assets.length} pictures`,
    anchor: `${result.counts.agree} agree · ${result.counts.differ} differ · ${result.counts.not_visible} no such text · ${result.counts.not_checked} not checked`,
    extracted: [...result.findings.map(findingText), ...result.notes],
    imageCheck: { mode: result.mode, model: result.model, status: result.status, promptVersion: result.promptVersion, checkedAt: result.checkedAt, fallbackReason: result.fallbackReason,
      counts: result.counts, transmitted: result.transmitted, assets: result.assets, notes: result.notes, findings: result.findings,
      aiCallId: result.aiCallId, latencyMs: result.latencyMs } }) } });
  // A disagreement is settled in the check area, next to the evidence it came from, so nothing about
  // it is queued on Materials: that queue only carries what an uploaded supplier file got wrong.
  await clearImageDisputes(tx, context);
}

/**
 * The upload queue on Materials answers "what needs a human?" for imported files only. An earlier
 * version of this module pushed picture disagreements into it as well; the rows it left behind are
 * removed here, so the queue stops carrying decisions that belong to the check area.
 */
const imageBatchName = (sku: string) => `Product image check · ${sku}`;
async function clearImageDisputes(tx: Writer, context: ImageCheckContext) {
  const batch = await tx.importBatch.findFirst({ where: { userId: context.userId, mode: IMAGE_CHECK_BATCH_MODE, fileName: imageBatchName(context.sku) } });
  if (!batch) return;
  await tx.importOccurrence.deleteMany({ where: { batchId: batch.id, userId: context.userId } });
  await tx.importBatch.delete({ where: { id: batch.id } });
}
/**
 * Closes the adjudication rows that belong to a decision taken in the check area, so one picture
 * disagreement never stays pending in two places. Matching is by fact key or by picture, never by
 * guesswork: rows that were not decided stay pending for the ImportReview queue.
 */
export async function settleImageOccurrences(tx: Writer, userId: string, input: { sku: string; factKey?: string; asset?: string; action: 'use_incoming' | 'edited' | 'skipped' }) {
  const batch = await tx.importBatch.findFirst({ where: { userId, mode: IMAGE_CHECK_BATCH_MODE, fileName: imageBatchName(input.sku) } });
  if (!batch) return 0;
  const pending = await tx.importOccurrence.findMany({ where: { batchId: batch.id, userId, resolution: 'pending' } });
  const matches = pending.filter(row => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return input.factKey ? String(payload.factKey ?? '') === input.factKey : String(payload.asset ?? '') === input.asset;
  });
  for (const row of matches) await tx.importOccurrence.update({ where: { id: row.id }, data: { resolution: input.action, resolvedAt: new Date() } });
  if (matches.length) {
    const remaining = await tx.importOccurrence.count({ where: { batchId: batch.id, resolution: 'pending' } });
    await tx.importBatch.update({ where: { id: batch.id }, data: { status: remaining ? 'needs_review' : 'completed' } });
  }
  return matches.length;
}

/**
 * Applies a human decision to one image-check dispute. "Keep the stored value" changes nothing;
 * "use the observed value" replaces the task-card value but leaves the fact unconfirmed and
 * not listing-allowed, because a person still has to authorize it. V1 is never touched.
 * "Create a separate product" is meaningless here and is refused rather than silently ignored.
 */
export async function applyImageCheckResolution(tx: Writer, userId: string, occurrence: { id: string; payload: Prisma.JsonValue; sku: string }, action: 'keep_existing' | 'use_incoming' | 'separate' | 'skipped' | 'edited') {
  if (action === 'separate') throw new AppError('not_applicable', 'An image check cannot create a product.', 409);
  const payload = (occurrence.payload ?? {}) as Record<string, unknown>;
  const taskId = String(payload.taskId ?? ''); const productId = String(payload.productId ?? ''); const factKey = String(payload.factKey ?? '');
  let listingChanged = false;
  if (action === 'use_incoming' && taskId && productId && factKey) {
    const card = await tx.factCard.findFirst({ where: { userId, taskId, productId, version: 2 }, orderBy: { revision: 'desc' } });
    if (!card) throw new AppError('facts_not_analyzed', 'The task fact card no longer exists.', 409);
    const fact = await tx.fact.findFirst({ where: { factCardId: card.id, key: factKey } });
    if (!fact) throw new AppError('not_found', 'That fact no longer exists on the task card.', 404);
    const metadata = { ...(fact.metadata as object ?? {}) } as Record<string, unknown>;
    metadata.previousValue = fact.value; metadata.previousSource = fact.source; metadata.sourceKind = 'image';
    await tx.fact.update({ where: { id: fact.id }, data: { value: String(payload.imageValue ?? '').slice(0, 200), source: IMAGE_CHECK_SOURCE,
      anchor: [payload.asset, payload.region].filter(Boolean).join(' · '), status: 'Requires Confirmation', listingAllowed: false, metadata: json(metadata) } });
    await tx.factCard.update({ where: { id: card.id }, data: { revision: { increment: 1 } } });
    listingChanged = true;
  }
  await tx.importOccurrence.update({ where: { id: occurrence.id }, data: { resolution: action, resolvedProductId: productId || null, resolvedAt: new Date() } });
  if (listingChanged) await invalidateDownstream(tx, taskId, productId);
  return { resolvedProductId: productId || null, catalogChanged: false, listingChanged };
}

/** Human-readable lines for the evidence modal, shared with the offline demo path. */
export const imageCheckLines = (result: Pick<ImageCheckResult, 'findings' | 'notes'>) => [...result.findings.map(findingText), ...result.notes];
