/**
 * The checks that sit around the fact card: the picture-text check, the quality report and the
 * transport attributes. All three follow one rule — a clean result stays quiet, only an abnormality
 * is raised for a person, and every abnormality offers a decision that is recorded.
 *
 * This file holds the quality-report half plus the decision log shared by both evidence checks. It
 * is isomorphic on purpose: the review UI reads it to raise the alarm, the server reads it to decide
 * whether a draft may publish, so "abnormal" can never mean two different things.
 */

import { IMAGE_CHECK_SOURCE } from './multimodal';
import { reviewFact } from './facts';
import { COPY_FACTS, normalizeFactValue } from '../src/services/factReview';
import type { Fact } from '../src/types';

/**
 * The two ways a picture disagreement can be settled on the fact itself: take what the picture prints,
 * or correct the value by hand. The decision *is* the authorization — a person looked at the picture and
 * the fact and picked the value that stands — so the task card keeps that value as confirmed and the
 * listing studio never asks for the same confirmation a second time. Both re-read the verdict against the
 * new value, so the alarm clears exactly when the picture and the fact start to agree.
 */
export type FactDecision = { action: 'adopt_printed_text' | 'edited'; value?: string };
/**
 * Do the stored value and the printed wording say the same thing? Spacing, case and our own unit
 * formatting are not disagreements: “750 ML”, “750ml” and “750ml / 25.4 fl oz” are one claim.
 * Anything else stays a disagreement rather than being talked into agreement.
 */
