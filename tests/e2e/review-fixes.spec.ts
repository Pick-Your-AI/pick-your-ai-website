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

test('builder: objectives mount on first expansion and preserve unsaved edits', async ({
  page,
}) => {
  await page.goto('/builder');
  const field = page.getByRole('textbox', { name: 'Requests per day' });
  await expect(field).toHaveCount(0);
  const summary = page.locator('summary').filter({ hasText: 'Objectives and policy' });
  await summary.click();
  await expect(field).toBeVisible();
  await field.fill('1234');
  await summary.click();
  await expect(field).toBeHidden();
  await summary.click();
  await expect(field).toHaveValue('1234');
});

test('builder: restoring retained history creates a new revision and survives reload', async ({
  page,
}, info) => {
  test.skip(desktopOnly(info.project.name), 'the dense table is a desktop layout');
  await page.goto('/catalog/tool?show=all');
  await page
    .getByRole('row', { name: /Demo Web Search Tool/ })
    .getByRole('button', { name: 'Add' })
    .click();
  await page.getByRole('link', { name: /Back to builder/ }).click();
  await expect(page.locator('.pbar')).toContainText('rev 2');
  await page.goto('/catalog/tool?show=all');
  await page
    .getByRole('row', { name: /Demo Ticket Writer/ })
    .getByRole('button', { name: 'Add' })
    .click();
  await page.getByRole('link', { name: /Back to builder/ }).click();
  await expect(page.locator('.pbar')).toContainText('rev 3');
  await page.locator('summary').filter({ hasText: 'Revision history' }).click();
  await page.getByRole('button', { name: 'Restore revision 2 as new revision' }).click();
  await expect(page.locator('.pbar')).toContainText('rev 4');
  await expect(page.locator('.pt tbody tr[data-kind="tool"]')).toContainText(
    'Demo Web Search Tool',
  );
  await expect(page.locator('.pt tbody tr[data-kind="tool"]')).not.toContainText(
    'Demo Ticket Writer',
  );
  await expect(page.locator('.pbox-save-error')).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const id = localStorage.getItem('pyai.currentBuildId');
        const stored = id ? localStorage.getItem(`pyai.build.${id}`) : null;
        return stored ? JSON.parse(stored).build.revision : null;
      }),
    )
    .toBe(4);
  await page.reload();
  await expect(page.locator('.pbar')).toContainText('rev 4');
  await expect(page.locator('.pt tbody tr[data-kind="tool"]')).toContainText(
    'Demo Web Search Tool',
  );
});

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
  // The default filter hides incompatible candidates by design (research §4.1), and Ticket Writer
  // needs guardrails, so continue on the explicit all-buckets view — otherwise the row can vanish
  // mid-click once the verdicts land and the test races the compatibility query.
  await page.goto('/catalog/tool?show=all&add=1');
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
  await expect(row.locator('[data-label="Est. cost"]')).toHaveText('Excluded');
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

test('selected model keeps its settings when revisited in compare and detail', async ({ page }) => {
  await page.goto('/catalog/model/demo~model~aurora-large');
  await page.getByRole('button', { name: /Add to my stack/ }).click();
  await expect(page.getByRole('button', { name: /In your build/ })).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const id = localStorage.getItem('pyai.currentBuildId');
        return id ? localStorage.getItem(`pyai.build.${id}`) : null;
      }),
    )
    .not.toBeNull();
  const original = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId')!;
    const key = `pyai.build.${id}`;
    const stored = JSON.parse(localStorage.getItem(key)!);
    stored.build.selections.find(
      (s: { catalog_item_id: string }) => s.catalog_item_id === 'demo.model.aurora-large',
    ).settings.temperature = 0.37;
    localStorage.setItem(key, JSON.stringify(stored));
    return stored.build;
  });
  await page.goto('/compare?ids=demo~model~aurora-large');
  await expect(page.getByRole('button', { name: 'Use this part' })).toBeDisabled();
  await page.goto('/catalog/model/demo~model~aurora-large');
  await expect(page.getByRole('button', { name: /In your build/ })).toBeDisabled();
  const saved = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId')!;
    return JSON.parse(localStorage.getItem(`pyai.build.${id}`)!).build;
  });
  expect(saved).toEqual(original);
});

test('catalog preserves a disabled model and its configured settings', async ({ page }) => {
  await page.goto('/catalog/model/demo~model~aurora-large');
  await page.getByRole('button', { name: /Add to my stack/ }).click();
  await expect(page.getByRole('button', { name: /In your build/ })).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const id = localStorage.getItem('pyai.currentBuildId');
        return id ? localStorage.getItem(`pyai.build.${id}`) : null;
      }),
    )
    .not.toBeNull();
  const original = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId')!;
    const key = `pyai.build.${id}`;
    const stored = JSON.parse(localStorage.getItem(key)!);
    const model = stored.build.selections.find(
      (s: { catalog_item_id: string }) => s.catalog_item_id === 'demo.model.aurora-large',
    );
    model.settings.temperature = 0.37;
    model.enabled = false;
    localStorage.setItem(key, JSON.stringify(stored));
    return stored.build;
  });
  await page.goto('/catalog/model?show=all');
  const row = page.getByRole('row', { name: /Demo Aurora Large/ });
  await expect(row.getByRole('button', { name: /In stack/ })).toBeDisabled();
  await page.reload();
  await expect(row.getByRole('button', { name: /In stack/ })).toBeDisabled();
  const saved = await page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId')!;
    return JSON.parse(localStorage.getItem(`pyai.build.${id}`)!).build;
  });
  expect(saved).toEqual(original);
});

test('summary revision comparison opens the build chooser', async ({ page }) => {
  await page.goto('/catalog/model/demo~model~aurora-large');
  await page.getByRole('button', { name: /Add to my stack/ }).click();
  await expect(page.getByRole('button', { name: /In your build/ })).toBeDisabled();
  await page.goto('/summary');
  await page.getByRole('link', { name: 'Compare two revisions' }).click();
  await expect(page).toHaveURL(/\/compare\?mode=builds$/);
  await expect(
    page.getByRole('heading', { name: 'Revisions of your current build' }),
  ).toBeVisible();
  const revisions = page.getByRole('group', { name: /^Revisions of/ });
  await revisions.getByRole('checkbox', { name: /^Revision 1 / }).check();
  await revisions.getByRole('checkbox', { name: /^Revision 2 / }).check();
  await page.getByRole('button', { name: 'Compare these two' }).click();
  await expect(page).toHaveURL(/\/compare\?revisions=1,2$/);
});

test('builder announces the storage failure and its explanation', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('pyai.build.'))
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await page.goto('/builder');
  await page.getByRole('textbox', { name: 'Build name' }).fill('Unsaved build');
  await page.getByRole('textbox', { name: 'Build name' }).press('Tab');
  const status = page.getByRole('status').filter({ hasText: 'Not saved:' });
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveAttribute('aria-atomic', 'true');
  await expect(status).toContainText(/storage|save|persist/i);
});
