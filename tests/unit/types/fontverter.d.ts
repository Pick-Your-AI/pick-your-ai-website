/**
 * `fontverter` ships no type declarations and has no @types package.
 *
 * The declaration lives here rather than in scripts/ because tsconfig.test.json includes only `src`
 * and `tests/unit`; a `.d.mts` under scripts/ is outside that project and would not be loaded.
 */
declare module 'fontverter' {
  export function convert(
    input: Uint8Array,
    targetFormat: 'truetype' | 'sfnt' | 'woff' | 'woff2',
    fromFormat?: 'truetype' | 'sfnt' | 'woff' | 'woff2',
  ): Promise<ArrayBuffer>;
  export function detectFormat(input: Buffer): 'woff' | 'woff2' | 'sfnt';
}
