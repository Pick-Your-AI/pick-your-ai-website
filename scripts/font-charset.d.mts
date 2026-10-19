/** Types for scripts/font-charset.mjs, which is plain ESM so the subset script can import it. */

/** Sorted, de-duplicated codepoints the subset keeps. */
export function subsetCodepoints(): number[];

/** The subset as the single string `subset-font` expects. */
export function subsetText(): string;

/** A codepoint rendered for a human: `U+00D7 "×"`. */
export function describeCodepoint(cp: number): string;

/** Non-ASCII codepoints added on top of printable ASCII. */
export const EXTRA_CODEPOINTS: number[];
