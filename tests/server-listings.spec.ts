import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from './fixtures';
const KEY = 'prismlaunch.demo.v1';
const state = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
const label = (zh: boolean, en: string, cn: string) => zh ? cn : en;
async function generate(page: Page, zh = false) {
  await page.goto('/'); if (zh) await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('button', { name: label(zh, 'Create Demo Task', '创建演示任务'), exact: true }).click();
  await page.getByTestId('recommendation-1').getByRole('button', { name: label(zh, 'Select SKU', '选择 SKU'), exact: true }).click();
  await page.getByRole('button', { name: label(zh, 'Analyze Evidence', '分析证据'), exact: true }).first().click();
  await page.getByRole('button', { name: label(zh, 'Continue to Listing Studio', '继续前往文案工作室') }).click();
  await page.getByRole('button', { name: label(zh, 'Generate Amazon Listing', '生成 Amazon 文案') }).click();
  await page.getByRole('button', { name: label(zh, 'Continue to Review', '继续前往审核') }).click();
  await page.getByRole('button', { name: label(zh, 'Run Review', '运行审核'), exact: true }).click();
  await expect(page.locator('.risk-issue')).toContainText('R001');
}
async function fix(page: Page, zh = false) {
  await page.getByRole('button', { name: label(zh, 'Apply Suggested Fix', '应用建议修订') }).click();
  await expect(page.getByRole('button', { name: label(zh, 'Publish', '发布'), exact: true })).toBeDisabled();
  await page.getByRole('button', { name: label(zh, 'Run Review', '运行审核'), exact: true }).click();
  await expect(page.getByRole('button', { name: label(zh, 'Publish', '发布'), exact: true })).toBeEnabled();
}
for (const zh of [false, true]) test(`server review and publication survive cache forgery and deletion (${zh ? 'Chinese' : 'English'})`, async ({ page }, info) => {
  await generate(page, zh); const blocked = await state(page);
  expect(blocked.listings.amazon.recordId).toBeTruthy(); expect(blocked.reviews.amazon.recordId).toBeTruthy();
  await page.evaluate(key => {
    const s = JSON.parse(localStorage.getItem(key)!);
    s.stage = 'published'; s.listings.amazon.title = 'FORGED CACHED CONTENT';
    s.reviews.amazon = { recordId: 'fake-review', status: 'passed', revision: s.listings.amazon.revision, issues: [] };
    s.publications.amazon = { recordId: 'fake-publish', platform: 'amazon', productId: 'FAKE-PUBLISHED', status: 'Export ready', revision: s.listings.amazon.revision };
    localStorage.setItem(key, JSON.stringify(s));
  }, KEY);
  await page.reload(); await expect(page.locator('.risk-issue')).toContainText('R001');
  await expect(page.getByRole('button', { name: label(zh, 'Publish', '发布'), exact: true })).toBeDisabled();
  await expect(page.locator('.listing-copy')).not.toContainText('FORGED'); expect((await state(page)).publications).toEqual({});
  const forged = await page.context().request.post(`/api/listings/${blocked.listings.amazon.recordId}/publish`, { data: { expectedVersion: 1, expectedFactsRevision: blocked.factsRevision, reviewPassed: true } });
  expect(forged.status()).toBe(400);
  await fix(page, zh);
  await page.getByRole('button', { name: label(zh, 'Publish', '发布'), exact: true }).click();
  await expect(page.getByRole('heading', { name: label(zh, 'Amazon Listing Export Ready', 'Amazon 文案已就绪，可导出') })).toBeVisible();
  const published = await state(page); const id = published.publications.amazon.recordId;
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
  if (zh) await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: label(zh, 'Review & Publish', '审核与发布'), exact: true }).click();
  await expect(page.getByRole('heading', { name: label(zh, 'Amazon Listing Export Ready', 'Amazon 文案已就绪，可导出') })).toBeVisible();
  expect((await state(page)).publications.amazon.recordId).toBe(id);
  const history = await (await page.context().request.get(`/api/listings/${blocked.listings.amazon.recordId}`)).json();
  expect(history.data.listing.status).toBe('superseded'); expect(history.data.reviews[0].invalidatedAt).toBeTruthy();
  const csvResponse = page.waitForResponse(r => r.url().endsWith(`/api/publish/${id}/amazon-csv`));
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: label(zh, 'Export Amazon CSV', '导出 Amazon CSV') }).click();
  const response = await csvResponse; expect(response.status()).toBe(200);
  const csv = await response.text(); expect(csv).toContain('19.99'); expect(csv).not.toMatch(/FORGED|100% leakproof|fake-publish/);
  await (await downloaded).saveAs(info.outputPath('server-amazon.csv'));
  const bytes = await readFile(info.outputPath('server-amazon.csv'));
  expect(bytes.subarray(0, 3).toString('hex')).toBe('efbbbf');
});

test('another tab publishing stale listing version gets server rejection and current unreviewed copy', async ({ page }) => {
  await generate(page); await fix(page);
  const before = await state(page); const old = before.listings.amazon;
  const changed = await page.context().request.patch(`/api/listings/${old.recordId}`, { data: { expectedVersion: old.revision, expectedFactsRevision: before.factsRevision, title: 'New unreviewed title', bullets: old.bullets, description: old.description } });
  expect(changed.status()).toBe(200);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('.listing-copy')).toContainText('New unreviewed title');
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  const after = await state(page); expect(after.listings.amazon.revision).toBe(old.revision + 1); expect(after.reviews).toEqual({}); expect(after.publications).toEqual({});
  await page.getByRole('button', { name: 'Run Review', exact: true }).click();
  await expect(page.locator('.risk-issue')).toContainText('R002');
});

test('a new browser context restores SQLite publication with cookies and no business cache', async ({ page, browser }) => {
  await generate(page); await fix(page); await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Amazon Listing Export Ready' })).toBeVisible();
  const saved = await state(page);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', locale: 'en-US', storageState: { cookies: await page.context().cookies(), origins: [] } });
  try {
    const fresh = await context.newPage(); await fresh.goto('/'); await expect(fresh.locator('.product-table tbody tr')).toHaveCount(10);
    await fresh.getByRole('navigation').getByRole('button', { name: 'Review & Publish', exact: true }).click();
    await expect(fresh.getByRole('heading', { name: 'Amazon Listing Export Ready' })).toBeVisible();
    expect((await state(fresh)).publications.amazon.recordId).toBe(saved.publications.amazon.recordId);
    expect((await state(fresh)).reviews.amazon.recordId).toBe(saved.reviews.amazon.recordId);
  } finally { await context.close(); }
});
