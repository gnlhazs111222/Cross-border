import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { utils, write } from 'xlsx';
import { parseSupplierFile } from '../src/services/supplierImport';

const HERO = 'LM-KT-BTL-001-BLK-500';
const MISSING = 'LM-KT-IMP-005-BLK-500';
const STATE_KEY = 'prismlaunch.demo.v1';
const csvSample = readFileSync(resolve('public/demo/prismlaunch-supplier-demo.csv'), 'utf8');
const header = csvSample.split('\n')[0].trim();
const hero = csvSample.split('\n')[1].trim().split(',');
const snapshot = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STATE_KEY);
const csvBytes = (rows: string[][]) => Buffer.from('\uFEFF' + [header, ...rows.map(row => row.map(v => `"${v.replace(/"/g, '""')}"`).join(','))].join('\r\n'));

async function previewSample(page: Page, extension: string, mode = 'replace') {
  await page.getByRole('button', { name: 'Import Supplier File', exact: true }).click();
  if (mode !== 'replace') await page.getByRole('combobox', { name: 'Import mode' }).selectOption(mode);
  await page.getByLabel('Supplier file', { exact: true }).setInputFiles(resolve(`public/demo/prismlaunch-supplier-demo.${extension}`));
  await expect(page.getByRole('dialog').getByLabel('Import summary')).toBeVisible();
}

for (const extension of ['xlsx', 'csv']) {
  test(`real ${extension} sample import continues through review, publish, CSV, reload and fallback`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
    const before = await snapshot(page);
    await previewSample(page, extension);
    expect(await snapshot(page)).toEqual(before);
    const counts = page.getByRole('dialog').locator('.import-counts strong');
    await expect(counts).toHaveText(['8', '6', '1', '1', '0']);
    await page.getByRole('button', { name: 'Import 7 products', exact: true }).click();
    await expect(page.getByTestId('import-completed')).toBeVisible();
    await expect(page.locator('.product-table tbody tr')).toHaveCount(7);
    await expect(page.getByTestId(`product-${HERO}`)).toHaveCount(1);
    await expect(page.getByTestId(`product-${MISSING}`)).toContainText('Missing Data');
    const imported = await snapshot(page);
    expect(imported.datasetSource).toBe('imported');
    expect(imported.catalog.find((p: { sku: string }) => p.sku === HERO).supplierCost).toBe(8.2);
    expect(imported.catalog.find((p: { sku: string }) => p.sku === HERO).straw).toBe(false);
    expect(imported.importReport.duplicates).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`import-${extension}.png`), fullPage: true });
    await page.reload();
    await expect(page.locator('.product-table tbody tr')).toHaveCount(7);
    await expect(page.getByTestId('import-completed')).toBeVisible();
    await page.getByRole('button', { name: `View ${MISSING}`, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pricing Blocked', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').locator('.suggested-price')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
    await expect(page.getByTestId('recommendation-1')).toContainText(HERO);
    await expect(page.getByTestId('recommendation-1').locator('.match-score')).toHaveText('94/100');
    await expect(page.locator('.recommendation-grid')).not.toContainText('Duplicate Hero Row');
    await expect(page.locator('.recommendation-grid')).not.toContainText(MISSING);
    await expect(page.locator('.shortlist-heading')).toContainText('6 eligible candidates evaluated · 1 products excluded');
    await page.getByTestId('recommendation-1').getByRole('button', { name: 'Select SKU' }).click();
    await expect(page.getByRole('heading', { name: 'FactCard V1', exact: true })).toBeVisible();
    const v1 = (await snapshot(page)).v1;
    expect(v1.facts.find((f: { key: string }) => f.key === 'capacity').source).toBe('Imported Supplier File');
    expect(v1.facts.find((f: { key: string }) => f.key === 'capacity').anchor).toContain(`prismlaunch-supplier-demo.${extension}`);
    await page.getByRole('button', { name: /Imported Supplier File.*View extracted result/ }).click();
    await expect(page.getByRole('dialog')).toContainText('row 2');
    await expect(page.getByRole('dialog')).toContainText('These values were parsed from your supplier file.');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
    await expect(page.locator('.suggested-price>strong')).toHaveText('USD 19.99');
    expect((await snapshot(page)).v1).toEqual(v1);
    await page.getByRole('button', { name: 'Continue to Listing Studio' }).click();
    await page.getByRole('button', { name: 'Generate Amazon Listing' }).click();
    await expect(page.locator('.listing-copy')).toContainText('100% leakproof');
    await page.getByRole('button', { name: 'Continue to Review' }).click();
    await page.getByRole('button', { name: 'Run Review' }).click();
    await expect(page.locator('.risk-issue')).toContainText('R001');
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Apply Suggested Fix' }).click();
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Run Review' }).click();
    await expect(page.getByRole('heading', { name: 'Review Passed' })).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Amazon Listing Export Ready' })).toBeVisible();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Amazon CSV' }).click();
    const download = await downloaded;
    await download.saveAs(testInfo.outputPath('imported-amazon.csv'));
    const output = readFileSync(testInfo.outputPath('imported-amazon.csv'), 'utf8');
    expect(output).toContain(HERO); expect(output).toContain('19.99'); expect(output).not.toContain('100% leakproof');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Amazon Listing Export Ready' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Materials', exact: true }).click();
    await page.getByRole('button', { name: 'Load Demo Dataset' }).click();
    await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
    expect((await snapshot(page)).task).toBeNull();
    await expect(page.getByTestId('import-completed')).toHaveCount(0);
    await previewSample(page, extension);
    await page.getByRole('button', { name: 'Import 7 products' }).click();
    await expect(page.locator('.product-table tbody tr')).toHaveCount(7);
    await page.getByRole('button', { name: 'Reset Demo', exact: true }).click();
    await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
    expect((await snapshot(page)).datasetSource).toBe('builtin');
    expect(errors).toEqual([]);
  });
}

