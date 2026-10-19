/*
 * Guards the weight range of the variable faces.
 *
 * The stylesheet selects 400-700 only (`font-weight: 400 700` on the two variable faces, and
 * `grep -o 'font-weight: *[0-9]*' src/styles` finds nothing outside that span). `scripts/
 * subset-fonts.mjs` clips the `wght` axis to exactly that span, which drops the unused masters:
 * DM Sans is 25.9 kB at full range and 16.1 kB clipped. Shipping the full axis again would silently
 * add ~10 kB to the render-blocking font payload that the Lighthouse budget on the parts routes is
 * measured against, so the ceiling below is set just above the clipped size.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FONT_DIR = 'public/fonts';
const WEIGHT_RANGE = '400 700';

const fontFiles = readdirSync(FONT_DIR).filter((f) => f.endsWith('.woff2'));
const payloadBytes = fontFiles.reduce((sum, f) => sum + statSync(join(FONT_DIR, f)).size, 0);

describe('variable font weight range', () => {
  it('clips the wght axis in the subset script', () => {
    const script = readFileSync('scripts/subset-fonts.mjs', 'utf8');
    expect(script).toMatch(/variationAxes:\s*VARIATION_AXES/);
    expect(script).toMatch(/wght:\s*\{\s*min:\s*400,\s*max:\s*700\s*\}/);
  });

  it('declares the same weight span in the stylesheet', () => {
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

  it('keeps the whole font payload inside the clipped-size budget', () => {
    // 48.2 kB shipped; 59 kB is what the same subset costs with the full wght axis.
    expect(payloadBytes, `fonts: ${fontFiles.join(', ')}`).toBeLessThan(52 * 1024);
  });
});
