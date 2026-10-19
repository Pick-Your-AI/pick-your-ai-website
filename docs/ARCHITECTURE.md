# Architecture

## Constraints that shaped it

- **Hosting.** GoDaddy cPanel shared hosting runs Apache, PHP and SSH but no Node runtime. The site is therefore a fully static SPA. Apache rewrites client routes to `/index.html` (see `public/.htaccess`, which operations owns). Paths that end in something like a file extension are **not** rewritten, so routes never end in `.xyz` and catalog ids use `~` in place of `.` in URLs.
- **Contract first.** The research contract (`contracts/v1`, v1.0.0) is authoritative for ids, enums, payloads and compatibility policy. See `DATA_INTEGRATION.md`.
- **Honesty.** Data is synthetic until real research lands. Unknown never renders as compatible.

## Stack

Vite 8 · React 19 · TypeScript 6 (strict, `noUncheckedIndexedAccess`) · plain CSS design system (`src/styles/mock.css` + `src/styles/index.css`, no utility framework) · React Router 8 (data router, lazy routes) · TanStack Query 5 · Ajv 8 standalone validators · json-schema-to-typescript · Vitest + Testing Library · Playwright + axe-core.

## Layers

| Layer             | Path                                                     | Responsibility                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Presentation      | `src/pages`, `src/features/*`, `src/components`          | Pages, builder UI, catalog UI, primitives (`status.tsx`, `feedback.tsx`, `layout.tsx`, `icon.tsx`) and the view helpers `lib/layers.ts`, `lib/item-cost.ts`, `lib/compat.ts`          |
| Application       | `src/app`                                                | Routing, `BuilderProvider` (current draft, commit, persistence, invalidation), TanStack Query hooks keyed by build id and revision                                                    |
| Domain / contract | `src/contracts`, `src/domain`                            | Generated types and validators, registry, baseline graph and ruleset, evaluator (port of `reference/evaluate.py`), activation, invalidation, build operations, cost, freshness, share |
| Data access       | `src/data`                                               | Provider interfaces (`types.ts`), HTTP client and providers, local build repository, configuration (`config.ts`), `DataError`                                                         |
| Fixtures          | `src/data/fixture`                                       | Synthetic catalog, pricebook, starter stacks, fixture providers                                                                                                                       |
| Infrastructure    | `scripts/`, `.github/workflows/ci.yml`, `vite.config.ts` | Contract vendoring and verification, type generation, `version.json`, CI                                                                                                              |

The presentation layer imports provider _interfaces_ only, through `useData()`. Switching `VITE_DATA_MODE` swaps implementations without touching any page.

## Data flow for a change

```text
user action (Add / Replace / Configure / Remove / Objectives)
  → BuilderProvider.apply(change, summary, changedKinds)
      commit(): new immutable BuildSnapshot (revision + 1), history kept (last 50)
      affectedByChange(graph, changedKinds, ctx before, ctx after)  → "re-checked" notices
      BuildRepository.save(draft, expectedRevision)  (compare-and-swap; 409 on stale writer)
  → React re-render with the new revision
      useBuildAnalysis(build):
        ['cost', id, rev]       PricingProvider.estimate
        ['resources', id, rev]  ResourceEstimateProvider.estimate
        ['evaluation', id, rev, costId, resourceId] CompatibilityEvaluator.evaluate(build, {cost, resources})
      prior-evaluation metadata is labelled stale; findings, verdicts, counts and readiness await the current report
  → current-report aria-live announcement: "Revision N evaluated: X failing, Y unknown"
```

Build-derived results are keyed by `(build id, revision)`, and evaluation also includes the admitted immutable cost and resource evidence IDs. Late or replacement evidence triggers reevaluation. The query layer excludes evidence from another build or revision and marks previous reports as stale. The builder withholds previous findings, summary outcomes, counts, readiness and screen-reader announcements until the current report is available.

## Contracts and versioning

- `contracts/v1/**` is vendored byte-for-byte from `pick-your-ai-research@<sha>`. `contracts/PROVENANCE.json` holds per-file SHA-256 hashes. `npm run contracts:verify [-- --upstream]` checks for local edits, checks the frozen baseline against upstream `UPSTREAM_SHA256SUMS`, and (in CI) checks byte-identity with GitHub at the pinned SHA.
- `npm run contracts:types` generates `src/contracts/generated/contract-types.ts` (types plus per-kind `CatalogSpecMap`/`SelectionSettingsMap`) and `validators.js` (ahead-of-time Ajv, no `eval`, so the CSP stays `script-src 'self'`). The validators load as a lazy chunk, and providers await `validatorsReady`.
- Build snapshots carry `schema_version` 1.0.0 and lock the catalog snapshot, ruleset version, graph revision and pricebook.

## Compatibility integration boundary

The website does **not** own compatibility policy. `src/domain/evaluator.ts` interprets the published `Ruleset` using the contract's three-valued semantics, and `tests/unit/evaluator-parity.test.ts` proves it matches the research reference interpreter: it reproduces `examples/evaluation-report.json` and matches `evaluate.py` output on 7 scenarios, running Python in CI. In `http` mode the API's `POST /builds/{id}/evaluate` result is used instead. The website adds only presentation: lettering, grouping, wording, and "compatible-options" buckets, which run the same ruleset on hypothetical substitutions.

## State management

- **Server/data state** lives in TanStack Query. Catalog, graph, ruleset and pricebook use `staleTime: Infinity` because they are immutable. Build-derived queries are keyed by revision.
- **Current draft** lives in `BuilderProvider` (React state). The `pyai.currentBuildId` key points at the draft in `LocalBuildRepository` (`pyai.build.<id>`, `pyai.builds.index`).
- **URL state** holds selection-page filters, sort, compatibility bucket and compare list (query string), compare targets (`?ids=`, `?builds=`, `?revisions=`) and share payloads (`/shared#b1.<base64url>`, never sent to the server).
- **Theme** uses `pyai.theme`, applied before first paint by `public/theme-init.js`.

## Routes (sitemap)

`/` · `/builder` · `/catalog` · `/catalog/:kind` · `/catalog/:kind/:item` · `/compare` · `/summary` · `/builds` · `/shared` · `/methodology` · `/about` · `/legal` · `*` (404). All routes are lazy-loaded.

## Build output

`npm run build` runs `tsc -b`, then `vite build`, writing `dist/` with `index.html`, hashed `assets/*`, `version.json` (`commit`, `builtAt`, `contractVersion`, `contractSourceSha`, `dataMode`) and the `public/` files. `scripts/check-dist.mjs` enforces the contract in `DEPLOYMENT_CONTRACT.md`.

## Environment variables

See `DATA_INTEGRATION.md` §3 (`VITE_*`) and `DEPLOYMENT_CONTRACT.md` (`PYAI_COMMIT_SHA`). Secrets are never read by the build.

## Local development

```sh
npm ci
npm run dev                 # http://localhost:5173 (fixture mode)
npm test                    # unit + integration (Python 3 on PATH enables evaluator parity)
npm run build && npm run test:e2e   # preview on :4317 + Playwright/axe
```

## Security notes

The site uses no inline scripts and no `eval`, has no third-party origins, keeps credentials out of the client, and renders imported files as data and never as HTML. Settings named `credential_ref` must match the contract's `secret://` pattern, and the form rejects pasted credentials. See `SECURITY.md`.
