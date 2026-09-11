import { test, expect } from './fixtures';
for (const mode of ['qwen', 'template_fallback'] as const) test(`generation indicator shows ${mode} metadata clearly on Chinese mobile`, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  // UI-only response fixture. Provider + DB behavior is verified with mock transports in server tests.
  await page.route('**/api/tasks/*/products/*/listings', async route => {
    const response = await route.fetch(); const body = await response.json();
    if (body.data?.listings?.amazon) { const l = body.data.listings.amazon; l.generationMode = mode; l.generation = { provider: mode === 'qwen' ? 'bailian' : 'template', model: 'qwen3.6-flash', promptVersion: 'listing-qwen-v2', cacheHit: mode === 'qwen', fallbackReason: mode === 'qwen' ? undefined : 'bailian_timeout' }; }
    await route.fulfill({ response, json: body });
  });
  await page.goto('/'); await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('button', { name: '创建演示任务', exact: true }).click();
  await page.getByTestId('recommendation-1').getByRole('button', { name: '选择 SKU', exact: true }).click();
  await page.getByRole('button', { name: '分析证据', exact: true }).first().click();
  await page.getByRole('button', { name: '继续前往文案工作室' }).click();
  await page.getByRole('button', { name: '生成 Amazon 文案' }).click();
  const indicator = page.getByTestId('generation-indicator');
  await expect(indicator).toContainText(mode === 'qwen' ? 'Qwen · qwen3.6-flash' : '模板回退');
  if (mode === 'template_fallback') await expect(indicator).toContainText('可以继续审核');
  await indicator.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(indicator).toContainText('listing-qwen-v2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('explicit demo risk creates a new server version and blocks review without claiming a model error', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
  await page.getByTestId('recommendation-1').getByRole('button', { name: 'Select SKU', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue to Listing Studio' }).click();
  await page.getByRole('tab', { name: 'Shopify US' }).click(); await page.getByRole('button', { name: 'Generate Shopify Listing' }).click();
  await page.getByRole('button', { name: 'Inject Demo Risk', exact: true }).click();
  await expect(page.locator('.listing-copy')).toContainText('100% leakproof');
  await page.getByTestId('generation-indicator').locator('summary').click();
  await expect(page.getByTestId('generation-indicator')).toContainText('added by a demo action');
  await page.getByRole('button', { name: 'Continue to Review' }).click(); await page.getByRole('button', { name: 'Run Review', exact: true }).click();
  await expect(page.locator('.risk-issue')).toContainText('R001');
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
});
