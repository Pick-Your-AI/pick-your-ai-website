import { expect, test } from '@playwright/test';

for (const moveFocus of [false, true]) {
  test(`builder loading preserves ${moveFocus ? 'user-chosen' : 'navigation'} focus`, async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/assets/BuilderPage-*.js', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto('/');
    await page.locator('a[href="/builder"]').first().waitFor({ state: 'attached' });
    await page.evaluate(() =>
      document.querySelector<HTMLAnchorElement>('a[href="/builder"]')!.click(),
    );
    const heading = page.getByRole('heading', { level: 1, name: 'Choose your parts' });
    await expect(heading).toBeFocused();
    const oldHeading = await heading.elementHandle();
    const skip = page.getByRole('link', { name: 'Skip to content' });
    if (moveFocus) await skip.focus();
    release();
    await page.waitForFunction((element) => !element?.isConnected, oldHeading);
    await expect(page.getByText('Loading the parts register…')).toHaveCount(0);
    await expect(moveFocus ? skip : heading).toBeFocused();
  });
}
