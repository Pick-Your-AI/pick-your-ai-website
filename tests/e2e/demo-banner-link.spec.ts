import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/*
 * Regression coverage for the tablet accessibility defect that reached production.
 *
 * The synthetic-data banner's "Why?" link carried Tailwind utility class names after the switch to
 * plain CSS. Those classes have no definitions in the stylesheet, and the global anchor rule strips
 * text decoration, so the link was identified by colour alone. At 768px the banner reflows and the
 * link sits inline with surrounding prose, which is what makes it a `link-in-text-block` violation;
 * at narrower widths it wraps onto its own line and at wider widths the surrounding text is short
 * enough that axe does not flag it.
 *
 * Why it escaped: the PR-level axe sweep in smoke.spec.ts runs only the desktop (1440) and mobile
 * (Pixel 7) projects, and the only 768px coverage was the post-deploy `E2E live` suite. So the
 * defect could only ever be discovered after a deploy. These cases put 768px in front of the merge.
 */

const WIDTHS = [375, 768, 1440] as const;

for (const width of WIDTHS) {
  test(`demo disclosure link is not identified by colour alone at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto('/');
    const banner = page.getByRole('note', { name: 'Demo mode' });
    const link = banner.getByRole('link', { name: 'Why?', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/methodology#data');
    // Assert the rendered decoration rather than axe's classification: axe's text-block rule
    // depends on wrapping, so pinning the visible cue keeps this deterministic across widths.
    await expect(link).toHaveCSS('text-decoration-line', 'underline');
  });
}

test('the home page has no accessibility violations at tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes
          .map((node) => node.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    ),
  ).toEqual([]);
});
