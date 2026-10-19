# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Accepted English 1.0.0 display labels from Research #487, pinned independently of frozen v1 and imported without a duplicate kind table; normal contract verification checks the sidecar and its immutable upstream source.
- Project bootstrap: Vite + React 19 + TypeScript (strict), Tailwind CSS 4, React Router, TanStack Query, ESLint, Prettier, Vitest, Playwright with axe.
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
