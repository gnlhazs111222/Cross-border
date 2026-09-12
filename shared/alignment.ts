import type { Product } from '../src/types';

/**
 * Deterministic identity alignment for supplier records.
 *
 * Design rules, agreed with the product owner:
 * - Only identifiers (SKU, model) and exact binary identity (image sha256) may produce "same".
 * - Fuzzy signals (product type, name similarity, attribute agreement) may only produce "probable",
 *   which is the grey zone a human reviews; a future embedding scorer may join there and never above it.
 * - Same identity with disagreeing key attributes is a conflict, never a silent overwrite.
 * - No model call happens here; every verdict is reproducible and explainable.
 */

export type AttributeName = 'capacity' | 'color' | 'material' | 'dimensions' | 'category' | 'straw' | 'countryOfOrigin' | 'supplierCost' | 'packagingWeight';
export type MatchVerdict = 'same' | 'conflict' | 'probable' | 'distinct';
export type FieldNature = 'value' | 'format' | 'tolerance';

export type AlignableRecord = {
  sourceId: string; label: string;
  sku?: string; name?: string; category?: string; model?: string;
  capacity?: string | number; color?: string; material?: string; straw?: string | boolean;
  countryOfOrigin?: string; supplierCost?: number; packagingWeight?: number; dimensions?: string;
  imageHashes?: string[];
};

export type RecordProfile = {
  record: AlignableRecord;
  sku: string; model: string; productType: string; nameFingerprint: string; nameSquished: string;
  capacityMl?: number; color: string; material: string; category: string;
  straw?: boolean; country: string; supplierCost?: number; packagingWeight?: number;
  dimensionsCm?: number[]; imageHashes: string[];
};

export type MatchEvidence = {
  kind: 'sku' | 'model' | 'image_hash' | 'product_type' | 'name' | 'capacity' | 'color' | 'material' | 'dimensions' | 'category' | 'straw' | 'country' | 'cost' | 'weight';
  verdict: 'agree' | 'differ' | 'absent';
  detail: string;
};

export type FieldDifference = { field: AttributeName | 'sku' | 'model'; a: string; b: string; nature: FieldNature; key: boolean };

export type MatchResult = {
  verdict: MatchVerdict; score: number; grayZone: boolean;
  a: { sourceId: string; label: string; sku?: string; name?: string };
  b: { sourceId: string; label: string; sku?: string; name?: string };
  evidence: MatchEvidence[]; differences: FieldDifference[];
};

const OZ_TO_ML = 29.5735295625;
const KEY_ATTRIBUTES: AttributeName[] = ['capacity', 'color', 'material', 'dimensions'];

export function toHalfWidth(input: string): string {
  return input.replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
}
export const normalizeText = (input: string): string => toHalfWidth(String(input)).toLowerCase().replace(/[\s\u00a0]+/g, ' ').trim();
export const squish = (input: string): string => normalizeText(input).replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
/** Separators are not meaningful for identity comparison, but the stored value keeps its original form. */
export const normalizeSku = (input: string): string => squish(input).toUpperCase();
export const normalizeModel = (input: string): string => squish(input).toUpperCase();

type AliasEntry = [string, string];
const compile = (entries: AliasEntry[]) => entries.slice().sort((a, b) => b[0].length - a[0].length);
const findAlias = (entries: AliasEntry[], input: string): string => {
  const text = normalizeText(input);
  if (!text) return '';
  for (const [alias, canonical] of entries) if (text.includes(alias)) return canonical;
  return '';
};

const COLOR_ALIASES = compile([
  ['哑光黑', 'black'], ['磨砂黑', 'black'], ['matte black', 'black'], ['jet black', 'black'], ['黑色', 'black'], ['黑', 'black'], ['black', 'black'],
  ['象牙白', 'ivory'], ['米白', 'ivory'], ['瓷白', 'ivory'], ['ivory', 'ivory'], ['白色', 'white'], ['白', 'white'], ['white', 'white'],
  ['不锈钢色', 'silver'], ['银色', 'silver'], ['银', 'silver'], ['silver', 'silver'],
  ['藏青', 'navy'], ['深蓝', 'navy'], ['navy', 'navy'],
  ['鼠尾草绿', 'sage'], ['灰绿', 'sage'], ['sage', 'sage'], ['绿色', 'green'], ['绿', 'green'], ['green', 'green'],
  ['蓝色', 'blue'], ['蓝', 'blue'], ['blue', 'blue'], ['灰色', 'gray'], ['灰', 'gray'], ['gray', 'gray'], ['grey', 'gray'],
  ['粉色', 'pink'], ['粉', 'pink'], ['pink', 'pink'], ['红色', 'red'], ['红', 'red'], ['red', 'red'],
  ['金色', 'gold'], ['金', 'gold'], ['gold', 'gold'],
  ['紫色', 'purple'], ['紫', 'purple'], ['purple', 'purple'], ['棕色', 'brown'], ['棕', 'brown'], ['brown', 'brown'],
  ['橙色', 'orange'], ['橙', 'orange'], ['orange', 'orange'],
]);

