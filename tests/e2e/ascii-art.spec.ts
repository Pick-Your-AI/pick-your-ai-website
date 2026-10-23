import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('ASCII controls pause rotation and assemble the same seven-tier scene', async ({ page }) => {
  await page.goto('/ascii-study');
  const art = page.locator('.ascii-art');
  await expect(art).toHaveAttribute('aria-hidden', 'true');
  const initial = await art.textContent();
  expect(initial?.replace(/\s/g, '').length).toBeGreaterThan(500);
  await expect.poll(() => art.textContent()).not.toBe(initial);
  await page.getByRole('button', { name: 'Pause animation' }).click();
  await expect(page.getByRole('button', { name: 'Resume animation' })).toBeVisible();
  const paused = await art.textContent();
  const stable = await art.evaluate(
    (element) =>
      new Promise<boolean>((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve(false);
        });
        observer.observe(element, { childList: true, characterData: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(true);
        }, 250);
      }),
  );
  expect(stable).toBe(true);
  await page.getByRole('button', { name: 'Assemble' }).click();
  await expect(page.getByRole('button', { name: 'Explode' })).toBeVisible();
  expect(await art.textContent()).not.toBe(paused);
  await page.getByRole('button', { name: 'Explode' }).click();
  await expect(art).toHaveText(paused!);
});

test('reduced motion keeps artwork still and layouts fit at narrow widths', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ascii-study');
  await expect(page.getByText('Still / reduced motion', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /animation/ })).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    const switchButton = page.getByRole('button', { name: `Switch to ${theme} theme` });
    if (await switchButton.count()) await switchButton.click();
    await expect(page.locator('.ascii-art')).not.toBeEmpty();
    const widths = await page.evaluate(() => ({
      width: innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.width);
    await page.screenshot({ path: info.outputPath(`home-${theme}.png`), fullPage: true });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  for (const route of ['/builder', '/catalog', '/catalog/model']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const widths = await page.evaluate(() => ({
      width: innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.width);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/ascii-study');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: info.outputPath('home-320.png'), fullPage: true });
});

test('study navigation preserves the main design and starts a blank build explicitly', async ({
  page,
}) => {
  await page.goto('/');
  const heading = page.getByRole('heading', { level: 1 });
  const before = await heading.evaluate((element) => {
    const style = getComputedStyle(element);
    return { font: style.fontFamily, size: style.fontSize, color: style.color };
  });
  await page.goto('/ascii-study');
  await expect(page.locator('.tier-index li').last()).toContainText('OPTIONAL / 5 KINDS');
  await expect(page.locator('.tier-index a').nth(1)).toHaveAttribute('href', '/catalog?layer=T1');
  await page.locator('.starter-open').first().click();
  await expect(page).toHaveURL(/\/builder$/);
  await expect(page.getByTestId('overall-status')).not.toContainText(
    '0 of 4 required choices made',
  );
  await page.goto('/ascii-study');
  await page.getByRole('button', { name: 'Start a stack' }).click();
  await expect(page).toHaveURL(/\/builder$/);
  await expect(page.getByTestId('overall-status')).toContainText('0 of 4 required choices made');
  // Client navigation keeps lazy CSS loaded: it must still have no effect outside the study.
  await page.locator('header a.brand').click();
  await expect(page).toHaveURL(/\/$/);
  const after = await page.getByRole('heading', { level: 1 }).evaluate((element) => {
    const style = getComputedStyle(element);
    return { font: style.fontFamily, size: style.fontSize, color: style.color };
  });
  expect(after).toEqual(before);
});
