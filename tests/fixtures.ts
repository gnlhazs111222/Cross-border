import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
export type { Page } from '@playwright/test';
export { expect };

// Isolated real accounts/cookies prevent one parallel scenario's reset affecting another.
export const test = base.extend({ page: async ({ page }, use) => {
  const response = await page.context().request.post('/api/auth/register', { data: { email: `test-${randomUUID()}@prismlaunch.local`, password: 'Demo123456', displayName: 'PrismLaunch Demo' } });
  expect(response.status()).toBe(201);
  await use(page);
  await page.context().request.post('/api/auth/logout', { data: {} });
} });
