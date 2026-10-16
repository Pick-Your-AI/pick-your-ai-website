# Release and change procedure

## Normal changes (site or docs)

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…`, `ops/…`).
2. Open a PR. CI runs: format, lint, typecheck, contracts, unit, build, browser smoke and a11y, audit, and dependency review, all summarised by **`ci-required`**.
3. The `main-protection` ruleset requires a PR (0 approvals, so the solo operator can merge), a green `ci-required`, and blocks force pushes and branch deletion. There are **no bypass actors**: nobody, admins included, can merge red.
4. Merge (squash preferred). The push to `main` deploys automatically, and E2E live runs afterwards.
5. Check the result: the deploy run summary, `version.json`, or the footer SHA.

Nothing else is needed. No manual uploads, FTP, or cPanel File Manager edits. Any file edited by hand in the docroot is overwritten or deleted by the next deploy, except `.well-known/` and `cgi-bin/`.

## Changes to the pipeline itself

These files belong to operations:

- `deploy-production.yml`
- `e2e-live.yml`
- `public/.htaccess`
- `scripts/deploy/**`
- `tests/e2e-live/**`
- `docs/operations/**`

Before you open a PR:

- Run `shellcheck scripts/deploy/*.sh`, `actionlint` and `zizmor .github/workflows/`.
- Run `npx prettier --check .github/workflows tests/e2e-live` (the `.htaccess` and these docs are prettier-ignored).
- For `.htaccess` changes, test in a throwaway sub-directory of the docroot first (copy the file there, request it through `--resolve pickyour.ai:443:107.180.118.46`, check for 500s), and then remove the directory. A broken `.htaccess` returns 500 on every path. The deploy's verification catches that and restores the previous release automatically.
- Remember that the host is CloudLinux CageFS:
  - no `/dev/fd`, so no `<(...)` process substitution
  - the account cannot `chgrp` to `nobody`
  - `rsync` must not use `-a`/`-p`/`-g` against the docroot (`-rlt` only)

Keep actions pinned to full commit SHAs, and keep permissions at `contents: read`.

## Changing a security header or the CSP

The site workstream asks in the coordination `HANDOFF.md`. Operations changes `public/.htaccess` in a PR, and the merge deploys it. `verify-live.sh` and the E2E live suite assert that the headers are present.

## Emergency

- A bad release is live: roll back first (see [backup-and-rollback.md](backup-and-rollback.md)), then fix forward through a PR.
- The deploy pipeline itself is broken: the last good release stays live, because verification failure restores it. Fix it through a PR. Do not disable the ruleset.
