# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **Builder, catalog and compare rebuilt on a dense "parts list" layer** (`src/styles/dense.css`, `src/components/parts.tsx`) modelled on the PCPartPicker interaction patterns recorded in `docs/research/pcpartpicker-ux-notes.md`: fixed component rows in dependency order with "Choose …" empty states, a status strip carrying the worst outcome plus live estimates, a running total under the table, lettered findings with severity and outcome as words, an explicit "what was not checked" note, a compatibility filter that is on by default with `unknown` as its own bucket, `aria-sort` table headers, active-filter chips, and URL-carried filter state.
- Compare is now one aligned table (properties as rows, up to three products as columns) with difference markers, slot pickers, and explicit "not recorded" cells instead of blanks. `*_ref` spec values are resolved to the referenced component's name so no internal catalog id is printed.
- The three pages use compact titles and tables instead of the marketing hero treatment; the marketing pages are unchanged.
- **Website UI rebuilt to match the approved design mock** (`docs/design/pickyourai-complete.html`). The mock's stylesheet is vendored verbatim as `src/styles/mock.css` (the only edit is scoping the theme class to `<html>`), its 33-glyph icon sprite as `src/components/icon.tsx`, and every screen now uses the mock's markup and class names instead of utility classes; Tailwind was removed. The seven "layers" of the mock are the contract's seven tiers, so no parallel taxonomy was introduced.
- Home, builder, catalog directory, component chooser, component detail, compare, My Builds, starter builds, methodology, about, legal, build summary and the shared-build preview all follow the mock's layout, typography, palette and responsive behaviour.
- A first visit now opens a prefilled demonstration stack (the mock's default state) instead of an empty canvas; "New build" still starts blank.
- Per-component prices come from the real preview estimator over a one-item probe build (`src/lib/item-cost.ts`), never from hard-coded numbers; `Unknown` is shown when no applicable rate exists. `Included` and `Free` are rendered as words, never as `$0`.
- Catalog rows carry a one-line spec subtitle (`rowSubtitle` in `src/lib/catalog-view.ts`) that only prints values the catalog records, prefers numbers, and never restates the component kind or layer.
- Compare and catalog rows show licence/billing facts the contract actually carries instead of inventing a vendor name.
- Dim greys were lifted to the WCAG AA contrast floor in both themes, and accent-filled controls pick ink or white per theme.
- Documentation: `docs/DESIGN_SYSTEM.md` rewritten for the new design system; `docs/ARCHITECTURE.md` stack line updated.

### Added

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