const MATERIAL_ALIASES = compile([
  ['不锈钢', 'stainless_steel'], ['stainless steel', 'stainless_steel'], ['stainlesssteel', 'stainless_steel'],
  ['ss304', 'stainless_steel'], ['sus304', 'stainless_steel'], ['304', 'stainless_steel'], ['316', 'stainless_steel'],
  ['不锈钢材质', 'stainless_steel'], ['玻璃', 'glass'], ['glass', 'glass'],
  ['塑料', 'plastic'], ['tritan', 'tritan'], ['pp', 'plastic'], ['pc', 'plastic'], ['plastic', 'plastic'],
  ['陶瓷', 'ceramic'], ['ceramic', 'ceramic'],
  ['铝合金', 'aluminum'], ['铝', 'aluminum'], ['aluminium', 'aluminum'], ['aluminum', 'aluminum'],
  ['硅胶', 'silicone'], ['silicone', 'silicone'], ['钛', 'titanium'], ['titanium', 'titanium'],
  ['帆布', 'canvas'], ['canvas', 'canvas'], ['尼龙', 'nylon'], ['nylon', 'nylon'],
  ['竹', 'bamboo'], ['bamboo', 'bamboo'],
]);

/** Product-type vocabulary is what makes Chinese/English records comparable without a model. */
const TYPE_ALIASES = compile([
  ['随行水瓶', 'bottle'], ['保温杯', 'bottle'], ['保温瓶', 'bottle'], ['随行杯', 'bottle'], ['运动水壶', 'bottle'],
  ['水杯', 'bottle'], ['水瓶', 'bottle'], ['水壶', 'bottle'], ['杯', 'bottle'],
  ['water bottle', 'bottle'], ['travel bottle', 'bottle'], ['sports bottle', 'bottle'], ['tumbler', 'bottle'], ['flask', 'bottle'], ['bottle', 'bottle'],
  ['帆布包', 'bag'], ['托特包', 'bag'], ['手提包', 'bag'], ['背包', 'bag'], ['包', 'bag'],
  ['tote bag', 'bag'], ['canvas tote', 'bag'], ['backpack', 'bag'], ['tote', 'bag'], ['bag', 'bag'],
  ['台灯', 'lamp'], ['床头灯', 'lamp'], ['灯', 'lamp'], ['desk lamp', 'lamp'], ['table lamp', 'lamp'], ['lamp', 'lamp'],
]);

const MARKETING_TERMS = [
  '新款', '爆款', '包邮', '跨境', '现货', '促销', '时尚', '高档', '厂家直销', '网红', '同款', '特价',
  'new arrival', 'new style', 'hot sale', 'best seller', 'bestseller', 'promotion', 'free shipping', 'wholesale', 'dropshipping',
];

const COUNTRY_ALIASES = compile([
  ['中国', 'china'], ['china', 'china'], ['mainland china', 'china'],
  ['美国', 'usa'], ['united states', 'usa'], ['united states of america', 'usa'], ['usa', 'usa'],
  ['日本', 'japan'], ['japan', 'japan'], ['德国', 'germany'], ['germany', 'germany'],
  ['越南', 'vietnam'], ['vietnam', 'vietnam'], ['印度', 'india'], ['india', 'india'],
  ['韩国', 'korea'], ['south korea', 'korea'], ['korea', 'korea'], ['台湾', 'taiwan'], ['taiwan', 'taiwan'],
  ['英国', 'united_kingdom'], ['united kingdom', 'united_kingdom'],
]);
/** Two-letter codes only match the whole value, otherwise "us" would match inside "austria". */
const COUNTRY_CODES: Record<string, string> = { cn: 'china', us: 'usa', jp: 'japan', de: 'germany', vn: 'vietnam', in: 'india', kr: 'korea', tw: 'taiwan', uk: 'united_kingdom', gb: 'united_kingdom' };

