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
 * Weight range the stylesheet actually selects (`font-weight: 400 700` on the two variable faces;
 * `grep font-weight src/styles` finds 400, 500, 600 and 700 and nothing outside that span).
 * Restricting the wght axis drops the unused masters instead of shipping them: DM Sans alone is
 * 25.9 kB at full range and 16.1 kB clipped to 400-700. The static mono faces have no axis, so the
 * option is only passed for the variable ones.
 */
const VARIATION_AXES = { wght: { min: 400, max: 700 } };

const sourceDir = fileURLToPath(new URL('../fonts-src/', import.meta.url));
const outDir = fileURLToPath(new URL('../public/fonts/', import.meta.url));
const text = subsetText();

for (const { file: face, variable } of FACES) {
  const source = await readFile(`${sourceDir}${face}`);
  const subset = await subsetFont(source, text, {
    targetFormat: 'woff2',
    ...(variable ? { variationAxes: VARIATION_AXES } : {}),
  });
  if (subset.length >= source.length) {
    throw new Error(
      `${face}: subset (${subset.length} B) is not smaller than the source; refusing to write`,
    );
  }
  await writeFile(`${outDir}${face}`, subset);
  console.log(`${face}: ${source.length} -> ${subset.length} bytes`);
}