test('append skips existing and intra-file duplicates without overwriting products', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
  await previewSample(page, 'csv', 'append');
  await expect(page.getByRole('dialog').locator('.import-counts strong')).toHaveText(['8', '2', '1', '5', '0']);
  await page.getByRole('button', { name: 'Import 3 products' }).click();
  await expect(page.locator('.product-table tbody tr')).toHaveCount(13);
  const saved = await snapshot(page);
  expect(saved.catalog.find((p: { sku: string }) => p.sku === HERO).supplierCost).toBe(8.2);
  expect(saved.catalog.find((p: { sku: string }) => p.sku === HERO).importSource).toBeUndefined();
  await previewSample(page, 'csv', 'append');
  await expect(page.getByRole('dialog').locator('.import-counts strong')).toHaveText(['8', '0', '0', '8', '0']);
  await expect(page.getByRole('button', { name: 'Import 0 products' })).toBeDisabled();
  expect(await snapshot(page)).toEqual(saved);
});

test('unsupported headers, empty and corrupt files leave the current dataset and task intact', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
  await expect(page.getByTestId('recommendation-1')).toBeVisible();
  await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Materials', exact: true }).click();
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Import Supplier File', exact: true }).click();
  const input = page.getByLabel('Supplier file', { exact: true });
  for (const [name, body, error] of [
    ['bad.csv', csvSample.replace('productName,', 'product_name,'), 'Unsupported supplier template'],
    ['bad.csv', csvSample.replace('productName,', 'sku,'), 'Unsupported supplier template'],
    ['empty.csv', '', 'The supplier file is empty.'],
    ['header.csv', header, 'No data rows found.'],
    ['broken.xlsx', 'This is not a workbook', 'Could not read supplier file.'],
  ]) {
    await input.setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(body) });
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(error);
    await expect(page.getByRole('button', { name: 'Import 0 products' })).toBeDisabled();
    expect(await snapshot(page)).toEqual(before);
  }
  await input.setInputFiles(resolve('public/demo/prismlaunch-supplier-demo.xlsx'));
  await expect(page.getByRole('button', { name: 'Import 7 products' })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
});

test('validation retains quoted CSV values and rejects invalid rows and XLSX formulas', async () => {
  const valid = [...hero]; valid[0] = 'CSV-REAL-001'; valid[1] = 'Bottle, "commuter"\nEdition'; valid[9] = '6.75';
  const missingSku = [...hero]; missingSku[0] = '';
  const missingName = [...hero]; missingName[1] = '';
  const badNumber = [...hero]; badNumber[0] = 'BAD-NUM'; badNumber[8] = '-2';
  const badBool = [...hero]; badBool[0] = 'BAD-BOOL'; badBool[6] = 'maybe';
  const missingPackaging = [...hero]; missingPackaging[0] = 'MISSING-BOTH'; missingPackaging[10] = ''; missingPackaging[11] = '';
  const data = csvBytes([valid, missingSku, missingName, badNumber, badBool, missingPackaging]);
  const preview = await parseSupplierFile(new File([new Uint8Array(data)], 'test.csv'), 'replace', []);
  expect([preview.processed, preview.ready, preview.missing, preview.invalid]).toEqual([6, 1, 1, 4]);
  expect(preview.products[0].name).toBe(valid[1]); expect(preview.products[0].declaredValue).toBe(6.75);
  expect(preview.products[0].straw).toBe(false);
  expect(preview.products[1].missing).toEqual(['Packaging Weight', 'Packaging Dimensions']);
  const workbook = utils.book_new(); const sheet = utils.aoa_to_sheet([header.split(','), hero]);
  sheet.G2 = { t: 'b', v: false };
  sheet.I2 = { t: 'n', v: 8.2, f: '4.1*2' };
  utils.book_append_sheet(workbook, sheet, 'Products');
  const bytes = write(workbook, { bookType: 'xlsx', type: 'array' });
  const formula = await parseSupplierFile(new File([bytes], 'formula.xlsx'), 'replace', []);
  expect(formula.invalid).toBe(1); expect(formula.products).toHaveLength(0);
  expect(formula.rows[0].issues).toEqual([{ code: 'formula', field: 'supplierCost' }]);
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([['extra']]), 'Extra');
  await expect(parseSupplierFile(new File([write(workbook, { bookType: 'xlsx', type: 'array' })], 'multi.xlsx'), 'replace', [])).rejects.toThrow('Use exactly one worksheet');
  await expect(parseSupplierFile(new File([Buffer.alloc(2 * 1024 * 1024 + 1)], 'huge.csv'), 'replace', [])).rejects.toThrow('File too large');
  const reversed = header.split(',').reverse().join(',') + '\n' + [...hero].reverse().join(',');
  const reordered = await parseSupplierFile(new File([reversed], 'reordered.csv'), 'replace', []);
  expect(reordered.products[0].sku).toBe(HERO); expect(reordered.products[0].packagingWeight).toBe(0.38);
  await expect(parseSupplierFile(new File([header + '\n' + (hero.join(',') + '\n').repeat(501)], 'many.csv'), 'replace', [])).rejects.toThrow('Too many rows');
});