const CATEGORY_ALIASES = compile([
  ['家居与厨房', 'home_kitchen'], ['home & kitchen', 'home_kitchen'], ['home and kitchen', 'home_kitchen'],
  ['包袋与配饰', 'bags_accessories'], ['bags & accessories', 'bags_accessories'], ['bags and accessories', 'bags_accessories'],
  ['电子产品', 'electronics'], ['electronics', 'electronics'],
]);

export const normalizeColor = (input: string): string => findAlias(COLOR_ALIASES, input);
export const normalizeMaterial = (input: string): string => findAlias(MATERIAL_ALIASES, input);
export const normalizeProductType = (input: string): string => findAlias(TYPE_ALIASES, input);
/** Unknown countries fall back to the normalized text, so same-language values still compare. */
export function normalizeCountry(input: string): string {
  const text = normalizeText(input);
  if (!text) return '';
  return COUNTRY_CODES[text] ?? (findAlias(COUNTRY_ALIASES, text) || text);
}
export const normalizeCategory = (input: string): string => findAlias(CATEGORY_ALIASES, input) || squish(input);

export function stripMarketing(input: string): string {
  let text = normalizeText(input);
  for (const term of MARKETING_TERMS) text = text.split(term).join(' ');
  return text.replace(/\s+/g, ' ').trim();
}

/** Capacity is compared in millilitres so 500ml, 0.5L and 16.9 fl oz agree. */
export function parseCapacityMl(input: string | number | undefined): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : undefined;
  const text = normalizeText(input).replace(/,/g, '');
  const match = text.match(/(\d+(?:\.\d+)?)\s*(ml|毫升|l|liter|litre|升|oz|ounces?|fl\.?\s*oz)/);
  if (!match) return undefined;
  const value = Number(match[1]); const unit = match[2];
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (/^(ml|毫升)$/.test(unit)) return value;
  if (/^(l|liter|litre|升)$/.test(unit)) return value * 1000;
  return value * OZ_TO_ML;
}

