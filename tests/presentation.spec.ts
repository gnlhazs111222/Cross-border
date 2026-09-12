import { expect, test, type Page } from './fixtures';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const profiles = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 375, height: 812 },
];
const snapshot = (page: Page) => page.evaluate(() => localStorage.getItem('prismlaunch.demo.v1'));

for (const locale of ['en-US', 'zh-CN']) for (const viewport of profiles) {
  test.describe(`presentation ${locale} ${viewport.width}`, () => {
    test.use({ locale, viewport });
    test('main and missing-fact stories remain clear, reachable and bounded', async ({ page }, testInfo) => {
      const zh = locale === 'zh-CN';
      const choose = (en: string, cn: string) => zh ? cn : en;
      const capture = zh && viewport.width === 1920;
      const shots: { file: string; width: number; height: number; locale: string }[] = [];
      const metrics: Record<string, unknown> = {};
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const dismiss = async () => {
        const button = page.getByRole('button', { name: choose('Dismiss notification', '关闭通知'), exact: true });
        if (await button.isVisible()) await button.click();
      };
      const shot = async (file: string, selector?: string) => {
        if (!capture) return;
        await dismiss();
        await page.evaluate(selector => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          window.scrollTo(0, 0);
          if (selector) {
            const element = document.querySelector(selector);
            if (element) window.scrollTo(0, Math.max(0, element.getBoundingClientRect().top + scrollY - 250));
          }
        }, selector);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await mkdir('artifacts/presentation', { recursive: true });
        await page.screenshot({ path: `artifacts/presentation/${file}`, fullPage: false });
        shots.push({ file, ...viewport, locale });
      };
      const button = (en: string, cn: string) => page.getByRole('button', { name: choose(en, cn), exact: true });
      await page.goto('/');
      await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
      await expect(page.locator('.journey')).toHaveCount(1);
      await expect(page.locator('.journey-guidance')).toContainText(choose('Step 1 of 5', '第 1 / 5 步'));
      const beforeCapabilities = await snapshot(page);
      await button('Demo Capabilities', '演示能力说明').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('REAL / LOCAL'); await expect(dialog).toContainText('DEMO / MOCK');
      await expect(dialog).toContainText(choose('not an LLM', '没有调用 LLM'));
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await shot('00-demo-capabilities.png');
      await page.keyboard.press('Escape');
      await expect(button('Demo Capabilities', '演示能力说明')).toBeFocused();
      expect(await snapshot(page)).toEqual(beforeCapabilities);
      await noOverflow();
      await button('Load Demo Dataset', '载入内置数据').click();
      await expect(page.locator('.product-table tbody tr')).toHaveCount(10);
      await button('Import Supplier File', '导入供应商文件').click();
      await page.getByLabel(choose('Supplier file', '供应商文件'), { exact: true }).setInputFiles(resolve('public/demo/prismlaunch-supplier-demo.xlsx'));
      await button('Import 7 products', '导入 7 个商品').click();
      await expect(page.locator('.product-table tbody tr')).toHaveCount(7);
      await shot('01-materials-import.png', '.supplier-import-panel');
      await button('Create Demo Task', '创建演示任务').click();
      await expect(page.getByTestId('recommendation-1')).toContainText('94');
      await page.evaluate(() => window.scrollTo(0, 0));
      const select = page.getByTestId('recommendation-1').getByRole('button', { name: choose('Select SKU', '选择 SKU'), exact: true });
      if (viewport.width > 1000) {
        await expect(select).toBeInViewport();
        metrics.top1Select = await select.boundingBox();
        const selectBounds = await select.boundingBox();
        expect(selectBounds!.y + selectBounds!.height).toBeLessThanOrEqual(viewport.height);
      }
      await shot('02-top3-recommendation.png', '.shortlist-heading');
      await select.click();
      await expect(button('Analyze Evidence', '分析证据').first()).toBeVisible();
      await expect(page.locator('.contextbar')).toContainText('PL-DEMO-001');
      await expect(page.locator('.contextbar')).toContainText('LM-KT-BTL-001-BLK-500');
      await button('Analyze Evidence', '分析证据').first().click();
      await expect(page.locator('.suggested-price>strong')).toHaveText('USD 22.39');
      await expect(page.locator('.facts-panel')).not.toHaveAttribute('open', '');
      await expect(page.locator('.fact-permission-note')).toContainText(choose('Confirmed costs and weights still stay internal.', '已确认的成本、重量仍仅供内部使用。'));
      metrics.factReviewTop = await page.locator('.fact-review').evaluate(element => Math.round(element.getBoundingClientRect().top + scrollY));
      await noOverflow();
      await shot('03-evidence-fact-review.png', '.facts-panel');
      await button('Continue to Listing Studio', '继续前往文案工作室').click();
      await button('Generate Amazon Listing', '生成 Amazon 文案').click();
      await expect(page.locator('.listing-copy')).toContainText('100% leakproof');
      await page.locator('.fact-sources summary').click();
      await expect(page.locator('.source-facts')).toContainText(choose('Imported Supplier File', '导入的供应商文件'));
      await shot('06-listing-fact-sources.png', '.listing-preview');
      await button('Continue to Review', '继续前往审核').click();
      await expect(button('Publish', '发布')).toBeDisabled();
      await button('Run Review', '运行审核').click();
      await expect(page.getByTestId('review-stage-banner')).toContainText(choose('HIGH RISK · Publish blocked', '高风险 · 发布已阻断'));
      await expect(page.locator('.risk-issue')).toContainText('R001');
      await expect(button('Publish', '发布')).toBeDisabled();
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.getByTestId('review-stage-banner')).toBeInViewport();
      if (viewport.width > 1000) await expect(button('Apply Suggested Fix', '应用建议修订')).toBeInViewport();
      metrics.reviewFix = await button('Apply Suggested Fix', '应用建议修订').boundingBox();
      metrics.reviewBanner = await page.getByTestId('review-stage-banner').boundingBox();
      await noOverflow(); await shot('07-high-risk-blocked.png', '.review-stage-banner');
      await button('Apply Suggested Fix', '应用建议修订').click();
      await expect(page.getByTestId('review-stage-banner')).toContainText(choose('Review required · Publish locked', '需要审核 · 发布未开放'));
      await expect(button('Publish', '发布')).toBeDisabled();
      await expect(page.locator('.listing-copy')).not.toContainText('100% leakproof');
      await shot('08-review-required.png', '.review-stage-banner');
      await button('Run Review', '运行审核').click();
      await expect(page.getByTestId('review-stage-banner')).toContainText(choose('Review passed · Ready to publish', '审核通过 · 可以发布'));
      await expect(button('Publish', '发布')).toBeEnabled();
      await shot('09-review-passed.png', '.review-stage-banner');
      await button('Publish', '发布').click();
      await expect(page.getByRole('heading', { name: choose('Amazon Listing Export Ready', 'Amazon 文案已就绪，可导出') })).toBeVisible();
      await shot('10-publish-success.png', '.publish-success');
      const download = page.waitForEvent('download'); await button('Export Amazon CSV', '导出 Amazon CSV').click();
      expect((await download).suggestedFilename()).toContain('LM-KT-BTL-001');
      await page.getByRole('navigation').getByRole('button', { name: choose('Materials', '商品资料'), exact: true }).click();
      await button('View LM-KT-IMP-005-BLK-500', '查看 LM-KT-IMP-005-BLK-500').click();
      await button('Review Facts', '核对事实').click();
      await expect(page.getByRole('heading', { name: choose('Fact card comparison', '事实卡对照'), exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: choose('Pricing Blocked', '定价已阻断'), exact: true })).toBeVisible();
      await expect(page.locator('.fact-review-table tbody tr').first()).toHaveAttribute('data-testid', 'fact-review-packagingWeight');
      await shot('04-missing-fact-pricing-blocked.png', '.pricing-blocked');
      const row = page.getByTestId('fact-review-packagingWeight');
      await row.getByRole('button', { name: choose('Add Value', '补充值'), exact: true }).click();
      await page.getByRole('dialog').locator('input').fill('0.42');
      await button('Save Value', '保存数值').click();
      await expect(row).toContainText(choose('Needs confirmation', '待确认'));
      await expect(page.getByRole('heading', { name: choose('Pricing Blocked', '定价已阻断'), exact: true })).toBeVisible();
      await row.getByRole('button', { name: choose('Confirm', '确认'), exact: true }).click();
      await expect(page.getByTestId('fact-outcome')).toContainText('18.90');
      await expect(page.locator('.suggested-price>strong')).toHaveText('USD 21.96');
      await expect(row).toContainText(choose('Manual confirmation', '人工确认'));
      await row.locator('summary').click();
      await noOverflow(); await shot('05-manual-confirmation-pricing-ready.png', '.pricing-panel');
      if (capture) await writeFile('artifacts/presentation/screenshots.json', JSON.stringify({ source: 'Actual Chromium UI at http://127.0.0.1:4173', screenshots: shots.sort((a, b) => a.file.localeCompare(b.file)), metrics }, null, 2));
      const layoutFile = testInfo.outputPath('layout.json');
      await mkdir(dirname(layoutFile), { recursive: true });
      await writeFile(layoutFile, JSON.stringify({ locale, viewport, metrics }, null, 2));
      expect(errors).toEqual([]);
    });
  });
}
