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

test('review r4314645207: both home builder calls to action open the visible editor', async ({
  page,
}) => {
  for (const selector of ['.hero-ctas', '.end-cta']) {
    await route(page, 'home');
    await page.locator(selector + ' [data-scroll="builder"]').click();
    await expect(page.locator('#builderScreen')).toBeVisible();
    await expect(page.locator('#homeScreen')).toBeHidden();
    await expect(page).toHaveURL(/#builder$/);
  }
});

test('review r4314645219: modal action labels follow their current operation', async ({ page }) => {
  await route(page, 'builder');
  await page.locator('#saveBtn').click();
  await route(page, 'builds');
  await page.locator('[data-saved-action="delete"]').click();
  await expect(page.locator('#modalPrimary')).toHaveText('Delete saved build');
  await page.keyboard.press('Escape');
  await route(page, 'builder');
  await page.locator('#viewJson').click();
  await expect(page.locator('#modalPrimary')).toHaveText('Copy JSON');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => JSON.parse(text) },
    });
  });
  await page.locator('#modalPrimary').click();
  await expect(page.locator('#toast')).toHaveText('Configuration JSON copied');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('pickyourai-demo-builds-v2')!)),
  ).toHaveLength(1);
  await page.locator('#modalCloseBtn').click();
  await route(page, 'builds');
  await page.locator('[data-saved-action="delete"]').click();
  await page.locator('#modalPrimary').click();
  await expect(page.locator('.saved-card')).toHaveCount(0);
  await expect(page.locator('#buildsScreen h1')).toBeFocused();
});

test('review r4314645227: dialogs contain keyboard focus and return it to their invoker', async ({
  page,
}) => {
  await route(page, 'builder');
  await page.locator('#viewJson').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#closeModal')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#modalPrimary')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#closeModal')).toBeFocused();
  await page.locator('#themeBtn').evaluate((element: HTMLElement) => element.focus());
  await expect(page.locator('#closeModal')).toBeFocused();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Exercise the supported copy fallback');
        },
      },
    });
  });
  await page.locator('#modalPrimary').click();
  await expect(page.locator('#modalPrimary')).toBeFocused();
  await expect(page.locator('#toast')).toHaveText(
    /^(Configuration JSON copied|Copy was blocked by this browser\.)$/,
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('#modalBackdrop')).toBeHidden();
  await expect(page.locator('#viewJson')).toBeFocused();
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');

  await page.locator('.compare-action').nth(0).click();
  await page.locator('.compare-action').nth(1).click();
  await page.locator('#openCompare').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#modalPrimary')).toBeHidden();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#modalCloseBtn')).toBeFocused();
  await page.locator('#modalCloseBtn').click();
  await expect(page.locator('#openCompare')).toBeFocused();
  await page.setViewportSize({ width: 320, height: 760 });
  await page.locator('#menuBtn').click();
  await page.locator('#viewJson').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#closeModal')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewJson')).toBeFocused();
  await expect(page.locator('#menuBtn')).toHaveAttribute('aria-expanded', 'true');
});

test('review r4314645243: saved identity survives reload without creating another build', async ({
  page,
}) => {
  await route(page, 'builder');
  await page.locator('#buildName').fill('Saved identity fixture');
  await page.locator('#inputTokens').fill('0');
  await page.locator('#outputTokens').fill('7');
  await page.locator('#saveBtn').click();
  const original = await page.evaluate(
    () => JSON.parse(localStorage.getItem('pickyourai-demo-builds-v2')!)[0],
  );
  await page.reload();
  await expect(page.locator('#buildName')).toHaveValue(original.name);
  await page.locator('#buildName').fill('Saved identity updated');
  await page.locator('#saveBtn').click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pickyourai-demo-builds-v2')!),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ id: original.id, name: 'Saved identity updated' });
  expect(saved[0].workload).toEqual({ inputTokens: '0', outputTokens: '7' });
  await route(page, 'builds');
  await page.locator('[data-saved-action="load"]').click();
  await page.reload();
  await page.locator('#saveBtn').click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('pickyourai-demo-builds-v2')!)),
  ).toHaveLength(1);
  await page.locator('#viewJson').click();
  expect(JSON.parse(await page.locator('#jsonPreview').innerText())).not.toHaveProperty(
    'selectedBuildId',
  );
});

test('review r4314645247: routes move focus into the newly visible screen', async ({ page }) => {
  await route(page, 'builder');
  await page.locator('#buildName').focus();
  await page.evaluate(() => {
    location.hash = '#catalog';
  });
  await expect(page.locator('#catalogScreen')).toBeVisible();
  await expect(page.locator('#catalogScreen h1')).toBeFocused();
  await page.locator('[data-directory-detail]').first().click();
  await expect(page.locator('#detailScreen h1')).toBeFocused();
  await page.goBack();
  await expect(page.locator('#catalogScreen h1')).toBeFocused();
  await page.evaluate(() => {
    location.hash = '#builder';
  });
  await expect(page.locator('#builderScreen h2').first()).toBeFocused();
});

