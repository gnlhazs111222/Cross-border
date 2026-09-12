import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseSupplierFile } from "../../src/services/supplierImport";

const parse = async (relative: string) => {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const bytes = fs.readFileSync(path);
  return parseSupplierFile(new File([bytes], path.split(/[\\/]/).at(-1)!, { type: "text/csv" }), "replace", []);
};

/**
 * The supplier sheet mixes three kinds of optional column: the file names we should fetch, the
 * transport declarations and the quality report. Only the first kind is an evidence reference — a
 * declaration read as a file name sent "false" and "Stainless Steel" to the picture check as if they
 * were missing photographs, and the check then had nothing to read at all.
 */
test('a transport declaration is not read as an evidence reference', async () => {
  const parsed = await parse("../../evaluation/asset-import-sample/危险品运输属性样本.csv");
  assert.equal(parsed.invalid, 0);
  const hazard = parsed.products.find(product => product.sku === 'HAZ-001')!;
  assert.deepEqual(hazard.transport, { liquid: false, battery: true, magnetic: false, aerosol: false, flammable: false, fragile: false });
  assert.equal(hazard.assetReferences, undefined, 'a boolean column is not a file name');
});

test('only file-name columns become evidence references', async () => {
  const parsed = await parse("../../evaluation/asset-import-sample/商品参数信息表-含故意错误.csv");
  const bottle = parsed.products.find(product => product.sku === 'PL-BTL-001-PNK')!;
  assert.deepEqual(bottle.assetReferences, ['IMG-02-1.jpg', 'IMG-02-2.jpg', 'IMG-02-3.jpg']);
  assert.equal(bottle.assetUrls?.length, 3, 'links keep going to the download channel');
});

test('a quality report is not read as an evidence reference either', async () => {
  const parsed = await parse("../../evaluation/asset-import-sample/质检报告样本.csv");
  const reported = parsed.products.find(product => product.sku === 'QA-001')!;
  assert.equal(reported.qualityReport?.reportNo, 'QC-2026-1001');
  assert.equal(reported.assetReferences, undefined, 'the report columns are data, not pictures');
});
