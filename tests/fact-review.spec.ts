import { expect, test, type Page } from './fixtures';
import { resolve } from 'node:path';

const HERO = 'LM-KT-BTL-001-BLK-500';
const MISSING = 'LM-KT-BTL-005-BLK-500';
const IMPORT_MISSING = 'LM-KT-IMP-005-BLK-500';
const KEY = 'prismlaunch.demo.v1';
const snapshot = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
async function navigate(page: Page, name: string) { await page.getByRole('navigation').getByRole('button', { name, exact: true }).click(); }
/** The comparison is collapsed by default, so a test that edits a fact opens it the way a person does. */
async function openComparison(page: Page, zh = false) {
  const panel = page.locator('details#fact-review');
  await expect(panel).toBeVisible();
  if (!(await panel.evaluate((node: HTMLDetailsElement) => node.open))) await panel.locator('summary').click();
  await expect(page.getByRole('heading', { name: zh ? '事实卡对照' : 'Fact card comparison', exact: true })).toBeVisible();
}
async function openFacts(page: Page, sku: string, zh = false) {
  await page.getByRole('button', { name: `${zh ? '查看' : 'View'} ${sku}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: zh ? '核对事实' : 'Review Facts', exact: true }).click();
  await openComparison(page, zh);
}
async function editFact(page: Page, key: string, value: string, zh = false) {
  const row = page.getByTestId(`fact-review-${key}`);
  await row.getByRole('button', { name: zh ? /^(编辑|补充值)$/ : /^(Edit|Add Value)$/ }).click();
  await page.getByRole('dialog').locator('input').fill(value);
  await page.getByRole('button', { name: zh ? '保存数值' : 'Save Value', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row.locator('td').nth(2)).toHaveText(zh ? '待确认' : 'Needs confirmation');
}
async function confirmFact(page: Page, key: string, zh = false) {
  const row = page.getByTestId(`fact-review-${key}`);
  await row.getByRole('button', { name: zh ? '确认' : 'Confirm', exact: true }).click();
  await expect(row.locator('td').nth(2)).toHaveText(zh ? '已确认' : 'Confirmed');
}
async function importSample(page: Page) {
  await page.getByRole('button', { name: 'Import Supplier File', exact: true }).click();
  await page.getByLabel('Supplier file', { exact: true }).setInputFiles(resolve('public/demo/prismlaunch-supplier-demo.xlsx'));
  await page.getByRole('button', { name: 'Import 7 products' }).click();
  await expect(page.locator('.product-table tbody tr')).toHaveCount(7);
}

test('pricing-pending SKU can generate and pass Listing review before price is completed', async ({ page }) => {
  await page.goto('/');
  await openFacts(page, MISSING);
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to Listing Studio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pricing Blocked', exact: true })).toBeVisible();
  await expect(page.getByText('Suggested price pending', { exact: true })).toBeVisible();
  const generate = page.getByRole('button', { name: 'Generate Shopify Listing', exact: true });
  await page.getByRole('tab', { name: 'Shopify US', exact: true }).click();
  await expect(generate).toBeEnabled();
  await generate.click();
  await page.getByRole('button', { name: 'Continue to Review', exact: true }).click();
  await page.getByRole('button', { name: 'Run Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review Passed', exact: true })).toBeVisible();
  await expect(page.getByTestId('review-stage-banner')).toContainText('Review passed · Suggested price pending');
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  await expect(page.getByText('Complete pricing inputs before publishing or exporting.', { exact: true })).toBeVisible();
  await navigate(page, 'Evidence & Facts');
  await editFact(page, 'packagingWeight', '0.42');
  await confirmFact(page, 'packagingWeight');
  await expect(page.locator('.suggested-price>strong')).toHaveText('USD 19.20');
  await navigate(page, 'Review & Publish');
  await expect(page.getByRole('heading', { name: 'Review Passed', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
});

for (const imported of [false, true]) {
  test(`${imported ? 'imported English' : 'built-in Chinese mobile'} missing weight is saved pending, confirmed and really unlocks pricing`, async ({ page }, info) => {
    const zh = !imported;
    const sku = imported ? IMPORT_MISSING : MISSING;
    if (zh) await page.setViewportSize({ width: 375, height: 812 });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
    if (imported) await importSample(page); else await page.getByRole('button', { name: '中文', exact: true }).click();
    await openFacts(page, sku, zh);
    await expect(page.getByRole('heading', { name: zh ? '定价已阻断' : 'Pricing Blocked', exact: true })).toBeVisible();
    const row = page.getByTestId('fact-review-packagingWeight');
    await expect(row.locator('td').nth(2)).toHaveText(zh ? '缺失' : 'Missing');
    await expect(row.getByRole('button', { name: zh ? '确认' : 'Confirm', exact: true })).toHaveCount(0);
    const original = await snapshot(page);
    await editFact(page, 'packagingWeight', '0.42', zh);
    expect((await snapshot(page)).pricing.status).toBe('blocked');
    await expect(row).toContainText(zh ? '人工确认' : 'Manual confirmation');
    await confirmFact(page, 'packagingWeight', zh);
    await expect(page.locator('.suggested-price>strong')).toHaveText(imported ? 'USD 18.90' : 'USD 19.20');
    const saved = await snapshot(page);
    const fact = saved.v1.facts.find((f: { key: string }) => f.key === 'packagingWeight');
    expect(fact).toMatchObject({ value: '0.42 kg', status: 'Confirmed', source: 'Manual confirmation', sourceKind: 'manual', allowed: false, previousValue: 'Missing' });
    expect(Number.isNaN(Date.parse(fact.confirmedAt))).toBe(false);
    expect(fact.previousSource).toContain(imported ? 'prismlaunch-supplier-demo.xlsx' : 'Supplier Spreadsheet');
    expect(saved.catalog).toEqual(original.catalog); // supplier evidence is not silently rewritten
    expect(saved.pricing.status).toBe('ready'); expect(saved.pricing.suggestedPrice).not.toBe(19.99);
    const v1 = saved.v1;
    await page.getByRole('button', { name: zh ? '分析证据' : 'Analyze Evidence', exact: true }).first().click();
    await expect(page.getByRole('button', { name: zh ? '继续前往文案工作室' : 'Continue to Listing Studio' })).toBeVisible();
    expect((await snapshot(page)).v1).toEqual(v1);
    await page.reload();
    await expect(page.getByTestId('fact-review-packagingWeight')).toContainText('0.93 lb');
    await expect(page.locator('.suggested-price>strong')).toHaveText(imported ? 'USD 18.90' : 'USD 19.20');
    await page.screenshot({ path: info.outputPath('manual-weight-ready.png'), fullPage: true });
    await navigate(page, zh ? '商品资料' : 'Materials');
    await expect(page.getByTestId(`product-${sku}`).locator('td').nth(4)).toContainText(zh ? '资料齐全' : 'Ready');
    await page.getByRole('button', { name: `${zh ? '查看' : 'View'} ${sku}`, exact: true }).click();
    await expect(page.getByRole('button', { name: zh ? '选择用于上新' : 'Select for Launch' })).toBeEnabled();
    await page.getByRole('button', { name: zh ? '关闭详情' : 'Close details' }).click();
    await navigate(page, zh ? '证据与事实' : 'Evidence & Facts');
    await page.getByRole('button', { name: zh ? '继续前往文案工作室' : 'Continue to Listing Studio' }).click();
    await page.getByRole('tab', { name: zh ? 'Shopify 美国站' : 'Shopify US' }).click();
    await page.getByRole('button', { name: zh ? '生成 Shopify 文案' : 'Generate Shopify Listing' }).click();
    await expect(page.locator('.listing-copy')).toContainText('500ml / 16.9 fl oz');
    expect(errors).toEqual([]);
  });
}

test('all required dimensions must be confirmed, and invalid or blank values cannot save', async ({ page }) => {
  await page.goto('/');
  await openFacts(page, 'LM-KT-BTL-006-GRN-500');
  const length = page.getByTestId('fact-review-packageLength');
  await length.getByRole('button', { name: 'Add Value' }).click();
  for (const value of ['', '0', '-1']) {
    await page.getByRole('dialog').locator('input').fill(value);
    await page.getByRole('button', { name: 'Save Value' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    expect((await snapshot(page)).pricing.status).toBe('blocked');
  }
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  for (const [key, value] of [['packageLength', '8'], ['packageWidth', '8'], ['packageHeight', '25']]) {
    await editFact(page, key, value);
    expect((await snapshot(page)).pricing.status).toBe('blocked');
    await confirmFact(page, key);
    expect((await snapshot(page)).pricing.status).toBe(key === 'packageHeight' ? 'ready' : 'blocked');
  }
  await expect(page.locator('.suggested-price>strong')).toHaveText('USD 19.20');
});

test('copy fact changes invalidate Listing while pricing-only facts preserve approved copy', async ({ page }) => {
  await page.goto('/'); await openFacts(page, HERO);
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue to Listing Studio' }).click();
  await page.getByRole('button', { name: 'Generate Amazon Listing' }).click();
  await page.getByRole('button', { name: 'Continue to Review' }).click();
  await page.getByRole('button', { name: 'Run Review' }).click();
  await page.getByRole('button', { name: 'Apply Suggested Fix' }).click();
  await page.getByRole('button', { name: 'Run Review' }).click();
  await expect(page.getByRole('heading', { name: 'Review Passed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Amazon Listing Export Ready' })).toBeVisible();
  await page.getByRole('tab', { name: 'Shopify US' }).click();
  await page.getByRole('button', { name: 'Go to Listing Studio' }).click();
  await page.getByRole('button', { name: 'Generate Shopify Listing' }).click();
  await page.getByRole('button', { name: 'Continue to Review' }).click();
  await page.getByRole('button', { name: 'Run Review' }).click();
  await expect(page.getByRole('heading', { name: 'Review Passed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Shopify Draft Created' })).toBeVisible();
  expect(Object.keys((await snapshot(page)).publications)).toHaveLength(2);
  const priceVersion = (await snapshot(page)).pricing.version;
  await navigate(page, 'Evidence & Facts');
  await editFact(page, 'color', 'Ivory');
  const pending = await snapshot(page);
  expect(pending.listings).toEqual({}); expect(pending.reviews).toEqual({}); expect(pending.publications).toEqual({});
  expect(pending.pricing.version).toBe(priceVersion);
  expect(pending.v2.facts.find((f: { key: string }) => f.key === 'color')).toMatchObject({ value: 'Ivory', status: 'Requires Confirmation', allowed: false });
  await navigate(page, 'Listing Studio');
  await expect(page.getByRole('button', { name: 'Generate Shopify Listing' })).toBeDisabled();
  await navigate(page, 'Evidence & Facts'); await confirmFact(page, 'color');
  await navigate(page, 'Listing Studio');
  await page.getByRole('button', { name: 'Generate Shopify Listing' }).click();
  await expect(page.locator('.listing-copy h2')).toContainText('Ivory');
  await page.getByRole('button', { name: 'Continue to Review' }).click();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Run Review' }).click();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Shopify Draft Created' })).toBeVisible();
  const beforePricingEdit = await snapshot(page);
  await navigate(page, 'Evidence & Facts'); await editFact(page, 'packagingWeight', '0.5');
  const changed = await snapshot(page);
  expect(changed.pricing.status).toBe('blocked'); expect(changed.pricing.version).not.toBe(priceVersion);
  expect(changed.publications).toEqual({});
  expect(changed.reviews).toEqual(beforePricingEdit.reviews);
  expect(changed.stage).toBe('review_passed');
  expect(changed.listings.shopify).toMatchObject({
    recordId: beforePricingEdit.listings.shopify.recordId,
    revision: beforePricingEdit.listings.shopify.revision,
    title: beforePricingEdit.listings.shopify.title,
    status: 'review_passed',
  });
  await confirmFact(page, 'packagingWeight');
  await expect(page.locator('.suggested-price>strong')).toHaveText('USD 19.99');
  expect((await snapshot(page)).stage).toBe('review_passed');
  await navigate(page, 'Review & Publish');
  await expect(page.getByRole('heading', { name: 'Review Passed', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  await page.reload();
  expect((await snapshot(page)).publications).toEqual({});
});

test('pending and rejected facts never enter normal copy; V2 edits do not overwrite V1', async ({ page }) => {
  await page.goto('/'); await openFacts(page, MISSING);
  await editFact(page, 'packagingWeight', '0.42'); await confirmFact(page, 'packagingWeight');
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await expect(page.getByTestId('fact-review-lidType').locator('td').nth(2)).toHaveText('Needs confirmation');
  const base = (await snapshot(page)).v1;
  await page.getByTestId('fact-review-finish').getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByTestId('fact-review-finish').locator('td').nth(2)).toHaveText('Rejected');
  await page.getByTestId('fact-review-leakproof').getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByTestId('fact-review-leakproof').getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  await expect(page.getByTestId('fact-review-leakproof').locator('td').nth(2)).toHaveText('Rejected');
  expect((await snapshot(page)).v1).toEqual(base);
  await page.getByRole('button', { name: 'Continue to Listing Studio' }).click();
  await page.getByRole('tab', { name: 'Shopify US' }).click();
  await page.getByRole('button', { name: 'Generate Shopify Listing' }).click();
  await expect(page.locator('.listing-copy')).not.toContainText(/matte|screw-top|Instruction card|leakproof/i);
  const draft = (await snapshot(page)).listings.shopify;
  expect(draft.sources.every((f: { status: string; allowed: boolean }) => f.status === 'Confirmed' && f.allowed)).toBe(true);
  await navigate(page, 'Evidence & Facts');
  await editFact(page, 'lidType', 'Flip-top lid'); await confirmFact(page, 'lidType');
  await editFact(page, 'packageIncludes', 'Bottle, Lid'); await confirmFact(page, 'packageIncludes');
  expect((await snapshot(page)).v1).toEqual(base);
  for (const [key, value] of [['capacity', '650'], ['material', 'Tritan'], ['countryOfOrigin', 'Vietnam']]) {
    await editFact(page, key, value); await confirmFact(page, key);
  }
  await page.getByTestId('fact-review-straw').getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByTestId('fact-review-straw').locator('td').nth(2)).toHaveText('Rejected');
  await navigate(page, 'Listing Studio');
  await page.getByRole('button', { name: 'Generate Shopify Listing' }).click();
  await expect(page.locator('.listing-copy')).toContainText('650ml / 22.0 fl oz');
  await expect(page.locator('.listing-copy')).toContainText('Tritan');
  await expect(page.locator('.listing-copy')).toContainText('Vietnam');
  await expect(page.locator('.listing-copy')).toContainText('Flip-top lid');
  await expect(page.locator('.listing-copy')).not.toContainText(/matte|screw-top|straw|leakproof/i);
});

test('API rejects invalid confirmations and cannot authorize the seeded performance claim', async () => {
  const { mockApi } = await import('../src/services/mockApi');
  await mockApi.reset(); await mockApi.openFactReview(MISSING);
  const before = mockApi.getState();
  await expect(mockApi.confirmFact('packagingWeight')).rejects.toThrow('A value is required');
  for (const value of ['', '0', '-1', 'NaN']) await expect(mockApi.editFact('packagingWeight', value)).rejects.toThrow();
  expect(mockApi.getState()).toEqual(before);
  await mockApi.editFact('packagingWeight', '0.42');
  expect(mockApi.getState().pricing?.status).toBe('blocked');
  await mockApi.confirmFact('packagingWeight');
  expect(mockApi.getState().pricing?.suggestedPrice).toBe(19.2);
  expect((await mockApi.getCatalog()).find(p => p.sku === MISSING)?.status).toBe('search_ready');
  await mockApi.editFact('supplierCost', '12');
  expect(mockApi.getState().pricing?.status).toBe('blocked');
  await mockApi.confirmFact('supplierCost');
  expect(mockApi.getState().pricing?.suggestedPrice).toBe(23);
  expect(mockApi.getState().v1?.facts.find(f => f.key === 'supplierCost')?.allowed).toBe(false);
  await mockApi.analyzeEvidence();
  await expect(mockApi.confirmFact('leakproof')).rejects.toThrow('cannot be edited or confirmed');
  await expect(mockApi.editFact('leakproof', '100% leakproof')).rejects.toThrow('cannot be edited or confirmed');
  expect(mockApi.canPublish()).toBe(false);
  for (const sku of ['LM-KT-BTL-007-BLK-500', 'LM-KT-BTL-008-BLK-500', 'LM-EL-LMP-010-BLK']) {
    await mockApi.openFactReview(sku); await mockApi.analyzeEvidence();
    expect(mockApi.listingReady()).toBe(false);
    await expect(mockApi.generateListing()).rejects.toThrow('Duplicate or out-of-category');
  }
});