test('review r4314645256: mobile navigation exposes its expanded state on every close path', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  const menu = page.locator('#menuBtn');
  await expect(menu).toHaveAttribute('aria-controls', 'mainNav');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toHaveAccessibleName('Close navigation');
  await page.locator('#mainNav [data-nav="catalog"]').click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toHaveAccessibleName('Open navigation');
  await expect(page.locator('#mainNav')).not.toHaveClass(/open/);
  await menu.click();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await menu.click();
  await page.evaluate(() => {
    location.hash = '#builder';
  });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('review r4314645260: builder filters announce their selected state alongside visual state', async ({
  page,
}) => {
  await route(page, 'builder');
  for (const value of ['all', 'compatible', 'oss', 'all']) {
    await page.locator('#filterChips [data-filter="' + value + '"]').click();
    await expect(page.locator('#filterChips [aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#filterChips [data-filter="' + value + '"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('#filterChips [aria-pressed="false"]')).toHaveCount(2);
    await expect(page.locator('#filterChips .active')).toHaveAttribute('data-filter', value);
  }
});

test('review r4314645269: detail tags retain text contrast in both themes', async ({ page }) => {
  await page.goto(url + '#detail/model/gpt41');
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#themeBtn').click();
    const contrasts = await page.locator('.detail-tags span').evaluateAll((tags) => {
      const channels = (text: string) => text.match(/[\d.]+/g)!.map(Number);
      const luminance = (rgb: number[]) =>
        rgb.slice(0, 3).reduce((sum, channel, index) => {
          const value = channel / 255;
          return (
            sum +
            [0.2126, 0.7152, 0.0722][index]! *
              (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          );
        }, 0);
      const background = getComputedStyle(document.querySelector('.detail-hero')!);
      const base = channels(background.backgroundColor);
      const tint = channels(background.backgroundImage.match(/rgba?\([^)]+\)/)![0]);
      const gradientEdge = base.map((value, i) => value * (1 - tint[3]!) + tint[i]! * tint[3]!);
      return tags.map((tag) => {
        const foreground = luminance(channels(getComputedStyle(tag).color));
        return Math.min(
          ...[base, gradientEdge].map((rgb) => {
            const back = luminance(rgb);
            return (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05);
          }),
        );
      });
    });
    expect(contrasts.length).toBeGreaterThan(0);
    for (const ratio of contrasts) expect(ratio, theme).toBeGreaterThanOrEqual(4.5);
  }
});

test('review r4314645281: same-document shared links replace state without saved-copy authority', async ({
  page,
}) => {
  await route(page, 'builder');
  await page.locator('#buildName').fill('Original local build');
  await page.locator('#saveBtn').click();
  const local = await page.evaluate(
    () => JSON.parse(localStorage.getItem('pickyourai-demo-builds-v2')!)[0],
  );
  const incoming = {
    name: 'Shared fixture Ω',
    picks: { model: 'sonnet' },
    workload: { inputTokens: '0', outputTokens: '23' },
    selectedBuildId: local.id,
  };
  const hash =
    '#build=' + encodeURIComponent(Buffer.from(JSON.stringify(incoming)).toString('base64'));
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await expect(page.locator('#buildName')).toHaveValue(incoming.name);
  await expect(page.locator('#inputTokens')).toHaveValue('0');
  await expect(page.locator('#outputTokens')).toHaveValue('23');
  await expect(page.locator('#progressFraction')).toHaveText('1/9');
  await expect(page.locator('[data-select="sonnet"]')).toContainText('Selected');
  await page.locator('#saveBtn').click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pickyourai-demo-builds-v2')!),
  );
  expect(saved).toHaveLength(2);
  expect(saved.find((build: { id: string }) => build.id === local.id)).toEqual(local);
  expect(saved.find((build: { id: string }) => build.id !== local.id).name).toBe(incoming.name);
  await page.reload();
  await expect(page.locator('#buildName')).toHaveValue(incoming.name);
  await page.locator('#saveBtn').click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('pickyourai-demo-builds-v2')!)),
  ).toHaveLength(2);
  await page.evaluate(() => {
    location.hash = '#build=not-valid-base64';
  });
  await expect(page.locator('#toast')).toHaveText(
    'Invalid shared configuration. Current build kept.',
  );
  await expect(page.locator('#buildName')).toHaveValue(incoming.name);
  await page.reload();
  await expect(page.locator('#buildName')).toHaveValue(incoming.name);
  await page.locator('#saveBtn').click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('pickyourai-demo-builds-v2')!)),
  ).toHaveLength(2);
});
