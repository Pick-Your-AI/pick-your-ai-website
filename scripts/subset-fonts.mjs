/*
 * Regenerates the subset web fonts in `public/fonts/` from the unmodified upstream faces in
 * `fonts-src/`.
 *
 * Run `npm run fonts:subset` after changing copy in a way that introduces a new non-ASCII character.
 * `tests/unit/font-subset.test.ts` fails first if the character is not in scripts/font-charset.mjs,
 * so this is never a silent step.
 *
 * Both trees are committed. `fonts-src/` holds the pristine upstream files (outside `public/`, so it
 * is never served or copied into `dist/`); `public/fonts/` holds the generated subsets the site
 * ships. Keeping the originals in-tree means the subset can be reproduced offline and reviewed as a
 * derived artefact, and the production build never depends on a font-subsetting toolchain.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';
import { subsetText } from './font-charset.mjs';

const FACES = [
  { file: 'dm-sans-var.woff2', variable: true },
  { file: 'space-grotesk-var.woff2', variable: true },
  { file: 'ibm-plex-mono-400.woff2', variable: false },
  { file: 'ibm-plex-mono-600.woff2', variable: false },
];

/*
 * Weight range the stylesheet admits is declared in CSS (`font-weight: 400 700` on the two variable
 * faces), NOT by clipping the binary.
 *
 * Do not pass `variationAxes` here. Clipping the `wght` axis to 400-700 does shrink the file
 * (DM Sans 25.9 kB -> 16.1 kB), but it rewrites the face's native design coordinates: the retained
 * masters become the axis endpoints, so the interpolated advances at any given weight are no longer
 * the ones the type designer drew. `tests/e2e/font-subset.spec.ts` measures advances at 400, 500,
 * 600 and 700 against the pristine face, which is what keeps this honest.
 *
 * Restricting the admitted range belongs in the `@font-face` rule, where it is declarative,
 * reversible and does not alter the glyph data.
 *
 * `preserveNameIds` is required, not cosmetic. The harfbuzz subsetter drops most of the `name` table
 * by default, and the pristine faces carry their licence URL in name ID 14
 * (`https://scripts.sil.org/OFL`). Dropping it removes the licence notice from the distributed file,
 * which the SIL Open Font License requires to be retained. ID 0 (copyright) survives by default, but
 * it is listed explicitly so the intent is visible rather than incidental.
 */
const LICENCE_NAME_IDS = [
  0, // copyright notice
  7, // trademark notice
  11, // vendor URL
  12, // designer URL
  13, // licence description
  14, // licence URL
];

const sourceDir = fileURLToPath(new URL('../fonts-src/', import.meta.url));
const outDir = fileURLToPath(new URL('../public/fonts/', import.meta.url));
const text = subsetText();

for (const { file: face } of FACES) {
  const source = await readFile(`${sourceDir}${face}`);
  // Glyph subset only: the axis is preserved exactly as the upstream face declares it.
  const subset = await subsetFont(source, text, {
    targetFormat: 'woff2',
    preserveNameIds: LICENCE_NAME_IDS,
  });
  if (subset.length >= source.length) {
    throw new Error(
      `${face}: subset (${subset.length} B) is not smaller than the source; refusing to write`,
    );
  }
  await writeFile(`${outDir}${face}`, subset);
  console.log(`${face}: ${source.length} -> ${subset.length} bytes`);
}
