/*
 * The shipped web fonts are subsets (see docs/ASSETS.md). This test proves the subset still contains
 * every glyph the full face had, so subsetting can never quietly produce tofu: for each face, the
 * pristine file in `fonts-src/` and the shipped subset in `public/fonts/` are loaded side by side and
 * every codepoint in the subset alphabet must measure to the same advance width.
 *
 * A missing glyph falls back to the next family in the chain, which changes its advance width — that
 * is the signal this asserts on. Comparing against the pristine face (rather than just checking that
 * something rendered) means a glyph that neither font has, such as `≥` in IBM Plex Mono, is not
 * mistaken for a subsetting bug.
 */
import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { subsetCodepoints } from '../../scripts/font-charset.mjs';

const SRC_DIR = join(process.cwd(), 'fonts-src');
const faces = readdirSync(SRC_DIR).filter((f) => f.endsWith('.woff2'));

test('every subset face keeps all of its glyphs', async ({ page }) => {
  expect(faces.length).toBeGreaterThan(0);

  // Serve the pristine faces under /_orig/ so both files can be compared in one page.
  await page.route('**/_orig/*.woff2', async (route) => {
    const name = route.request().url().split('/').pop()!;
    await route.fulfill({
      body: readFileSync(join(SRC_DIR, name)),
      contentType: 'font/woff2',
    });
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const codepoints = subsetCodepoints();
  const results = await page.evaluate(
    async ({ faces, codepoints }) => {
      const load = async (family: string, url: string) => {
        const face = new FontFace(family, `url(${url})`, { style: 'normal', weight: '400' });
        await face.load();
        document.fonts.add(face);
      };
      const ctx = document.createElement('canvas').getContext('2d')!;
      const width = (family: string, ch: string) => {
        ctx.font = `400 40px ${family}`;
        return ctx.measureText(ch).width;
      };
      const out: { face: string; missing: string[] }[] = [];
      for (const face of faces as string[]) {
        await load(`probe-orig-${face}`, `/_orig/${face}`);
        await load(`probe-sub-${face}`, `/fonts/${face}`);
        const missing: string[] = [];
        for (const cp of codepoints as number[]) {
          const ch = String.fromCodePoint(cp);
          const a = width(`probe-orig-${face}`, ch);
          const b = width(`probe-sub-${face}`, ch);
          if (Math.abs(a - b) > 0.01) {
            missing.push(
              `U+${cp.toString(16).toUpperCase().padStart(4, '0')} (${a.toFixed(2)} -> ${b.toFixed(2)})`,
            );
          }
        }
        out.push({ face, missing });
      }
      return out;
    },
    { faces, codepoints },
  );

  for (const { face, missing } of results) {
    expect(missing, `${face} lost glyphs; run \`npm run fonts:subset\``).toEqual([]);
  }
});
