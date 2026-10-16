# Agent and contributor instructions — pickyour.ai (website)

This repository is the PickYour.AI website: a static React + TypeScript SPA served by Apache on GoDaddy shared hosting. Read `CONTRIBUTING.md` and `docs/ARCHITECTURE.md` before changing code.

## Non-negotiables

- **The research contract is authoritative.** `contracts/v1/` is vendored verbatim from `Pick-Your-AI/pick-your-ai-research` at the SHA in `contracts/PROVENANCE.json`. Never edit it by hand. Re-vendor with `npm run contracts:update -- --ref <sha>`; propose contract changes through research issue #40.
- **Use canonical identifiers.** Component kinds, tiers, outcome states (`pass`/`fail`/`unknown`/`skipped`), and severities (`info`/`warning`/`error`) come from the contract. Do not invent new enums or a separate compatibility policy; evaluation consumes `baseline/core-dependency-graph.json` and `baseline/core-ruleset.json`.
- **Generated types are generated.** `src/contracts/generated/` is produced by `npm run contracts:types`. Do not edit it; CI fails if it drifts.
- **No fabricated facts.** Fixtures are synthetic and must be labelled as such in the UI. Never present invented prices, benchmarks, citations, vendor names, or compatibility verdicts as real.
- **Unknown is not pass.** Missing information must surface as `unknown`, never as compatible.
- **Static only.** The host has no Node runtime. `npm run build` must produce a fully static `dist/` (see `docs/ARCHITECTURE.md` and the build contract in `docs/DEPLOYMENT_CONTRACT.md`).
- **Accessibility.** Target WCAG 2.2 AA. Never convey status with colour alone.
- **No secrets.** Never commit credentials, `.env` files with values, or private build content.

## Ownership

Operations files — `public/.htaccess`, `.github/workflows/deploy-production.yml` and any workflow other than `ci.yml`, `scripts/deploy/**`, `tests/e2e-live/**`, `docs/operations/**`, `docs/research/pcpartpicker-*` — are owned by the operations workstream. Request changes rather than editing them directly.

## Before you open a PR

```sh
npm ci
npm run format:check && npm run lint && npm run typecheck
npm run contracts:verify
npm test
npm run build && npm run test:e2e
npm run audit
```

Work on a `feat/…`, `fix/…`, `docs/…`, or `ci/…` branch. Merge only through a PR with the `ci-required` check green.
