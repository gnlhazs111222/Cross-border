import { test, expect, type Page } from './fixtures';
const state = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('prismlaunch.demo.v1')!));
async function navigation(page: Page, name: string) { await page.getByRole('navigation').getByRole('button', { name, exact: true }).click(); }
for (const zh of [false, true]) test(`editable task save and explicit recommendation survive reload (${zh ? 'Chinese mobile' : 'English'})`, async ({ page }) => {
  if (zh) await page.setViewportSize({ width: 375, height: 812 });
  const text = (en: string, cn: string) => zh ? cn : en;
  await page.goto('/'); if (zh) await page.getByRole('button', { name: '中文', exact: true }).click();
  await navigation(page, text('Launch Tasks', '上新任务')); await page.getByRole('button', { name: text('New Task', '新建任务'), exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(text('Platform', '平台'), { exact: true }).selectOption('Shopify US');
  let posts = 0; page.on('request', r => { if (r.method() === 'POST' && /\/recommendations$/.test(r.url())) posts++; });
  await dialog.getByLabel(text('Requirements', '选品要求'), { exact: true }).fill('A black 500ml commuter bottle with a straw.');
  expect(posts).toBe(0); await dialog.getByRole('button', { name: text('Create Task', '创建任务'), exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('.recommendation-card')).toHaveCount(0); expect(posts).toBe(0);
  await page.getByRole('button', { name: text('Run Recommendation', '运行推荐'), exact: true }).click();
  await expect(page.getByTestId('recommendation-1')).toContainText('LM-KT-BTL-002-BLK-500'); expect(posts).toBe(1);
  const before = await state(page); expect(before.task.platform).toBe('Shopify US');
  await page.reload(); await expect(page.getByTestId('recommendation-1')).toContainText('LM-KT-BTL-002-BLK-500'); expect(posts).toBe(1);
  await page.getByTestId('recommendation-1').getByRole('button', { name: text('Select SKU', '选择 SKU'), exact: true }).click();
  await expect(page.getByRole('heading', { name: text('Fact Review', '事实人工核对'), exact: true })).toBeVisible();
  await navigation(page, text('Launch Tasks', '上新任务')); await page.getByRole('button', { name: text('Edit Current Task', '编辑当前任务'), exact: true }).click();
  await page.getByRole('dialog').getByLabel(text('Requirements', '选品要求'), { exact: true }).fill('Black 750ml without a straw.');
  await page.getByRole('button', { name: text('Save Task', '保存任务'), exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.recommendation-card')).toHaveCount(0); expect((await state(page)).selectedSku).toBeNull();
  const task = (await state(page)).task;
  const stale = (await (await page.context().request.get(`/api/tasks/${task.recordId}/recommendations`)).json()).data;
  expect(stale.status).toBe('stale');
  await page.getByRole('button', { name: text('Run Recommendation', '运行推荐'), exact: true }).click();
  await expect(page.getByTestId('recommendation-1')).toContainText('LM-KT-BTL-003-BLK-750');
  await page.getByRole('button', { name: text('Load Bottle Demo', '载入水杯演示'), exact: true }).click();
  await expect(page.getByTestId('recommendation-1')).toContainText('LM-KT-BTL-001-BLK-500'); expect((await state(page)).task.id).toBe('PL-DEMO-001');
  await navigation(page, text('Materials', '商品资料')); await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('price target does not affect selection and is applied only after choosing a SKU', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Current Task', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Minimum unit profit (USD)').fill('10');
  await page.getByRole('button', { name: 'Save Task', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run Recommendation', exact: true }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(3);
  await expect(page.getByTestId('recommendation-1')).toContainText('LM-KT-BTL-001-BLK-500');
  await page.getByTestId('recommendation-1').getByRole('button', { name: 'Select SKU', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await expect(page.locator('.suggested-price>strong')).toHaveText('USD 24.20');
  await page.reload(); expect((await state(page)).task.minProfit).toBe(10);
});

test('long freeform requirements wrap on mobile after saving without running a model', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/');
  await navigation(page, 'Launch Tasks'); await page.getByRole('button', { name: 'New Task', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Requirements', { exact: true }).fill(Array(40).fill('black 500ml without a straw').join(' '));
  await page.getByRole('button', { name: 'Create Task', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.recommendation-card')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
