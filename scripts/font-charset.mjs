/*
 * The glyph set the web fonts are subset to.
 *
 * The design specifies Space Grotesk (display), DM Sans (body) and IBM Plex Mono (labels). Shipping
 * the full faces cost ~91 kB, which is most of what pushed the Lighthouse performance median on the
 * parts routes below the 90 budget. The site is English-only and renders a small, closed alphabet,
 * so the fonts are subset to printable ASCII plus the punctuation and math characters the UI
 * actually uses.
 *
 * `tests/unit/font-subset.test.ts` recomputes this set from src/ and the contract JSON and fails if
 * the sources use a character that is not listed here. That is deliberate: the failure is the signal
 * to add the character and re-run `npm run fonts:subset`, so a glyph can never go missing silently.
 */

/** Printable ASCII: space through tilde. */
const ASCII = Array.from({ length: 0x7f - 0x20 + 1 }, (_, i) => 0x20 + i);

/**
 * Non-ASCII characters that appear in copy, labels or contract data, plus the few typographic
 * characters a future string is likely to need (so a one-off edit does not require a rebuild).
 */
export const EXTRA_CODEPOINTS = [
  0x00a0, // no-break space
  0x00a3, // £
  0x00a7, // § section sign (methodology cross-references)
  0x00a9, // © copyright
  0x00b7, // · middle dot (separators)
  0x00d7, // × multiplication sign (dimensions)
  0x2013, // – en dash
  0x2014, // — em dash
  0x2018, // ‘
  0x2019, // ’
  0x201c, // “
  0x201d, // ”
  0x2026, // … ellipsis
  0x20ac, // €
  0x2192, // → rightwards arrow
  0x2197, // ↗ north-east arrow
  0x21a5, // ↥ upwards arrow from bar
  0x2212, // − minus sign (exact decimal values)
  0x2260, // ≠
  0x2264, // ≤
  0x2265, // ≥ lower-bound price marker
  0x2286, // ⊆
  0x2713, // ✓
  0x2715, // ✕
];

/** Every codepoint the subset keeps, sorted and de-duplicated. */
export function subsetCodepoints() {
  return [...new Set([...ASCII, ...EXTRA_CODEPOINTS])].sort((a, b) => a - b);
}

/** The subset as the single string `subset-font` expects. */
export function subsetText() {
  return String.fromCodePoint(...subsetCodepoints());
}

/** The subset as a printable list, for the guard test's failure message. */
export function describeCodepoint(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${JSON.stringify(String.fromCodePoint(cp))}`;
}
