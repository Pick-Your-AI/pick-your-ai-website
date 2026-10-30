/*
 * /organization/ in both states of the admission contract (docs/ORGANIZATION_DIRECTORY.md):
 *  - no bundle admitted: the SPA shows an honest "not published yet" page with no organization data;
 *  - bundle present in dist/organization (admitted, or staged locally for verification): the
 *    canonical static directory works with its filters, links, exports and keyboard use.
 * The mode is taken from the built output, which is what the preview server actually serves.
 *
 * `vite preview` is not Apache: MIME types for .mmd, the CSP header and cache headers are checked
 * against the real host by scripts/deploy/verify-live.sh, not here.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

const staticBundle = existsSync('dist/organization/index.html');
const ORG_LINK = /^https:\/\/github\.com\/(?:orgs\/)?Pick-Your-AI(?:\/|$)/;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

test('About links to the directory (a full page load) and to the canonical policy', async ({
  page,
}) => {
  await page.goto('/about');
  const faq = page.locator('details', { hasText: 'Who maintains what' });
  await faq.locator('summary').click();
  const directory = faq.getByRole('link', { name: 'organization directory' });
  await expect(directory).toHaveAttribute('href', '/organization/');
  const policy = faq.getByRole('link', { name: 'canonical escalation policy' });
  await expect(policy).toHaveAttribute(
    'href',
    'https://github.com/Pick-Your-AI/.github/blob/main/docs/governance/ESCALATION.md',
  );
});

test.describe('no bundle admitted', () => {
  test.skip(staticBundle, 'a bundle is present in dist/organization');

  test('shows the pending page, no organization data, and passes axe', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/organization/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Organization directory');
    await expect(page.getByText('Not published yet.')).toBeVisible();
    await expect(page.locator('main table')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'canonical escalation policy' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await axe(page);
    expect(errors).toEqual([]);
  });

  test('the slashless path reaches the same page', async ({ page }) => {
    await page.goto('/organization');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Organization directory');
  });
});

test.describe('bundle present', () => {
  test.skip(!staticBundle, 'no bundle in dist/organization');

  test('serves the canonical static page with working filters', async ({ page }) => {
    const errors: string[] = [];
    const external: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('request', (r) => {
      const host = new URL(r.url()).hostname;
      if (host !== 'localhost' && host !== '127.0.0.1') external.push(r.url());
    });
    const response = await page.goto('/organization/');
    expect(response?.headers()['content-type']).toMatch(/^text\/html/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/Current organization/);

    const rows = page.locator('tbody tr');
    const total = await rows.count();
    expect(total).toBeGreaterThan(0);
    const count = page.locator('#count');
    await expect(count).toHaveText(`${total} of ${total} entities shown`);

    await page.getByLabel('Entity type').selectOption('projects');
    const projects = await page.locator('tbody tr[data-kind="projects"]').count();
    await expect(count).toHaveText(`${projects} of ${total} entities shown`);
    await expect(page.locator('tbody tr:not([hidden])')).toHaveCount(projects);

    await page.getByLabel('Entity type').selectOption('');
    await page.getByLabel('Search names or areas').fill('zzzz-no-such-entity');
    await expect(count).toHaveText(`0 of ${total} entities shown`);
    await page.getByLabel('Search names or areas').fill('');

    await page.getByLabel('Mapping').selectOption('unmapped');
    const unmapped = await page.locator('tbody tr:not([hidden])').count();
    expect(unmapped).toBeLessThanOrEqual(total);
    await expect(count).toHaveText(`${unmapped} of ${total} entities shown`);

    // The freshness line is explicit about what it knows and does not claim a deployment time.
    const freshness = page.locator('#freshness');
    await expect(freshness).toContainText(/Last observed: \d{4}-\d{2}-\d{2}T/);
    await expect(freshness).toContainText(/Publication time requires deployment readback/);

    await page.waitForLoadState('networkidle');
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('every link stays in the organization or resolves to a served file', async ({
    page,
    request,
  }) => {
    await page.goto('/organization/');
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    const files = new Set<string>();
    for (const href of hrefs) {
      if (href.startsWith('#')) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) expect(href).toMatch(ORG_LINK);
      else files.add(href.split('#')[0]!);
    }
    expect(files.size).toBeGreaterThan(0);
    const types: Record<string, RegExp> = {
      '.json': /json/,
      '.svg': /svg/,
      '.png': /image\/png/,
    };
    for (const file of files) {
      const res = await request.get(`/organization/${file}`);
      expect(res.status(), file).toBe(200);
      const type = res.headers()['content-type'] ?? '';
      expect(type, `${file} must not be the SPA fallback`).not.toMatch(/text\/html/);
      for (const [ext, pattern] of Object.entries(types))
        if (file.endsWith(ext)) expect(type, file).toMatch(pattern);
    }
    const script = await request.get('/organization/directory.js');
    expect(script.headers()['content-type']).toMatch(/javascript/);
    // The model download is the sanitized public projection: no roster or contact fields.
    const model = await (await request.get('/organization/organization.json')).text();
    expect(model).not.toMatch(/"(?:email|members|invitations|users)"\s*:/);
  });

  test('is usable by keyboard and passes axe', async ({ page }) => {
    await page.goto('/organization/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to directory' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#directory$/);
    await page.getByLabel('Search names or areas').focus();
    await page.keyboard.type('website');
    await expect(page.locator('#count')).toContainText(/entities shown/);
    await axe(page);
  });

  test('reflows without horizontal page scroll at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/organization/');
    await page.waitForLoadState('networkidle');
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