/** Dimensions are compared in centimetres; mm inputs are converted. */
export function parseDimensionsCm(input: string | undefined): number[] | undefined {
  if (!input) return undefined;
  const text = normalizeText(input).replace(/[×x*]/g, ' ');
  const numbers = (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (numbers.length < 3) return undefined;
  const inMillimetres = /\bmm\b|毫米/.test(text);
  const scaled = numbers.slice(0, 3).map(n => inMillimetres ? n / 10 : n);
  return scaled;
}

export function parseStraw(input: string | boolean | undefined): boolean | undefined {
  if (typeof input === 'boolean') return input;
  if (input === undefined) return undefined;
  const text = normalizeText(input);
  if (['true', '1', 'yes', 'y', '是', '有', '带吸管', '含吸管'].includes(text)) return true;
  if (['false', '0', 'no', 'n', '否', '无', '无吸管', '不带吸管'].includes(text)) return false;
  if (/no straw|without straw|straw ?free/.test(text)) return false;
  if (/with straw|includes? straw|has straw/.test(text)) return true;
  return undefined;
}

export function buildProfile(record: AlignableRecord): RecordProfile {
  const cleaned = stripMarketing(record.name ?? '');
  return {
    record,
    sku: normalizeSku(record.sku ?? ''),
    model: normalizeModel(record.model ?? ''),
    productType: normalizeProductType(record.name ?? ''),
    nameFingerprint: squish(cleaned),
    nameSquished: squish(record.name ?? ''),
    capacityMl: parseCapacityMl(record.capacity),
    color: normalizeColor(record.color ?? ''),
    material: normalizeMaterial(record.material ?? ''),
    category: normalizeCategory(record.category ?? ''),
    straw: parseStraw(record.straw),
    country: normalizeCountry(record.countryOfOrigin ?? ''),
    supplierCost: typeof record.supplierCost === 'number' && Number.isFinite(record.supplierCost) ? record.supplierCost : undefined,
    packagingWeight: typeof record.packagingWeight === 'number' && Number.isFinite(record.packagingWeight) ? record.packagingWeight : undefined,
    dimensionsCm: parseDimensionsCm(record.dimensions),
    imageHashes: (record.imageHashes ?? []).filter(Boolean),
  };
}

/** Character bigram Jaccard. Handles Chinese and English names but never compares across languages without a type match. */
export function nameSimilarity(a: string, b: string): number {
  const left = squish(a); const right = squish(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const bigrams = (value: string) => {
    const set = new Set<string>();
    for (let index = 0; index < value.length - 1; index++) set.add(value.slice(index, index + 2));
    if (!set.size) set.add(value);
    return set;
  };
  const first = bigrams(left); const second = bigrams(right);
  let shared = 0;
  for (const gram of first) if (second.has(gram)) shared++;
  return shared / (first.size + second.size - shared);
}

const capacityAgrees = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, a * 0.01);

function dimensionsAgreement(a: number[], b: number[]): 'agree' | 'close' | 'differ' {
  const deltas = a.map((value, index) => Math.abs(value - b[index]));
  if (deltas.every(delta => delta <= 0.1)) return 'agree';
  if (deltas.every((delta, index) => delta <= Math.max(0.5, a[index] * 0.05))) return 'close';
  return 'differ';
}

const display = (value: unknown) => value === undefined || value === null || value === '' ? '—' : String(value);

export function compareProfiles(a: RecordProfile, b: RecordProfile): MatchResult {
  const evidence: MatchEvidence[] = []; const differences: FieldDifference[] = [];
  let score = 0;
  const note = (kind: MatchEvidence['kind'], verdict: MatchEvidence['verdict'], detail: string) => evidence.push({ kind, verdict, detail });

  const skuEqual = !!a.sku && a.sku === b.sku;
  const modelEqual = !!a.model && a.model === b.model;
  const sharedHashes = a.imageHashes.filter(hash => b.imageHashes.includes(hash));
  const typeEqual = !!a.productType && a.productType === b.productType;

  if (skuEqual) { score += 0.6; note('sku', 'agree', `SKU ${a.record.sku}`); }
  else if (a.sku && b.sku) { score -= 0.35; differences.push({ field: 'sku', a: display(a.record.sku), b: display(b.record.sku), nature: 'value', key: false }); note('sku', 'differ', 'Different SKU values'); }
  else note('sku', 'absent', 'At least one record has no SKU');

  if (modelEqual) { score += 0.35; note('model', 'agree', `Model ${a.record.model}`); }
  else if (a.model && b.model) { score -= 0.15; differences.push({ field: 'model', a: display(a.record.model), b: display(b.record.model), nature: 'value', key: false }); note('model', 'differ', 'Different model values'); }

  if (sharedHashes.length) { score += 0.45; note('image_hash', 'agree', `Shared image content ${sharedHashes[0].slice(0, 12)}`); }

  if (typeEqual) { score += 0.25; note('product_type', 'agree', `Same product type ${a.productType}`); }
  else if (a.productType && b.productType) { score -= 0.25; note('product_type', 'differ', `Product type ${a.productType} vs ${b.productType}`); }
  else note('product_type', 'absent', 'Product type not recognized on both records');

  const similarity = nameSimilarity(a.nameSquished, b.nameSquished);
  if (similarity >= 0.5) { score += similarity * 0.25; note('name', 'agree', `Name similarity ${similarity.toFixed(2)}`); }
  else if (similarity > 0) note('name', 'differ', `Name similarity ${similarity.toFixed(2)}`);
  else note('name', 'absent', 'No shared name tokens');

  const compared: [AttributeName, boolean | undefined, MatchEvidence['kind'], number, number][] = [
    ['capacity', a.capacityMl !== undefined && b.capacityMl !== undefined ? capacityAgrees(a.capacityMl, b.capacityMl) : undefined, 'capacity', 0.15, 0.2],
    ['color', a.color && b.color ? a.color === b.color : undefined, 'color', 0.1, 0.12],
    ['material', a.material && b.material ? a.material === b.material : undefined, 'material', 0.12, 0.15],
    ['category', a.category && b.category ? a.category === b.category : undefined, 'category', 0.05, 0.1],
    ['straw', a.straw !== undefined && b.straw !== undefined ? a.straw === b.straw : undefined, 'straw', 0.03, 0.06],
  ];
  for (const [field, agrees, kind, up, down] of compared) {
    if (agrees === undefined) { note(kind, 'absent', `${field} not present on both records`); continue; }
    if (agrees) { score += up; note(kind, 'agree', `${field} agrees`); }
    else { score -= down; differences.push({ field, a: display(a.record[field]), b: display(b.record[field]), nature: 'value', key: KEY_ATTRIBUTES.includes(field) }); note(kind, 'differ', `${field} differs`); }
  }

  if (a.dimensionsCm && b.dimensionsCm) {
    const agreement = dimensionsAgreement(a.dimensionsCm, b.dimensionsCm);
    if (agreement === 'agree') { score += 0.05; note('dimensions', 'agree', 'Packaging dimensions agree'); }
    else if (agreement === 'close') { score += 0.02; note('dimensions', 'agree', 'Packaging dimensions differ only by rounding'); }
    else { score -= 0.08; differences.push({ field: 'dimensions', a: a.record.dimensions ?? '', b: b.record.dimensions ?? '', nature: 'value', key: true }); note('dimensions', 'differ', 'Packaging dimensions differ'); }
  } else note('dimensions', 'absent', 'Packaging dimensions not present on both records');

  if (a.country && b.country && a.country !== b.country) { differences.push({ field: 'countryOfOrigin', a: a.record.countryOfOrigin ?? '', b: b.record.countryOfOrigin ?? '', nature: 'value', key: false }); note('country', 'differ', 'Country of origin differs'); }
  if (a.supplierCost !== undefined && b.supplierCost !== undefined && Math.abs(a.supplierCost - b.supplierCost) > 0.005) {
    differences.push({ field: 'supplierCost', a: a.supplierCost.toFixed(2), b: b.supplierCost.toFixed(2), nature: 'value', key: false });
    note('cost', 'differ', 'Supplier cost differs between sources');
  }
  if (a.packagingWeight !== undefined && b.packagingWeight !== undefined && Math.abs(a.packagingWeight - b.packagingWeight) > 1e-6) {
    differences.push({ field: 'packagingWeight', a: `${a.packagingWeight} kg`, b: `${b.packagingWeight} kg`, nature: 'value', key: false });
    note('weight', 'differ', 'Packaging weight differs between sources');
  }
  // Commercial fields are only contradictions when both records claim the same identity: two codes
  // with different quotes is normal, the same code with two costs is a data problem.
  if (skuEqual || modelEqual) for (const difference of differences) if (difference.field === 'supplierCost' || difference.field === 'packagingWeight') difference.key = true;

  score = Math.max(-1, Math.min(1, score));
  const keyConflicts = differences.filter(difference => difference.key);
  const skuPresent = !!a.sku && !!b.sku;
  const modelPresent = !!a.model && !!b.model;
  const sharedHash = sharedHashes.length > 0;
  const nearIdenticalName = similarity >= 0.8;
  const identicalName = similarity >= 0.9;
  // Category wording and commercial fields depend on the file, not on the item, so they never block
  // "same product under a new code"; straw, size and origin do.
  const identityDifferences = differences.filter(difference => difference.key || difference.field === 'straw' || difference.field === 'dimensions' || difference.field === 'countryOfOrigin');
  let verdict: MatchVerdict;
  if (skuEqual || modelEqual) verdict = keyConflicts.length ? 'conflict' : 'same';
  else if (sharedHash) verdict = keyConflicts.length ? 'conflict' : 'same';
  // An identical name with contradictory attributes is a data-quality signal, so it goes to a human
  // even when the codes differ. Different codes with different names stay clearly separate.
  else if (identicalName && keyConflicts.length) verdict = 'conflict';
  // Two different supplier codes mean two different items. A near-identical name keeps the door open
  // for a renamed code, but only as a grey-zone pair a human reviews.
  else if (skuPresent || modelPresent) verdict = (identicalName && !keyConflicts.length) || (!identityDifferences.length && typeEqual) ? 'probable' : 'distinct';
  else if (nearIdenticalName && keyConflicts.length) verdict = 'conflict';
  else if (nearIdenticalName) verdict = 'probable';
  else if (typeEqual && !keyConflicts.length) verdict = 'probable';
  else verdict = 'distinct';

  return {
    verdict, score: Math.round(score * 1000) / 1000, grayZone: verdict === 'probable',
    a: { sourceId: a.record.sourceId, label: a.record.label, sku: a.record.sku, name: a.record.name },
    b: { sourceId: b.record.sourceId, label: b.record.label, sku: b.record.sku, name: b.record.name },
    evidence, differences,
  };
}

export const compareRecords = (a: AlignableRecord, b: AlignableRecord): MatchResult => compareProfiles(buildProfile(a), buildProfile(b));

/** Compares every unordered pair once and keeps only the pairs worth reviewing, so clearly unrelated rows never reach the report. */
export function compareAll(records: AlignableRecord[]): MatchResult[] {
  const profiles = records.map(buildProfile);
  const results: MatchResult[] = [];
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const result = compareProfiles(profiles[i], profiles[j]);
      if (result.verdict !== 'distinct') results.push(result);
    }
  }
  return results.sort((left, right) => right.score - left.score);
}

