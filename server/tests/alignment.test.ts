import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareRecords, normalizeColor, normalizeMaterial, normalizeProductType, normalizeSku,
  parseCapacityMl, parseDimensionsCm, nameSimilarity, stripMarketing, summarizeAlignment, compareAll,
  shortlistRecords, summarizeShortlist, normalizeCountry, normalizeCategory,
  type AlignableRecord,
} from '../../shared/alignment';

const bottle = (overrides: Partial<AlignableRecord> = {}): AlignableRecord => ({
  sourceId: 'a.xlsx', label: 'a.xlsx · row 2', sku: 'LM-KT-BTL-001-BLK-500',
  name: '黑色不锈钢随行水瓶 500ml', category: '家居与厨房', capacity: '500ml', color: '黑色', material: '不锈钢',
  straw: false, countryOfOrigin: '中国', supplierCost: 8.2, packagingWeight: 0.38,
  ...overrides,
});

test('normalization folds full-width text, case, whitespace and SKU separators', () => {
  assert.equal(normalizeSku(' lm-kt-btl-001-blk-500 '), 'LMKTBTL001BLK500');
  assert.equal(normalizeSku('LM_KT_BTL_001_BLK_500'), normalizeSku('lmkt btl 001 blk 500'));
  assert.equal(normalizeColor('哑光黑色'), 'black');
  assert.equal(normalizeColor('Matte Black'), 'black');
  assert.equal(normalizeColor('米白'), 'ivory');
  assert.equal(normalizeMaterial('304不锈钢'), 'stainless_steel');
  assert.equal(normalizeMaterial('Stainless Steel'), 'stainless_steel');
  assert.equal(normalizeMaterial('Tritan'), 'tritan');
});

test('capacity is compared in millilitres across ml, L and fl oz', () => {
  assert.equal(parseCapacityMl('500ml'), 500);
  assert.equal(parseCapacityMl('500 ml / 16.9 fl oz'), 500);
  assert.equal(parseCapacityMl('0.5L'), 500);
  assert.ok(Math.abs((parseCapacityMl('16.9 oz') ?? 0) - 499.79) < 0.1);
  assert.equal(parseCapacityMl('no capacity here'), undefined);
});

test('dimensions are compared in centimetres and tolerate millimetre spellings', () => {
  assert.deepEqual(parseDimensionsCm('7.1 × 7.1 × 26.4 cm'), [7.1, 7.1, 26.4]);
  assert.deepEqual(parseDimensionsCm('7.1x7.1x26.4cm'), [7.1, 7.1, 26.4]);
  assert.deepEqual(parseDimensionsCm('71 × 71 × 264 mm'), [7.1, 7.1, 26.4]);
});

test('product type and marketing terms are recognized across Chinese and English', () => {
  assert.equal(normalizeProductType('黑色不锈钢随行水瓶 500ml'), 'bottle');
  assert.equal(normalizeProductType('Stainless Steel Travel Bottle, Black, 500ml'), 'bottle');
  assert.equal(normalizeProductType('新款帆布托特包'), 'bag');
  assert.equal(normalizeProductType('Compact Desk Lamp'), 'lamp');
  assert.equal(stripMarketing('新款黑色保温杯 包邮'), '黑色保温杯');
  assert.ok(nameSimilarity('黑色不锈钢随行水瓶 500ml', '黑色不锈钢随行水瓶500毫升') > 0.7);
});

test('the same SKU with identical data is a confirmed match', () => {
  const result = compareRecords(bottle(), bottle({ sourceId: 'b.xlsx', label: 'b.xlsx · row 5' }));
  assert.equal(result.verdict, 'same');
  assert.equal(result.grayZone, false);
  assert.ok(result.evidence.some(item => item.kind === 'sku' && item.verdict === 'agree'));
});

test('the same SKU with conflicting key attributes is a conflict, never a silent merge', () => {
  const result = compareRecords(bottle(), bottle({ sourceId: 'b.xlsx', label: 'b.xlsx · row 5', capacity: '750ml' }));
  assert.equal(result.verdict, 'conflict');
  assert.deepEqual(result.differences.filter(item => item.key).map(item => item.field), ['capacity']);
});

test('a shared image hash proves identity on its own but still reports conflicting attributes', () => {
  const hash = 'a'.repeat(64);
  const clean = compareRecords(bottle({ sku: undefined }), bottle({ sku: undefined, sourceId: 'b.pdf', label: 'b.pdf · page 3', imageHashes: [hash] }));
  assert.equal(clean.verdict, 'probable');
  const strong = compareRecords(bottle({ sku: undefined, imageHashes: [hash] }), bottle({ sku: undefined, sourceId: 'b.pdf', label: 'b.pdf · page 3', imageHashes: [hash] }));
  assert.equal(strong.verdict, 'same');
  const conflicting = compareRecords(bottle({ sku: undefined, imageHashes: [hash] }), bottle({ sku: undefined, sourceId: 'b.pdf', label: 'b.pdf · page 3', imageHashes: [hash], material: '玻璃' }));
  assert.equal(conflicting.verdict, 'conflict');
});

