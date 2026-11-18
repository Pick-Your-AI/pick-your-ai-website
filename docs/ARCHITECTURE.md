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
| Application       | `src/app`                                                | Routing, `BuilderProvider` (current draft, save queue, current selection, removal and invalidation), TanStack Query hooks keyed by complete build snapshot content                    |
| Domain / contract | `src/contracts`, `src/domain`                            | Generated types and validators, registry, baseline graph and ruleset, evaluator (port of `reference/evaluate.py`), activation, invalidation, build operations, cost, freshness, share |
| Data access       | `src/data`                                               | Provider interfaces (`types.ts`), HTTP client and providers, local build repository, configuration (`config.ts`), `DataError`                                                         |
| Fixtures          | `src/data/fixture`                                       | Synthetic catalog, pricebook, starter stacks, fixture providers                                                                                                                       |
| Infrastructure    | `scripts/`, `.github/workflows/ci.yml`, `vite.config.ts` | Contract vendoring and verification, type generation, `version.json`, CI                                                                                                              |

The presentation layer imports provider _interfaces_ only, through `useData()`. Switching `VITE_DATA_MODE` swaps implementations without touching any page.

The builder route includes a small loading shell in the initial bundle so its heading can paint before the editor, forms and schema metadata load. The editor remains lazy-loaded behind Suspense, and the same shell covers pending build data. Its parts-list styles load with the shell; other page content remains route-split.

## Data flow for a change

1. A user action calls `BuilderProvider.apply(change, summary, changedKinds)`. The
   dependency graph determines the affected kinds and the re-check notices.
2. Local storage can retain incomplete drafts. HTTP storage requires a complete,
   schema-valid `BuildSnapshot` before queueing it. Incomplete initial edits stay
   at revision 1; an invalid later successor remains at the next staged revision
   until corrected. Valid queued snapshots are immutable, and the saved history
   remains bounded to the last 50 revisions.
3. The save queue submits each valid snapshot after its predecessor is acknowledged,
   using that acknowledged revision for compare-and-swap. A failed attempted write
   stays ahead of dependent writes; a conflict requires recovery rather than an
   unconditional overwrite.
4. `useBuildAnalysis` and compatible-options hooks use `buildQueryKey`: build ID,
   revision and canonical JSON snapshot content. Evaluation also includes the
   admitted cost and resource evidence content. The canonical serializer uses an
   explicit stack for deeply nested accepted JSON. Different staged/imported
   snapshots cannot share findings just by declaring the same ID and revision.
5. An HTTP acknowledgement resets queries for that exact saved snapshot, including
   catalog compatibility and comparison analysis. Reset cancels pre-save reads
   before refetching, so a late missing-build response cannot leave the saved
   snapshot stuck. Other snapshots retain their independent query state.

The query layer excludes foreign, placeholder and failed-refresh evidence from
current results. The builder withholds previous findings, summary outcomes,
counts, readiness and screen-reader announcements until the report is current.
Its live announcement then identifies the evaluated revision and result counts.
Client query identity does not change the server's ID/revision wire protocol.

## Contracts and versioning

- `contracts/v1/**` is vendored byte-for-byte from `pick-your-ai-research@<sha>`. `contracts/PROVENANCE.json` holds per-file SHA-256 hashes. `npm run contracts:verify [-- --upstream]` checks for local edits, checks the frozen baseline against upstream `UPSTREAM_SHA256SUMS`, and (in CI) checks byte-identity with GitHub at the pinned SHA.
- `npm run contracts:types` generates `src/contracts/generated/contract-types.ts` (types plus per-kind `CatalogSpecMap`/`SelectionSettingsMap`) and `validators.js` (ahead-of-time Ajv, no `eval`, so the CSP stays `script-src 'self'`). The validators load as a lazy chunk, and providers await `validatorsReady`.
- Build snapshots carry `schema_version` 1.0.0 and lock the catalog snapshot, ruleset version, graph revision and pricebook.

## Compatibility integration boundary

The website does **not** own compatibility policy. `src/domain/evaluator.ts` interprets the published `Ruleset` using the contract's three-valued semantics, and `tests/unit/evaluator-parity.test.ts` proves it matches the research reference interpreter: it reproduces `examples/evaluation-report.json` and matches `evaluate.py` output on 7 scenarios, running Python in CI. In `http` mode the API's `POST /builds/{id}/evaluate` result is used instead. The website adds only presentation: lettering, grouping, wording, and "compatible-options" buckets, which run the same ruleset on hypothetical substitutions.

## State management

- **Server/data state** lives in TanStack Query. Catalog, graph, ruleset and pricebook use `staleTime: Infinity` because they are immutable. Build-derived queries include complete snapshot content.
- **Current draft** lives in `BuilderProvider` (React state). `pyai.currentBuildId` remembers a successfully saved or explicitly opened build. Activating an unsaved new draft clears that pointer; a failed HTTP create does not silently select the previous build on reload. Local records and the HTTP browser index use `pyai.build.<id>` and `pyai.builds.index`. HTTP GET does not write that index.
- **Removal** is coordinated by `BuilderProvider.remove`. A successful removal clears only the matching remembered identity, retires that build's older pending save queue and pending opens, while preserving a newer explicit start/open and its ability to save. If a newer pending open fails, the removed current build is replaced with a fresh draft. The fallback yields to a newer completed open. HTTP removal forgets the browser entry only: v1 has no DELETE endpoint. Within one `HttpBuildRepository` instance, per-build cache serialization and removal generations prevent pre-removal acknowledgements from recreating the forgotten entry. A later explicit save may index it again. This does not promise cross-process localStorage transactions or server-side deletion/retention.
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
