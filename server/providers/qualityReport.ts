import { createHash } from 'node:crypto';
import { z } from 'zod';
import { QUALITY_REPORT_PROMPT_VERSION, QUALITY_REPORT_SYSTEM_PROMPT, qualityReportModelPrompt } from '../prompts/quality-report-v1';
import type { TextModelProvider } from './text';

/** What the document states. Every field is optional: a report may simply not print one. */
export const qualityReportReadingSchema = z.object({
  productName: z.string().max(220).nullish(),
  productMatch: z.boolean().nullish(),
  reportNo: z.string().max(120).nullish(),
  validUntil: z.string().max(40).nullish(),
  result: z.enum(['pass', 'fail', 'unknown']).nullish(),
}).strict();

export type QualityReportReading = { productName?: string; productMatch?: boolean; reportNo?: string; validUntil?: string; result?: 'pass' | 'fail' };
export type QualityReportReader = (input: { fileName: string; mimeType: string; dataUrl: string; product: { sku: string; name: string } }) => Promise<QualityReportReading>;

/**
 * The printed date in the shapes reports actually use — 2027-06-30, 2027/6/30, 2027年6月30日. Anything
 * that does not resolve to a real calendar date is treated as "no date printed", never as a guess.
 */
export function normalizeReportDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = String(value).match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (!match) return undefined;
  const candidate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? undefined : candidate;
}

/**
 * Does the name printed on the report describe this product? A report issued for another SKU does not
 * certify this one, so the words that carry the identity have to line up: every word of the shorter
 * name must appear in the longer one, which tolerates a partially read name but not a different
 * variant ("… 520ml Blue" against "… 520ml Pink" is another product).
 */
export function reportNameMatches(printed: string, name: string): boolean {
  const words = (value: string) => new Set(value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(word => word.length > 1));
  const left = words(printed); const right = words(name);
  if (!left.size || !right.size) return true;
  const [shorter, longer] = left.size <= right.size ? [left, right] : [right, left];
  return [...shorter].every(word => longer.has(word));
}

export function createQualityReportReader(text: TextModelProvider, options: { model: string; maxTokens: number }): QualityReportReader {
  return async input => {
    const { data: reading } = await text.generateStructured({
      prompt: qualityReportModelPrompt({ fileName: input.fileName, sku: input.product.sku, name: input.product.name }),
      purpose: 'quality_report', systemPrompt: QUALITY_REPORT_SYSTEM_PROMPT, maxTokens: options.maxTokens,
      promptVersion: QUALITY_REPORT_PROMPT_VERSION, mode: 'vision' as const,
      inputHash: createHash('sha256').update(JSON.stringify({ file: input.fileName, sku: input.product.sku, model: options.model })).digest('hex'),
      images: [{ fileName: input.fileName, dataUrl: input.dataUrl }],
      schema: qualityReportReadingSchema, example: { productName: null, reportNo: null, validUntil: null, result: 'unknown' },
    });
    const validUntil = normalizeReportDate(reading.validUntil);
    return { ...(reading.productName ? { productName: reading.productName.trim() } : {}), ...(typeof reading.productMatch === 'boolean' ? { productMatch: reading.productMatch } : {}),
      ...(reading.reportNo ? { reportNo: reading.reportNo.trim() } : {}),
      ...(validUntil ? { validUntil } : {}), ...(reading.result === 'pass' || reading.result === 'fail' ? { result: reading.result } : {}) };
  };
}