test('mixed-validity CSV shows invalid rows and uses imported costs and declared value', async ({ page }) => {
  const valid = [...hero]; valid[0] = 'CSV-CUSTOM-350'; valid[1] = 'Real Uploaded 350ml Bottle'; valid[4] = '350'; valid[8] = '12'; valid[9] = '6.75';
  const noSku = [...hero]; noSku[0] = '';
  const noName = [...hero]; noName[1] = '';
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Supplier File', exact: true }).click();
  await page.getByLabel('Supplier file', { exact: true }).setInputFiles({ name: 'custom.csv', mimeType: 'text/csv', buffer: csvBytes([valid, noSku, noName, valid]) });
  await expect(page.getByRole('dialog').locator('.import-counts strong')).toHaveText(['4', '1', '0', '1', '2']);
  await expect(page.getByRole('dialog')).toContainText('Missing required field: sku');
  await expect(page.getByRole('dialog')).toContainText('Missing required field: productName');
  await page.getByRole('button', { name: 'Import 1 products' }).click();
  await expect(page.locator('.product-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.product-table')).toContainText('Real Uploaded 350ml Bottle');
  await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
  await expect(page.getByTestId('recommendation-1')).toContainText('CSV-CUSTOM-350');
  await page.getByTestId('recommendation-1').getByRole('button', { name: 'Select SKU' }).click();
  await expect(page.getByRole('heading', { name: 'FactCard V1', exact: true })).toBeVisible();
  const facts = (await snapshot(page)).v1.facts;
  expect(facts.find((f: { key: string }) => f.key === 'declaredValue').value).toBe('USD 6.75');
  expect(facts.find((f: { key: string }) => f.key === 'supplierCost').value).toBe('USD 12.00');
  expect(facts.find((f: { key: string }) => f.key === 'capacity').value).toBe('350ml / 11.8 fl oz');
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await expect(page.locator('.suggested-price>strong')).toHaveText('USD 23.00');
});

test('Chinese mobile import and language switch preserve the preview and imported state', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('button', { name: '导入供应商文件', exact: true }).click();
  await page.getByLabel('供应商文件', { exact: true }).setInputFiles(resolve('public/demo/prismlaunch-supplier-demo.xlsx'));
  await expect(page.getByRole('button', { name: '导入 7 个商品' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '导入 7 个商品' }).click();
  await expect(page.getByTestId('import-completed')).toContainText('导入完成');
  await expect(page.locator('.product-table tbody tr')).toHaveCount(7);
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByTestId('import-completed')).toContainText('Import completed');
  await page.reload();
  await expect(page.locator('.product-table tbody tr')).toHaveCount(7);
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('button', { name: `查看 ${MISSING}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: '定价已阻断' })).toBeVisible();
});

test('existing v1 sessions migrate to a catalog without losing the task', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
  await expect(page.getByTestId('recommendation-1')).toBeVisible();
  await page.evaluate(key => {
    const state = JSON.parse(localStorage.getItem(key)!);
    delete state.catalog; delete state.datasetSource; delete state.importReport;
    localStorage.setItem(key, JSON.stringify(state));
  }, STATE_KEY);
  await page.reload();
  await expect(page.getByTestId('recommendation-1')).toContainText(HERO);
  const state = await snapshot(page);
  expect(state.catalog).toHaveLength(10); expect(state.task.id).toBe('PL-DEMO-001');
});
