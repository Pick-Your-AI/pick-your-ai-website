# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **Builder, catalog and compare rebuilt on a dense "parts list" layer** (`src/styles/dense.css`, `src/components/parts.tsx`) modelled on the PCPartPicker interaction patterns recorded in `docs/research/pcpartpicker-ux-notes.md`: fixed component rows in dependency order with "Choose …" empty states, a status strip carrying the worst outcome plus live estimates, a running total under the table, lettered findings with severity and outcome as words, an explicit "what was not checked" note, a compatibility filter that is on by default with `unknown` as its own bucket, `aria-sort` table headers, active-filter chips, and URL-carried filter state.
- Compare is now one aligned table (properties as rows, up to three products as columns) with difference markers, slot pickers, and explicit "not recorded" cells instead of blanks. `*_ref` spec values are resolved to the referenced component's name so no internal catalog id is printed.
- The three pages use compact titles and tables instead of the marketing hero treatment; the marketing pages are unchanged.
- **Website UI rebuilt to match the approved design mock** (`docs/design/pickyourai-complete.html`). The mock's stylesheet is vendored verbatim as `src/styles/mock.css` (the only edit is scoping the theme class to `<html>`), its 33-glyph icon sprite as `src/components/icon.tsx`, and every screen now uses the mock's markup and class names instead of utility classes; Tailwind was removed. The seven "layers" of the mock are the contract's seven tiers, so no parallel taxonomy was introduced.
- Home, builder, catalog directory, component chooser, component detail, compare, My Builds, starter builds, methodology, about, legal, build summary and the shared-build preview all follow the mock's layout, typography, palette and responsive behaviour.
- A first visit opens an empty canvas, not the mock's prefilled demonstration stack: a preselected stack would read as a recommendation, and an unconfigured build must surface as `Incomplete`, not `Compatible`. Starter stacks remain an explicit choice on /templates.
- Per-component prices come from the real preview estimator over a one-item probe build (`src/lib/item-cost.ts`), never from hard-coded numbers. Every applicable meter is summed, so a component with two billable meters shows both; if any meter has no applicable rate the row is a lower bound (`≥ … partial`) rather than a monthly price, and `Unknown` when none applies. Free/included is an admission outcome of the build policy, not a property of the item: absent or false `allow_unverified_catalog_items` gives `Unknown`, true gives `Included*` with a caveat. Never `$0`.
- Catalog rows carry a one-line spec subtitle (`rowSubtitle` in `src/lib/catalog-view.ts`) that only prints values the catalog records, prefers numbers, and never restates the component kind or layer.
- Compare and catalog rows show licence/billing facts the contract actually carries instead of inventing a vendor name.
- Dim greys were lifted to the WCAG AA contrast floor in both themes, and accent-filled controls pick ink or white per theme.
- Documentation: `docs/DESIGN_SYSTEM.md` rewritten for the new design system; `docs/ARCHITECTURE.md` stack line updated.

### Fixed

