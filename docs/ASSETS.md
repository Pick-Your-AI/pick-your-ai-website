# Image assets and provenance

All AI-generated raster images on the site were created with **OpenAI Codex** (`codex` CLI 0.162.1, `codex exec`, built-in `imagegen` skill / `image_gen` tool, GPT Image). No other image generator was used. UI icons are the inline SVG sprite in `src/components/icon.tsx` (ported from the approved design mock); the logo mark and favicon are hand-written SVG.

| File                                                                                  | Used on                        | Source image                                                               | Generated (UTC)      | Alt text                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| `src/assets/images/hero-stack-640.avif`, `hero-stack-640.webp`, `hero-stack-400.webp` | Home hero                      | `hero.png` 1672×941, right-hand illustration cropped (820×941) and resized | 2026-10-16T15:19:19Z | "Illustration: seven stacked layers of modular AI components connected by dependency lines" |
| `src/assets/images/builder-empty-480.webp`                                            | Builder empty state            | `builder-empty.png` 1254×1254, cropped and resized to 480 px               | 2026-10-16T15:19:44Z | Decorative (`alt=""`): the adjacent text says the same thing                                |
| `public/og-card.jpg`                                                                  | Social preview card (1200×630) | `og-card.png` 1730×909, cover-cropped to 1200×630                          | 2026-10-16T15:20:07Z | Not shown in the page                                                                       |

- **Request**: [`docs/assets/codex-request.txt`](assets/codex-request.txt) is the instruction given to Codex.
- **Exact prompts**: [`docs/assets/codex-provenance.json`](assets/codex-provenance.json) has the prompts Codex sent to `image_gen`, as Codex recorded them, plus the output sizes and timestamps. Codex reported the model only as "GPT Image (built-in)", without a version.
- **Optimisation**: ffmpeg 8.1 (`libwebp` at quality 80–82, `libaom-av1` at CRF 32 for AVIF, JPEG at q=4). Each optimised file is 11–54 KB.
- **Originals**: the full-resolution PNGs (about 1.4 MB each) are not committed. To change an asset, regenerate it with Codex and update this table.
- **Content rules**: no text, logos, people or third-party marks. The art is original and does not copy PCPartPicker or any other site.

## Fonts

The design's three typefaces are self-hosted from `public/fonts/` (latin subset, woff2) and declared
in `src/styles/fonts.css`. Serving them from this origin keeps the production
Content-Security-Policy at `style-src 'self'; font-src 'self'` and means a page load makes no
third-party request.

| Family        | Weights | File                                              | Licence                   |
| ------------- | ------- | ------------------------------------------------- | ------------------------- |
| Space Grotesk | 400–700 | `public/fonts/space-grotesk-var.woff2` (variable) | SIL Open Font License 1.1 |
| DM Sans       | 400–700 | `public/fonts/dm-sans-var.woff2` (variable)       | SIL Open Font License 1.1 |
| IBM Plex Mono | 400/600 | `public/fonts/ibm-plex-mono-{400,600}.woff2`      | SIL Open Font License 1.1 |

### Metric-matched fallbacks

`fonts.css` also declares a `'<Family> Fallback'` face per family, naming a local system font and
correcting it with `size-adjust` / `ascent-override` / `descent-override`. `font-display: swap` paints
text immediately in the fallback and swaps when the webfont lands; without matched metrics that swap
reflows the page. The line box matches the webfont **exactly** for all three families, and the advance
width is within ~3% (the browser quantises `size-adjust` to whole pixels, so an exact width match is
not achievable by scaling). `tests/e2e/font-fallback-metrics.spec.ts` asserts both the match and that
the adjusted fallback is measurably closer than the plain generic family — otherwise deleting the
overrides would still pass.

The two mono faces use `font-display: optional`: they are the last thing painted, and a late swap
would re-lay every numeric column.

### Subsetting

`public/fonts/` holds **generated** subsets, not the upstream files. `fonts-src/` holds the pristine
upstream faces (outside `public/`, so never served or copied into `dist/`). Regenerate the shipped
files with:

```sh
npm run fonts:subset
```

The glyph set lives in `scripts/font-charset.mjs`: printable ASCII plus the punctuation and math
characters the UI renders (`—`, `·`, `…`, `→`, `×`, `§`, `≥`, `≠`, `≤`, `⊆`, `✓`, `✕`, …).

**Glyph subsetting is the only transformation applied.** Shipping the full faces cost ~91 kB; the
glyph subset is ~58 kB.

The `wght` axis is deliberately **not** clipped, even though clipping to 400–700 would save a further
~10 kB. Clipping rewrites the retained masters into the axis endpoints, so the interpolated advance at
a given weight stops matching the one the designer drew. Measured, it was lossless at exactly
400/500/600/700 and wrong in between — Space Grotesk at 550 differed by 0.25%, and the "WAV" advance
at 400 changed by a whole pixel. Which weights may be _used_ is declared in CSS instead
(`font-weight: 400 700` in `fonts.css`), which is declarative and does not touch the glyph data.
`tests/e2e/font-subset.spec.ts` measures advances against the pristine face at 400, 450, 500, 550,
600, 650 and 700, so a re-introduction fails the build.

`src/styles/fonts.css` deliberately declares **no `unicode-range`**. It previously carried Google
Fonts' default _latin_ range, which stops at U+2193, so nine characters the UI renders (`→ ↗ ↥ ≠ ≤ ≥
⊆ ✓ ✕`) silently fell back to a system font even though the subset contained them. The files here are
already subset to exactly what the app uses, so the font's own cmap is the correct authority.
`tests/unit/font-subset.test.ts` fails if new copy uses a character outside the set, and fails if the
payload creeps back over 64 kB, so neither regression can land silently.

The OFL permits redistribution and self-hosting, including in a bundled web application, provided
the fonts are not sold on their own and any modified version is renamed. The upstream files in
`fonts-src/` are unmodified copies of the Google Fonts releases (`fonts.gstatic.com`). The subset is
a binary subset of an unmodified font — glyph outlines and names are not altered, only omitted — so
the reserved-font-name rule does not apply and no renaming is required.

## Stylesheet layers

`src/styles/index.css` imports `fonts.css` and `mock.css` only.

- `mock.css` is the design system ported from the mock, restricted to the screens this app renders.
- `mock-legacy.css` holds the mock's screens the app does not implement (the multi-step builder
  wizard, the old catalog directory and compare panels, the marketing masthead). It is **not**
  imported, so it ships nothing; it exists because the README calls `mock.css` a faithful port.
  Rules were moved there only after being verified dead across 444 route loads in both themes, and
  the move is confirmed by the six visual baselines and both axe suites still passing.
- `dense.css` is the parts-register layer and is imported per route module, not globally.
