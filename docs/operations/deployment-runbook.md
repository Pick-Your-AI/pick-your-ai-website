# GoDaddy deployment runbook

## What triggers a deploy

| Trigger | Result |
|---|---|
| Push to `main` (every merged PR) | CI → build → deploy → verify. Fully automatic. |
| `workflow_dispatch` on `main`, `rollback_to` empty | Redeploys the current `main` commit (CI runs again first). |
| `workflow_dispatch` on `main`, `rollback_to=<sha>` | Re-activates a retained release, then verifies it. No build. See [backup-and-rollback.md](backup-and-rollback.md). |
| Dispatch or re-run by someone not in `DEPLOY_DISPATCHERS` | Never deploys or rolls back. Only a merge to `main`, run as the merging user, deploys without the allowlist. |
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
4. **E2E live** (`.github/workflows/e2e-live.yml`) admits each successful deployment event before browser setup. A current release runs Playwright against production at 1440, 1024, 768 and 375 widths; an already superseded event requires the evidence described below. The suite also runs daily at 06:17 UTC.

## Admission of delayed deployment events

[Issue #318](https://github.com/Pick-Your-AI/pick-your-ai-website/issues/318) addresses delayed `workflow_run` delivery. GitHub event arrival and workflow completion metadata do not establish the order in which releases actually became live. The read-only `scripts/deploy/live-admission.mjs` runs before `npm ci` or browser installation and writes an explicit decision:

| Decision     | Meaning and next step                                                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`        | A fresh live commit equals the triggering push's `EXPECTED_SHA`. Run the existing strict suite with that exact, unchanged expectation. Schedule, manual and rollback checks retain their existing empty expectation and run their usual checks. Admission itself is not a browser or deployment result. |
| `superseded` | The expected release was successfully deployed and verified, then a proven later accepted release replaced it. Skip only this obsolete browser run and retain both execution identities. This is not a browser pass for the older release.                                                              |
| `failed`     | Evidence is absent, contradictory, malformed, changes during admission, or remains unavailable at the reconciliation limit. Fail the job; do not certify supersession.                                                                                                                                  |

For push events, canonical workflow and exact triggering-run identity/status checks also precede the matching-live fast path. A successful same-name workflow on a feature branch or fork cannot enter as canonical just because production happens to match its SHA.

Supersession requires all of the following:

1. The triggering payload and authenticated REST data bind the repository name and immutable repository/head-repository IDs, canonical `Deploy production` workflow ID and path, `push` event, `main` branch, full commit SHA, run ID and exact attempt. A later attempt cannot stand in for the triggering attempt.
2. A fresh cache-busted public `version.json` names the observed release. GitHub comparison data proves that the expected commit is its ancestor and that the observed commit belongs to current accepted `main`. A descendant commit alone is insufficient.
3. Both original and successor attempts have an actual successful `deploy` job, with exactly one successfully executed **Check the artifact is the exact commit**, **Validate release on host**, **Activate**, and **Verify live site through Cloudflare** step. Job/run/attempt/head identities must agree; required step numbers and timestamps must be present and ordered, and restoration must have been skipped. The original verifier must have completed **strictly before** the successor's activation began. Equal or missing timestamps cannot prove that order.
4. A second fresh public version read, after the metadata and ancestry checks, confirms the same observed SHA. A changing SHA fails admission. The helper never substitutes the observed SHA into `EXPECTED_SHA`.

The trust boundary is authenticated GitHub metadata for these named steps in the reviewed canonical deployment workflow. Its artifact check binds the same-run download to the run SHA; activation and `verify-live.sh` then enforce that SHA on production. A workflow-level success, environment summary, branch name or successful unrelated job cannot replace the actual deployment steps. The helper does not download raw logs/artifacts, repeat a deployment, or independently rebuild its artifact. If the canonical deployment procedure or step identities change, review this admission contract with that change.

The generated repository token is exposed as `GH_TOKEN` only in the admission step. `E2E live` has `contents: read` plus `actions: read` for workflow/attempt/job metadata; the token is never sent to production. The deployment workflow retains its existing permissions and production concurrency. There are no new write permissions or deployment credentials in the live workflow.

Reconciliation has a four-minute global deadline, ten-second request deadlines including response bodies, at most thirteen attempts, and twenty-second waits between attempts. Only temporary read failures or pending evidence are retried. JSON bodies are bounded to 4 KiB for the live identity and 1 MiB for API data. At most five matching canonical push runs and one complete page of at most 100 jobs per attempt are admitted; truncated, duplicate or excessive results fail closed. Every listed candidate must qualify, so a successful earlier candidate cannot hide a failed or indeterminate execution. A stable observed release is required across retries.

The workflow summary and seven-day `live-admission` artifact retain the decision, expected/observed/current-main SHAs, ancestry, and successful run/attempt/job/step proof when superseded. Errors use fixed reason codes rather than raw response bodies, private paths or token-bearing exceptions. Existing browser failure artifacts remain intact. Cancellation is scoped to the triggering deployment execution, with separate schedule/manual groups, so an old event cannot cancel another release's live check. Once admitted, production movement during the browser suite still produces the existing strict version failure.

The CPU regression suite runs in the ordinary `npm test` CI gate. Its response envelopes and mutations are synthetic; selected public IDs/timestamps reproduce the verified incident. The original [failed live run 39286186762](https://github.com/Pick-Your-AI/pick-your-ai-website/actions/runs/39286186762) remains failed (four logical version failures, twelve failed attempts, 28 passing cases). The later accepted release's [successful deployment 39281193002](https://github.com/Pick-Your-AI/pick-your-ai-website/actions/runs/39281193002) and [32 passing strict live checks 39286655637](https://github.com/Pick-Your-AI/pick-your-ai-website/actions/runs/39286655637) are separate evidence. This prospective repair does not rewrite either result.

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