export type AlignmentSummary = {
  records: number; pairsConsidered: number;
  counts: Record<MatchVerdict, number>; grayZoneRate: number; conflicts: MatchResult[]; grayZone: MatchResult[];
};

export function summarizeAlignment(records: AlignableRecord[], results = compareAll(records)): AlignmentSummary {
  const counts: Record<MatchVerdict, number> = { same: 0, conflict: 0, probable: 0, distinct: 0 };
  for (const result of results) counts[result.verdict]++;
  const totalPairs = records.length * (records.length - 1) / 2;
  // compareAll omits unrelated pairs to keep the report small, so distinct is derived from the total.
  counts.distinct = Math.max(0, totalPairs - counts.same - counts.conflict - counts.probable);
  return {
    records: records.length, pairsConsidered: totalPairs, counts,
    grayZoneRate: totalPairs ? counts.probable / totalPairs : 0,
    conflicts: results.filter(result => result.verdict === 'conflict'),
    grayZone: results.filter(result => result.verdict === 'probable'),
  };
}

export function recordFromProduct(product: Product, sourceId = 'catalog'): AlignableRecord {
  return {
    sourceId, label: `${sourceId} · ${product.sku}`,
    sku: product.sku, name: product.name, category: product.category,
    capacity: product.capacity, color: product.color, material: product.material, straw: product.straw,
    countryOfOrigin: product.countryOfOrigin, supplierCost: product.supplierCost,
    packagingWeight: product.packagingWeight, dimensions: product.packagingDimensions,
  };
}

