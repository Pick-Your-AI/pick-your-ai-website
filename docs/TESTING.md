# Testing strategy

| Layer                                | Tool                                       | Location                                             | What it proves                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract                             | Vitest + generated Ajv validators          | `tests/unit/contracts.test.ts`                       | Upstream examples, baseline graph (59 edges) and ruleset (45 rules) validate; malformed payloads are rejected; the synthetic catalog validates, covers all 29 kinds, is tagged synthetic, and its references resolve                                                                                                                           |
| Contract integrity                   | `scripts/contracts.mjs verify --upstream`  | CI `quality` job                                     | The vendored bytes equal upstream at the pinned SHA; the frozen baseline matches `UPSTREAM_SHA256SUMS`                                                                                                                                                                                                                                         |
| Generated code                       | `contracts:types` + `git diff --exit-code` | CI `quality` job                                     | Types and validators are current                                                                                                                                                                                                                                                                                                               |
| Policy parity                        | Vitest + Python `reference/evaluate.py`    | `tests/unit/evaluator-parity.test.ts`                | The TS evaluator reproduces `examples/evaluation-report.json` exactly and equals the Python reference on 7 scenarios. The Python part is skipped only when no Python 3 is installed; CI always has it                                                                                                                                          |
| Domain scenarios (MASTER_PROMPT §11) | Vitest                                     | `tests/unit/scenarios.test.ts`                       | Optional workstreams, contradictory selections, unknown compatibility, cross-tier and bidirectional invalidation, stale evidence after revisions, missing prices, unknown billing, currency mismatch, stale catalog, version drift, revisions and history, import/export and share fragments, rejection of malformed or secret-bearing imports |
| Data layer                           | Vitest with an in-memory fake API          | `tests/unit/providers.test.ts`                       | Fixture and HTTP providers return equal results; config selection; malformed JSON, schema-invalid payloads, wrong-revision responses, network failure with retry, HTTP 500/404, 409 conflicts; local repository CAS and corrupt-record handling                                                                                                |
| Browser smoke + a11y                 | Playwright + axe                           | `tests/e2e/smoke.spec.ts`                            | Every route renders an h1, the demo banner and the build SHA, with no page errors and no axe violations, on desktop 1440 px and Pixel 7. Flows covered: starter → mode switch → fail + invalidation → export → persistence → dark mode; selection buckets; share-link round trip; mobile cards                                                 |
| Build contract                       | `scripts/check-dist.mjs`                   | CI `build` job                                       | `version.json` shape and commit, hashed assets                                                                                                                                                                                                                                                                                                 |
| Dependencies                         | `npm audit`, dependency review             | CI `audit`, `dependency-review`                      | No high-severity production vulnerabilities                                                                                                                                                                                                                                                                                                    |
| Live site                            | Operations                                 | `tests/e2e-live/**`, `scripts/deploy/verify-live.sh` | Owned by operations                                                                                                                                                                                                                                                                                                                            |

Run locally:

```sh
npm run format:check && npm run lint && npm run typecheck
npm run contracts:verify
npm test
npm run build && npm run test:e2e
npm run audit
```

Not yet automated: visual regression snapshots and Lighthouse budgets.

Manual Lighthouse 12 run on 2026-10-16 against `vite preview` (headless Chromium, mobile emulation with default throttling):

| Route            | Performance | Accessibility | Best practices | SEO                         | LCP   | CLS   |
| ---------------- | ----------- | ------------- | -------------- | --------------------------- | ----- | ----- |
| `/`              | 95          | 100           | 100            | 92 → 100 after `robots.txt` | 2.6 s | 0     |
| `/builder`       | 93          | 100           | 100            | 100                         | 2.8 s | 0.005 |
| `/catalog/model` | 95          | 100           | 100            | 100                         | 2.6 s | 0.042 |

The first builder run measured CLS 0.385, caused by the content swap after loading. Reserving viewport height for `main` fixed it.
