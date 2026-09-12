import type { ProductAsset } from './contracts';

/**
 * Contract for the multimodal module (business-flow module 4: 多模态解析与事实卡更新).
 *
 * The module answers one question: does the text printed on the product or its packaging agree with
 * the facts we hold? It reads printed words (capacity marks, material marks, model, origin, label and
 * packaging copy), compares them with V1/V2 facts and hands a human pending candidates. It never
 * rewrites V1 facts, never turns appearance into a material/performance/safety conclusion, and never
 * certifies anything (see the module guard in 01_业务流程图.html).
 */
export const MULTIMODAL_PROMPT_VERSION = 'multimodal-v2';
/** Import batches of this mode hold picture-text disagreements, so one adjudication queue serves both. */
export const IMAGE_CHECK_BATCH_MODE = 'image_check';
export const IMAGE_CHECK_SOURCE = 'Picture text (multimodal check)';
/** Sending every uploaded photo is neither necessary nor cheap: the main image plus a couple of details. */
export const IMAGE_CHECK_MAX_ASSETS = 4;
export const IMAGE_CHECK_MAX_BYTES = 6 * 1024 * 1024;

export type ImageVerdict = 'agree' | 'differ' | 'not_visible' | 'unreadable' | 'not_checked';
export type ImageCheckMode = 'qwen' | 'local';

/**
 * One comparison between the wording printed in a picture and what our facts say.
 * `imageValue` is the text actually read in the picture, quoted as printed; it is empty whenever the
 * verdict says no wording was read, so a stored finding never carries a made-up quote.
 */
export type ImageCheckFinding = {
  factKey: string | null; attribute: string; imageValue: string; factValue: string;
  verdict: ImageVerdict; confidence: number; asset: string; region: string;
};
/** Stored on the fact itself so the review table can show the picture wording behind the value. */
export type FactImageCheck = ImageCheckFinding & { mode: ImageCheckMode; model: string; promptVersion: string; checkedAt: string; previousVerdict?: ImageVerdict };
/** Payload of the image-check evidence row, so the review UI reads one typed record per run. */
export type ImageCheckEvidence = { mode: ImageCheckMode; model: string; status: ImageCheckResult['status']; promptVersion: string; checkedAt: string; fallbackReason?: string;
  counts: Record<ImageVerdict, number>; transmitted: ImageCheckResult['transmitted']; assets: ImageCheckAsset[]; notes: string[]; findings: ImageCheckFinding[]; aiCallId?: string; latencyMs?: number };
export type ImageCheckAsset = {
  assetId: string; fileName: string; role: string; mimeType: string; byteSize: number; sha256: string;
  status: 'checked' | 'skipped' | 'missing' | 'dropped'; note?: string; otherSkus?: string[];
};
export type ImageCheckResult = {
  sku: string; mode: ImageCheckMode; provider: string; model: string;
  status: 'enhanced' | 'needs_review' | 'no_images';
  promptVersion: string; baseVersion: 1 | 2; findings: ImageCheckFinding[]; assets: ImageCheckAsset[];
  /** Exactly what left the private data zone, so the call scope stays auditable. */
  transmitted: { fileName: string; byteSize: number; sha256: string }[];
  counts: Record<ImageVerdict, number>; notes: string[];
  /** Set when a live call failed and only the offline file checks ran. */
  fallbackReason?: string;
  aiCallId?: string; latencyMs?: number; checkedAt: string;
};

/**
 * Facts whose value is normally printed on the product or its packaging, so the words in a picture can
 * be compared with them. Printed wording is a claim, not proof: a match marks agreement only.
 */
export const IMAGE_TEXT_FACT_KEYS = ['color', 'capacity', 'material', 'model', 'productName', 'brand', 'sku', 'countryOfOrigin',
  'straw', 'bagType', 'packageIncludes', 'lidType', 'packagingWeight'] as const;
/**
 * Never compared and never sent. Performance, safety and certification claims must not gain apparent
 * support from a picture, and internal commercial fields never leave the private data zone.
 */
export const IMAGE_EXCLUDED_KEYS = ['leakproof', 'bpaFree', 'foodSafe', 'dishwasherSafe', 'coldRetention', 'heatRetention',
  'dropTest', 'power', 'supply', 'certification', 'supplierCost', 'declaredValue'] as const;
/** Picture wording that no fact covers yet may join V2 as a pending candidate. */
export const IMAGE_ONLY_FACTS: { key: string; label: string }[] = [
  { key: 'imageVisibleText', label: 'Text printed on the product image' },
  { key: 'imagePackagingMark', label: 'Text printed on the packaging image' },
];

export const imageCheckCounts = (findings: ImageCheckFinding[]): Record<ImageVerdict, number> => ({
  agree: findings.filter(f => f.verdict === 'agree').length,
  differ: findings.filter(f => f.verdict === 'differ').length,
  not_visible: findings.filter(f => f.verdict === 'not_visible').length,
  unreadable: findings.filter(f => f.verdict === 'unreadable').length,
  not_checked: findings.filter(f => f.verdict === 'not_checked').length,
});

