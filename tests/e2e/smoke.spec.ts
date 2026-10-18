import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * End-to-end coverage of the design-mock shell: every page renders, labels demo data, exposes one
 * h1, passes axe (WCAG 2.2 AA) and never throws. Selectors target roles and visible text so the
 * suite does not depend on the mock's internal class names beyond the few public design hooks.
 */
const PAGES: [string, RegExp][] = [
  ['/', /Great AI starts\s*with the right stack/i],
  ['/builder', /Choose your parts/i],
  ['/catalog', /All components/i],
  ['/catalog?layer=T1', /Choose models/i],
  ['/catalog/model', /Choose an AI model/i],
  ['/catalog/model/demo~model~open-8b', /Demo Open 8B/i],
  ['/compare', /Compare components/i],
  ['/compare?ids=demo~model~open-8b,demo~model~aurora-large', /Compare components/i],
  ['/summary', /.+/],
  ['/builds', /Good builds are\s*worth keeping\./i],
  ['/templates', /A head start,\s*not a black box\./i],
  ['/shared', /Shared build/i],
  ['/methodology', /Trust should be\s*inspectable\./i],
  ['/about', /AI is complicated/i],
  ['/legal', /Privacy and terms/i],
  ['/no/such/page', /not found|404/i],
];

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    ),
  ).toEqual([]);
}

for (const [path, heading] of PAGES) {
  test(`${path} renders, labels demo data and passes axe`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(page.getByRole('note', { name: 'Demo mode' })).toContainText('synthetic');
    await expect(page.getByTestId('build-sha')).toHaveText(/^[0-9a-f]{7}$|unknown/);
    await page.waitForLoadState('networkidle');
    await axe(page);
    expect(errors).toEqual([]);
  });
}

test('light theme passes axe on every route too', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'dark theme covers mobile; light is desktop');
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveClass(/light/);
  for (const [path, heading] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await page.waitForLoadState('networkidle');
    await axe(page);
  }
});

test('a page load makes no third-party request (CSP stays self-only)', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') external.push(r.url());
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(external).toEqual([]);
  // The design's typefaces are self-hosted, so they must actually load.
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
  );
  expect(loaded).toEqual(expect.arrayContaining(['Space Grotesk', 'DM Sans']));
});

test('version.json matches the build contract', async ({ request }) => {
  const res = await request.get('/version.json');
  expect(res.ok()).toBeTruthy();
  const v = await res.json();
  expect(Object.keys(v).sort()).toEqual([
    'builtAt',
    'commit',
    'contractSourceSha',
    'contractVersion',
    'dataMode',
  ]);
  expect(v.contractVersion).toBe('1.0.0');
  expect(v.contractSourceSha).toMatch(/^[0-9a-f]{40}$/);
  expect(v.dataMode).toBe('fixture');
});

test('the shell matches the design mock: banner, nav, stack counter, footer build stamp', async ({
  page,
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'the nav collapses into a menu on mobile');
  await page.goto('/');
  const header = page.locator('header.site-header');
  await expect(header.getByRole('link', { name: /PickYourAI/ })).toBeVisible();
  for (const label of [
    'Discover',
    'Builder',
    'Catalog',
    'Compare',
    'My Builds',
    'Methodology',
    'About',
  ]) {
    await expect(header.getByRole('link', { name: label })).toBeVisible();
  }
  await expect(header.locator('.header-build')).toContainText('Your stack');
  await expect(page.locator('footer .footer-bottom')).toContainText('DEMONSTRATION ONLY');
  // The mock's design system is loaded (semantic classes, not utility classes).
  await expect(page.locator('.hero .hero-copy h1')).toBeVisible();
  await expect(page.locator('.stats-band .stat')).toHaveCount(3);
  await expect(page.locator('.catalog-rows .catalog-row')).toHaveCount(7);
});

test('builder: parts table, running total, findings, export and theme', async ({ page }, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'table interactions are covered on desktop; mobile renders the same data as cards',
  );
  await page.goto('/builder');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Choose your parts/i);

  // One group row per layer, in dependency order.
  const groups = page.locator('.pt tbody tr.pt-group');
  await expect(groups).toHaveCount(7);
  await expect(groups.first()).toContainText('Requirements & Configuration');

  // The status strip carries the worst outcome and the live estimates.
  const status = page.getByTestId('overall-status');
  await expect(status).toContainText(/compatibility error|check|missing|No compatibility errors/i);
  await expect(status).toContainText('Required');
  await expect(status).toContainText('Est. monthly');

  // A running total under the table, with an explicit "not a quote" note.
  const foot = page.locator('.pt-foot');
  await expect(foot).toContainText('Estimated total');
  await expect(foot).toContainText('$');
  await expect(foot).toContainText('Not a quote');

  // Findings are lettered, and the page states what was not evaluated.
  await expect(page.getByRole('heading', { name: 'Compatibility notes' })).toBeVisible();
  await expect(page.getByText(/What was not checked/i)).toBeVisible();

  // Changing a component goes through the picker and returns with the row updated.
  await page
    .locator('.pt tbody tr', { hasText: 'AI Model' })
    .first()
    .getByRole('link', { name: /Change/ })
    .click();
  await expect(page).toHaveURL(/\/catalog\/model\?replace=/);
  await expect(page.getByText(/Replacing a component/i)).toBeVisible();

  // Verdicts arrive asynchronously; wait for the list to settle before clicking a row.
  const list = page.locator('.pt tbody');
  await expect(list.locator('.pchip-pass, .pchip-fail, .pchip-unknown').first()).toBeVisible();
  const candidate = list
    .locator('tr', { has: page.getByRole('button', { name: /^Add$/ }) })
    .first();
  const candidateName = (await candidate.locator('a').first().textContent())!.trim();
  await candidate.getByRole('button', { name: /^Add$/ }).click();
  await expect(page).toHaveURL(/\/builder$/);
  await expect(page.locator('.pt tbody tr', { hasText: 'AI Model' }).first()).toContainText(
    candidateName,
  );

  // Export downloads a contract-shaped file.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /^Export$/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.r\d+\.pickyour-ai\.json$/);

  // Name and selections persist across reloads.
  const name = page.getByLabel('Build name');
  await name.fill('Support stack v2');
  await name.blur();
  await page.reload();
  await expect(page.getByLabel('Build name')).toHaveValue('Support stack v2');

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveClass(/light/);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await axe(page);
});

