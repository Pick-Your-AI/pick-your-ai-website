import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// EXPECTED_SHA is set by the post-deploy workflow for push-triggered deploys. Without it,
// the tests check the site is internally consistent (footer matches version.json).
const expectedSha = process.env.EXPECTED_SHA ?? '';
const siteHost = new URL(process.env.PRODUCTION_URL ?? 'https://pickyour.ai').host;

type Version = { commit: string; builtAt: string; contractVersion: string; dataMode: string };

async function liveVersion(page: Page): Promise<Version> {
  const res = await page.request.get(`/version.json?e2e=${Date.now()}`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toContain('no-cache');
  return (await res.json()) as Version;
}

// Scripts injected by the platform, not by our build: GoDaddy's origin "traffic-assets" tracker
// (an inline <script> plus tccl.min.js) and Cloudflare's Web Analytics beacon. Our CSP blocks
// them, which is intended. They are reported as annotations, not failures.
// See docs/operations/troubleshooting.md.
const injectedByPlatform = (text: string) =>
  text.includes('Content Security Policy') &&
  (/wsimg\.com|cloudflareinsights\.com/.test(text) || text.startsWith('Executing inline script'));

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (injectedByPlatform(msg.text())) {
      test.info().annotations.push({ type: 'blocked-injection', description: msg.text() });
      return;
    }
    problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400 && new URL(res.url()).host === siteHost) {
      problems.push(`${res.status()} ${res.url()}`);
    }
  });
  return problems;
}

test('version.json reports the deployed commit', async ({ page }) => {
  const v = await liveVersion(page);
  expect(v.commit).toMatch(/^[0-9a-f]{40}$/);
  if (expectedSha) expect(v.commit).toBe(expectedSha);
  expect(v.contractVersion).toBe('1.0.0');
  expect(['fixture', 'http']).toContain(v.dataMode);
});

test('home renders over HTTPS with the build SHA in the footer and no errors', async ({ page }) => {
  const problems = collectProblems(page);
  const v = await liveVersion(page);
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  expect(page.url()).toMatch(/^https:\/\//);
  await expect(page).toHaveTitle(/PickYour\.AI/);
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByTestId('build-sha')).toContainText(v.commit.slice(0, 7));
  await expect(page.getByTestId('data-mode')).toHaveText(v.dataMode);
  await page.waitForLoadState('networkidle');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('security headers are present on the document', async ({ page }) => {
  const res = await page.goto('/');
  const h = res!.headers();
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBeTruthy();
  expect(h['permissions-policy']).toBeTruthy();
  expect(h['strict-transport-security']).toContain('max-age=');
});

test('deep links survive a hard refresh (SPA fallback)', async ({ page }) => {
  for (const route of ['/builder', '/catalog', '/compare', '/no/such/route']) {
    const res = await page.goto(route);
    expect(res?.status(), route).toBe(200);
    await expect(page.locator('#root'), route).not.toBeEmpty();
    await page.reload();
    await expect(page.locator('#root'), route).not.toBeEmpty();
  }
});

test('hashed assets are immutable and missing assets are real 404s', async ({ page }) => {
  const assetUrls: string[] = [];
  page.on('response', (r) => {
    if (new URL(r.url()).pathname.startsWith('/assets/')) assetUrls.push(r.url());
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(assetUrls.length).toBeGreaterThan(0);
  for (const url of assetUrls) {
    const r = await page.request.get(url);
    expect(r.status(), url).toBe(200);
    expect(r.headers()['cache-control'], url).toContain('immutable');
  }
  const missing = await page.request.get('/assets/definitely-missing-chunk.js');
  expect(missing.status()).toBe(404);
});

test('www redirects to the apex with a 301', async ({ page }) => {
  const base = new URL(test.info().project.use.baseURL ?? 'https://pickyour.ai');
  const r = await page.request.get(`https://www.${base.host}/builder?x=1`, { maxRedirects: 0 });
  expect(r.status()).toBe(301);
  expect(r.headers()['location']).toBe(`https://${base.host}/builder?x=1`);
});

test('layout does not overflow horizontally', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('no critical or serious accessibility violations on the home page', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
