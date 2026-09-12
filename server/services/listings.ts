import { type ListingRuntime, type AuthorizedListing } from '../providers/qwenListing';
import { validateGeneratedListingAgainstFacts, listingOutputSchema } from '../providers/listingValidation';
import { Prisma, type PrismaClient, type ListingDraft } from '@prisma/client';
import type { Listing, Platform } from '../../src/types';
import type { WorkflowSnapshot, FactSnapshot } from '../../shared/contracts';
import { amazonCsv } from '../../shared/csv';
import { AppError } from '../errors';
import { domainProviders } from '../providers/domain';
import { factSnapshotTx } from './facts';
import { hardReviewIssues, reviewInputHash, rulesReviewRuntime } from '../providers/qwenReview';
import { REVIEW_PROMPT_VERSION, REVIEW_RULE_VERSION, type ReviewInput, type ReviewMetadata } from '../../shared/review';
import { demoRiskClaim } from '../../shared/domain';

type DB = Prisma.TransactionClient;
export type VersionInput = { expectedVersion: number; expectedFactsRevision: number };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const toListing = (row: ListingDraft): Listing => { const { authorization: _private, ...data } = row.data as unknown as AuthorizedListing; void _private; return { ...data, recordId: row.id, revision: row.revision, factRevision: row.factRevision, platform: row.platform as Platform, status: row.status, generationMode: row.generationMode }; };
const active = (row: ListingDraft) => !['stale', 'superseded'].includes(row.status);
async function owned(db: DB, userId: string, id: string) {
  const row = await db.listingDraft.findFirst({ where: { id, userId, task: { userId }, product: { userId } } });
  if (!row) throw new AppError('not_found', 'Listing not found.', 404);
  return row;
}
async function latest(db: DB, row: Pick<ListingDraft, 'taskId' | 'productId' | 'platform'>) {
  return db.listingDraft.findFirst({ where: { taskId: row.taskId, productId: row.productId, platform: row.platform }, orderBy: { revision: 'desc' } });
}
function checkFacts(snap: FactSnapshot, revision: number) {
  if (snap.factsRevision !== revision) throw new AppError('facts_changed', 'Facts changed. Reload the current facts before retrying.', 409);
}
async function current(db: DB, userId: string, id: string, input: VersionInput, allowStale = false) {
  const row = await owned(db, userId, id); const head = await latest(db, row);
  if (head?.id !== row.id || row.revision !== input.expectedVersion) throw new AppError('listing_changed', 'Listing changed. Reload the current version before retrying.', 409);
  const snap = await factSnapshotTx(db, userId, row.taskId, row.productId); checkFacts(snap, input.expectedFactsRevision);
  if (!allowStale && (!active(row) || row.factRevision !== snap.listingFactsRevision)) throw new AppError('listing_stale', 'The listing is stale. Regenerate from the current facts.', 409);
  return { row, snap };
}
async function supported(snap: FactSnapshot, platform: Platform, revision: number) {
  if (!snap.listingReadiness.ready) throw new AppError('listing_blocked', 'Confirm the required listing facts before generating a listing.', 409);
  return domainProviders.listing.generate({ factCard: snap.v2!, pricing: snap.pricing, platform, revision, factRevision: snap.listingFactsRevision });
}
const defaultListingRuntime: ListingRuntime = { requested: 'template', provider: domainProviders.listing };
async function generationInput(db: DB, snap: FactSnapshot, platform: Platform, revision: number) {
  if (!snap.listingReadiness.ready) throw new AppError('listing_blocked', 'Confirm the required listing facts before generating a listing.', 409);
  const task = await db.launchTask.findUniqueOrThrow({ where: { id: snap.taskId } });
  return { factCard: snap.v2!, pricing: snap.pricing, platform, revision, factRevision: snap.listingFactsRevision,
    context: { market: task.market, category: task.category, requirements: task.requirements as string[], product: { sku: snap.product.sku, name: snap.product.name } } };
}
async function reviewBaseline(snap: FactSnapshot, row: ListingDraft): Promise<Listing> {
  const data = row.data as unknown as AuthorizedListing;
  if (row.generationMode === 'qwen' && data.authorization?.factsRevision === snap.listingFactsRevision) {
    const output = validateGeneratedListingAgainstFacts(listingOutputSchema(row.platform as Platform).parse(data.authorization.output), snap.facts);
    const { usedFacts: _used, ...copy } = output; void _used;
    return { ...toListing(row), ...copy, riskDemoInjected: false };
  }
  return supported(snap, row.platform as Platform, row.revision);
}
async function retire(db: DB, row: ListingDraft) {
  const invalidatedAt = new Date();
  await db.reviewResult.updateMany({ where: { listingDraftId: row.id, invalidatedAt: null }, data: { invalidatedAt } });
  await db.publishResult.updateMany({ where: { listingDraftId: row.id, invalidatedAt: null }, data: { invalidatedAt } });
  await db.listingDraft.update({ where: { id: row.id }, data: { status: 'superseded' } });
}
async function insert(db: DB, userId: string, snap: FactSnapshot, listing: Listing, previous?: ListingDraft | null) {
  if (previous) await retire(db, previous);
  return db.listingDraft.create({ data: { userId, taskId: snap.taskId, productId: snap.productId, platform: listing.platform, revision: listing.revision, factRevision: snap.listingFactsRevision,
    status: 'review_required', generationMode: listing.generationMode ?? 'template', data: json(listing) } });
}
// Authorization is always computed from the current DB version and facts, never client flags.
export async function canPublishListing(db: DB, userId: string, id: string, knownSnapshot?: FactSnapshot, reviewRuntime = rulesReviewRuntime): Promise<boolean> {
  const row = await owned(db, userId, id); const head = await latest(db, row);
  if (head?.id !== row.id || !['review_passed', 'published'].includes(row.status)) return false;
  const snap = knownSnapshot ?? await factSnapshotTx(db, userId, row.taskId, row.productId);
  if (snap.listingFactsRevision !== row.factRevision || !snap.listingReadiness.ready || !snap.pricingReadiness.ready) return false;
  const review = await db.reviewResult.findFirst({ where: { listingDraftId: row.id, invalidatedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  if (!review || review.revision !== row.revision || review.status !== 'passed' || review.highRiskCount !== 0 || (review.issues as unknown[]).length !== 0) return false;
  if (review.reviewMode === 'rules_qwen') {
    const input = await semanticInput(db, row, snap); const meta = review.metadata as unknown as ReviewMetadata | null;
    return !!meta && reviewRuntime.mode === 'qwen' && meta.model === reviewRuntime.model && meta.modelCalled === true
      && meta.promptVersion === REVIEW_PROMPT_VERSION && meta.ruleVersion === REVIEW_RULE_VERSION
      && meta.inputHash === reviewInputHash(input, reviewRuntime.model) && hardReviewIssues(input).length === 0;
  }
  if (reviewRuntime.mode === 'qwen') return false;
  const issues = await domainProviders.review.review(toListing(row), await reviewBaseline(snap, row));
  return issues.length === 0;
}
async function workflow(db: DB, userId: string, taskId: string, productId: string, reviewRuntime = rulesReviewRuntime): Promise<WorkflowSnapshot> {
  const snap = await factSnapshotTx(db, userId, taskId, productId);
  const result: WorkflowSnapshot = { taskId: snap.taskId, productId: snap.productId, factsRevision: snap.factsRevision, heads: {}, listings: {}, reviews: {}, publications: {}, publishAllowed: {} };
  for (const platform of ['amazon', 'shopify'] as const) {
    const row = await latest(db, { taskId: snap.taskId, productId: snap.productId, platform });
    if (!row) continue;
    const valid = active(row) && row.factRevision === snap.listingFactsRevision;
    result.heads[platform] = { recordId: row.id, revision: row.revision, status: valid ? row.status : 'stale' };
    if (!valid) continue;
    result.listings[platform] = toListing(row);
    const review = await db.reviewResult.findFirst({ where: { listingDraftId: row.id, revision: row.revision, invalidatedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (review) result.reviews[platform] = { recordId: review.id, status: review.status as import('../../shared/review').ReviewStatus, revision: review.revision, issues: review.issues as unknown as import('../../src/types').Issue[], highRiskCount: review.highRiskCount, reviewMode: review.reviewMode, ...(review.metadata ? { metadata: review.metadata as unknown as ReviewMetadata } : {}) };
    const allowed = await canPublishListing(db, userId, row.id, snap, reviewRuntime); result.publishAllowed[platform] = allowed;
    const publication = allowed ? await db.publishResult.findFirst({ where: { listingDraftId: row.id, revision: row.revision, invalidatedAt: null }, orderBy: { createdAt: 'desc' } }) : null;
    if (publication) result.publications[platform] = { recordId: publication.id, platform, productId: publication.externalDemoId, status: publication.status, revision: publication.revision };
  }
  return result;
}
// SQLite serializes local writes. Unique version constraints remain a final guard against races.
async function transaction<T>(db: PrismaClient, run: (tx: DB) => Promise<T>) {
  try { return await db.$transaction(run, { timeout: 15000 }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new AppError('listing_changed', 'Listing changed. Reload the current version before retrying.', 409);
    throw error;
  }
}
export const getWorkflow = (db: PrismaClient, userId: string, taskId: string, productId: string, reviewRuntime = rulesReviewRuntime) => transaction(db, tx => workflow(tx, userId, taskId, productId, reviewRuntime));
export async function getListing(db: PrismaClient, userId: string, id: string, reviewRuntime = rulesReviewRuntime) {
  return transaction(db, async tx => {
    const row = await owned(tx, userId, id);
    return { listing: toListing(row), reviews: await tx.reviewResult.findMany({ where: { listingDraftId: id }, orderBy: { createdAt: 'asc' } }),
      publications: await tx.publishResult.findMany({ where: { listingDraftId: id }, orderBy: { createdAt: 'asc' } }), isLatest: (await latest(tx, row))?.id === id, publishAllowed: await canPublishListing(tx, userId, id, undefined, reviewRuntime) };
  });
}
export async function createListing(db: PrismaClient, userId: string, taskId: string, productId: string, input: VersionInput & { platform: Platform }, runtime = defaultListingRuntime, reviewRuntime = rulesReviewRuntime) {
  const prepared = await transaction(db, async tx => {
    const snap = await factSnapshotTx(tx, userId, taskId, productId); checkFacts(snap, input.expectedFactsRevision);
    const previous = await latest(tx, { taskId: snap.taskId, productId: snap.productId, platform: input.platform });
    if ((previous?.revision ?? 0) !== input.expectedVersion) throw new AppError('listing_changed', 'Listing changed. Reload the current version before retrying.', 409);
    return { snap, previous, providerInput: await generationInput(tx, snap, input.platform, (previous?.revision ?? 0) + 1) };
  });
  // Network generation runs outside SQLite transactions. Revalidate both revisions before committing.
  const listing = await runtime.provider.generate(prepared.providerInput);
  if (runtime.requested === 'template' && input.platform === 'amazon' && (!prepared.previous || !active(prepared.previous) || prepared.previous.factRevision !== prepared.snap.listingFactsRevision)) { listing.bullets[2] = demoRiskClaim(prepared.snap.product.visual); listing.riskDemoInjected = true; }
  return transaction(db, async tx => {
    const snap = await factSnapshotTx(tx, userId, taskId, productId); checkFacts(snap, input.expectedFactsRevision);
    const previous = await latest(tx, { taskId: snap.taskId, productId: snap.productId, platform: input.platform });
    if ((previous?.revision ?? 0) !== input.expectedVersion) throw new AppError('listing_changed', 'Listing changed. Reload the current version before retrying.', 409);
    await insert(tx, userId, snap, listing, previous); return workflow(tx, userId, snap.taskId, snap.productId, reviewRuntime);
  });
}
export async function reviseListing(db: PrismaClient, userId: string, id: string, action: 'edit' | 'regenerate' | 'fix' | 'inject-risk', input: VersionInput & { title?: string; bullets?: string[]; description?: string }, runtime = defaultListingRuntime, reviewRuntime = rulesReviewRuntime) {
  if (action === 'regenerate') {
    const prepared = await transaction(db, async tx => { const { row, snap } = await current(tx, userId, id, input, true); return generationInput(tx, snap, row.platform as Platform, row.revision + 1); });
    const generated = await runtime.provider.generate(prepared);
    return transaction(db, async tx => { const { row, snap } = await current(tx, userId, id, input, true); await insert(tx, userId, snap, generated, row); return workflow(tx, userId, row.taskId, row.productId, reviewRuntime); });
  }
  return transaction(db, async tx => {
    const { row, snap } = await current(tx, userId, id, input);
    let listing: AuthorizedListing;
    if (action === 'edit' || action === 'inject-risk') {
      listing = { ...(row.data as unknown as AuthorizedListing), generationMode: row.generationMode, revision: row.revision + 1 };
      if (action === 'edit') Object.assign(listing, { title: input.title!, bullets: input.bullets!, description: input.description! });
      else { listing.bullets = [...listing.bullets]; listing.bullets[Math.min(2, listing.bullets.length)] = demoRiskClaim(snap.product.visual); listing.riskDemoInjected = true; }
    } else { listing = await supported(snap, row.platform as Platform, row.revision + 1); listing.generationMode = 'template'; }
    await insert(tx, userId, snap, listing, row); return workflow(tx, userId, row.taskId, row.productId, reviewRuntime);
  });
}
async function semanticInput(db: DB, row: ListingDraft, snap: FactSnapshot): Promise<ReviewInput> {
  const task = await db.launchTask.findUniqueOrThrow({ where: { id: row.taskId } });
  return { listing: toListing(row), facts: snap.facts, context: { market: task.market, category: task.category, taskRevision: task.revision }, listingRevision: row.revision, factsRevision: snap.listingFactsRevision };
}
// A process-local admission lock prevents two simultaneous attempts consuming model calls.
// The persisted attempt ID and invalidatedAt guard final writes, including task/fact edits.
const reviewing = new Set<string>();
export async function reviewListing(db: PrismaClient, userId: string, id: string, input: VersionInput, reviewRuntime = rulesReviewRuntime) {
  if (reviewRuntime.mode === 'qwen') {
    if (!reviewRuntime.provider) throw new AppError('review_unavailable', 'Reviewer is unavailable.', 503);
    if (reviewing.has(id)) throw new AppError('review_in_progress', 'This version is already being reviewed.', 409);
    reviewing.add(id);
    let attemptId: string | undefined;
    try {
      const prepared = await transaction(db, async tx => {
        const { row, snap } = await current(tx, userId, id, input);
        const running = await tx.reviewResult.findFirst({ where: { listingDraftId: id, status: 'running', invalidatedAt: null } });
        if (running && Date.now() - running.createdAt.getTime() < 180000) throw new AppError('review_in_progress', 'Review is still running. Retry after it finishes.', 409);
        const invalidatedAt = new Date();
        await tx.reviewResult.updateMany({ where: { listingDraftId: id, invalidatedAt: null }, data: { invalidatedAt } });
        await tx.publishResult.updateMany({ where: { listingDraftId: id, invalidatedAt: null }, data: { invalidatedAt } });
        const context = await semanticInput(tx, row, snap);
        const attempt = await tx.reviewResult.create({ data: { listingDraftId: id, revision: row.revision, reviewMode: 'rules_qwen', status: 'running', issues: [], highRiskCount: 0 } });
        await tx.listingDraft.update({ where: { id }, data: { status: 'review_required' } });
        return { context, attemptId: attempt.id };
      });
      attemptId = prepared.attemptId;
      const result = await reviewRuntime.provider.review(prepared.context);
      return await transaction(db, async tx => {
        const { row, snap } = await current(tx, userId, id, input);
        const context = await semanticInput(tx, row, snap);
        if (reviewInputHash(context, reviewRuntime.model) !== result.metadata.inputHash) throw new AppError('review_context_changed', 'Review context changed. Run review again.', 409);
        const attempt = await tx.reviewResult.findUniqueOrThrow({ where: { id: prepared.attemptId } });
        if (attempt.invalidatedAt || attempt.status !== 'running') throw new AppError('review_changed', 'Review attempt changed. Run review again.', 409);
        await tx.reviewResult.update({ where: { id: attempt.id }, data: { status: result.status, issues: json(result.issues), highRiskCount: result.issues.filter(i => i.severity === 'HIGH').length, metadata: json(result.metadata) } });
        await tx.listingDraft.update({ where: { id }, data: { status: result.status === 'passed' ? 'review_passed' : result.status === 'blocked' ? 'review_blocked' : 'review_required' } });
        return workflow(tx, userId, row.taskId, row.productId, reviewRuntime);
      });
    } catch (error) {
      if (attemptId) await db.reviewResult.updateMany({ where: { id: attemptId, status: 'running' }, data: { status: 'failed', invalidatedAt: new Date() } });
      throw error;
    } finally { reviewing.delete(id); }
  }
  return transaction(db, async tx => {
    const { row, snap } = await current(tx, userId, id, input);
    const issues = await domainProviders.review.review(toListing(row), await reviewBaseline(snap, row));
    const invalidatedAt = new Date();
    await tx.reviewResult.updateMany({ where: { listingDraftId: id, invalidatedAt: null }, data: { invalidatedAt } });
    await tx.publishResult.updateMany({ where: { listingDraftId: id, invalidatedAt: null }, data: { invalidatedAt } });
    const status = issues.length ? 'blocked' : 'passed';
    await tx.reviewResult.create({ data: { listingDraftId: id, revision: row.revision, status, issues: json(issues), highRiskCount: issues.filter(i => i.severity === 'HIGH').length, reviewMode: 'rules' } });
    await tx.listingDraft.update({ where: { id }, data: { status: status === 'passed' ? 'review_passed' : 'review_blocked' } });
    return workflow(tx, userId, row.taskId, row.productId, reviewRuntime);
  });
}
export async function publishListing(db: PrismaClient, userId: string, id: string, input: VersionInput, reviewRuntime = rulesReviewRuntime) {
  return transaction(db, async tx => {
    const { row, snap } = await current(tx, userId, id, input);
    if (!snap.pricingReadiness.ready) throw new AppError('pricing_required_for_publish', 'Complete pricing inputs before publishing.', 409);
    if (!await canPublishListing(tx, userId, id, undefined, reviewRuntime)) throw new AppError('publish_blocked', 'Publish blocked: the current revision must pass review.', 409);
    const existing = await tx.publishResult.findFirst({ where: { listingDraftId: id, revision: row.revision, invalidatedAt: null } });
    if (!existing) {
      const platform = row.platform as Platform;
      const externalDemoId = platform === 'amazon' ? 'AMZ-DEMO-1042' : 'SHOP-DEMO-1042';
      const pricingSnapshot = snap.pricing.snapshot;
      await tx.publishResult.create({ data: { listingDraftId: id, revision: row.revision, platform, status: platform === 'amazon' ? 'Export ready' : 'Draft', externalDemoId,
        data: { mock: true, pricingSnapshotId: pricingSnapshot?.recordId ?? null, pricingSnapshotCode: pricingSnapshot?.code ?? null, pricingSnapshotVersion: pricingSnapshot?.version ?? null } } });
    }
    await tx.listingDraft.update({ where: { id }, data: { status: 'published' } });
    return workflow(tx, userId, row.taskId, row.productId, reviewRuntime);
  });
}
export async function publishedAmazonCsv(db: PrismaClient, userId: string, publishId: string, reviewRuntime = rulesReviewRuntime) {
  return transaction(db, async tx => {
    const result = await tx.publishResult.findFirst({ where: { id: publishId, listingDraft: { userId, task: { userId }, product: { userId } } }, include: { listingDraft: { include: { product: true } } } });
    if (!result) throw new AppError('not_found', 'Publication not found.', 404);
    const row = result.listingDraft;
    if (result.platform !== 'amazon' || result.invalidatedAt || result.revision !== row.revision || !await canPublishListing(tx, userId, row.id, undefined, reviewRuntime)) throw new AppError('export_blocked', 'Publish the current reviewed Amazon draft before exporting.', 409);
    const snap = await factSnapshotTx(tx, userId, row.taskId, row.productId);
    return { filename: `PrismLaunch-${row.product.sku.replace(/[^a-zA-Z0-9_-]/g, '_')}-Amazon.csv`, csv: amazonCsv(row.product.sku, toListing(row), snap.pricing.suggestedPrice!) };
  });
}
