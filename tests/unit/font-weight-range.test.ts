/*
 * Guards the weight range of the variable faces.
 *
 * Two different mechanisms restrict weight, and they must not be confused:
 *
 *  - **Which weights may be used** is declared in CSS (`font-weight: 400 700` on the two variable
 *    faces). That is declarative, reversible and does not touch the font data.
 *  - **What is inside the shipped file** must stay the upstream face, glyph-subset only. An earlier
 *    revision also clipped the `wght` axis to 400–700 in `scripts/subset-fonts.mjs` to save ~10 kB.
 *    That was reverted: clipping rewrites the retained masters into the axis endpoints, so the
 *    interpolated advance at a given weight is no longer the one the designer drew. Measured, it was
 *    lossless at exactly 400/500/600/700 and wrong in between (Space Grotesk at 550 differed by
 *    0.25%, and at 400 the "WAV" advance changed by 1px).
 *
 * `tests/e2e/font-subset.spec.ts` is the test that would actually catch a re-introduction: it
 * measures advances against the pristine face at 400, 450, 500, 550, 600, 650 and 700. This unit test
 * guards the cheap, static half — that the script does not clip, and that the payload stays bounded.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FONT_DIR = 'public/fonts';
const WEIGHT_RANGE = '400 700';

const fontFiles = readdirSync(FONT_DIR).filter((f) => f.endsWith('.woff2'));
const payloadBytes = fontFiles.reduce((sum, f) => sum + statSync(join(FONT_DIR, f)).size, 0);

describe('variable font weight range', () => {
  it('does not clip the wght axis in the subset script', () => {
    const script = readFileSync('scripts/subset-fonts.mjs', 'utf8');
    // No variationAxes option at all: the axis must survive exactly as upstream declares it.
    expect(script).not.toMatch(/variationAxes\s*:/);
    // And the reason must be recorded, so this is not "fixed" back to clipping.
    expect(script).toMatch(/do not pass `variationAxes`|Do not pass `variationAxes`/i);
  });

  it('declares the admitted weight span in the stylesheet', () => {
    const css = readFileSync('src/styles/fonts.css', 'utf8');
    const variableFaces = [
      ...css.matchAll(/font-family:\s*'([^']+)';[\s\S]*?font-weight:\s*([^;]+);/g),
    ]
      .filter(([, family]) => family === 'DM Sans' || family === 'Space Grotesk')
      .map(([, family, weight]) => [family, weight!.trim()]);
    expect(variableFaces).toEqual([
      ['DM Sans', WEIGHT_RANGE],
      ['Space Grotesk', WEIGHT_RANGE],
    ]);
  });

  it('keeps the whole font payload bounded', () => {
    // Glyph subset with the full axis is ~58 kB; the glyph-subset-only build must not creep past
    // this. It is a ceiling, not a target: the payload is reported so a regression is legible.
    expect(payloadBytes, `fonts: ${fontFiles.join(', ')}`).toBeLessThan(64 * 1024);
  });
});
