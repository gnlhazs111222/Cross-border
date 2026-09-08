import { test, expect, type Page } from './fixtures';
const KEY = 'prismlaunch.demo.v1';
const HERO = 'LM-KT-BTL-001-BLK-500';
const MISSING = 'LM-KT-BTL-005-BLK-500';
const state = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
async function open(page: Page, sku: string, zh = false) {
  await page.getByRole('button', { name: `${zh ? '查看' : 'View'} ${sku}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: zh ? '核对事实' : 'Review Facts', exact: true }).click();
  await expect(page.getByTestId('fact-review-packagingWeight')).toBeVisible();
}
async function edit(page: Page, key: string, value: string, zh = false) {
  await page.getByTestId(`fact-review-${key}`).getByRole('button', { name: zh ? /^(编辑|补充值)$/ : /^(Edit|Add Value)$/ }).click();
  await page.getByRole('dialog').locator('input').fill(value);
  await page.getByRole('button', { name: zh ? '保存数值' : 'Save Value', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function serverSnapshot(page: Page) {
  const s = await state(page);
  const response = await page.context().request.get(`/api/tasks/${s.task.recordId}/products/${s.selectedSku}/fact-snapshot`);
  expect(response.ok()).toBe(true); return (await response.json()).data;
}
for (const zh of [false, true]) test(`server facts survive all localStorage deletion and cache forgery (${zh ? 'Chinese' : 'English'})`, async ({ page }) => {
  await page.goto('/');
  if (zh) await page.getByRole('button', { name: '中文', exact: true }).click();
  await open(page, MISSING, zh);
  await edit(page, 'packagingWeight', '0.42', zh);
  let snap = await serverSnapshot(page);
  expect(snap.pricingReadiness.ready).toBe(false);
  expect(snap.facts.find((f: { key: string }) => f.key === 'packagingWeight').status).toBe('Requires Confirmation');
  await page.getByTestId('fact-review-packagingWeight').getByRole('button', { name: zh ? '确认' : 'Confirm', exact: true }).click();
  await expect(page.locator('.suggested-price>strong')).toHaveText('USD 19.20');
  await page.getByRole('button', { name: zh ? '分析证据' : 'Analyze Evidence', exact: true }).first().click();
  await expect(page.getByRole('button', { name: zh ? '继续前往文案工作室' : 'Continue to Listing Studio' })).toBeVisible();
  snap = await serverSnapshot(page);
  const weight = snap.facts.find((f: { key: string }) => f.key === 'packagingWeight');
  expect(weight).toMatchObject({ status: 'Confirmed', sourceKind: 'manual', previousValue: 'Missing', value: '0.42 kg' });
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
  await page.getByRole('navigation').getByRole('button', { name: 'Evidence & Facts', exact: true }).click();
  await expect(page.getByTestId('fact-review-packagingWeight')).toContainText('0.42 kg');
  expect((await serverSnapshot(page)).factsRevision).toBe(snap.factsRevision);
  expect((await state(page)).v2).not.toBeNull();
  await page.evaluate(key => {
    const s = JSON.parse(localStorage.getItem(key)!);
    for (const card of [s.v1, s.v2]) for (const f of card.facts) if (f.key === 'color') { f.value = 'FORGED MAGENTA'; f.status = 'Confirmed'; f.allowed = true; }
    s.factEdits = { [s.selectedSku]: { color: { ...s.v1.facts.find((f: { key: string }) => f.key === 'color'), value: 'FORGED MAGENTA' } } };
    localStorage.setItem(key, JSON.stringify(s));
  }, KEY);
  await page.reload(); await expect(page.getByTestId('fact-review-color')).toContainText('Black');
  await expect(page.getByTestId('fact-review-color')).not.toContainText('FORGED');
  expect((await state(page)).factEdits).toEqual({});
  await page.getByRole('button', { name: 'Continue to Listing Studio' }).click();
  await page.getByRole('tab', { name: 'Shopify US' }).click();
  await page.getByRole('button', { name: 'Generate Shopify Listing' }).click();
  await expect(page.locator('.listing-copy')).not.toContainText('FORGED');
  expect((await state(page)).listings.shopify.factRevision).toBe(snap.factsRevision);
});

test('server fact changed from another client clears old browser approval before publish', async ({ page }) => {
  await page.goto('/'); await open(page, HERO);
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue to Listing Studio' }).click();
  await page.getByRole('tab', { name: 'Shopify US' }).click();
  await page.getByRole('button', { name: 'Generate Shopify Listing' }).click();
  await page.getByRole('button', { name: 'Continue to Review' }).click();
  await page.getByRole('button', { name: 'Run Review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  const snap = await serverSnapshot(page); const color = snap.facts.find((f: { key: string }) => f.key === 'color');
  const changed = await page.context().request.patch(`/api/facts/${color.recordId}`, { data: { value: 'Navy', expectedRevision: snap.factsRevision } });
  expect(changed.ok()).toBe(true); expect((await changed.json()).data.downstreamInvalidated).toBe(true);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Generate a listing before review' })).toBeVisible();
  const s = await state(page); expect(s.listings).toEqual({}); expect(s.reviews).toEqual({}); expect(s.publications).toEqual({});
  expect(s.factsRevision).toBe(snap.factsRevision + 1);
});

test('legacy browser facts are not promoted into a newly created server V1', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
  await expect(page.getByTestId('recommendation-1')).toBeVisible();
  const s = await state(page);
  await page.context().request.post(`/api/tasks/${s.task.recordId}/selection`, { data: { productId: HERO, purpose: 'selected' } });
  await page.evaluate(({ key, hero }) => {
    const s = JSON.parse(localStorage.getItem(key)!); s.selectedSku = hero; s.workspace = 'evidence'; delete s.factsRevision;
    const fact = { key: 'color', label: 'Color', value: 'FORGED OLD VALUE', source: 'Manual confirmation', sourceKind: 'manual', anchor: 'Legacy', status: 'Confirmed', allowed: true };
    s.factEdits = { [hero]: { color: fact } }; s.v1 = { version: 1, sku: hero, facts: [fact] }; s.v2 = { version: 2, sku: hero, facts: [fact] };
    localStorage.setItem(key, JSON.stringify(s));
  }, { key: KEY, hero: HERO });
  await page.reload(); await expect(page.getByTestId('fact-review-color')).toContainText('Black');
  const restored = await serverSnapshot(page); expect(restored.v2).toBeNull(); expect(restored.facts).toHaveLength(11);
  await expect(page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first()).toBeVisible();
  expect((await state(page)).factEdits).toEqual({});
});

test('a published browser cache cannot export CSV after a server fact changes', async ({ page }) => {
  await page.goto('/'); await open(page, HERO);
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue to Listing Studio' }).click();
  await page.getByRole('button', { name: 'Generate Amazon Listing' }).click();
  await page.getByRole('button', { name: 'Continue to Review' }).click();
  await page.getByRole('button', { name: 'Run Review', exact: true }).click();
  await page.getByRole('button', { name: 'Apply Suggested Fix' }).click();
  await page.getByRole('button', { name: 'Run Review', exact: true }).click();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export Amazon CSV' })).toBeVisible();
  const snap = await serverSnapshot(page); const color = snap.facts.find((f: { key: string }) => f.key === 'color');
  expect((await page.context().request.post(`/api/facts/${color.recordId}/reject`, { data: { expectedRevision: snap.factsRevision } })).ok()).toBe(true);
  let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Export Amazon CSV' }).click();
  await expect(page.getByRole('heading', { name: 'Generate a listing before review' })).toBeVisible();
  expect(downloads).toBe(0); expect((await state(page)).publications).toEqual({});
});
