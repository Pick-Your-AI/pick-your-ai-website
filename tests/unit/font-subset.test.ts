/*
 * Guards the subset web fonts.
 *
 * The fonts in public/fonts/ are subset to the alphabet the UI renders, which is what keeps the
 * Lighthouse performance budget reachable. Two things can silently break that:
 *  - new copy introduces a character outside the subset (it would render as a missing glyph), and
 *  - the font files drift back to full size (the budget regression returns).
 *
 * This test fails on both, with the exact characters to add.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeCodepoint, subsetCodepoints } from '../../scripts/font-charset.mjs';

const FONT_DIR = 'public/fonts';
const SCANNED = ['src', 'contracts', 'index.html'];

/** Every non-ASCII character the shipped UI can render. */
function charactersUsedInSources() {
  const found = new Map<number, string[]>();
  const walk = (path: string) => {
    if (statSync(path).isDirectory()) {
      if (path.includes('node_modules') || path.endsWith('/generated')) return;
      for (const entry of readdirSync(path)) walk(join(path, entry));
      return;
    }
    if (!/\.(tsx?|jsx?|json|html|css)$/.test(path)) return;
    for (const char of readFileSync(path, 'utf8')) {
      const cp = char.codePointAt(0);
      if (cp !== undefined && cp > 0x7e) {
        const seen = found.get(cp) ?? [];
        if (seen.length < 3) seen.push(path);
        found.set(cp, seen);
      }
    }
  };
  for (const entry of SCANNED) walk(entry);
  return found;
}

describe('subset web fonts', () => {
  it('covers every non-ASCII character the sources render', () => {
    const allowed = new Set(subsetCodepoints());
    const used = charactersUsedInSources();
    const missing = [...used.keys()].filter((cp) => !allowed.has(cp));
    expect(
      missing.map((cp) => `${describeCodepoint(cp)} in ${(used.get(cp) ?? []).join(', ')}`),
      'add these characters to scripts/font-charset.mjs and run `npm run fonts:subset`',
    ).toEqual([]);
  });

  it('keeps the subset alphabet itself stable', () => {
    // A deliberate change here must also regenerate the files; the size budget below catches that.
    expect(subsetCodepoints().length).toBeGreaterThan(100);
    expect(subsetCodepoints()[0]).toBe(0x20);
    const points = subsetCodepoints();
    expect(points.every((cp, i) => i === 0 || cp > (points[i - 1] ?? 0))).toBe(true);
  });

  it('keeps the shipped font payload small', () => {
    const sizes = Object.fromEntries(
      readdirSync(FONT_DIR)
        .filter((f) => f.endsWith('.woff2'))
        .map((f) => [f, statSync(join(FONT_DIR, f)).size]),
    );
    // Full upstream faces totalled ~91 kB. Glyph subsetting alone lands near 58 kB, which is the
    // shipped size: the `wght` axis is deliberately NOT clipped (see font-weight-range.test.ts), so
    // the ceiling allows the full axis but not a revert to unsubset faces.
    const total = Object.values(sizes).reduce((sum, n) => sum + n, 0);
    expect(total, `fonts: ${JSON.stringify(sizes)}`).toBeLessThan(64 * 1024);
  });

  it('declares no unicode-range that would exclude a glyph the UI renders', () => {
    /*
     * A face can contain a glyph and still never render it: `unicode-range` decides which codepoints
     * a face may serve. These faces carried Google Fonts' default *latin* range, which stops at
     * U+2193, so `-> >= != <= subset-of check cross` and the diagonal/upward arrows silently fell
     * back to a system font while the subset contained them.
     *
     * `document.fonts.check` cannot catch this in Chromium (it returns true for an excluded
     * codepoint), and a width comparison cannot either, because several of these glyphs are absent
     * from some of the families and correctly fall back there. So the assertion is made on the
     * stylesheet itself: any declared range must cover the whole subset.
     */
    const css = readFileSync('src/styles/fonts.css', 'utf8');
    const ranges = [...css.matchAll(/unicode-range:\s*([^;]+);/g)].map((m) => m[1]!);
    const parse = (spec: string) =>
      spec
        .split(',')
        .map((part) => part.trim().replace(/^U\+/i, ''))
        .filter(Boolean)
        .map((part) => {
          const [from, to] = part.split('-');
          const lo = Number.parseInt(from!, 16);
          const hi = to ? Number.parseInt(to, 16) : lo;
          return [lo, hi] as const;
        });
    for (const range of ranges) {
      const spans = parse(range);
      const uncovered = subsetCodepoints().filter(
        (cp) => !spans.some(([lo, hi]) => cp >= lo && cp <= hi),
      );
      expect(
        uncovered.map(describeCodepoint),
        'these characters are excluded by unicode-range and would render in a fallback font',
      ).toEqual([]);
    }
  });

  it('ships no weight the stylesheet never selects', () => {
    const css = readFileSync('src/styles/fonts.css', 'utf8');
    const declared = [...css.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
    const shipped = readdirSync(FONT_DIR).filter((f) => f.endsWith('.woff2'));
    expect(shipped.sort()).toEqual([...new Set(declared)].sort());
  });
});
