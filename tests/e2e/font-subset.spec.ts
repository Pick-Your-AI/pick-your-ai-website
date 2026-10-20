/*
 * The shipped web fonts are glyph subsets of the pristine faces in `fonts-src/` (see docs/ASSETS.md).
 * Two properties must hold, and this file asserts both.
 *
 * 1. **No glyph is lost.** A missing glyph falls back to the next family in the chain, which changes
 *    its advance width. Comparing against the pristine face — rather than merely checking that
 *    something rendered — means a character neither face has, such as `≥` in IBM Plex Mono, is not
 *    mistaken for a subsetting bug.
 *
 * 2. **The variable faces still interpolate to the advances the designer drew, at every admitted
 *    weight.** The stylesheet admits 400–700 (`font-weight: 400 700` in fonts.css). An earlier
 *    revision clipped the `wght` axis to that span to save bytes; that rewrote the retained masters
 *    into the axis endpoints, so the advance at a given weight was no longer the original one. Both
 *    faces are therefore measured at 400, 500, 600 and 700 here. Do not re-introduce axis clipping
 *    to shrink the payload: restrict the admitted range in CSS instead.
 */
import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { subsetCodepoints } from '../../scripts/font-charset.mjs';

const SRC_DIR = join(process.cwd(), 'fonts-src');
const faces = readdirSync(SRC_DIR).filter((f) => f.endsWith('.woff2'));

/**
 * Weights to measure. The stylesheet admits 400-700 (fonts.css: `font-weight: 400 700`), so the whole
 * span matters, not just the four values the stylesheet happens to name. Clipping the `wght` axis was
 * lossless at exactly 400/500/600/700 and wrong in between (Space Grotesk at 550 differed by 0.25%),
 * which is why the intermediate stops are sampled here.
 */
const ADMITTED_WEIGHTS = [400, 450, 500, 550, 600, 650, 700];

/** Faces with a `wght` axis; the two static mono faces only have their declared weight. */
const VARIABLE = new Set(['dm-sans-var.woff2', 'space-grotesk-var.woff2']);

test.beforeEach(async ({ page }) => {
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
});

test('every subset face keeps all of its glyphs', async ({ page }) => {
  expect(faces.length).toBeGreaterThan(0);
  const codepoints = subsetCodepoints();

  const results = await page.evaluate(
    async ({ faces, codepoints }) => {
      const load = async (family: string, url: string, weight: string) => {
        const face = new FontFace(family, `url(${url})`, { style: 'normal', weight });
        await face.load();
        document.fonts.add(face);
      };
      const ctx = document.createElement('canvas').getContext('2d')!;
      const width = (family: string, ch: string) => {
        ctx.font = `400 40px ${family}`;
        return ctx.measureText(ch).width;
      };
      const out: { face: string; missing: string[] }[] = [];
      let n = 0;
      for (const face of faces as string[]) {
        // Family names must be plain identifiers: a name containing `.woff2` makes the CSS `font`
        // shorthand invalid, and `ctx.font = …` then silently keeps the previous font, so both
        // measurements would use the same fallback and every comparison would pass vacuously.
        const origFamily = `pfo${n}`;
        const subFamily = `pfs${n}`;
        n += 1;
        // Declare both over the full range so this test is not itself constrained by CSS.
        await load(origFamily, `/_orig/${face}`, '100 900');
        await load(subFamily, `/fonts/${face}`, '100 900');
        const missing: string[] = [];
        for (const cp of codepoints as number[]) {
          const ch = String.fromCodePoint(cp);
          const a = width(origFamily, ch);
          const b = width(subFamily, ch);
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

test('variable faces interpolate identically at every admitted weight', async ({ page }) => {
  const variableFaces = faces.filter((f) => VARIABLE.has(f));
  expect(variableFaces.length).toBe(2);

  // Mixed text: ascenders/descenders, a wide cap, digits (tabular figures matter for price columns)
  // and two non-ASCII glyphs the UI renders.
  const SAMPLES = ['Hamburgefonstiv', 'Mg', 'WAV', '0123456789', '—≥'];

  const results = await page.evaluate(
    async ({ variableFaces, weights, samples }) => {
      const load = async (family: string, url: string) => {
        const face = new FontFace(family, `url(${url})`, { style: 'normal', weight: '100 900' });
        await face.load();
        document.fonts.add(face);
      };
      const ctx = document.createElement('canvas').getContext('2d')!;
      const width = (family: string, weight: number, text: string) => {
        ctx.font = `${weight} 48px ${family}`;
        return ctx.measureText(text).width;
      };
      const out: { face: string; weight: number; text: string; orig: number; sub: number }[] = [];
      let n = 0;
      for (const face of variableFaces as string[]) {
        // Plain-identifier family names, for the same reason as in the glyph test above.
        const origFamily = `pwo${n}`;
        const subFamily = `pws${n}`;
        n += 1;
        await load(origFamily, `/_orig/${face}`);
        await load(subFamily, `/fonts/${face}`);
        /*
         * Guard against a vacuous pass. If the CSS `font` shorthand did not apply the family, both
         * sides would measure the identical *fallback* and every comparison below would trivially
         * succeed. Require each loaded family to be distinguishable from the generic fallback.
         */
        for (const family of [origFamily, subFamily]) {
          const applied =
            Math.abs(
              width(family, 400, 'Hamburgefonstiv') - width('sans-serif', 400, 'Hamburgefonstiv'),
            ) > 0.01;
          if (!applied) {
            out.push({
              face,
              weight: -1,
              text: `(family ${family} did not apply; measurement would be vacuous)`,
              orig: 0,
              sub: 0,
            });
          }
        }
        for (const weight of weights as number[]) {
          for (const text of samples as string[]) {
            const orig = width(origFamily, weight, text);
            const sub = width(subFamily, weight, text);
            if (Math.abs(orig - sub) > 0.01) out.push({ face, weight, text, orig, sub });
          }
        }
      }
      return out;
    },
    { variableFaces, weights: ADMITTED_WEIGHTS, samples: SAMPLES },
  );

  expect(
    results.map((r) => `${r.face} w=${r.weight} ${JSON.stringify(r.text)}: ${r.orig} -> ${r.sub}`),
    'the subset must not alter interpolated advances; do not clip the wght axis',
  ).toEqual([]);
});
