import { expect, test, type Page } from './fixtures';
import { mkdir } from 'node:fs/promises';

const KEY = 'prismlaunch.demo.v1';
const LANGUAGE = 'prismlaunch.language';
const HERO = 'LM-KT-BTL-001-BLK-500';
const snapshot = (page: Page) => page.evaluate(key => localStorage.getItem(key), KEY);

test.describe('Chinese and English interface', () => {
  test.use({ locale: 'zh-CN' });

  for (const width of [1440, 375]) {
    test(`Chinese full flow and language round trip preserve draft and review at ${width}px`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
      await expect(page.getByRole('heading', { name: '可信上新，从可靠资料开始。' })).toBeVisible();
      await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
      await expect(page.getByRole('button', { name: '中文', exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await mkdir('artifacts', { recursive: true });
      await page.screenshot({ path: `artifacts/materials-zh-${width}.png`, fullPage: true });

      // Both names remain searchable when the UI language changes.
      await page.getByRole('textbox', { name: '搜索商品资料' }).fill('黑色吸管');
      await expect(page.locator('.product-table tbody tr')).toHaveCount(1);
      await page.getByRole('button', { name: 'EN', exact: true }).click();
      await expect(page.locator('.product-table tbody tr')).toHaveCount(1);
      await expect(page.locator('.product-table')).toContainText('Black Straw Travel Bottle');
      await page.getByRole('button', { name: '中文', exact: true }).click();
      await page.getByRole('textbox', { name: '搜索商品资料' }).fill('');
      await page.getByRole('button', { name: '查看 LM-KT-BTL-005-BLK-500', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('估算物流费用需要包装重量。');
      await expect(page.getByRole('heading', { name: '定价已阻断' })).toBeVisible();
      await expect(page.getByRole('dialog').locator('.suggested-price')).toHaveCount(0);
      await page.getByRole('button', { name: '关闭详情' }).click();

      await page.getByRole('button', { name: '创建演示任务', exact: true }).click();
      await expect(page.getByTestId('recommendation-1')).toContainText(HERO);
      await expect(page.getByTestId('recommendation-1')).toContainText('黑色符合指定颜色');
      await expect(page.getByTestId('recommendation-2')).toContainText('不符合无吸管偏好');
      await expect(page.getByTestId('recommendation-3')).toContainText('容量过大');
      await page.getByTestId('recommendation-1').getByRole('button', { name: '选择 SKU' }).click();
      await expect(page.getByRole('heading', { name: '事实卡 V1', exact: true })).toBeVisible();
      await page.getByRole('button', { name: /供应商表格.*查看提取结果/ }).click();
      await expect(page.getByRole('dialog')).toContainText('颜色：黑色');
      await expect(page.getByRole('dialog')).toContainText('商品及包装工作表');
      await page.getByRole('button', { name: '关闭弹窗' }).click();

      // Switching while the request is pending does not cancel or duplicate it.
      await page.getByRole('button', { name: '分析证据', exact: true }).first().click();
      await page.getByRole('button', { name: 'EN', exact: true }).click();
      await expect(page.locator('.suggested-price>strong')).toHaveText('USD 19.99');
      await page.getByRole('button', { name: '中文', exact: true }).click();
      await expect(page.locator('.v2')).toContainText('杯体、杯盖、说明卡');
      await expect(page.locator('.v2')).toContainText('禁止写入文案');
      await page.getByRole('button', { name: '继续前往文案工作室' }).click();
      await page.getByRole('button', { name: '生成 Amazon 文案' }).click();
      await expect(page.locator('.listing-copy')).toContainText('100% leakproof');
      await expect(page.locator('.listing-language-note')).toContainText('美国市场英文商品文案');
      await page.getByRole('button', { name: '继续前往审核' }).click();
      await page.getByRole('button', { name: '运行审核' }).click();
      await expect(page.locator('.risk-issue')).toContainText('无证据支持的性能宣称');
      await expect(page.locator('.risk-issue')).toContainText('没有经过确认的证据支持');
      await expect(page.getByRole('button', { name: '发布', exact: true })).toBeDisabled();
      const blocked = await snapshot(page);
      await page.getByRole('button', { name: 'EN', exact: true }).click();
      await expect(page.locator('.risk-issue')).toContainText('Unsupported performance claim');
      expect(await snapshot(page)).toEqual(blocked);
      await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '中文', exact: true }).click();
      await page.screenshot({ path: `artifacts/review-zh-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: '应用建议修订' }).click();
      await expect(page.getByRole('button', { name: '发布', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '运行审核' }).click();
      await expect(page.getByRole('heading', { name: '审核通过', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '发布', exact: true })).toBeEnabled();
      const passed = await snapshot(page);
      await page.getByRole('button', { name: 'EN', exact: true }).click();
      expect(await snapshot(page)).toEqual(passed);
      await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: '中文', exact: true }).click();
      await page.getByRole('button', { name: '发布', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Amazon 文案已就绪，可导出' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Amazon 文案已就绪，可导出' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const downloadReady = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出 Amazon CSV' }).click();
      const download = await downloadReady;
      const stream = await download.createReadStream();
      const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
      const csv = Buffer.concat(chunks).toString('utf8');
      expect(csv).toContain('Black Stainless Steel Travel Bottle');
      expect(csv).not.toContain('100% leakproof');
      expect(csv).not.toMatch(/[\u4e00-\u9fff]/);

      await page.getByRole('tab', { name: 'Shopify 美国站' }).click();
      await expect(page.getByRole('heading', { name: '先生成商品文案，再进行审核' })).toBeVisible();
      await page.getByRole('button', { name: '前往文案工作室' }).click();
      await page.getByRole('button', { name: '生成 Shopify 文案' }).click();
      await page.getByRole('button', { name: '继续前往审核' }).click();
      await page.getByRole('button', { name: '运行审核' }).click();
      await expect(page.getByRole('heading', { name: '审核通过', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '发布', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Shopify 草稿已创建' })).toBeVisible();
      await expect(page.locator('.publish-success')).toContainText('SHOP-DEMO-1042');
      await expect(page.locator('.publish-success')).toContainText('状态： 草稿');
      await page.getByRole('button', { name: '重置演示', exact: true }).click();
      await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
      expect(await page.evaluate(key => localStorage.getItem(key), LANGUAGE)).toBe('zh');
      expect(errors).toEqual([]);
    });
  }

  test('saved language preference overrides browser language and survives reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Good launches start with good data.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Reset Demo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Good launches start with good data.' })).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), LANGUAGE)).toBe('en');
  });
});