test('identical data under a different code is the rename case: grey zone, never an automatic merge', () => {
  const english = bottle({ sourceId: 'c.csv', label: 'c.csv · row 9', sku: 'SKU-EN-77', name: 'Stainless Steel Travel Bottle, Black, 500ml', category: 'Home & Kitchen', color: 'Black', material: 'Stainless Steel' });
  assert.equal(compareRecords(bottle(), english).verdict, 'probable');
  // A physical difference keeps them clearly apart.
  assert.equal(compareRecords(bottle(), { ...english, straw: true }).verdict, 'distinct');
  const documentRow = { ...english, sku: undefined, sourceId: 'c.pdf', label: 'c.pdf · page 3' };
  const result = compareRecords(bottle({ sku: undefined }), documentRow);
  assert.equal(result.verdict, 'probable');
  assert.equal(result.grayZone, true);
});

test('a renamed code with an identical name is grey zone, not an automatic merge', () => {
  const result = compareRecords(bottle(), bottle({ sourceId: 'c.csv', label: 'c.csv · row 9', sku: 'LM-KT-BTL-001-BLK-500-NEW' }));
  assert.equal(result.verdict, 'probable');
});

test('near-identical names with different capacity are a conflict even without SKU or model', () => {
  const result = compareRecords(bottle({ sku: undefined }), bottle({ sku: undefined, sourceId: 'c.csv', label: 'c.csv · row 9', capacity: '750ml' }));
  assert.equal(result.verdict, 'conflict');
});

test('different product types stay distinct, including out-of-category demo rows', () => {
  const bag = bottle({ sourceId: 'd.csv', label: 'd.csv · row 2', sku: 'LM-BG-TOT-009-BLK', name: 'Everyday Canvas Tote', category: 'Bags & Accessories', capacity: 0, color: 'Black', material: 'Canvas' });
  assert.equal(compareRecords(bottle(), bag).verdict, 'distinct');
});

test('a numeric capacity and an equivalent ounce string agree within tolerance', () => {
  const result = compareRecords(bottle({ sku: 'X-1', capacity: 500 }), bottle({ sku: 'X-1', sourceId: 'b.csv', label: 'b.csv · row 3', capacity: '16.9 oz' }));
  assert.equal(result.verdict, 'same');
  assert.ok(!result.differences.some(item => item.field === 'capacity'));
});

test('the summary exposes the grey-zone rate so the embedding decision can be data driven', () => {
  const records = [
    bottle(), bottle({ sourceId: 'b.xlsx', label: 'b.xlsx · row 5' }), bottle({ sourceId: 'b.xlsx', label: 'b.xlsx · row 6', capacity: '750ml' }),
    bottle({ sourceId: 'c.pdf', label: 'c.pdf · page 3', sku: undefined, name: 'Stainless Steel Travel Bottle, Black, 500ml', category: 'Home & Kitchen', color: 'Black', material: 'Stainless Steel' }),
    bottle({ sourceId: 'd.csv', label: 'd.csv · row 2', sku: 'LM-BG-TOT-009-BLK', name: 'Everyday Canvas Tote', category: 'Bags & Accessories', capacity: 0, color: 'Black', material: 'Canvas' }),
  ];
  const summary = summarizeAlignment(records);
  assert.equal(summary.records, 5);
  assert.equal(summary.pairsConsidered, 10);
  assert.equal(summary.counts.same + summary.counts.conflict + summary.counts.probable + summary.counts.distinct, 10);
  assert.ok(summary.counts.same >= 1);
  assert.ok(summary.counts.conflict >= 1);
  assert.ok(summary.grayZoneRate > 0 && summary.grayZoneRate <= 1);
  assert.ok(summary.grayZone.every(result => result.verdict === 'probable'));
});

test('compareAll sorts the most likely duplicates first and drops clearly unrelated pairs', () => {
  const results = compareAll([
    bottle(),
    bottle({ sourceId: 'b.xlsx', label: 'b.xlsx · row 5' }),
    bottle({ sourceId: 'e.csv', label: 'e.csv · row 8', sku: 'LM-EL-LMP-010-BLK', name: 'Compact Desk Lamp', category: 'Electronics', capacity: 0, material: 'Aluminum' }),
  ]);
  assert.equal(results[0].verdict, 'same');
  assert.ok(results[0].score >= results[results.length - 1].score);
  assert.ok(!results.some(result => result.a.sku === 'LM-EL-LMP-010-BLK' && result.verdict === 'same'));
});

