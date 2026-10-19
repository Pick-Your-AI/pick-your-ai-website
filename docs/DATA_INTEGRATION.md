# Data integration: from research artifacts to production data

This explains how real research output replaces the synthetic fixtures without rewriting the UI.

GitHub status reconciled with a **2026-10-19 09:15 UTC cutoff**, alongside research [`9db556b7fca485c8eb4396f9ee2ceeacdc119d79`](https://github.com/Pick-Your-AI/pick-your-ai-research/commit/9db556b7fca485c8eb4396f9ee2ceeacdc119d79); see `RESEARCH_MAPPING.md` for the dated merge/closure inventory and final #39–#42 research completion receipts. Completed research does not publish production data or implement the receiving website features. The website remains on contract **1.0.0**, pinned at `d4bdca479f78439b3b98e7418b37acbaccbaa63c`, with synthetic fixtures and unavailable resource estimates.

The acceptance gates in [website #15](https://github.com/Pick-Your-AI/pickyour.ai/issues/15), [#16](https://github.com/Pick-Your-AI/pickyour.ai/issues/16), [#17](https://github.com/Pick-Your-AI/pickyour.ai/issues/17) and [#18](https://github.com/Pick-Your-AI/pickyour.ai/issues/18) remain in force. This refresh changes documentation only.

## 1. The pipeline

Artifact review is governed by research [#40](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/40), [#41](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/41) and [#39](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/39).

```text
research PR merged on pick-your-ai-research main
   │  (catalog proposals, pricebooks, rules, estimator evidence — reviewed under research #40/#41/#39)
   ▼
published, versioned artifacts
   CatalogSnapshot (catalog.<x>.<rev>)  Pricebook  Ruleset@version  DependencyGraph@rev  ResourceEstimate
   ▼
served by the contract API  (contracts/v1/api/openapi.yaml, base /v1)    ← static JSON can serve immutable GET artifacts only
   ▼
website HTTP providers  (src/data/http/providers.ts)
   every response → JSON Schema validation (generated Ajv validators) → typed contract object
   malformed / failed → DataError(kind) → explicit UI error state, never silently used
   ▼
presentation layer (unchanged)
```

The website never edits research data. It reads published, immutable revisions and pins every build to them through `BuildSnapshot.locks` (`catalog_snapshot_id`, `ruleset_id@ruleset_version`, `dependency_graph_id@revision`, `pricebook_id`).

## 2. Provider interfaces (the seam)

`src/data/types.ts` defines everything the UI may use:

| Interface                  | Fixture implementation                                                                    | HTTP implementation (openapi)                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `CatalogRepository`        | `FixtureCatalogRepository`: demo catalog plus baseline graph and ruleset                  | `GET /catalog/snapshots/{id}`, `GET /dependencies/{id}`, `GET /rulesets/{id}?version=`                                            |
| `BuildRepository`          | `LocalBuildRepository`: `localStorage` with compare-and-swap                              | `POST /builds`, `GET /builds/{id}`, `PUT /builds/{id}` with `If-Match` and `Idempotency-Key` (opt-in via `VITE_BUILD_STORE=http`) |
| `CompatibilityEvaluator`   | `LocalCompatibilityEvaluator`: port of `reference/evaluate.py` over the published ruleset | `POST /builds/{id}/evaluate`, `GET /builds/{id}/compatible-options`                                                               |
| `PricingProvider`          | `FixturePricingProvider`: preview estimator over the synthetic pricebook                  | `GET /pricebooks/{id}`, `POST /builds/{id}/estimate-cost`                                                                         |
| `EvidenceProvider`         | Derived from item `provenance`                                                            | Same, since v1 has no evidence endpoint                                                                                           |
| `ResourceEstimateProvider` | Unavailable, so VRAM rules report **Unknown**                                             | Unavailable, since v1 has no read endpoint (see gaps)                                                                             |

The HTTP providers also check revision scoping: an evaluation or quote for a different `build_revision` is rejected as malformed.

## 3. Configuration and feature flags

Set these at build time (Vite `VITE_*` variables, baked into the static bundle):

| Variable                | Values              | Default    | Notes                                                                                                    |
| ----------------------- | ------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `VITE_DATA_MODE`        | `fixture` \| `http` | `fixture`  | Any other value fails the build (`scripts/version-plugin.ts`) and shows a configuration error at runtime |
| `VITE_API_BASE_URL`     | URL ending in `/v1` | —          | Required in `http` mode                                                                                  |
| `VITE_CATALOG_SNAPSHOT` | snapshot id         | —          | Required in `http` mode, because v1 has no "current snapshot" endpoint                                   |
| `VITE_PRICEBOOK_ID`     | pricebook id        | build lock | Optional                                                                                                 |
| `VITE_BUILD_STORE`      | `local` \| `http`   | `local`    | Store builds on the API instead of in the browser                                                        |

`dist/version.json` records `dataMode`, and the footer shows it. In `http` mode the demo banner disappears, but synthetic tags on any item still render.

**Hosting change required for `http` mode.** The production CSP is `connect-src 'self'`. Pointing at an API on another origin needs that origin added to `public/.htaccess`, which operations owns. Alternatively, serve the API under the same origin, for example `https://pickyour.ai/v1`.

## 4. Real-data integration checklist

1. ☐ The specific research artifacts to adopt are merged on research `main`, with required owner decisions recorded. Unmerged PRs stay provisional; a merge alone does not satisfy the remaining gates.
2. ☐ If the contract changed (via [#40](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/40)): `npm run contracts:update -- --ref <sha>`, then `npm run contracts:types`, fix any type errors, and confirm `npm test` passes, including evaluator parity against the new `reference/evaluate.py`.
3. ☐ Publish immutable artifacts behind the API (or a static mirror for GET paths). Evaluation, cost estimates and remote build writes still need the corresponding dynamic API endpoints; a static mirror alone cannot supply the full HTTP provider.
4. ☐ Validate offline: fetch each artifact and check it with `validateContract` (as `tests/unit/contracts.test.ts` does). Reject anything with fabricated fields.
5. ☐ In the `build` job of `.github/workflows/ci.yml`, change `VITE_DATA_MODE: fixture` to `http` and add `VITE_API_BASE_URL` and `VITE_CATALOG_SNAPSHOT`. Use repository variables for these, not secrets: they end up in the public bundle.
6. ☐ Request the CSP `connect-src` change if the API is on another origin.
7. ☐ Run the Playwright suite against `http` mode with a recorded API, as in `tests/unit/providers.test.ts › fakeApi`.
8. ☐ Remove or flag the synthetic `tags` path. Real items must carry `verification_status` and `source_uri` provenance.
9. ☐ Update `docs/RESEARCH_MAPPING.md` and `CHANGELOG.md`.

## 5. Fixture strategy

- `src/data/fixture/catalog.ts` holds 64 fictional items covering all 29 kinds. Each has `tags: ['synthetic']`, provenance `verification_status: "unverified"` with a "SYNTHETIC DEMO FIXTURE" note, and the `demo.*` id prefix.
- `src/data/fixture/pricebook.ts` holds the synthetic rates (`price_type: estimate`, unverified). One is deliberately expired.
- `src/data/fixture/starters.ts` holds four demo starter stacks, labelled "(demo)".
- Fixtures go through the same validators as live responses (`assertContract`), and tests validate them against the schemas.
- The upstream `contracts/v1/examples/*` are used only in tests, as golden references.

## 6. Contract-change workflow

1. Propose the change in the research repo through issue [#40](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/40), with versioning and owner review.
2. After it merges upstream, run `npm run contracts:update -- --ref <new sha>`. This writes `contracts/PROVENANCE.json` with per-file SHA-256 hashes.
3. CI's `contracts:verify --upstream` re-downloads the pinned SHA and fails on any byte difference. It also checks the frozen baseline against `UPSTREAM_SHA256SUMS`.
4. Regenerate the types and validators (`npm run contracts:types`). CI fails if the generated files drift.
5. Adjust the presentation only where new fields or kinds need display.

## 7. Required backend endpoints and known v1 gaps

The endpoints the UI needs all exist in openapi v1, except these gaps. The accepted research in [#40](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/40) supplies decision records; the corresponding versioned release and consumer implementation still have to be delivered:

- No `GET` for the **current** catalog snapshot id, so it is set by configuration today.
- No `GET` for **resource estimates**, so capacity evidence cannot be read and VRAM-fit rules stay Unknown.
- No **list builds** or **delete build** endpoint, so remote builds keep a local index.
- No **evidence** endpoint beyond item provenance.
- No accepted **display-label sidecar** adopted by the website. The shared English sidecar remains a proposal, so the site keeps its own display-only labels.
- Billing meters for egress and training (see PRs [#70](https://github.com/Pick-Your-AI/pick-your-ai-research/pull/70) and [#77](https://github.com/Pick-Your-AI/pick-your-ai-research/pull/77)) are missing, so those costs appear as uncovered warnings.

## 8. Research decisions still requiring integration or owner disposition

- Freshness policy ([#41](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/41)): [merged PR #127](https://github.com/Pick-Your-AI/pick-your-ai-research/pull/127) and its [scoped T4 receipt](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/41#issuecomment-6242626857) adopt no TTL. Pinned facts do not expire by age; hosted current-state facts use capture-date versions and retained snapshots. A newer snapshot alone does not invalidate a build. The website now displays capture dates without age-based freshness claims; the 30-day preview warning at `dc66a9e` is historical. Item revision mismatches, missing items, build schema mismatches and explicit price validity remain separate checks; the completed #39/#41 research and its named implementation follow-ups govern price-specific refresh/invalidation rather than an invented website policy.
- Implement the completed cost research ([#39](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/39)): preserve source currency and explicit budget currency, with no automatic FX or region/account fallback. Applicable quotes and complete priced coverage remain separate evidence requirements. The site's preview estimator is provisional.
- Implement the completed sharing/privacy research from [#42](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/42) under [website #17](https://github.com/Pick-Your-AI/pick-your-ai-website/issues/17). Both #42 and its #40 research prerequisite are completed; the site's share links remain a local-only preview. Their research completion adopts no hosted retention period and supplies no deployed accounts, persistence or authorization service.
- The merged memory record (PR [#72](https://github.com/Pick-Your-AI/pick-your-ai-research/pull/72)) documents capability-evidence gaps in `rule.memory.framework.compatibility`; policy changes still require a reviewed contract version.
- Deployment-mode research ([#3](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/3), received in [#42](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/42)): the [accepted record](https://github.com/Pick-Your-AI/pick-your-ai-research/blob/9db556b7fca485c8eb4396f9ee2ceeacdc119d79/research/T0-configuration/saved-shared-builds.md) classifies components by operator and capacity placement. Any required unresolved component makes the aggregate unknown; otherwise a common mode stays that mode and mixed modes aggregate to hybrid. Encoding and adopting this model require a successor contract and client implementation; the website retains frozen v1 behavior.

The [#40 completion receipt](https://github.com/Pick-Your-AI/pick-your-ai-research/issues/40#issuecomment-6257213742) closes the research criteria, including the receiving map and physical-pool decision. It does not release a successor wire schema, ruleset, reader or migration. Frozen v1 remains unchanged.

The [publication eligibility handoff](https://github.com/Pick-Your-AI/pick-your-ai-research/blob/9db556b7fca485c8eb4396f9ee2ceeacdc119d79/docs/PUBLICATION_ELIGIBILITY_HANDOFF.md) clears no complete existing catalog or pricebook for publication and records the exclusion of GPUs.io API retrieval, display and export from the current product. The [display-label sidecar](https://github.com/Pick-Your-AI/pick-your-ai-research/blob/9db556b7fca485c8eb4396f9ee2ceeacdc119d79/research/T0-configuration/display-labels/README.md) remains proposed and still needs an accepted revision, a decision receipt and consumer import. Neither is supplied by closing the parent research issues.

Before real-data intake, apply the scoped evidence and per-source rights gates in `RESEARCH_MAPPING.md`: source-checked without independent support maps to `unverified`, and new `verified` claims require linked independent support. Missing rights-table rows do not authorize automated collection, display or redistribution. Preserve source dates and selected snapshots; do not silently convert a new catalog revision into expiry of existing build evidence. Neither these receipts nor merged research authorize enabling production providers.