export const sameWording = (stored: string, printed: string) => {
  const clean = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const a = clean(stored); const b = clean(printed);
  if (a === b) return true;
  const numbers = (value: string) => (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const storedNumbers = numbers(a); const printedNumbers = numbers(b);
  return storedNumbers.length > 0 && printedNumbers.length > 0 && storedNumbers[0] === printedNumbers[0];
};
/** Our canonical value when the printed text is readable, the printed wording itself when it is not. */
export function adoptedFactValue(key: string, printed: string): string {
  const raw = printed.trim().slice(0, 220);
  try { return normalizeFactValue(key, raw); } catch { /* a picture may print the unit next to the number */ }
  const number = raw.match(/\d+(?:\.\d+)?/)?.[0];
  if (!number) return raw;
  try { return normalizeFactValue(key, number); } catch { return raw; }
}
export function appliedFactDecision(fact: Fact, decision: FactDecision): Fact {
  const annotation = fact.imageCheck;
  if (!annotation || annotation.verdict !== 'differ') throw new Error('That field has no open picture disagreement.');
  const now = new Date().toISOString();
  let updated: Fact;
  if (decision.action === 'adopt_printed_text') {
    if (!annotation.imageValue) throw new Error('The check read no printed text for that field.');
    const value = adoptedFactValue(fact.key, annotation.imageValue);
    updated = { ...fact, value, allowed: false, source: IMAGE_CHECK_SOURCE, sourceKind: 'image',
      anchor: [annotation.asset, annotation.region].filter(Boolean).join(' · ') || IMAGE_CHECK_SOURCE,
      previousValue: fact.value, previousSource: fact.sourceKind === 'image' ? fact.previousSource : `${fact.source} · ${fact.anchor}`,
      updatedAt: now, revision: (fact.revision ?? 0) + 1 };
  } else {
    updated = reviewFact(fact, 'edit', decision.value ?? '');
  }
  // What the person decided is what the task card holds: confirmed, and allowed into copy when the field
  // is copy material. V1 keeps the supplier's value either way.
  const decided: Fact = { ...updated, status: 'Confirmed', allowed: COPY_FACTS.includes(fact.key), confirmedAt: now };
  const agreed = sameWording(updated.value, annotation.imageValue);
  return { ...decided, imageCheck: { ...annotation, verdict: agreed ? 'agree' : 'differ', factValue: decided.value,
    ...(agreed ? { previousVerdict: annotation.previousVerdict ?? 'differ' } : {}) } };
}
/**
 * What the picture-text check actually did. "Never ran", "ran and had no picture at all", "ran but
 * read no picture" and "ran and read the pictures" are four different states, and a panel that reports
 * the first when the third happened misleads the person reading it. The counts come from the run itself,
 * so the wording stays true in both modes.
 */
export type ImageCheckRun = { status: string; mode: string; transmitted: readonly { fileName: string }[]; assets: readonly { fileName: string; status: string }[]; fallbackReason?: string };
export type ImageTextVerdict = 'not_run' | 'no_pictures' | 'dropped' | 'not_read' | 'read';
export type ImageTextAssessment = { verdict: ImageTextVerdict; attached: number; referenced: number; skipped: number; dropped: number; sent: number; fallbackReason?: string };
export function assessImageText(run?: ImageCheckRun): ImageTextAssessment {
  if (!run) return { verdict: 'not_run', attached: 0, referenced: 0, skipped: 0, dropped: 0, sent: 0 };
  const count = (status: string) => run.assets.filter(asset => asset.status === status).length;
  const attached = count('checked'); const referenced = count('missing'); const skipped = count('skipped'); const dropped = count('dropped');
  // "Nothing to read" has two different causes: the SKU has no picture, or a person dropped the only
  // one it had. Reporting the first when the second happened sends someone to upload what they hold.
  return { verdict: attached ? (run.transmitted.length ? 'read' : 'not_read') : dropped ? 'dropped' : 'no_pictures',
    attached, referenced, skipped, dropped, sent: run.transmitted.length, ...(run.fallbackReason ? { fallbackReason: run.fallbackReason } : {}) };
}

export const QUALITY_REPORT_LABELS: Record<string, string> = { capacity: 'Capacity', material: 'Material' };

/** What the report itself states, quoted from the document rather than from our facts. */
export type QualityReportStatement = { capacity?: number; material?: string };
export type QualityReport = {
  reportNo: string;
  /** A report that failed is a factual block, never a waiver. */
  result: 'pass' | 'fail';
  issuedAt?: string;
  validUntil?: string;
  /** What the document printed about the product, and the picture it was read from. */
  productName?: string;
  file?: string;
  stated?: QualityReportStatement;
};

export type InspectionVerdict = 'clear' | 'not_registered' | 'expired' | 'failed' | 'mismatch';
export type InspectionProblem = { factKey: string; label: string; factValue: string; reportValue: string };
export type InspectionAssessment = {
  verdict: InspectionVerdict;
  declared: boolean;
  /** A report was on file but a person dropped it from the check. */
  ignored: boolean;
  reportNo: string;
  problems: InspectionProblem[];
  requirements: string[];
  publishBlocked: boolean;
  /** Only a human may drop a report from the check; a failed report can never be dropped. */
  waivable: boolean;
};

/**
 * Dropping a picture or a report is a recorded human decision, not a silent deletion: the reference
 * stays on the product with who decided and when, and the check honours it on every later run.
 */
export type CheckDecisionTarget = 'image_text' | 'quality_report';
export type CheckDecision = { target: CheckDecisionTarget; ref: string; by: string; at: string };
export const ignoredRefs = (decisions: readonly CheckDecision[] | undefined, target: CheckDecisionTarget): string[] =>
  (decisions ?? []).filter(decision => decision.target === target).map(decision => decision.ref);

/** YYYY-MM-DD only: an unreadable date is reported as missing rather than guessed at. */
export const isoDate = (value?: string): string | undefined => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

/** The label a report row carries; the picture it was read from is the anchor. */
export const QUALITY_REPORT_FACT_SOURCE = 'Quality report';
/**
 * What the report on file states, written as task-card fields: the number it was filed under, the name
 * the document prints, the date it runs to and its verdict. Reading a report is evidence about the
 * product rather than a value somebody typed, so these rows carry no controls, and they are internal —
 * a certificate number and a laboratory verdict are not consumer copy. V1 keeps what the supplier
 * delivered, so they belong to the task card and appear once it exists.
 */
export function qualityReportFacts(report: QualityReport | undefined): Fact[] {
  if (!report) return [];
  const fact = (key: string, label: string, value: string): Fact => ({ key, label, value, source: QUALITY_REPORT_FACT_SOURCE,
    anchor: report.file ? `${report.file} · ${report.reportNo}` : report.reportNo, sourceKind: 'image', status: 'Confirmed', allowed: false });
  return [
    fact('qualityReportNo', 'Report number', report.reportNo),
    ...(report.productName ? [fact('qualityReportProduct', 'Report product name', report.productName)] : []),
    ...(isoDate(report.validUntil) ? [fact('qualityReportValidUntil', 'Report valid until', report.validUntil!)] : []),
    fact('qualityReportVerdict', 'Report verdict', report.result === 'pass' ? 'Qualified' : 'Unqualified'),
  ];
}

/**
 * An absent report is a data gap and stays quiet, exactly like an undeclared transport attribute.
 * A failed, expired or contradictory report is an abnormality and is raised with the reason.
 */
export function assessInspection(input: { report?: QualityReport; capacity: number; material: string; ignored?: string[]; today?: string }): InspectionAssessment {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const report = input.report;
  if (!report) return { verdict: 'not_registered', declared: false, ignored: false, reportNo: '', problems: [], requirements: [], publishBlocked: false, waivable: false };
  const base = { declared: true, reportNo: report.reportNo };
  if (input.ignored?.includes(report.reportNo)) return { ...base, verdict: 'not_registered', ignored: true, problems: [], requirements: [], publishBlocked: false, waivable: false };
  if (report.result === 'fail') return { ...base, verdict: 'failed', ignored: false, problems: [], publishBlocked: true, waivable: false,
    requirements: ['Correct the product data or withdraw the SKU: a failed report cannot be waived'] };
  const validUntil = isoDate(report.validUntil);
  if (validUntil && validUntil < today) return { ...base, verdict: 'expired', ignored: false, problems: [], publishBlocked: true, waivable: true,
    requirements: ['A report covering the current production batch'] };
  const problems = compareReport(report.stated, { capacity: input.capacity, material: input.material });
  if (problems.length) return { ...base, verdict: 'mismatch', ignored: false, problems, publishBlocked: true, waivable: true,
    requirements: ['Reconcile the report with the product facts'] };
  return { ...base, verdict: 'clear', ignored: false, problems: [], requirements: [], publishBlocked: false, waivable: false };
}

/** Only what the report certifies is compared; an absent statement is not a disagreement. */
/**
 * The one reading the flow itself needs: a report is on file and nothing in it blocks the task. The
 * check panel keeps the full assessment, because it also has to say which of the two it is.
 */
export function reportClearsNextStep(input: { report?: QualityReport; capacity: number; material: string; ignored?: string[]; today?: string }): boolean {
  const report = assessInspection(input);
  return report.declared && !report.publishBlocked;
}

/**
 * What the report is compared against. The task card wins when it exists, because a person may have
 * corrected a value there; the product row is the fallback for a SKU with no task card yet. Both the
 * review UI and the server gate read this, so they cannot disagree about what is abnormal.
 */
export function inspectionTargets(facts: readonly { key: string; value: string }[], product: { capacity: number; material: string }) {
  const value = (key: string) => facts.find(fact => fact.key === key)?.value;
  const capacity = Number.parseFloat(String(value('capacity') ?? ''));
  return { capacity: Number.isFinite(capacity) && capacity > 0 ? Math.round(capacity) : product.capacity, material: value('material') ?? product.material };
}

function compareReport(stated: QualityReportStatement | undefined, facts: { capacity: number; material: string }): InspectionProblem[] {
  if (!stated) return [];
  const problems: InspectionProblem[] = [];
  if (stated.capacity !== undefined && Number.isFinite(stated.capacity) && stated.capacity > 0 && stated.capacity !== facts.capacity) {
    problems.push({ factKey: 'capacity', label: QUALITY_REPORT_LABELS.capacity, factValue: `${facts.capacity} ml`, reportValue: `${stated.capacity} ml` });
  }
  const material = (stated.material ?? '').trim();
  if (material && material.toLowerCase() !== facts.material.trim().toLowerCase()) {
    problems.push({ factKey: 'material', label: QUALITY_REPORT_LABELS.material, factValue: facts.material, reportValue: material });
  }
  return problems;
}
