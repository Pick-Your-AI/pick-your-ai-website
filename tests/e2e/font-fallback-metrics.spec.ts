/*
 * Metric-matched fallbacks.
 *
 * `font-display: swap` paints text immediately in a system font, then swaps when the webfont arrives.
 * If the two disagree on advance width or line-box height, the swap reflows the page. The fix is a
 * second `@font-face` per family that names a local face and corrects it with `size-adjust` /
 * `ascent-override` / `descent-override`, so the fallback occupies the same space as the webfont.
 *
 * This test asserts two things, and the second is the one that matters:
 *
 * 1. the line box matches exactly, and the advance width is within tolerance; and
 * 2. the metric-adjusted fallback is measurably CLOSER to the webfont than the plain generic family
 *    would be. Without (2) the test would still pass if someone deleted the overrides, because a
 *    generic fallback is not catastrophically wrong — it is just worse.
 *
 * Tolerance: an exact width match is not achievable by scaling. `size-adjust` is a single scalar
 * while the glyph advance widths differ per character, and the browser quantises the adjusted size to
 * whole pixels. The measured worst case across five representative strings is ~2.9% (DM Sans) and
 * ~3.6% (Space Grotesk), against ~4.3% unadjusted. The height match is exact.
 */
import { expect, test } from '@playwright/test';

/** Strings chosen to exercise narrow, wide, numeric and punctuation-heavy runs. */
const SAMPLES = [
  'Hamburgefonstiv',
  'The quick brown fox jumps over the lazy dog',
  '0123456789 $1,234.56',
  'Choose your parts',
  'Synthetic demo estimates — not a quote',
];

const PAIRS = [
  {
    name: 'DM Sans',
    web: "'DM Sans', sans-serif",
    fallback: "'DM Sans Fallback', sans-serif",
    generic: 'sans-serif',
  },
  {
    name: 'Space Grotesk',
    web: "'Space Grotesk', sans-serif",
    fallback: "'Space Grotesk Fallback', sans-serif",
    generic: 'sans-serif',
  },
  {
    name: 'IBM Plex Mono',
    web: "'IBM Plex Mono', monospace",
    fallback: "'IBM Plex Mono Fallback', monospace",
    generic: 'monospace',
  },
];

test('fallback faces match the webfonts closely enough to swap without reflow', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);

  const measured = await page.evaluate(
    async ({ samples, pairs }) => {
      const el = document.createElement('span');
      el.style.cssText =
        'position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-weight:400;line-height:1.5';
      document.body.appendChild(el);
      const box = (family: string, text: string) => {
        el.textContent = text;
        el.style.fontFamily = family;
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      };

      const out: {
        name: string;
        worstWidthError: number;
        heightErrors: number[];
        fallbackWorst: number;
        genericWorst: number;
        applied: boolean;
      }[] = [];

      for (const pair of pairs) {
        // fonts.ready only waits for faces already in use. Load the measured face explicitly:
        // an optional mono font may not have been requested by the home page yet.
        await document.fonts.load(`400 100px ${pair.web}`, samples.join(' '));
        await document.fonts.load(`400 100px ${pair.fallback}`, samples.join(' '));
        let worstWidthError = 0;
        let fallbackWorst = 0;
        let genericWorst = 0;
        const heightErrors: number[] = [];
        for (const text of samples) {
          const web = box(pair.web, text);
          const fb = box(pair.fallback, text);
          const gen = box(pair.generic, text);
          worstWidthError = Math.max(worstWidthError, Math.abs(fb.w - web.w) / web.w);
          fallbackWorst = Math.max(fallbackWorst, Math.abs(fb.w - web.w) / web.w);
          genericWorst = Math.max(genericWorst, Math.abs(gen.w - web.w) / web.w);
          heightErrors.push(Math.abs(fb.h - web.h));
        }
        // Did the family actually apply, or did we silently measure the generic fallback twice?
        const applied = box(pair.fallback, samples[0]!).w !== box(pair.generic, samples[0]!).w;
        out.push({
          name: pair.name,
          worstWidthError,
          heightErrors,
          fallbackWorst,
          genericWorst,
          applied,
        });
      }
      el.remove();
      return out;
    },
    { samples: SAMPLES, pairs: PAIRS },
  );

  for (const m of measured) {
    // Guard against a vacuous comparison.
    expect(
      m.applied,
      `${m.name}: the Fallback family did not resolve to a distinct local face`,
    ).toBe(true);
    // The line box must match exactly: this is what prevents vertical reflow.
    expect(m.heightErrors, `${m.name}: fallback line box differs from the webfont`).toEqual(
      m.heightErrors.map(() => 0),
    );
    // And the metric override must be an improvement, not a decoration.
    expect(
      m.fallbackWorst,
      `${m.name}: adjusted fallback (${(m.fallbackWorst * 100).toFixed(2)}%) is no better than the plain generic family (${(m.genericWorst * 100).toFixed(2)}%)`,
    ).toBeLessThan(m.genericWorst);
    expect(
      m.worstWidthError,
      `${m.name}: fallback width differs by ${(m.worstWidthError * 100).toFixed(2)}%`,
    ).toBeLessThan(0.045);
  }
});
