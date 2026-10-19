import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const html = readFileSync(new URL('../../docs/design/pickyourai-complete.html', import.meta.url));
let server: Server;
let url: string;
const errors = new WeakMap<Page, string[]>();

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Concept server has no TCP address');
  url = 'http://127.0.0.1:' + address.port + '/concept.html';
});
test.afterAll(
  async () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

test.beforeEach(async ({ page }) => {
  const caught: string[] = [];
  errors.set(page, caught);
  page.on('pageerror', (error) => caught.push(error.message));
  // No vendor or external-font request is part of this local concept test.
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.goto(url);
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

async function route(page: Page, name: string) {
  await page.goto(url + '#' + name);
  await expect(page.locator('#' + name + 'Screen')).toBeVisible();
}
async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  const inner = await page
    .locator(
      '.builder-grid, .component-area, .component-card, .card-actions, .summary-sidebar, #unpricedItems, #issueList, #compatPanel',
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length)
        .map((element) => ({
          label: element.id || element.className,
          right: element.getBoundingClientRect().right,
          left: element.getBoundingClientRect().left,
          overflow: element.scrollWidth - element.clientWidth,
          viewport: window.innerWidth,
        })),
    );
  for (const box of inner) {
    expect(box.right, box.label).toBeLessThanOrEqual(box.viewport + 1);
    expect(box.left, box.label).toBeGreaterThanOrEqual(-1);
    expect(box.overflow, box.label).toBeLessThanOrEqual(1);
  }
}

test('home, builder and all nine layers show bounded results and excluded costs', async ({
  page,
}, testInfo) => {
  await expect(page.locator('#homePreviewParts .preview-row')).toHaveCount(9);
  await expect(page.locator('[data-layer-count]').first()).toHaveText('9');
  for (const count of await page.locator('[data-template-count]').all())
    await expect(count).toHaveText('9 parts');
  await expect(page.locator('#homeCheckStatus')).toHaveText('No failing checks');
  await expect(page.locator('#homeSubtotal')).toHaveText('$80.00/mo*');
  await expect(page.locator('#homeUnpriced')).toContainText('GPT-4.1');
  await expect(page.locator('#homePreviewParts [data-price-state="unpriced"]')).toHaveCount(6);
  await noPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('concept-home.png'), fullPage: true });
  await route(page, 'builder');
  await expect(page.locator('#stepList [data-cat]')).toHaveCount(9);
  await expect(page.locator('#summaryFraction')).toHaveText('9 OF 9 LAYERS');
  await expect(page.locator('#issueList [data-outcome="pass"]')).toHaveCount(6);
  await expect(page.locator('#issueList [data-outcome="unknown"]')).toHaveCount(2);
  await expect(page.locator('#issueList [data-outcome="skipped"]')).toHaveCount(2);
  await expect(page.locator('#coverageGaps')).toContainText('32 selected layer pairs');
  await expect(page.locator('#totalPrice')).toHaveText('$80.00/mo*');
  await page.locator('#resetBtn').click();
  await expect(page.locator('#progressFraction')).toHaveText('0/9');
  await expect(page.locator('#compatTitle')).toContainText('Incomplete');
  await expect(page.locator('#issueList [data-outcome="skipped"]')).toHaveCount(10);
  await expect(page.locator('#issueList')).toContainText('SKIPPED · Incomplete · severity error');
  await expect(page.locator('#totalPrice')).toHaveText('Subtotal unavailable');
  await noPageOverflow(page);
});

