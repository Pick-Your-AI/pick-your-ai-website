import { expect, test } from '@playwright/test';

for (const theme of ['dark', 'light']) {
  test(`summary prints readable headings from the ${theme} theme`, async ({ page }, info) => {
    test.skip(info.project.name.startsWith('mobile'), 'PDF printing requires desktop Chromium');
    await page.addInitScript((value) => localStorage.setItem('pyai.theme', value), theme);
    await page.goto('/summary');
    await expect(page.locator('.panel').first()).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    for (const selector of ['.page-masthead', '.panel']) {
      const surfaces = page.locator(selector);
      for (const surface of await surfaces.all()) {
        await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(surface).toHaveCSS('background-image', 'none');
      }
    }
    for (const heading of await page.locator('h1, .panel h2, .panel h3').all()) {
      await expect(heading).toHaveCSS('color', 'rgb(0, 0, 0)');
    }
    await page.pdf({ path: info.outputPath(`summary-${theme}.pdf`), printBackground: true });
  });
}