const VERDICT_RANK: Record<MatchVerdict, number> = { same: 3, conflict: 2, probable: 1, distinct: 0 };

export type ShortlistEntry = {
  record: AlignableRecord; candidate: AlignableRecord; result: MatchResult;
  /** How many other records also matched. Above zero means the row is genuinely ambiguous. */
  alternatives: number;
};

/**
 * Review unit is one incoming record, not one pair. A record with no identifier would otherwise
 * pair with every similar product and bury the reviewer, so each record keeps only its best
 * candidate and reports how many other candidates competed for it.
 */
export function shortlistRecords(records: AlignableRecord[]): ShortlistEntry[] {
  const profiles = records.map(buildProfile);
  const entries: ShortlistEntry[] = [];
  for (let index = 0; index < profiles.length; index++) {
    let best: { result: MatchResult; candidateIndex: number } | undefined;
    let matches = 0;
    for (let other = 0; other < profiles.length; other++) {
      if (other === index) continue;
      const result = compareProfiles(profiles[index], profiles[other]);
      if (result.verdict === 'distinct') continue;
      matches++;
      if (!best || result.score > best.result.score || (result.score === best.result.score && VERDICT_RANK[result.verdict] > VERDICT_RANK[best.result.verdict])) best = { result, candidateIndex: other };
    }
    if (best) entries.push({ record: profiles[index].record, candidate: profiles[best.candidateIndex].record, result: best.result, alternatives: matches - 1 });
  }
  return entries.sort((left, right) => VERDICT_RANK[right.result.verdict] - VERDICT_RANK[left.result.verdict] || right.result.score - left.result.score);
}

export type ShortlistSummary = {
  records: number; needingReview: number; ambiguous: number;
  counts: Record<MatchVerdict, number>;
};

export function summarizeShortlist(entries: ShortlistEntry[], records: number): ShortlistSummary {
  const counts: Record<MatchVerdict, number> = { same: 0, conflict: 0, probable: 0, distinct: 0 };
  for (const entry of entries) counts[entry.result.verdict]++;
  return { records, needingReview: entries.length, ambiguous: entries.filter(entry => entry.alternatives > 0).length, counts };
}