test('workload, saved state, JSON and comparison retain unpriced versus explicit zero', async ({
  page,
}) => {
  await route(page, 'builder');
  await page.locator('#inputTokens').fill('1000000');
  await expect(page.locator('#totalPrice')).toHaveText('$80.00/mo*');
  await expect(page.locator('#componentResults [data-price-state="unpriced"]').first()).toHaveText(
    'Unpriced',
  );
  await page.locator('#outputTokens').fill('1000000');
  await expect(page.locator('#totalPrice')).toHaveText('$95.00/mo*');
  await page.locator('#buildName').fill('Usage fixture');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#toast')).toHaveText('Build saved to your browser workspace.');
  await page.locator('#viewJson').click();
  const exported = JSON.parse(await page.locator('#jsonPreview').innerText());
  expect(exported.workload).toEqual({ inputTokens: '1000000', outputTokens: '1000000' });
  expect(exported.pricing.pricedSubtotalUSD).toBe('95.00');
  expect(exported.pricing.unpricedItems).toHaveLength(5);
  expect(exported).not.toHaveProperty('illustrativeMonthlyTotalUSD');
  await page.locator('#closeModal').click();
  await page.locator('#inputTokens').fill('0');
  await page.locator('#outputTokens').fill('0');
  await expect(page.locator('#componentResults [data-price-state="priced"]').first()).toContainText(
    '$0.00',
  );
  await page.locator('#inputTokens').fill('');
  await expect(page.locator('#componentResults [data-price-state="unpriced"]').first()).toHaveText(
    'Unpriced',
  );
  await route(page, 'builds');
  await expect(page.locator('.saved-card')).toHaveCount(1);
  await expect(page.locator('.saved-card')).toContainText('$95.00/mo*');
  await expect(page.locator('.saved-card')).toContainText('Unpriced — excluded from subtotal');
  await page.locator('[data-saved-action="load"]').click();
  await expect(page.locator('#inputTokens')).toHaveValue('1000000');
  await expect(page.locator('#outputTokens')).toHaveValue('1000000');
  await expect(page.locator('#totalPrice')).toHaveText('$95.00/mo*');
  await route(page, 'compare');
  await expect(page.locator('#compareDetails')).toContainText('Provider API · shared capacity');
  await expect(page.locator('#compareDetails [data-price-state="unpriced"]')).toHaveCount(1);
  await expect(page.locator('#compareDetails')).toContainText('unknown');
  await noPageOverflow(page);
});

test('a warning failure remains fail and an uncovered combination remains a coverage gap', async ({
  page,
}) => {
  await route(page, 'builder');
  await page.locator('[data-cat="observability"]').click();
  await page.locator('[data-select="none-observe"]').click();
  await expect(
    page.locator('#issueList [data-outcome="fail"][data-severity="warning"]'),
  ).toHaveCount(1);
  await expect(page.locator('#compatTitle')).toContainText('1 failing check');
  await expect(page.locator('#issueList [data-outcome="unknown"]')).toHaveCount(2);
  await page.locator('[data-cat="model"]').click();
  await page.locator('[data-select="gpt41"]').click();
  await expect(page.locator('#issueList [data-outcome="skipped"]')).toHaveCount(5);
  await expect(page.locator('#issueList')).toContainText('Incomplete');
  await expect(page.locator('#coverageGaps')).toContainText(
    'Uncovered combinations are outside these findings',
  );
  await noPageOverflow(page);
});

test('narrow navigation retains templates, T6 meanings, details and readable totals', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await route(page, 'templates');
  await expect(page.locator('.template-node')).toHaveCount(36);
  await expect(page.locator('#fullTemplates')).toContainText('9 of 9 layers');
  await expect(page.locator('#fullTemplates')).toContainText('Unpriced — excluded from subtotal');
  await noPageOverflow(page);
  await route(page, 'catalog');
  await expect(page.locator('#catalogCategories [data-directory-category]')).toHaveCount(10);
  await page.locator('[data-directory-category="guardrail"]').click();
  await expect(page.locator('#catalogResultCount')).toHaveText('4 components');
  await page.locator('[data-directory-detail="guardrail/policy-demo"]').click();
  await expect(page.locator('#detailScreen')).toBeVisible();
  await expect(page.locator('#detailContents')).toContainText('Unpriced');
  await expect(page.locator('#detailContents')).toContainText('unknown');
  await noPageOverflow(page);
  await route(page, 'methodology');
  await expect(page.locator('.outcome-card')).toHaveCount(4);
  await expect(page.locator('#methodologyScreen')).toContainText('managed');
  await expect(page.locator('#methodologyScreen')).toContainText('dedicated or reserved');
  await expect(page.locator('#ruleTitles button')).toHaveCount(10);
  await page.locator('[data-rule="9"]').click();
  await expect(
    page.locator('#ruleDetail [data-outcome="unknown"][data-severity="info"]'),
  ).toHaveCount(1);
  await noPageOverflow(page);
  await route(page, 'builder');
  await page.screenshot({ path: testInfo.outputPath('concept-builder-320.png'), fullPage: true });
  await noPageOverflow(page);
});
