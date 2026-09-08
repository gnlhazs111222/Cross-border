import { test, expect } from './fixtures';

// UI-only mocked review responses; these tests never exercise a real model.
for (const scenario of [
  { status: 'blocked', called: true, heading: 'Review blocked' },
  { status: 'passed', called: true, heading: 'Semantic review passed' },
  { status: 'needs_human_review', called: true, heading: 'Human review required' },
  { status: 'failed', called: true, heading: 'Review failed — retry required' },
  { status: 'running', called: false, heading: 'Review in progress' },
  { status: 'blocked', called: false, heading: 'Review blocked' },
  { status: 'passed', called: true, heading: 'Historical review passed — approval expired', expired: true },
] as const) test(`mock UI: ${scenario.status}, modelCalled=${scenario.called}${'expired' in scenario ? ', expired' : ''}`, async ({ page }) => {
  let reviewRequests = 0;
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch(); const body = await response.json();
    body.data.review = { activeProvider: 'qwen', liveAvailable: true, liveImplemented: true, liveModel: 'fixture-model' };
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/listings/*/review', async route => {
    reviewRequests++;
    const response = await route.fetch(); const body = await response.json();
    body.data.reviews.amazon = {
      ...body.data.reviews.amazon, status: scenario.status, reviewMode: 'rules_qwen',
      issues: scenario.status === 'blocked' || scenario.status === 'needs_human_review' ? [{ id: 'S001', severity: 'HIGH', title: 'Unsupported claim', text: '100% leakproof', reason: 'No confirmed fact supports this claim.', category: 'unsupported_claim', location: { field: 'bullets', index: 0 }, factKeys: ['lidType'], suggestedFix: 'Remove the unsupported performance claim.', origin: scenario.called ? 'qwen' : 'rules' }] : [],
      metadata: { mode: 'rules_qwen', model: 'fixture-model', promptVersion: 'fixture-prompt-v1', ruleVersion: 'fixture-rule-v1', inputHash: 'fixture-hash', listingRevision: 1, factsRevision: 1, taskRevision: 1, modelCalled: scenario.called, ...(scenario.status === 'failed' ? { errorCode: reviewRequests === 1 ? 'bailian_timeout' : 'unsafe secret / detail' } : {}) },
    };
    body.data.publishAllowed.amazon = scenario.status === 'passed' && !('expired' in scenario);
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create Demo Task', exact: true }).click();
  await page.getByTestId('recommendation-1').getByRole('button', { name: 'Select SKU', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze Evidence', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue to Listing Studio' }).click();
  await page.getByRole('button', { name: 'Generate Amazon Listing' }).click();
  await page.getByRole('button', { name: 'Continue to Review' }).click();
  await expect(page.getByTestId('review-configured-mode')).toContainText('Configured review: rules + Qwen');
  expect(reviewRequests).toBe(0);
  await page.getByRole('button', { name: 'Run Review', exact: true }).click();
  const details = page.getByTestId('semantic-review-details');
  await expect(details.getByRole('heading', { name: scenario.heading, exact: true })).toBeVisible();
  await expect(page.getByTestId('review-stage-banner')).toContainText('expired' in scenario ? 'Review required: approval expired' : scenario.heading);
  if (scenario.status !== 'passed' || 'expired' in scenario) await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  if (!scenario.called) await expect(details).toContainText('model not called');
  if (scenario.status === 'failed') {
    await expect(details).toContainText('bailian_timeout');
    await page.getByRole('button', { name: 'Run Review', exact: true }).click();
    await expect.poll(() => reviewRequests).toBe(2);
    await expect(details).toContainText('review_failed');
    await expect(details).not.toContainText('unsafe secret');
  }
  if (scenario.status === 'blocked') {
    await expect(details.locator('blockquote')).toHaveText('100% leakproof');
    await expect(details).toContainText('lidType');
    await expect(details).toContainText('Location: bullets [1]');
    await expect(page.getByRole('button', { name: 'Apply Suggested Fix', exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: '中文', exact: true }).click();
    await expect(details).toContainText('审核阻断');
    await expect(details.locator('blockquote')).toHaveText('100% leakproof');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (scenario.called) await page.screenshot({ path: 'artifacts/b-review/semantic-review-zh-mobile.png', fullPage: true });
  }
});
