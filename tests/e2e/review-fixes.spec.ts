/*
 * Regression coverage for review 5591558191, driven in a real browser.
 *
 * Each test pins one finding from that review: a re-applied selection, a missing add-another path,
 * a disabled selection that vanished from the table, a share link encoded from an invalid draft,
 * comparison cells that dropped the pricing qualifiers or the cross-layer selections, a cleared
 * comparison that refilled itself, and a starter estimate that presented a lower bound as a total.
 */
import { expect, test } from '@playwright/test';

const desktopOnly = (name: string) => name.startsWith('mobile');

test('catalog: add another permits the same product and keeps both selections', async ({
  page,
}, info) => {
  test.skip(desktopOnly(info.project.name), 'the dense table is a desktop layout');
  await page.goto('/catalog/tool?show=all');
  await page
    .getByRole('row', { name: /Demo Web Search Tool/ })
    .getByRole('button', { name: 'Add' })
    .click();
  await page.goto('/catalog/tool?show=all&add=1');
  const row = page.getByRole('row', { name: /Demo Web Search Tool/ });
  await expect(row.getByRole('button', { name: /Add|In stack/ })).toBeEnabled();
  await row.getByRole('button', { name: /Add|In stack/ }).click();
  await page.goto('/builder');
  await expect(page.locator('.pt tbody tr[data-kind="tool"]')).toHaveCount(2);
  await expect(page.locator('.pt tbody tr[data-kind="tool"]')).toContainText([
    'Demo Web Search Tool',
    'Demo Web Search Tool',
  ]);
});

test('catalog: an already-selected component cannot be re-applied', async ({ page }, info) => {
  test.skip(desktopOnly(info.project.name), 'the dense table is a desktop layout');
  await page.goto('/catalog/tool?show=all');

  const row = page.getByRole('row', { name: /Demo Web Search Tool/ });
  await row.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('status').first()).toContainText(/added to your stack/i);

  // Re-adding used to run replaceSelection over the selection, resetting its configured settings.
  const inStack = row.getByRole('button', { name: /In stack/ });
  await expect(inStack).toBeDisabled();
  await expect(inStack).toHaveAttribute('title', /already selected/);
});

test('builder: a many-kind selection offers an add-another path that appends', async ({
  page,
}, info) => {
  test.skip(desktopOnly(info.project.name), 'the dense table is a desktop layout');
  await page.goto('/catalog/tool?show=all');
  await page
    .getByRole('row', { name: /Demo Web Search Tool/ })
    .getByRole('button', { name: 'Add' })
    .click();

  await page.goto('/builder');
  await expect(page.locator('.pt tbody tr[data-kind="tool"]')).toHaveCount(1);
  await page.getByRole('link', { name: /Add another tool/i }).click();

  await expect(page).toHaveURL(/\/catalog\/tool\?add=1/);
  await expect(page.getByText(/Adding an additional component/i)).toBeVisible();
  await page
    .getByRole('row', { name: /Demo Ticket Writer/ })
    .getByRole('button', { name: 'Add' })
    .click();

  // The first tool is preserved; the second is added beside it.
  await page.goto('/builder');
  const tools = page.locator('.pt tbody tr[data-kind="tool"]');
  await expect(tools).toHaveCount(2);
  await expect(tools.first()).toContainText('Demo Web Search Tool');
  await expect(tools.last()).toContainText('Demo Ticket Writer');
});

test('builder: a disabled selection stays visible with enable and remove controls', async ({
  page,
}, info) => {
  test.skip(desktopOnly(info.project.name), 'the dense table is a desktop layout');
  await page.goto('/catalog/workload?show=all');
  await page
    .getByRole('row', { name: /Demo Customer Support Chat/ })
    .getByRole('button', { name: 'Add' })
    .click();
  await page.goto('/catalog/model?show=all');
  await page.getByRole('button', { name: 'Add' }).first().click();
  await page.goto('/builder');

  const row = page.locator('.pt tbody tr[data-kind="model"]').first();
  await row.getByRole('button', { name: /^Disable / }).click();
  await expect(row).toHaveClass(/is-disabled/);
  await expect(row).toContainText('Disabled — excluded from checks');
  await expect(row.getByRole('button', { name: /^Remove .* from the stack/ })).toBeEnabled();

  await row.getByRole('button', { name: /^Enable / }).click();
  await expect(row).not.toHaveClass(/is-disabled/);
});

test('builder: a blank build explains why it cannot be shared', async ({ page }) => {
  await page.goto('/builder');
  await page.getByRole('button', { name: /Copy share link/ }).click();

  // Encoding used to throw outside the try block, leaving no explanation.
  await expect(page.locator('.toast')).toContainText(/Add at least 2 components before exporting/);
});

test('compare: keeps the lower-bound marker and cross-layer selections', async ({ page }, info) => {
  test.skip(desktopOnly(info.project.name), 'the comparison table is a desktop layout');
  // Prices are estimated against the current build's objectives, so start from a real workload.
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Provider-API support chat' })
    .getByRole('button', { name: /Use this build/ })
    .click();
  await page.goto('/compare?ids=demo~model~aurora-mini,demo~accelerator~c24');

  const table = page.locator('table.pcmp');
  // Both ids were accepted by the catalog's compare tray, so both columns must render.
  await expect(table.getByRole('link', { name: 'Demo Aurora Mini' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Demo C24 GPU' })).toBeVisible();

  // Aurora Mini's output-token rate is expired, so its price is a lower bound, not $14.40 flat.
  const costRow = table.locator('tbody tr', { hasText: 'Est. cost' });
  await expect(costRow).toContainText('≥ $14.40');
  await expect(costRow).toContainText('partial');

  // Clearing the populated slots keeps them empty instead of reseeding the defaults.
  await page.getByLabel('Compare slot 1').selectOption('');
  await page.getByLabel('Compare slot 2').selectOption('');
  await expect(page).toHaveURL(/[?&]ids=(&|$)/);
  await expect(page.getByText('Empty slot')).toHaveCount(3);
});

test('my builds: a saved build with an unpriced component shows a lower bound', async ({
  page,
}) => {
  await page.goto('/templates');
  await page
    .locator('.template-showcase', { hasText: 'Document Q&A' })
    .getByRole('button', { name: /Use this build/ })
    .click();

  await page.goto('/builds');
  const card = page.locator('.saved-card', { hasText: 'Document Q&A' });
  // The saved card used to store only the amount, so a partial total read as complete.
  await expect(card).toContainText('≥ $188.25');
  await expect(card).toContainText('lower bound');
});

test('templates: an incomplete starter estimate reads as a lower bound', async ({ page }) => {
  await page.goto('/templates');
  const card = page.locator('.template-showcase', { hasText: 'Document Q&A' });
  await expect(card).toContainText('≥ $188.25');
  await expect(card).toContainText('lower bound');
});
