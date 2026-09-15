import { expect, test } from './fixtures';
import { resolve } from 'node:path';

const BAG = 'LM-BG-TOT-101-BLK';
const BUILTIN_BAG = 'LM-BG-TOT-009-BLK';

test('tote bag completes recommendation, facts, listing, review, publish and CSV', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Supplier File', exact: true }).click();
  await page.getByLabel('Supplier file', { exact: true }).setInputFiles(resolve('public/demo/haitao-bag-demo.csv'));
  await page.getByRole('button', { name: 'Import 1 products', exact: true }).click();
  await expect(page.getByTestId(`product-${BAG}`)).toContainText('Tote bag');
  await page.getByRole('navigation').getByRole('button', { name: 'Launch Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Load Bag Demo', exact: true }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(1);
  const card = page.getByTestId('recommendation-1');
  await expect(card).toContainText(BAG);
  await expect(card).toContainText('Tote bag');
  await expect(card).toContainText('Canvas');
  await expect(card).not.toContainText('0ml');
  await expect(card).not.toContainText('No straw');
  await card.getByRole('button', { name: 'Select SKU', exact: true }).click();

  await expect(page.getByTestId('fact-review-bagType')).toContainText('Tote bag');
  await expect(page.getByTestId('fact-review-bagType')).toContainText('Imported Supplier File');
  await expect(page.getByTestId('fact-review-capacity')).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await expect(page.getByTestId('fact-review-closureType')).toContainText('Needs confirmation');
  await expect(page.getByTestId('fact-review-strapType')).toContainText('Needs confirmation');
  await page.getByTestId('fact-review-closureType').getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByTestId('fact-review-strapType').getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to Listing Studio', exact: true }).click();

  await expect(page.locator('.suggested-price>strong')).toHaveText('USD 17.50');
  await page.getByRole('button', { name: 'Generate Amazon Listing', exact: true }).click();
  await expect(page.locator('.listing-copy')).toContainText('Black Canvas Tote Bag');
  await expect(page.locator('.listing-copy')).toContainText('Open top closure.');
  await expect(page.locator('.listing-copy')).toContainText('Dual shoulder straps.');
  await expect(page.locator('.listing-copy')).toContainText('Guaranteed to carry up to 50 kg.');
  await expect(page.locator('.listing-copy')).not.toContainText('500ml');
  await expect(page.locator('.listing-copy')).not.toContainText('straw');
  await page.screenshot({ path: testInfo.outputPath('bag-listing.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue to Review', exact: true }).click();

  await page.getByRole('button', { name: 'Run Review', exact: true }).click();
  await expect(page.locator('.risk-issue')).toContainText('R003');
  await expect(page.locator('.risk-issue')).toContainText('Unsupported load claim');
  await page.getByRole('button', { name: 'Apply Suggested Fix', exact: true }).click();
  await expect(page.locator('.listing-copy')).not.toContainText('50 kg');
  await page.getByRole('button', { name: 'Run Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review Passed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Amazon Listing Export Ready' })).toBeVisible();

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Amazon CSV' }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv).toContain(BAG);
  expect(csv).toContain('Black Canvas Tote Bag');
  expect(csv).not.toMatch(/500ml|straw|bottle|leakproof|50 kg/i);
});

test('Chinese mobile bag path stays category-correct and usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: '上新任务', exact: true }).click();
  await page.getByRole('button', { name: '载入包类演示', exact: true }).click();
  const card = page.getByTestId('recommendation-1');
  await expect(card).toContainText('日用帆布托特包');
  await expect(card).toContainText(BUILTIN_BAG);
  await expect(card).toContainText('托特包符合指定商品类型');
  await expect(card).not.toContainText('0ml');
  await expect(card).not.toContainText('无吸管');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.getByRole('button', { name: '选择 SKU', exact: true }).click();
  await page.getByRole('button', { name: '分析证据', exact: true }).first().click();
  await expect(page.getByTestId('fact-review-closureType')).toContainText('待确认');
  await expect(page.getByTestId('fact-review-strapType')).toContainText('待确认');
  await expect(page.getByText('包类图片证据为模拟数据。图片可以显示外形、包口和肩带，但不能证明材质真实性、耐用性或承重能力。')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('bag-mobile-zh.png'), fullPage: true });
});
