import type { Prisma, PrismaClient } from '@prisma/client';
import { appliedFactDecision, type CheckDecision } from '../../shared/checks';
import type { FactSnapshot } from '../../shared/contracts';
import type { Fact, Product } from '../../src/types';
import { AppError } from '../errors';
import type { ServerConfig } from '../config';
import { readProductAsset } from './assets';
import { reportNameMatches, type QualityReportReader } from '../providers/qualityReport';
import { factSnapshotTx, readFact, storedFact } from './facts';
import { invalidateDownstream } from './invalidation';
import { settleImageOccurrences } from './multimodal';
import { IMAGE_CHECK_SOURCE } from '../../shared/multimodal';

type Writer = Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/**
 * Decisions taken in the check area. Every one of them answers a single raised problem: take what the
 * picture prints, correct the value by hand, drop the picture, or drop a quality report. The value
 * lives on the task card only — V1 keeps whatever the supplier delivered — and dropping evidence is
 * recorded on the product so the check honours it on every later run.
 */
export type CheckDecisionRequest =
  | { action: 'adopt_printed_text'; factKey: string }
  | { action: 'edited'; factKey: string; value: string }
  | { action: 'discard_image'; asset: string }
  | { action: 'restore_image'; asset: string }
  | { action: 'discard_report'; reportNo: string };
export type CheckDecisionInput =
  | { action: 'adopt_printed_text'; factKey: string; expectedRevision: number }
  | { action: 'edited'; factKey: string; value: string; expectedRevision: number }
  | { action: 'discard_image'; asset: string; expectedRevision: number }
  | { action: 'restore_image'; asset: string; expectedRevision: number }
  | { action: 'discard_report'; reportNo: string; expectedRevision: number };

/**
 * Records the quality report a person submits for a SKU. An import can carry one too, but a SKU with
 * no report cannot move on, so the check area has to be able to produce one without re-importing the
 * whole supplier sheet. What is stored is the laboratory's statement, never our own comparison: the
 * capacity and material in it are only ever compared against the facts, never written over them.
 *
 * When the submission carries a picture, the document itself is read: the validity date comes from the
 * picture (it is never typed in), a report that prints no date or an expired one is refused, and a
 * report issued for another product is refused rather than filed against this SKU.
 */
export async function recordQualityReport(db: PrismaClient, config: ServerConfig, userId: string, productId: string,
  input: { reportNo: string; result?: 'pass' | 'fail'; validUntil?: string; assetId?: string }, readReport?: QualityReportReader) {
  const row = await db.product.findFirst({ where: { userId, OR: [{ id: productId }, { sku: productId }] } });
  if (!row) throw new AppError('not_found', 'Product not found.', 404);
  const data = row.data as unknown as Product;
  const read = input.assetId && readReport ? await readSubmittedReport(db, config, userId, row.id, data, input.assetId, readReport, input.reportNo, input.result) : null;
  // The verdict is read from the document like the date; a submission without a picture and without a
  // verdict is filed as a pass, which is what the reference samples state.
  const report = read ?? { reportNo: input.reportNo, result: input.result ?? 'pass', ...(input.validUntil ? { validUntil: input.validUntil } : {}) };
  // Submitting a report can close or open publishing, which the publish gate reads live, so no
  // downstream result has to be invalidated here: nothing already produced quotes this document.
  await db.product.update({ where: { id: row.id }, data: { revision: { increment: 1 }, data: json({ ...data, qualityReport: report }) } });
  return { productId: row.id, report };
}

/**
 * The picture half of a submission: the stored file is read by the vision model, and only a document
 * that prints a usable validity date and names this product is filed. Nothing here writes a fact.
 */
async function readSubmittedReport(db: PrismaClient, config: ServerConfig, userId: string, productRowId: string, product: Product,
  assetId: string, readReport: QualityReportReader, submittedNo: string, submittedResult: 'pass' | 'fail' | undefined) {
  const asset = await db.productAsset.findFirst({ where: { userId, productId: productRowId, id: assetId } });
  if (!asset) throw new AppError('asset_not_found', 'That file is not attached to this product.', 404);
  if (asset.kind !== 'image') throw new AppError('report_not_a_picture', 'Attach the report as a picture: the validity date is read from it.', 400);
  const stored = await readProductAsset(db, config, userId, asset.id);
  const reading = await readReport({ fileName: asset.fileName, mimeType: stored.mimeType,
    dataUrl: `data:${stored.mimeType};base64,${stored.bytes.toString('base64')}`, product: { sku: product.sku, name: product.name } });
  if (!reading.validUntil) throw new AppError('report_without_valid_date', 'The picture prints no valid date. Submit a report that states one.', 422);
  if (reading.validUntil < new Date().toISOString().slice(0, 10)) throw new AppError('report_expired', 'The report on this picture is already expired. Submit a current one.', 422);
  // The reading itself decides whether the document names this product; the word comparison only covers
  // the case where the model returned a name but no verdict on it.
  const namesAnotherProduct = reading.productMatch === false
    || (reading.productMatch === undefined && !!reading.productName && !reportNameMatches(reading.productName, product.name));
  if (namesAnotherProduct) {
    // Say what the picture actually printed: a person has to be able to see why it was refused.
    throw new AppError('report_name_mismatch', `报告图片上的产品名称是「${reading.productName ?? '未读到'}」，当前商品是（${product.sku}）「${product.name}」，两者不符，请换成本商品的质检报告图片。`, 422);
  }
  // The date is never typed in, so it comes from the document; the number stays what the operator filed,
  // with the printed one as the fallback for a number they did not type.
  return { reportNo: submittedNo || reading.reportNo || product.sku, result: reading.result ?? submittedResult ?? 'pass', validUntil: reading.validUntil };
}

