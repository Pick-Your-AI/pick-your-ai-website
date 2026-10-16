# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Project bootstrap: Vite + React 19 + TypeScript (strict), Tailwind CSS 4, React Router, TanStack Query, ESLint, Prettier, Vitest, Playwright with axe.
- `dist/version.json` build stamp (commit, build time, contract version and source SHA, data mode) and a footer build indicator.
- Vendored research contract v1.0.0 from `Pick-Your-AI/pick-your-ai-research@d4bdca4` with provenance manifest and hash verification (`npm run contracts:verify`).
- CI workflow (`CI`) with the `ci-required` aggregate check, reusable via `workflow_call`, uploading the `site-dist` artifact.
- Contract-generated TypeScript types and ahead-of-time Ajv validators (`npm run contracts:types`; no `eval`, CSP-safe).
- Domain layer: TypeScript port of the reference rule interpreter (parity-tested against `reference/evaluate.py`), bidirectional graph invalidation, revisioned build operations, preview cost estimator, freshness checks, import/export and share links.
- Data layer: `CatalogRepository`, `BuildRepository`, `CompatibilityEvaluator`, `PricingProvider`, `EvidenceProvider`, `ResourceEstimateProvider` with fixture and HTTP implementations selected by `VITE_DATA_MODE`; synthetic demo catalog and pricebook validated against the schemas.
- Repository governance: `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`, issue and PR templates, Dependabot.
