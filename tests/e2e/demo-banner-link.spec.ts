import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// The post-deploy tablet audit caught a leftover utility class with no CSS definition.
// Pin the visible cue directly: axe's text-block classification can vary with wrapping.
for (const width of [375, 768, 1440]) {
  for (const theme of ['dark', 'light']) {
    test(`demo disclosure link stays distinguishable at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1024 });
      await page.addInitScript((value) => localStorage.setItem('pyai.theme', value), theme);
      await page.goto('/');
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
      const banner = page.getByRole('note', { name: 'Demo mode' });
      const link = banner.getByRole('link', { name: 'Why?', exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/methodology#data');
      await page.mouse.move(0, 1023);
      await expect(link).not.toBeFocused();
      await expect(link).toHaveCSS('text-decoration-line', 'underline');
      await link.focus();
      await expect(link).toHaveCSS('text-decoration-line', 'underline');
      await link.blur();
      await expect(link).toHaveCSS('text-decoration-line', 'underline');
      const results = await new AxeBuilder({ page })
        .include('.demo-banner')
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
}