test('an identical name with contradictory attributes is a conflict even when the codes differ', () => {
  const result = compareRecords(
    bottle({ sku: 'DEMO-A-001' }),
    bottle({ sku: 'DEMO-D-004', sourceId: 'b.xlsx', label: 'b.xlsx · row 7', material: '玻璃' }),
  );
  assert.equal(result.verdict, 'conflict');
  assert.ok(result.differences.some(item => item.field === 'material' && item.key));
});

test('review workload is counted per record, so one row without an SKU suggests one candidate', () => {
  const records: AlignableRecord[] = [
    bottle(),
    bottle({ sourceId: 'b.xlsx', label: 'b.xlsx · row 5', sku: 'LM-KT-BTL-002-BLK-500', name: 'Black Straw Travel Bottle', straw: true }),
    bottle({ sourceId: 'c.pdf', label: 'c.pdf · page 3', sku: undefined, name: 'Stainless Steel Travel Bottle 500ml' }),
    bottle({ sourceId: 'd.csv', label: 'd.csv · row 9', sku: 'LM-BG-TOT-009-BLK', name: 'Everyday Canvas Tote', category: 'Bags & Accessories', material: 'Canvas', capacity: 0 }),
  ];
  const entries = shortlistRecords(records);
  const workload = summarizeShortlist(entries, records.length);
  assert.equal(workload.records, 4);
  // The row without an SKU matches two bottle rows, but the panel still shows one candidate per record.
  const documentRow = entries.find(entry => entry.record.sku === undefined)!;
  assert.equal(documentRow.alternatives, 1);
  assert.ok(workload.needingReview <= records.length);
  assert.equal(entries.length, new Set(entries.map(entry => entry.record.label)).size);
  assert.ok(entries.some(entry => entry.result.verdict === 'probable'));
});

test('country and category names collapse across languages', () => {
  assert.equal(normalizeCountry('中国'), 'china');
  assert.equal(normalizeCountry('China'), 'china');
  assert.equal(normalizeCountry('CN'), 'china');
  assert.equal(normalizeCountry('越南'), normalizeCountry('Vietnam'));
  assert.equal(normalizeCountry('奥地利'), '奥地利'); // unknown values fall back instead of matching "us"
  assert.equal(normalizeCategory('家居与厨房'), normalizeCategory('Home & Kitchen'));
  assert.equal(normalizeCategory('包袋与配饰'), 'bags_accessories');
});

test('the same code with a different cost is a conflict, a different code is not', () => {
  const sameCode = compareRecords(bottle(), bottle({ sourceId: 'b.xlsx', label: 'b.xlsx · row 5', supplierCost: 9.9 }));
  assert.equal(sameCode.verdict, 'conflict');
  assert.ok(sameCode.differences.some(item => item.field === 'supplierCost' && item.key));
  const otherCode = compareRecords(bottle(), bottle({ sourceId: 'b.xlsx', label: 'b.xlsx · row 5', sku: 'OTHER-1', name: 'Everyday Kitchen Bottle', supplierCost: 9.9 }));
  assert.notEqual(otherCode.verdict, 'same');
  assert.ok(!otherCode.differences.some(item => item.field === 'supplierCost' && item.key));
});

test('a renamed code with identical data is grey zone even when the names are translated', () => {
  const chinese = bottle({ sku: 'CN-100', material: '不锈钢', color: '黑色', category: '家居与厨房', countryOfOrigin: '中国', straw: false });
  const english = bottle({ sku: 'EN-200', sourceId: 'b.csv', label: 'b.csv · row 4', name: 'Stainless Steel Bottle 500ml', material: 'Stainless Steel', color: 'Black', category: 'Home & Kitchen', countryOfOrigin: 'China', straw: false });
  const result = compareRecords(chinese, english);
  assert.equal(result.verdict, 'probable');
  assert.equal(result.grayZone, true);
  // A physical difference still blocks the rename reading. Both sides must carry the field for it to
  // count: missing data is never treated as a difference.
  assert.equal(compareRecords(chinese, { ...english, straw: true }).verdict, 'distinct');
});

test('full-width text and unit spellings normalize to the same product', () => {
  const wide = bottle({ sku: 'ＧＡＰ－Ｅ－０３０', capacity: '４５０ｍｌ' });
  const plain = bottle({ sku: 'GAP-E-030', sourceId: 'b.csv', label: 'b.csv · row 9', capacity: '450ml' });
  assert.equal(normalizeSku(String(wide.sku)), normalizeSku(String(plain.sku)));
  assert.equal(parseCapacityMl(String(wide.capacity)), parseCapacityMl(String(plain.capacity)));
  assert.equal(compareRecords(wide, plain).verdict, 'same');
  assert.equal(compareRecords(bottle(), bottle({ sourceId: 'b.csv', label: 'b.csv · row 9', capacity: '16.9 fl oz' })).verdict, 'same');
});
