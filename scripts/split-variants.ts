import { readFileSync, writeFileSync } from 'node:fs';
import { read, utils, write } from 'xlsx';

/**
 * Splits a supplier sheet whose 颜色分类 cell lists many variants into one row per variant.
 * Source rows keep a single 型号/颜色 each afterwards, which is what the pool and ranking expect.
 *
 * Usage: npm run split:variants -- "public/demo/商品参数信息表.xlsx"
 */

const source = process.argv[2] ?? 'public/demo/商品参数信息表.xlsx';
const workbook = read(readFileSync(source), { type: 'buffer' });
const rows = utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });

/**
 * The blob is label-then-value ("杯盖材质" then "PP材质"), but fields without a value break strict
 * alternation. So a line is a label only when it matches a known field name, and its value is the
 * next line unless that line is another label.
 */
const LABELS = /^(材质|材质工艺|品牌|型号|货号|颜色分类|产地|原产国|杯子种类|杯子样式|杯子用途|用途|功能|净重|商品名称|图案类型|图案款式|流行元素|风格|元素年代|保温时长|杯盖材质|杯盖类型|是否带柄|适用节日|适用人群|是否显示温度|适用空间|包装种类|是否带茶隔|杯身材质)$/;
function parseAttributes(blob: string): Record<string, string> {
  const lines = String(blob).split('\n').map(line => line.trim()).filter(Boolean);
  if (lines[0] === '参数信息') lines.shift();
  const attributes: Record<string, string> = {};
  const claimed = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    if (!LABELS.test(lines[index])) continue;
    // Most pairs are value-then-label, but some are label-then-value. A line that already served as
    // another field's value cannot be reused, which is what disambiguates "是否带茶隔 / 颜色分类".
    const before = index - 1; const after = index + 1;
    if (before >= 0 && !claimed.has(before) && !LABELS.test(lines[before])) { attributes[lines[index]] = lines[before]; claimed.add(before); }
    else if (after < lines.length && !claimed.has(after) && !LABELS.test(lines[after])) { attributes[lines[index]] = lines[after]; claimed.add(after); }
    else attributes[lines[index]] = '';
  }
  return attributes;
}

const COLOR_WORDS: [string, string][] = [['黑', 'Black'], ['粉', 'Pink'], ['蓝', 'Blue'], ['白', 'White'], ['绿', 'Green'], ['灰', 'Gray'], ['银', 'Silver'], ['紫', 'Purple'], ['红', 'Red'], ['黄', 'Yellow'], ['金', 'Gold'], ['米', 'Ivory'], ['棕', 'Brown'], ['橙', 'Orange']];
const colorOf = (text: string) => COLOR_WORDS.find(([word]) => text.includes(word))?.[1] ?? 'Unspecified';
const capacityOf = (text: string) => {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(ml|毫升|l|liter|oz|fl\.?\s*oz)/i);
  if (!match) return { value: 0, label: '' };
  const amount = Number(match[1]); const unit = match[2].toLowerCase();
  const ml = unit === 'l' || unit === 'liter' ? amount * 1000 : unit.startsWith('oz') || unit.includes('fl') ? amount * 29.5735 : amount;
  return { value: Math.round(ml), label: `${Math.round(ml)}ml` };
};
/** Variants inside 颜色分类 are separated by whitespace or commas; keep the original wording. */
const splitVariants = (text: string) => String(text).split(/[\s,，、;；]+/).map(entry => entry.trim()).filter(entry => entry.length > 1);

