import { expect, test } from '@playwright/test';

const routes = [
  { name: 'home', path: '/', heading: /Great AI starts\s*with the right stack/i },
  { name: 'builder', path: '/builder', heading: /Choose your parts/i },
  { name: 'catalog-model', path: '/catalog/model', heading: /Choose an AI model/i },
];

for (const theme of ['light', 'dark'] as const) {
  for (const route of routes) {
    test(`${route.name} in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.clock.setFixedTime(new Date('2026-10-16T12:00:00Z'));
      await page.addInitScript((value) => localStorage.setItem('pyai.theme', value), theme);
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading);
      await expect(page.getByRole('note', { name: 'Demo mode' })).toBeVisible();
      if (route.name === 'home') {
        // Fixture analysis resolves in memory, so networkidle does not mean the preview is ready.
        const preview = page.getByRole('group', { name: 'Example demo AI stack' });
        await expect(preview.locator('.preview-footer strong')).toHaveText('$324.00 per 30 days');
        await expect(preview.locator('.preview-stamp')).toHaveText('0 detected conflicts');
      }
      await page.waitForLoadState('networkidle');
      // Standardize the system-font aliases across Linux runners; keep mono text mono.
      await page.addStyleTag({
        content: ':root { --font-sans: "DejaVu Sans"; --font-mono: "DejaVu Sans Mono"; }',
      });
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${route.name}-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
        mask: [page.getByTestId('build-sha')],
        maxDiffPixels: 0,
      });
    });
  }
}
