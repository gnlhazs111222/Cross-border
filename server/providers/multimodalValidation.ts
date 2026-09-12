import { z } from 'zod';
import { IMAGE_EXCLUDED_KEYS, IMAGE_ONLY_FACTS, type ImageCheckFinding } from '../../shared/multimodal';
import { MULTIMODAL_ATTRIBUTES } from '../prompts/multimodal-v2';

/** Verdicts a model may return. not_checked belongs to the local analyser only. */
const verdicts = ['agree', 'differ', 'not_visible', 'unreadable'] as const;

export const multimodalOutputSchema = z.object({
  findings: z.array(z.object({
    factKey: z.string().min(1).max(80).nullable(),
    attribute: z.string().min(1).max(60),
    /** Empty is allowed and expected whenever no wording was read: a verdict never carries a made-up quote. */
    imageValue: z.string().max(200),
    verdict: z.enum(verdicts),
    confidence: z.number().min(0).max(1),
    asset: z.string().min(1).max(160),
    region: z.string().min(1).max(60),
  }).strict()).max(12),
}).strict();
export type MultimodalOutput = z.infer<typeof multimodalOutputSchema>;

/** Which pending candidate a printed wording joins when no fact of this product covers it. */
const IMAGE_ONLY_ATTRIBUTES: Record<string, string> = {
  visibleText: 'imageVisibleText', capacityMark: 'imageVisibleText', materialMark: 'imageVisibleText', modelMark: 'imageVisibleText',
  originMark: 'imageVisibleText', colorMark: 'imageVisibleText', barcodeText: 'imageVisibleText', labelText: 'imageVisibleText',
  packagingText: 'imagePackagingMark',
};
const EXCLUDED = new Set<string>(IMAGE_EXCLUDED_KEYS);
/** Attributes the pictures may be asked about. One unrecognised label is dropped on its own, not allowed to fail the whole call. */
const KNOWN_ATTRIBUTES = new Set<string>(MULTIMODAL_ATTRIBUTES);

/**
 * Turns raw model output into findings we are willing to store. Everything is dropped unless it can be
 * traced to a picture we actually sent and a fact we actually hold, an agreement or disagreement has to
 * quote the words it is based on, and performance, safety and commercial fields never reach this point.
 */
export function mapMultimodalFindings(output: MultimodalOutput, context: { facts: { key: string; value: string }[]; images: { file: string }[] }): { findings: ImageCheckFinding[]; dropped: string[] } {
  const factValue = new Map(context.facts.map(fact => [fact.key, fact.value]));
  const imageFiles = new Set(context.images.map(image => image.file));
  const imageOnlyKeys = new Set(IMAGE_ONLY_FACTS.map(fact => fact.key));
  const findings: ImageCheckFinding[] = []; const dropped: string[] = []; const seen = new Set<string>();
  for (const finding of output.findings) {
    if (!imageFiles.has(finding.asset)) { dropped.push(`${finding.attribute}: cites an image that was not sent`); continue; }
    if (!KNOWN_ATTRIBUTES.has(finding.attribute)) { dropped.push(`${finding.attribute}: not an attribute the pictures can be asked about`); continue; }
    const key = finding.factKey;
    if (key && EXCLUDED.has(key)) { dropped.push(`${key}: performance, safety and commercial fields are out of scope`); continue; }
    const quoted = finding.imageValue.trim();
    // A comparison without the printed words behind it is a guess, so only the two read-failure verdicts survive without a quote.
    if (!quoted && (finding.verdict === 'agree' || finding.verdict === 'differ')) { dropped.push(`${finding.attribute}: ${finding.verdict} without quoting the printed text`); continue; }
    const knownKey = key === null ? null : factValue.has(key) ? key : imageOnlyKeys.has(key) ? key : null;
    if (key !== null && knownKey === null) { dropped.push(`${key}: not a fact of this product`); continue; }
    // A printed wording is stored once per attribute and image, so repeats add nothing.
    const identity = `${finding.asset}|${finding.attribute}|${knownKey ?? 'new'}`;
    if (seen.has(identity)) { dropped.push(`${finding.attribute}: duplicate finding`); continue; }
    seen.add(identity);
    findings.push({ factKey: knownKey, attribute: finding.attribute,
      imageValue: finding.verdict === 'agree' || finding.verdict === 'differ' ? quoted : '',
      factValue: knownKey ? factValue.get(knownKey) ?? '' : '',
      verdict: finding.verdict, confidence: Math.round(finding.confidence * 100) / 100, asset: finding.asset, region: finding.region.trim() });
  }
  return { findings, dropped };
}

/** Attributes whose printed wording may be added as a pending candidate fact when no existing fact covers it. */
export const imageOnlyFactKey = (attribute: string): string | null => IMAGE_ONLY_ATTRIBUTES[attribute] ?? null;