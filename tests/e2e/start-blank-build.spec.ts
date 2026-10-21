/*
 * Starting a build must be an explicit choice, never a silent recommendation.
 *
 * The builder's first visit opens an empty canvas so an unconfigured stack reads as `Incomplete`
 * rather than arriving pre-filled with someone else's picks. The landing page's primary call to
 * action used to bypass that rule: "Build your AI stack" seeded the builder from `STARTERS[0]`, so
 * the first thing a visitor saw was a complete stack with prices and a compatibility verdict that
 * they had not chosen. Choosing a starter stays available, but only as an explicit action.
 */
import { expect, test } from '@playwright/test';

test('the landing call to action starts a blank build, not a preselected stack', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /Build your AI stack/i }).click();
  await expect(page).toHaveURL(/\/builder$/);
  await page.waitForLoadState('networkidle');

  // An empty canvas: the status strip reports incompleteness, not a compatibility verdict.
  const status = page.getByTestId('overall-status');
  await expect(status).toContainText('Incomplete');
  await expect(status).toContainText('0 of 4 required choices made');

  // No component row carries a selection, so nothing was seeded.
  const selected = await page.getByRole('region', { name: 'Scrollable parts table' }).innerText();
  expect(selected).not.toMatch(/Remove .* from your stack/);

  // And the selected-row count in the status strip is zero.
  const summary = await status.innerText();
  const match = summary.match(/Selected\s*(\d+)/i);
  expect(match?.[1], `expected 0 selections, status was: ${summary}`).toBe('0');
});

test('a starter build is still reachable as an explicit choice', async ({ page }) => {
  await page.goto('/templates');
  await page.waitForLoadState('networkidle');
  const firstStarter = page.getByRole('button', { name: /Use this starter|Start with/i }).first();
  await expect(firstStarter).toBeVisible();
});
