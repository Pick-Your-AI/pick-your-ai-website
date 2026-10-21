/*
 * Document-structure and self-containment checks for every route.
 *
 * These are the PR's own stated guarantees, made executable:
 *  - exactly one h1 per route (a screen-reader and SEO baseline; the build-compare chooser shipped
 *    with none until this test existed),
 *  - every visible form control has an accessible name, and
 *  - no request leaves the origin, so the production CSP can stay `default-src 'self'` and the
 *    privacy notice's "no third-party requests" promise holds.
 *
 * axe does not check any of these: it does not require a single h1, treats a control with an empty
 * text value as labelled, and says nothing about network origins.
 */
import { expect, test } from '@playwright/test';

const ROUTES = [
  '/',
  '/builder',
  '/builds',
  '/catalog',
  '/catalog/model',
  '/catalog/model/demo~model~aurora-large',
  '/catalog/workload',
  '/compare',
  '/compare?mode=builds',
  '/compare?ids=demo~model~open-8b,demo~model~aurora-large',
  '/templates',
  '/methodology',
  '/about',
  '/legal',
  '/shared',
  '/nope',
];

test('every route has exactly one h1', async ({ page }) => {
  const failures: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const count = await page.locator('h1').count();
    if (count !== 1) failures.push(`${route}: ${count} h1 elements`);
  }
  expect(failures).toEqual([]);
});

test('every visible form control has an accessible name', async ({ page }) => {
  const failures: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('input, select, textarea')]
        // Hidden inputs are triggered by a labelled button, and the file picker is aria-hidden.
        .filter((el) => {
          const type = el.getAttribute('type');
          if (type === 'hidden' || type === 'file') return false;
          if (el.getAttribute('aria-hidden') === 'true') return false;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          const byFor = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
          const byWrap = el.closest('label');
          const aria = el.getAttribute('aria-label');
          const labelledBy = el.getAttribute('aria-labelledby');
          return !(byFor || byWrap || aria || labelledBy);
        })
        .map((el) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 100)),
    );
    if (unnamed.length) failures.push(`${route}: ${unnamed.join(' ; ')}`);
  }
  expect(failures).toEqual([]);
});

test('no request leaves the origin', async ({ page }) => {
  const offOrigin = new Set<string>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) offOrigin.add(url.origin);
  });
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
  }
  expect(
    [...offOrigin],
    'the production CSP is default-src self and the privacy notice promises no third-party requests',
  ).toEqual([]);
});