const output = rows.flatMap((row, rowIndex) => {
  const attributes = parseAttributes(row['商品信息'] ?? '');
  const variants = splitVariants(attributes['颜色分类'] ?? '');
  const images = String(row['商品图'] ?? '').split('\n').map(line => line.trim()).filter(Boolean);
  const brand = attributes['品牌'] ?? 'Unbranded';
  const model = attributes['型号'] ?? attributes['货号'] ?? `ROW-${rowIndex + 2}`;
  const kind = attributes['杯子种类'] ?? attributes['杯子样式'] ?? 'Cup';
  const material = attributes['材质'] ?? attributes['杯身材质'] ?? '';
  const list = variants.length ? variants : ['(no variant listed)'];
  return list.map((variant, index) => {
    const capacity = capacityOf(variant);
    const color = colorOf(variant);
    return {
      sku: `${model}-${String(index + 1).padStart(2, '0')}`.toUpperCase().replace(/\s+/g, ''),
      productName: `${brand} ${kind} ${capacity.label} ${color}`.trim(),
      model, brand, category: /包|bag|tote/i.test(kind + variant) ? 'Bags & Accessories' : /灯|lamp/i.test(kind + variant) ? 'Electronics' : 'Home & Kitchen', productType: kind,
      variant: variant.replace(/[⭐【】]/g, '').trim(),
      color, capacityMl: capacity.value || '',
      material: material || 'Unspecified',
      straw: /吸管|三饮/.test(variant) ? 'true' : 'false',
      // A parsed neighbour can land on the wrong label, so only keep a value that looks like the
      // field it claims to be: empty is acceptable, wrong is not.
      countryOfOrigin: /中国|大陆|china|japan|日本|usa|united states|美国|germany|德国|vietnam|越南|korea|韩国/i.test(attributes['产地'] ?? '') ? attributes['产地'] : '',
      supplierCost: '',
      images: images.slice(0, 3).map((url, imageIndex) => `IMG-${String(rowIndex + 2).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}-${imageIndex + 1}.jpg`).join(';'),
      imageUrls: images.slice(0, 3).join(';'),
      sourceRow: rowIndex + 2,
    };
  });
});

/**
 * The source sheet has no commercial or packaging data at all, so those columns are derived from
 * capacity and marked in `estimatedFields`. Fabricated values are visible on purpose: nobody should
 * mistake them for supplier data. Ranking and pricing need supplierCost plus weight and dimensions,
 * which is why they cannot simply be left empty.
 */
for (const row of output) {
  const capacity = Number(row.capacityMl) || 500;
  const cost = Math.min(15, Math.round((5 + capacity / 200) * 100) / 100);
  const side = capacity >= 700 ? 9 : 8;
  const height = capacity >= 700 ? 28 : capacity >= 500 ? 25 : 21;
  const weight = Math.round((0.15 + capacity / 1000 * 0.5) * 100) / 100;
  Object.assign(row, {
    supplierCost: cost.toFixed(2), declaredValue: cost.toFixed(2),
    packagingWeightKg: String(weight), packageLengthCm: String(side), packageWidthCm: String(side), packageHeightCm: String(height),
    estimatedFields: 'supplierCost;declaredValue;packagingWeightKg;packageLengthCm;packageWidthCm;packageHeightCm',
  });
}

// A few deliberate anomalies, kept small so ranking and pricing still have clean rows to work with:
// one row without a SKU, one without images, two without a price to exercise the missing-data gate.
if (output.length > 8) { output[2].sku = ''; output[3].images = ''; output[4].supplierCost = ''; output[5].supplierCost = ''; output[5].estimatedFields = 'declaredValue;packagingWeightKg;packageLengthCm;packageWidthCm;packageHeightCm'; }

const sheet = utils.json_to_sheet(output);
const book = utils.book_new();
utils.book_append_sheet(book, sheet, 'Variants');
const target = source.replace(/\.xlsx?$/i, '') + '-已拆分成单型号.xlsx';
writeFileSync(target, write(book, { type: 'buffer', bookType: 'xlsx', compression: true }));
writeFileSync(target.replace(/\.xlsx$/i, '.csv'), '\uFEFF' + utils.sheet_to_csv(sheet), 'utf8');

console.log(`source rows        ${rows.length}`);
console.log(`variant rows       ${output.length}`);
console.log(`rows with 1 variant${output.filter((_, index) => output.findIndex(item => item.model === output[index].model) === index) ? '' : ''}`);
console.log(`written            ${target}`);
console.log(`written            ${target.replace(/\.xlsx$/i, '.csv')}`);
for (const row of output.slice(0, 6)) console.log(`  ${row.sku || '(no sku)'} | ${row.productName} | ${row.variant.slice(0, 28)}`);