test('catalog: compatibility buckets, sorting, search and add-to-stack', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'the dense table is a desktop layout');
  await page.goto('/catalog');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/All components/i);

  const rows = page.locator('.pt tbody tr').filter({ has: page.locator('input[type=checkbox]') });
  await expect(rows.first()).toBeVisible();

  // The compatibility filter is on by default, with unknown in its own bucket.
  const filter = page.locator('.pbox', { hasText: 'Compatibility' });
  await expect(filter.getByRole('checkbox', { name: /Compatible/ })).toBeChecked();
  await expect(filter.getByRole('checkbox', { name: /Unknown/ })).toBeChecked();
  await expect(filter.getByRole('checkbox', { name: /Incompatible/ })).not.toBeChecked();
  await expect(page.locator('.plist-head .count')).toContainText(/compatible/);

  // Every row states its verdict as a word.
  await expect(rows.first().locator('.pchip').first()).toHaveText(
    /Compatible|Unknown|Incompatible/,
  );

  // Turning on the incompatible bucket reveals blocked rows and is reflected in the URL.
  await filter.getByRole('checkbox', { name: /Incompatible/ }).click();
  await expect(filter.getByRole('checkbox', { name: /Incompatible/ })).toBeChecked();
  await expect(page).toHaveURL(/show=/);
  await expect(page.locator('.pt tbody tr.is-blocked').first()).toBeVisible();

  // Sorting is a real sort, announced through aria-sort.
  await page.getByRole('button', { name: /Est\. cost/ }).click();
  await expect(page.locator('th[aria-sort="ascending"], th[aria-sort="descending"]')).toHaveCount(
    1,
  );

  // Search narrows the list and shows a removable filter chip.
  await page.getByLabel('Search these components').fill('aurora');
  await expect(page.locator('.pchip-x').filter({ hasText: 'Search: aurora' })).toBeVisible();
  await expect(page.locator('.pt tbody tr').filter({ has: page.locator('a') })).toHaveCount(3);

  // Adding reports through the toast and flips the row to "In stack".
  await page
    .locator('.pt tbody tr', { hasText: 'Demo Aurora Mini' })
    .getByRole('button', { name: /^Add$/ })
    .click();
  await expect(page.getByRole('status').first()).toContainText(/added to your stack/i);
  await expect(page.locator('.pt tbody tr', { hasText: 'Demo Aurora Mini' }).first()).toContainText(
    'In stack',
  );
  await axe(page);
});

test('compare: aligned rows, difference markers and no leaked identifiers', async ({
  page,
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'the comparison table is a desktop layout');
  await page.goto('/compare');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Compare components/i);

  const table = page.locator('table.pcmp');
  await expect(table.locator('tbody tr').first()).toBeVisible();
  await expect(table.locator('thead th.cmpcol')).toHaveCount(3);

  // Rows whose values differ are marked.
  await expect(table.locator('.diffmark').first()).toBeVisible();
  await expect(table.locator('td.is-diff').first()).toBeVisible();

  // Missing values are named, never blank; no raw catalog ids leak into the table.
  await expect(table).toContainText(/No licence recorded|Not recorded|Unknown/);
  await expect(table).not.toContainText(/demo\.(model|hosting|provider)\./);

  // Switching layer changes the comparison set.
  await page.getByRole('button', { name: /T2 Infrastructure/ }).click();
  await expect(page).toHaveURL(/layer=T2/);
  await expect(page.locator('.pbar')).toContainText('Infrastructure');

  // A component can be applied straight from the comparison.
  await page
    .getByRole('button', { name: /Use this part/ })
    .first()
    .click();
  await expect(page.getByRole('status').first()).toContainText(/applied to your stack/i);
  await axe(page);
});

test('share link round-trips into a read-only shared view', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page
    .getByRole('button', { name: /Provider-API support chat/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^Share$/ }).click();
  await expect(page.getByText(/Share link copied/)).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('/shared#b1.');
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Provider-API support chat/);
  await expect(page.getByRole('button', { name: /Import to my builds/ })).toBeVisible();
});

test('mobile: the shell collapses to a hamburger and the builder stacks its columns', async ({
  page,
}, info) => {
  test.skip(!info.project.name.startsWith('mobile'), 'mobile only');
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open navigation' });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.getByRole('link', { name: 'Builder' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Choose your parts/);
  // The parts table becomes stacked cards on mobile: the head is hidden, rows are blocks.
  await expect(page.locator('.pt thead')).toBeHidden();
  await expect(page.locator('.pt tbody tr.pt-group').first()).toBeVisible();
  await expect(page.getByTestId('overall-status')).toBeVisible();
  await axe(page);
});
