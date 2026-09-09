import { test as publicTest, expect } from '@playwright/test';
import { test } from './fixtures';
import { resolve } from 'node:path';

publicTest('real login UI, HttpOnly session, wrong password and logout', async ({ page }) => {
  await page.goto('/');
  const login = page.frameLocator('.login-experience-frame');
  await expect(page.locator('.login-experience-frame')).toBeVisible();
  await login.locator('#start').click();
  await login.locator('#password').fill('incorrect');
  await login.locator('#loginForm .submit').click();
  await expect(login.locator('#toast')).toContainText('登录失败：Email or password is incorrect.');
  await login.locator('#password').fill('Demo123456');
  await login.locator('#loginForm .submit').click();
  await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
  await expect(page.locator('.account-menu')).toContainText('PrismLaunch Demo');
  const session = (await page.context().cookies()).find(c => c.name === 'prismlaunch_session');
  expect(session?.httpOnly).toBe(true); expect(session?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('prismlaunch_session');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(session!.value);
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.locator('.login-experience-frame')).toBeVisible();
  expect((await page.context().request.get('/api/auth/me')).status()).toBe(401);
  expect(await page.evaluate(() => localStorage.getItem('prismlaunch.demo.v1'))).toBeNull();
});

test('products and tasks survive clearing all browser storage; forged catalog cache is ignored', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import Supplier File', exact: true }).click();
  await page.getByLabel('Supplier file', { exact: true }).setInputFiles(resolve('public/demo/prismlaunch-supplier-demo.csv'));
  await page.getByRole('button', { name: 'Import 7 products' }).click();
  await expect(page.locator('.product-table tbody tr')).toHaveCount(7);
  await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
  await expect(page.getByTestId('recommendation-1')).toBeVisible();
  const storedTasks = (await (await page.context().request.get('/api/tasks')).json()).data;
  expect(storedTasks).toHaveLength(1);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.product-table tbody tr')).toHaveCount(7);
  await expect(page.getByRole('button', { name: 'View Launch Task' })).toBeVisible();
  expect((await (await page.context().request.get('/api/tasks')).json()).data[0].recordId).toBe(storedTasks[0].recordId);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('prismlaunch.demo.v1')!);
    state.catalog = [{ ...state.catalog[0], sku: 'FORGED-CACHE', name: 'Fake cached item' }];
    localStorage.setItem('prismlaunch.demo.v1', JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator('.product-table tbody tr')).toHaveCount(7);
  await expect(page.locator('.product-table')).not.toContainText('FORGED-CACHE');
  await page.getByRole('button', { name: 'Demo Capabilities', exact: true }).click();
  await expect(page.getByTestId('server-capabilities')).toContainText('SQLite / Prisma');
  await expect(page.getByTestId('server-capabilities')).toContainText('Server authoritative:');
  await expect(page.getByTestId('server-capabilities')).toContainText('Not configured');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reset Demo', exact: true }).click();
  await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
  expect((await (await page.context().request.get('/api/tasks')).json()).data).toEqual([]);
});

test('live smoke is disabled in E2E even when called explicitly', async ({ page }) => {
  const response = await page.context().request.post('/api/ai/smoke-test', { data: { message: 'Hello' } });
  expect(response.status()).toBe(403); expect((await response.json()).error.code).toBe('live_ai_disabled');
  const capabilities = (await (await page.context().request.get('/api/capabilities')).json()).data;
  expect(capabilities.textModel.liveEnabled).toBe(false); expect(capabilities.textModel.configured).toBe(false);
  expect(capabilities.textModel.remainingCalls).toBe(20);
});

publicTest('offline competition fallback works without any API requests', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/**', route => { calls++; return route.abort(); });
  await page.goto('/?mode=local');
  await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
  await expect(page.locator('.offline-indicator')).toContainText('Offline competition demo');
  await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
  await page.getByTestId('recommendation-1').getByRole('button', { name: 'Select SKU' }).click();
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await expect(page.locator('.suggested-price>strong')).toHaveText('USD 19.99');
  await page.getByRole('button', { name: 'Continue to Listing Studio' }).click();
  await page.getByRole('button', { name: 'Generate Amazon Listing' }).click();
  await page.getByRole('button', { name: 'Continue to Review' }).click();
  await page.getByRole('button', { name: 'Run Review' }).click();
  await expect(page.locator('.risk-issue')).toContainText('R001');
  await page.getByRole('button', { name: 'Apply Suggested Fix' }).click();
  await page.getByRole('button', { name: 'Run Review' }).click();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Amazon Listing Export Ready' })).toBeVisible();
  expect(calls).toBe(0);
});
