/*
 * No horizontal page scroll at any supported width.
 *
 * This caught three real mobile defects that the visual baselines could not: the catalog rail and
 * the About value grid overflowed because grid/flex children default to `min-width: auto`, and the
 * compare tier tabs are a horizontal scroller that also widened its own grid parent. Each pushed the
 * whole document wider than the viewport, so a phone user had to pan sideways to read a page.
 *
 * 320 px is the narrowest width still in common use (WCAG 1.4.10 asks for reflow at 320 CSS px).
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

const WIDTHS = [320, 390, 768, 1024, 1440];

for (const width of WIDTHS) {
  test(`no horizontal page scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const failures: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      if (scrollWidth > clientWidth + 1) {
        failures.push(
          `${route}: document is ${scrollWidth - clientWidth}px wider than the viewport`,
        );
      }
    }
    expect(
      failures,
      'allow the offending track/child to shrink (min-width: 0 / minmax(0, 1fr))',
    ).toEqual([]);
  });
}
