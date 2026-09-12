import { expect, test } from './fixtures';

async function openPricing(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
  await page.getByTestId('recommendation-1').getByRole('button', { name: 'Select SKU', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue to Listing Studio', exact: true }).click();
}

test('task pricing snapshot is persisted, traceable and refreshable', async ({ page }, testInfo) => {
  await openPricing(page);
  const panel = page.locator('.pricing-panel');
  await expect(panel.getByRole('heading', { name: 'Task Pricing Snapshot', exact: true })).toBeVisible();
  await expect(panel).toContainText('PCS-PL-DEMO-001-v1');
  await panel.getByText('Snapshot provenance', { exact: true }).click();
  await expect(panel).toContainText('1 CNY = 0.139 USD');
  await expect(panel).toContainText('Demo approved exchange-rate table');
  await expect(panel).toContainText('2026-09-01');
  await expect(panel).toContainText('shipping-us-demo-v1');
  await expect(panel).toContainText('Demo US parcel profile');
  await expect(panel).toContainText('duty-us-demo-v1');
  await expect(panel).toContainText('platform-us-demo-v1');
  await expect(panel).toContainText('pricing-context-demo-v1');
  await page.screenshot({ path: testInfo.outputPath('pricing-snapshot-v1.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
  await expect(panel).toContainText('PCS-PL-DEMO-001-v2');
  await page.reload();
  await expect(page.locator('.pricing-panel')).toContainText('PCS-PL-DEMO-001-v2');
});

test('Chinese mobile snapshot disclosure stays readable without horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openPricing(page);
  await page.getByRole('button', { name: '中文', exact: true }).click();
  const panel = page.locator('.pricing-panel');
  await expect(panel.getByRole('heading', { name: '定价计算', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '刷新快照', exact: true })).toBeVisible();
  await panel.getByText('查看快照来源与版本', { exact: true }).click();
  await expect(panel).toContainText('演示用受控汇率表');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pricing-snapshot-mobile-zh.png'), fullPage: true });
});
