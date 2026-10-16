# Image assets and provenance

All AI-generated raster images on the site were created with **OpenAI Codex** (`codex` CLI 0.162.1, `codex exec`, built-in `imagegen` skill / `image_gen` tool, GPT Image). No other image generator was used. UI icons are hand-written inline SVG (`src/components/icons.tsx`); the logo and favicon are hand-written SVG.

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
