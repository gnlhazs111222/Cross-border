import { test, expect } from './fixtures';

for (const target of ['amazon', 'shopify'] as const) test(`listing generation inherits ${target} task even with stale platform cache`, async ({ page }) => {
  const label = target === 'amazon' ? 'Amazon' : 'Shopify';
  // Seed the task's platform at creation; do not select a platform in the studio.
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), platform: `${label} US` }) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
  await page.getByTestId('recommendation-1').getByRole('button', { name: 'Select SKU', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue to Listing Studio' }).click();
  await page.evaluate(wrong => {
    const key = 'prismlaunch.demo.v1'; const state = JSON.parse(localStorage.getItem(key)!);
    state.platform = wrong; localStorage.setItem(key, JSON.stringify(state));
  }, target === 'amazon' ? 'shopify' : 'amazon');
  await page.reload();
  await expect(page.getByRole('tablist', { name: 'Listing platform' })).toHaveCount(0);
  await expect(page.getByTestId('task-listing-platform')).toHaveText(`${label} US`);
  const request = page.waitForRequest(r => r.method() === 'POST' && /\/products\/[^/]+\/listings$/.test(r.url()));
  await page.getByRole('button', { name: `Generate ${label} Listing`, exact: true }).click();
  expect((await request).postDataJSON().platform).toBe(target);
  await expect(page.locator('.listing-copy')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to Review', exact: true }).click();
  await expect(page.getByRole('tab', { name: `${label} US`, exact: true })).toHaveAttribute('data-state', 'active');
});
