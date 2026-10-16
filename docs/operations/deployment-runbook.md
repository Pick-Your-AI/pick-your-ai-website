# GoDaddy deployment runbook

## What triggers a deploy

| Trigger | Result |
|---|---|
| Push to `main` (every merged PR) | CI → build → deploy → verify. Fully automatic. |
| `workflow_dispatch` on `main`, `rollback_to` empty | Redeploys the current `main` commit (CI runs again first). |
| `workflow_dispatch` on `main`, `rollback_to=<sha>` | Re-activates a retained release, then verifies it. No build. See [backup-and-rollback.md](backup-and-rollback.md). |
| PRs, feature branches, dispatch on any other ref | Never deploy. The `deploy` and `rollback` jobs require `refs/heads/main`, and the `production` environment only admits `main`. |

## Workflow: `.github/workflows/deploy-production.yml`

1. **`ci`**: calls `./.github/workflows/ci.yml` (`workflow_call`) for the same commit. This runs every check job, the aggregate `ci-required`, and uploads `site-dist` built with `PYAI_COMMIT_SHA=${{ github.sha }}`.
2. **`deploy`**: runs only if `ci` succeeded. It uses `environment: production` and concurrency group `production` (`cancel-in-progress: false`), so deploys queue and never overlap.
   1. Check out the exact `github.sha` (for `scripts/deploy/`).
   2. Download `site-dist` and assert that `version.json.commit == github.sha`.
   3. `scripts/deploy/setup-ssh.sh` writes the key and pinned host keys from secrets, defines the `pyai-prod` alias, and tests login. Nothing is echoed.
   4. Upload. `remote-release.sh prepare <sha>` seeds `~/pickyour-releases/.incoming-<sha>` from the live release. `rsync --delete` from `dist/` then sends only what changed, and `finalize` renames the directory to `~/pickyour-releases/<sha>`.
   5. `validate <sha>` checks for `index.html`, `.htaccess`, `assets/*.js`, that every `/assets/...` referenced by `index.html` is present, and that `version.json` is stamped with this SHA.
   6. `activate <sha>`:
      - takes a host-side `flock` (a second safety net beside the GitHub concurrency group)
      - records what is live in `.state/restore`
      - tars the docroot to `~/pickyour-releases/backups/`
      - runs `rsync -rlt --delete-delay --delay-updates --exclude=/.well-known --exclude=/cgi-bin` into the docroot
   7. `scripts/deploy/verify-live.sh <sha>` checks through Cloudflare:
      - the cache-busted `version.json` commit, retried for up to about 60 s
      - `/` returns 200 HTML with `no-cache` and the security headers
      - every referenced asset returns 200 and is immutable
      - SPA deep links return 200, a missing asset returns 404
      - http→https and www→apex redirects
      - `/.well-known` is not rewritten
   8. On any failure after activation started, `restore` puts back what was live before. On a first-ever deploy that means the empty docroot.
   9. `prune 5` keeps the five newest releases, plus whatever is current or previous.
   10. The job summary prints the host state (`status`).
3. GitHub records a **deployment** in the `production` environment, with the environment URL and a link to the job log.
4. **E2E live** (`.github/workflows/e2e-live.yml`) runs after every successful deploy. It runs Playwright against production at 1440, 1024, 768 and 375 widths, and also daily at 06:17 UTC.

## Reading a deploy

- Actions → **Deploy production** → run → **deploy** job → *Summary*. This shows the commit, the activate and verify outcomes, and the host `status`.
- Environments → **production** shows the deployment history: one entry per run, with a status and a log link.
- Live check: `curl -s "https://pickyour.ai/version.json?x=$RANDOM"`. The footer shows `Build <short sha> · Data mode: …`.

## Host layout

```
~/public_html/pickyour.ai/          live docroot (addon domain). Contains the active release plus
  .well-known/  cgi-bin/            ← preserved, never written by deploys (AutoSSL uses .well-known)
~/pickyour-releases/
  <sha>/                            one directory per release (immutable after finalize)
  .incoming-<sha>/                  staging (removed by finalize/prune)
  .state/current|previous|restore   active sha, the sha before it, sha live when last activation began
  .state/log                        append-only activation/restore/prune log (UTC)
  backups/docroot-<UTC>.tgz         docroot snapshot before each activation (newest 5)
  .lock                             flock target
```

Nothing outside these two paths is touched. The parent `public_html` belongs to a separate site.

## Manual operations (operator with SSH access)

All commands are idempotent and run the same script as CI:

```bash
ssh dpc-godaddy 'bash -s' -- status   < scripts/deploy/remote-release.sh
ssh dpc-godaddy 'bash -s' -- validate <sha> < scripts/deploy/remote-release.sh
ssh dpc-godaddy 'bash -s' -- activate <sha> < scripts/deploy/remote-release.sh   # prefer the workflow
ssh dpc-godaddy 'bash -s' -- restore  < scripts/deploy/remote-release.sh
bash scripts/deploy/verify-live.sh <sha> https://pickyour.ai
```

Prefer the `workflow_dispatch` rollback over manual `activate`, so GitHub records the deployment.

## Verified evidence (2026-10-16)

| Event | Run | Result |
|---|---|---|
| First deploy (PR #7 merge, `48adb24`) | [38921731368](https://github.com/Pick-Your-AI/pickyour.ai/actions/runs/38921731368) | Failed at activate (`/dev/fd` missing on CageFS) before the docroot was touched. Fixed in PR #8. |
| First successful deploy (`3d5e31a`) | [38922375883](https://github.com/Pick-Your-AI/pickyour.ai/actions/runs/38922375883) | Live and verified |
| Site feature merge (`5d6994c`) | [38922927614](https://github.com/Pick-Your-AI/pickyour.ai/actions/runs/38922927614) | Auto-deployed |
| Failing CI cannot deploy (PR #11, never merged) | [38922994526](https://github.com/Pick-Your-AI/pickyour.ai/actions/runs/38922994526) | `ci-required` failed, `deploy` skipped, PR merge blocked by ruleset |
| Rollback to `3d5e31a` | [38923312356](https://github.com/Pick-Your-AI/pickyour.ai/actions/runs/38923312356) | Live SHA = `3d5e31a`, verified |
| Roll forward to `5d6994c` | [38923391828](https://github.com/Pick-Your-AI/pickyour.ai/actions/runs/38923391828) | Live SHA = `5d6994c`, verified |
| E2E live PR #10 merge (`64a8138`) | [38923495443](https://github.com/Pick-Your-AI/pickyour.ai/actions/runs/38923495443), E2E [38923722136](https://github.com/Pick-Your-AI/pickyour.ai/actions/runs/38923722136) | Deployed; 32/32 live checks |