- **Per-item price no longer reports only the first billable meter.** A component can have several applicable meters (a model has input and output token rates), and the register showed the first line as if it were the whole monthly price. All lines are now summed with the estimator's exact decimal arithmetic, a partly-priced component is labelled a lower bound, and the build policy decides free/included admission rather than the item's billing class alone.
- **No invented evidence expiry.** The register derived a `stale` flag from `days > 30` and the methodology page claimed a 30-day warning. Research #41 adopts no time-to-live: an evidence date is descriptive, and a version-pinned fact does not expire with age. Age-derived staleness is removed; `evidenceDateLabel` (`src/domain/freshness.ts`) presents the date and its basis (latest recorded source check, or item update).
- **Historical `verified` labels are no longer presented as current independent verification.** The strongest recorded provenance status is shown as `Recorded: verified` with its caveat, because the label may record a source check only. Extracted to `src/features/builder/evidence.ts`.
- **A declared SPDX licence is no longer treated as proof of open-source distribution.** `isOpenSource` became `accessSummary` / `declaresLicence`; the filter reads "Declared licence only".
- **`unicode-range` excluded glyphs the UI renders.** The self-hosted faces carried Google Fonts' default _latin_ range, which stops at U+2193, so `→ ↗ ↥ ≠ ≤ ≥ ⊆ ✓ ✕` silently fell back to a system font although the subset contained them. The range is removed and a unit test asserts any declared range covers the whole subset.
- **No horizontal page scroll on any route (WCAG 1.4.10 reflow).** The catalog rail, the About value grid and manifesto, the compare tier tabs and the header navigation each made the document wider than the viewport at 320–820 px, because grid/flex children default to `min-width: auto` and the menu button only appeared below 760 px. Fixed, and `tests/e2e/no-horizontal-scroll.spec.ts` asserts no route scrolls sideways at five widths.
- **Layout shift on the parts routes.** The builder status headline and the catalog rail status note grow from one line to three when the evaluation resolves, moving the table by 32–47 px. Both reserve their tallest state (CLS 0.055–0.071 → 0.007–0.023).
- **The build-compare chooser had no `h1`.** `tests/e2e/document-structure.spec.ts` now asserts exactly one `h1` per route, an accessible name on every visible control, and no request leaving the origin.
- **The dialog did not contain keyboard focus.** Tab is trapped inside the modal and focus returns to the opener on close.
- **Builder and revision comparison were lost in the redesign.** Restored on top of the design system as `?revisions=` and `?builds=`, sharing one diff renderer with selections by tier, objectives/policy/locks, outcome changes and cost.

### Performance

- Web fonts are subset to the glyphs the UI renders and the variable `wght` axis is clipped to 400–700: ~91 kB of faces became 49 kB. `fonts-src/` keeps the pristine upstream files (never shipped); `npm run fonts:subset` regenerates. Guards: a unit test fails on a character outside the subset or a payload over 50 kB, and an e2e test loads each pristine face beside its subset and asserts all 120 codepoints measure to the same advance width.
- `dense.css` is imported by the modules that render the parts register instead of globally, so the marketing pages no longer ship table CSS they cannot match.

### Added

- Accepted English 1.0.0 display labels from Research #487, pinned independently of frozen v1 and imported without a duplicate kind table; normal contract verification checks the sidecar and its immutable upstream source.
- Project bootstrap: Vite + React 19 + TypeScript (strict), React Router, TanStack Query, ESLint, Prettier, Vitest, Playwright with axe.
- `dist/version.json` build stamp (commit, build time, contract version and source SHA, data mode) and a footer build indicator.
- Vendored research contract v1.0.0 from `Pick-Your-AI/pick-your-ai-research@d4bdca4` with provenance manifest and hash verification (`npm run contracts:verify`).
- CI workflow (`CI`) with the `ci-required` aggregate check, reusable via `workflow_call`, uploading the `site-dist` artifact.
- Contract-generated TypeScript types and ahead-of-time Ajv validators (`npm run contracts:types`; no `eval`, CSP-safe).
- Domain layer: TypeScript port of the reference rule interpreter (parity-tested against `reference/evaluate.py`), bidirectional graph invalidation, revisioned build operations, preview cost estimator, freshness checks, import/export and share links.
- Data layer: `CatalogRepository`, `BuildRepository`, `CompatibilityEvaluator`, `PricingProvider`, `EvidenceProvider`, `ResourceEstimateProvider` with fixture and HTTP implementations selected by `VITE_DATA_MODE`; synthetic demo catalog and pricebook validated against the schemas.
- Website UI: home, AI stack builder (T0–T6 rows for all 29 kinds, add/replace/remove/disable, schema-driven settings, objectives, persistent summary, findings with outcome + severity, invalidation notices, revision history, local drafts, JSON/Markdown export, import, share links), catalog, component selection (search, schema facets, sortable columns, compatibility buckets, compare tray), component details, compare (components, builds, revisions), build summary, My Builds, shared build preview, methodology, about, legal; light/dark themes, mobile layouts, demo-mode banner.
- Original raster art generated with OpenAI Codex (GPT Image), optimised to AVIF/WebP; provenance in `docs/ASSETS.md`.
- Playwright smoke and axe (WCAG 2.2 AA tags) tests for every route on desktop and mobile, plus builder, selection and share flows.
- Repository governance: `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`, issue and PR templates, Dependabot.
