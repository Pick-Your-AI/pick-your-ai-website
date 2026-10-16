import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('home renders with build sha and passes axe', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('build-sha')).toContainText('Build');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('version.json matches the build contract', async ({ request }) => {
  const res = await request.get('/version.json');
  expect(res.ok()).toBeTruthy();
  const v = await res.json();
  expect(Object.keys(v).sort()).toEqual([
    'builtAt',
    'commit',
    'contractSourceSha',
    'contractVersion',
    'dataMode',
  ]);
  expect(v.contractVersion).toBe('1.0.0');
  expect(v.contractSourceSha).toMatch(/^[0-9a-f]{40}$/);
  expect(v.dataMode).toBe('fixture');
  expect(new Date(v.builtAt).toString()).not.toBe('Invalid Date');
});
