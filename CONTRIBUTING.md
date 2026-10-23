# Contributing to pickyour.ai

## Setup

Requirements: Node 22 LTS or newer, npm, git.

```sh
npm ci
npx playwright install chromium   # once, for end-to-end tests
npm run dev                        # http://localhost:5173
```

Copy `.env.example` to `.env.local` to change the data provider (`VITE_DATA_MODE=fixture|http`).

## Workflow

1. Open or pick an issue. Implementation issues link their research counterpart in `Pick-Your-AI/pick-your-ai-research`; do not duplicate research issues here.
2. Branch from `main`. Maintainers use `feat/…`, `fix/…`, `docs/…` or `ci/…`; early contributors use `contrib/<your-login>/<topic>`; other contributors work from a fork.
3. Keep changes small. Follow the existing code style; Prettier and ESLint are enforced.
4. Run the checks listed in `AGENTS.md`.
5. Open a PR using the template. Fill in traceability (research issues, contract dependencies, acceptance criteria, tests, unknowns).
6. `main` is protected: merging requires one approval from someone other than the author and the `ci-required` check, and only maintainers merge. Every merge to `main` deploys to production automatically.

The [organization contributing rules](https://github.com/Pick-Your-AI/.github/blob/main/CONTRIBUTING.md) define roles, credentials and enforcement.

## Access and roles

Access is granted through the Pick-Your-AI GitHub teams. The model below was reported in [PR #317](https://github.com/Pick-Your-AI/pick-your-ai-website/pull/317) on 2026-10-19; current GitHub team and repository settings govern installed permissions. Parent teams under `Maintainers` get Triage; push access is held by the child teams listed below.

| Role                                           | Who                                                    | Access to this repository                               |
| ---------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| Lead Maintainers (`Lead Maintainers` team)     | @CompleteDotTech, @BunsDev                             | Admin                                                   |
| Site team (`pickyour.ai` for this repository)  | @CompleteDotTech, @karutoil, @BunsDev, @pushingsquares | Write                                                   |
| `Websites` parent team                         | Members of the child teams above                       | Triage                                                  |
| Early contributors (`early-contributors` team) | Members of the `early-contributors` team               | Write, on branches named `contrib/<your-login>/<topic>` |
| Other contributors                             | Anyone else                                            | Fork and pull request                                   |

For team-membership requests, contact the Lead Maintainers (@CompleteDotTech and @BunsDev). Organization administrators retain the authority described in the organization contributing rules. Team membership grants access but does not waive the review and CI requirements above.

## npm scripts

| Script                    | Purpose                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| `dev`                     | Vite dev server                                                                |
| `build`                   | Type-check and build the static site into `dist/` (writes `dist/version.json`) |
| `preview`                 | Serve `dist/` on port 4317                                                     |
| `format` / `format:check` | Prettier                                                                       |
| `lint`                    | ESLint (zero warnings)                                                         |
| `typecheck`               | `tsc -b` in strict mode                                                        |
| `contracts:verify`        | Check vendored contract hashes (`-- --upstream` also compares with GitHub)     |
| `contracts:update`        | Re-vendor `contracts/v1` (`-- --ref <sha>`)                                    |
| `contracts:types`         | Regenerate TypeScript types from the JSON Schemas                              |
| `test`                    | Vitest unit and integration tests                                              |
| `test:e2e`                | Playwright smoke and axe accessibility tests against `vite preview`            |
| `audit`                   | `npm audit` for production dependencies (high and above)                       |

## Changing the contract

The contract is owned by the research repository. To adopt a new upstream version:

1. Get the change merged upstream (governed by research issue #40).
2. `npm run contracts:update -- --ref <new sha>` then `npm run contracts:types`.
3. Fix any type errors and fixture validation failures, update `CHANGELOG.md`, and open a PR.

See `docs/DATA_INTEGRATION.md` for the full process.

## Toolchain major upgrades

[Issue #20](https://github.com/Pick-Your-AI/pickyour.ai/issues/20) tracks deliberate evaluation of major toolchain upgrades. The earlier Dependabot PRs [#3](https://github.com/Pick-Your-AI/pickyour.ai/pull/3), [#4](https://github.com/Pick-Your-AI/pickyour.ai/pull/4), [#5](https://github.com/Pick-Your-AI/pickyour.ai/pull/5) and [#6](https://github.com/Pick-Your-AI/pickyour.ai/pull/6) were closed because they targeted the pre-bootstrap tree; closing them did not establish upgrade compatibility. [PR #28](https://github.com/Pick-Your-AI/pickyour.ai/pull/28) added the current Dependabot major-version ignores for TypeScript, ESLint, `@eslint/js` and `@types/node`. Node types follow the Node 22 runtime baseline.

Before adopting a major, record its migration requirements and compatibility with the actual runtime, TypeScript/ESLint configuration, plugins and generated contract tooling. Test the proposed lockfile with the full `AGENTS.md` checks, document failures or deferral reasons in #20, and submit a focused PR. The ignore rules are a deferral mechanism, not evidence that the evaluation is complete.

## Commit messages

Use imperative, conventional-style subjects (`feat: …`, `fix: …`, `docs: …`, `ci: …`, `chore: …`).
