# Build contract (producer side)

This is the interface between the site build (this repository's `ci.yml`, owned by the site workstream) and the production deploy workflow (`deploy-production.yml`, owned by operations). The deploy runbook lives in `docs/operations/`.

## Inputs

| Variable            | Default                                 | Meaning                                                                               |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| `PYAI_COMMIT_SHA`   | `GITHUB_SHA`, then `git rev-parse HEAD` | Commit stamped into `version.json`                                                    |
| `VITE_DATA_MODE`    | `fixture`                               | `fixture` (synthetic data) or `http` (contract API). Any other value fails the build. |
| `VITE_API_BASE_URL` | empty                                   | Contract API base URL, used only in `http` mode                                       |

## Output: `dist/`

- `index.html` — SPA entry. All client routes are history-API routes and need an Apache fallback to `/index.html`.
- `version.json`:

  ```json
  {
    "commit": "<full sha>",
    "builtAt": "<ISO-8601>",
    "contractVersion": "1.0.0",
    "contractSourceSha": "<research repo sha>",
    "dataMode": "fixture"
  }
  ```

  `contractVersion` and `contractSourceSha` come from `contracts/PROVENANCE.json`. The footer shows the short commit SHA and data mode from the same object.

- `assets/*` — content-hashed JS, CSS, and images (safe to cache immutably).
- `organization/` — present **only** when a reviewed `.github` bundle is admitted in `contracts/organization/PIN.json`, and then byte-identical to the pinned hashes (static `index.html`, `directory.js`, `organization.json`, `.mmd`/`.svg`/`.png` chart triples). `check-dist.mjs` fails if it is present without an admitted pin, absent with one, or differs by a byte. The complete canonical bundle is served together, `README.md` included. A changed bundle is a new website commit; `version.json` is unchanged in shape. Byte identity of the served `/organization/` HTML is part of live verification, so host-injected content in HTML responses fails it by design (operations owns that hosting action). Host needs (path-scoped CSP, `.mmd` MIME, live verification) are listed in `ORGANIZATION_DIRECTORY.md` and belong to operations.
- Other files copied from `public/` (favicon, `theme-init.js`, images, and the operations-owned `.htaccess`). These are not hashed and should be served with revalidation.

`node scripts/check-dist.mjs` verifies these properties; CI runs it after every build.

## CI

Workflow `CI` (`.github/workflows/ci.yml`) runs on `pull_request`, `push` to any branch, and `workflow_call`. Jobs:

| Job                 | Checks                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `quality`           | `format:check`, `lint`, `typecheck`, `contracts:verify --upstream`, `organization:verify --upstream`, generated types are current |
| `unit`              | `npm test` (Vitest)                                                                                                               |
| `build`             | `npm run build` with `PYAI_COMMIT_SHA=${{ github.sha }}`, `check-dist.mjs`, upload artifact **`site-dist`**                       |
| `e2e`               | Playwright smoke + axe against `vite preview` of the `site-dist` artifact                                                         |
| `audit`             | `npm run audit`                                                                                                                   |
| `dependency-review` | PRs only                                                                                                                          |
| **`ci-required`**   | Aggregate; fails unless every job above succeeded (dependency review may be skipped outside PRs)                                  |

The deploy workflow calls `CI` with `uses: ./.github/workflows/ci.yml`, then downloads `site-dist` from the same run.
