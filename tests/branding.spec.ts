import { expect, test } from '@playwright/test';

test('海淘集市 branding is consistent from login to workspace', async ({ page }, testInfo) => {
  // Brand assertions do not need the unrelated continuous WebGL render loop.
  await page.route('**/login-3d/scene.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.goto('/');
  await expect(page).toHaveTitle(/海淘集市/);

  const login = page.frameLocator('.login-experience-frame');
  await expect(login.locator('#siteBrand')).toContainText('海淘集市');
  await expect(login.locator('#heroTitle')).toHaveText('让上新有据让好物出海');
  await expect(login.locator('#siteBrand img')).toHaveAttribute('src', '../haitao-market-logo.png');
  await expect(login.locator('#siteBrand img')).toBeVisible();
  await expect(login.locator('#start')).toHaveText('登录→');
  await expect(login.locator('#start')).not.toContainText(/↗|↑/);
  await expect(login.locator('.intro')).toHaveText('从供应商资料出发，让选品、核验、定价和发布准备都有据可循。');
  await page.screenshot({ path: testInfo.outputPath('haitao-market-login.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(login.locator('#siteBrand')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('haitao-market-login-mobile.png'), fullPage: true });
  await login.locator('#start').click();
  await login.locator('#email').fill('demo@prismlaunch.local');
  await login.locator('#password').fill('Demo123456');
  await login.locator('#loginForm .submit').click();
  await expect(page.locator('.brand')).toContainText('海淘集市');
  await expect(page.locator('.brand img')).toHaveAttribute('src', '/haitao-market-logo.png');
  await expect(page.locator('.account-menu')).toContainText('海淘集市 Demo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('haitao-market-workspace.png'), fullPage: true });
});