export async function decideCheck(db: PrismaClient, userId: string, taskId: string, productId: string, input: CheckDecisionInput): Promise<FactSnapshot> {
  return db.$transaction(async tx => {
    const before = await factSnapshotTx(tx, userId, taskId, productId);
    if (before.factsRevision !== input.expectedRevision) throw new AppError('facts_changed', 'Facts changed. Reload the current facts before deciding.', 409);
    const productRow = await tx.product.findFirst({ where: { userId, id: before.productId } });
    if (!productRow) throw new AppError('not_found', 'Product not found.', 404);
    const data = productRow.data as unknown as Product;
    const v2Id = before.v2?.recordId;

    if (input.action === 'discard_image' || input.action === 'discard_report' || input.action === 'restore_image') {
      const target = input.action === 'discard_report' ? 'quality_report' as const : 'image_text' as const;
      const ref = input.action === 'discard_report' ? input.reportNo.trim() : input.asset.trim();
      if (!ref) throw new AppError('invalid_request', 'Name the evidence this decision is about.', 400);
      if (input.action === 'discard_report' && data.qualityReport?.reportNo !== ref) throw new AppError('not_found', 'That quality report is not on file for this product.', 404);
      const kept = (data.checkDecisions ?? []).filter(decision => !(decision.target === target && decision.ref === ref));
      // Restoring reads the same log the other way: the entry goes away, so the next run reads and
      // sends that picture again. Nothing else about the product changes.
      const decisions: CheckDecision[] = input.action === 'restore_image' ? kept
        : [...kept, { target, ref, by: await decisionAuthor(tx, userId), at: new Date().toISOString() }];
      await tx.product.update({ where: { id: productRow.id }, data: { revision: { increment: 1 }, data: json({ ...data, checkDecisions: decisions }) } });
      let cleared = 0;
      if (input.action === 'discard_image' && v2Id) {
        // The alarm disappears with the decision: the verdicts this picture contributed are removed,
        // and the pending rows it opened are closed as skipped in the same adjudication queue.
        const rows = await tx.fact.findMany({ where: { factCardId: v2Id } });
        for (const row of rows) {
          const metadata = { ...(row.metadata as object ?? {}) } as Record<string, unknown>;
          if ((metadata.imageCheck as { asset?: string } | undefined)?.asset !== ref) continue;
          // A field that exists only because this picture printed something is the picture's own
          // candidate, not a fact the supplier or a person owns: dropping the picture drops it too.
          if (metadata.sourceKind === 'image' && row.source === IMAGE_CHECK_SOURCE) {
            await tx.fact.delete({ where: { id: row.id } });
            cleared += 1;
            continue;
          }
          delete metadata.imageCheck;
          await tx.fact.update({ where: { id: row.id }, data: { metadata: json(metadata) } });
          cleared += 1;
        }
        if (cleared) await tx.factCard.update({ where: { id: v2Id }, data: { revision: before.factsRevision + 1 } });
        await settleImageOccurrences(tx, userId, { sku: before.product.sku, asset: ref, action: 'skipped' });
      }
      return factSnapshotTx(tx, userId, taskId, productId, false);
    }

    if (!v2Id) throw new AppError('facts_not_analyzed', 'Create the enhanced fact card before deciding on a check.', 409);
    const row = await tx.fact.findFirst({ where: { factCardId: v2Id, key: input.factKey } });
    if (!row) throw new AppError('not_found', 'That fact is not on the task card.', 404);
    const fact = readFact(row);
    let updated: Fact;
    try { updated = appliedFactDecision(fact, input); } catch (error) { throw new AppError('not_a_dispute', error instanceof Error ? error.message : 'That field has no open picture disagreement.', 409); }
    await tx.fact.update({ where: { id: row.id }, data: storedFact(updated) });
    await tx.factCard.update({ where: { id: v2Id }, data: { revision: before.factsRevision + 1 } });
    await settleImageOccurrences(tx, userId, { sku: before.product.sku, factKey: row.key, action: input.action === 'adopt_printed_text' ? 'use_incoming' : 'edited' });
    await invalidateDownstream(tx, before.taskId, before.productId);
    return factSnapshotTx(tx, userId, taskId, productId, true);
  }, { timeout: 20000 });
}

/** The person behind a decision: the account it was taken under, never a client-supplied name. */
async function decisionAuthor(tx: Writer, userId: string) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  return user.email;
}