/** Consumer facts only: claims a picture must not corroborate, plus cost and declared value. */
export const imageCheckFactPayload = (facts: { key: string; label: string; value: string; status: string; allowed: boolean; sourceKind?: string }[]) =>
  facts.filter(f => !IMAGE_EXCLUDED_KEYS.includes(f.key as (typeof IMAGE_EXCLUDED_KEYS)[number]))
    .map(f => ({ field: f.key, label: f.label, value: f.value, status: f.status, sourceKind: f.sourceKind ?? 'supplier' }));

/**
 * Resource checks that need no model at all, so they still run when live reading is off:
 * a sheet may reference a photo the library never received, and one photo reused across SKUs
 * is the cheapest sign that a picture does not belong to this product.
 */
export function describeImageAssets(input: { references: string[]; assets: ProductAsset[]; reuseByHash: Record<string, string[]>; dropped?: string[] }): { assets: ImageCheckAsset[]; notes: string[] } {
  const notes: string[] = [];
  const byName = new Map<string, ProductAsset>();
  for (const asset of input.assets) byName.set(asset.fileName.toLowerCase(), asset);
  const assets: ImageCheckAsset[] = input.assets.map(asset => {
    const otherSkus = input.reuseByHash[asset.sha256] ?? [];
    // A picture a person dropped is listed as dropped, never as checked: the panel can then say that
    // the picture is on file but out of the check, instead of reporting that the SKU has no picture.
    const dropped = input.dropped?.includes(asset.fileName) ?? false;
    return { assetId: asset.recordId ?? '', fileName: asset.fileName, role: asset.role, mimeType: asset.mimeType, byteSize: asset.byteSize,
      sha256: asset.sha256, status: dropped ? 'dropped' : 'checked', ...(dropped ? { note: 'Dropped from the check by a recorded human decision' } : {}), ...(otherSkus.length ? { otherSkus } : {}) };
  });
  for (const reference of input.references) {
    const name = reference.toLowerCase();
    if (byName.has(name)) continue;
    assets.push({ assetId: '', fileName: reference, role: 'referenced', mimeType: '', byteSize: 0, sha256: '', status: 'missing', note: 'Referenced by the supplier file but not in the image library' });
    notes.push(`Supplier file references ${reference}, but no such file has been uploaded.`);
  }
  const reused = assets.filter(asset => asset.otherSkus?.length);
  for (const asset of reused) notes.push(`${asset.fileName} is also attached to ${asset.otherSkus!.join(', ')}; confirm the picture belongs to this product.`);
  if (!input.assets.length && !input.references.length) notes.push('No product image is attached yet, so no printed text can be checked against the facts.');
  return { assets, notes };
}

/** One line describing a finding, so the server, the evidence modal and the offline demo read the same. */
export const imageCheckFindingText = (finding: ImageCheckFinding) => [finding.verdict.replace('_', ' '), finding.attribute,
  finding.imageValue ? `picture text "${finding.imageValue}"` : 'no text read in the picture',
  finding.factValue ? `fact says "${finding.factValue}"` : 'no matching fact',
  finding.asset ? `evidence ${finding.asset}${finding.region ? ` · ${finding.region}` : ''}` : ''].filter(Boolean).join(' · ');

/**
 * Findings the offline mode can honestly produce: it reads no picture content, so every field that
 * would need a look at the printed words is reported as not_checked and nothing is ever guessed.
 * Pure, so the browser demo path and the server local provider produce the same list.
 */
export function localImageCheckFindings(facts: { key: string; label: string; value: string; status: string; allowed: boolean; sourceKind?: string }[], asset: string): ImageCheckFinding[] {
  return imageCheckFactPayload(facts).filter(fact => IMAGE_ATTRIBUTE_BY_KEY[fact.field] !== undefined)
    .map(fact => ({ factKey: fact.field, attribute: IMAGE_ATTRIBUTE_BY_KEY[fact.field], imageValue: '', factValue: fact.value,
      verdict: 'not_checked' as const, confidence: 0, asset, region: '' }));
}

/** Builds the stored annotation for one fact, keeping model metadata next to the verdict. */
export const factImageCheck = (finding: ImageCheckFinding, context: { mode: ImageCheckMode; model: string; checkedAt: string }): FactImageCheck =>
  ({ ...finding, mode: context.mode, model: context.model, promptVersion: MULTIMODAL_PROMPT_VERSION, checkedAt: context.checkedAt });
/** Which printed-text attribute a fact key maps to when the local analyser reports it as unchecked. */
export const IMAGE_ATTRIBUTE_BY_KEY: Record<string, string> = {
  color: 'colorMark', capacity: 'capacityMark', material: 'materialMark', model: 'modelMark', productName: 'labelText',
  brand: 'labelText', sku: 'barcodeText', countryOfOrigin: 'originMark', straw: 'labelText', bagType: 'labelText',
  packageIncludes: 'packagingText', lidType: 'labelText', packagingWeight: 'packagingText',
};
