# Backup and rollback

## What is retained

| Item | Where | Retention |
|---|---|---|
| Release directories (complete `dist/` per commit) | `~/pickyour-releases/<sha>/` on the host | 5 newest, plus current and previous (never pruned) |
| Docroot snapshot before every activation | `~/pickyour-releases/backups/docroot-<UTC>.tgz` | 5 newest |
| Build artifacts | GitHub Actions artifact `site-dist` per CI run | 14 days |
| Source | Git history on `main` (force-push and deletion blocked by ruleset) | Permanent |
| Activation history | `~/pickyour-releases/.state/log`, GitHub `production` deployments | Permanent |

`.well-known/` (AutoSSL validation) and `cgi-bin/` are excluded from every sync and every backup, so no deploy or rollback ever touches them.

## Automatic restore

If any step from **Activate** onwards fails in a deploy or rollback run, the workflow runs `remote-release.sh restore`. That returns the docroot to the release recorded in `.state/restore`, which is whatever was live when the activation began. The run still ends red, so the failure is visible.

## Rolling back (recommended path)

1. Find the target SHA in Environments → production, `ssh dpc-godaddy 'bash -s' -- status < scripts/deploy/remote-release.sh`, or the deploy run summary. It must be a **retained** release.
2. Actions → **Deploy production** → *Run workflow*, with branch **main** and `rollback_to` = the full 40-char SHA. Your login must be in the `DEPLOY_DISPATCHERS` repository variable, or the `rollback` job is skipped.
3. The `rollback` job validates the release on the host, activates it, and verifies through Cloudflare that `version.json.commit` equals the target. E2E live runs afterwards.
4. **Roll forward** the same way, with `rollback_to` = the newer SHA. Or dispatch with `rollback_to` empty to redeploy the current `main`.

From the CLI:

```bash
gh workflow run deploy-production.yml --ref main -f rollback_to=<sha>
gh run watch "$(gh run list -w 'Deploy production' -L1 --json databaseId --jq '.[0].databaseId')"
```

A rollback does not change `main`. The next merge deploys `main` as usual. If the bad change must not come back, revert it through a PR.

### Tested

On 2026-10-16, [38923312356](https://github.com/Pick-Your-AI/pickyour.ai/actions/runs/38923312356) rolled back from `5d6994c` to `3d5e31a`, verified live. Then [38923391828](https://github.com/Pick-Your-AI/pickyour.ai/actions/runs/38923391828) rolled forward to `5d6994c`, verified live.

## Rolling back to a release that has been pruned

Revert on `main` through a PR, or push a branch at the old commit and merge it back via PR. The normal pipeline rebuilds and deploys it. Do not upload by hand.

## Restoring the pre-pipeline docroot

The docroot snapshots are plain tarballs:

```bash
ssh dpc-godaddy 'ls -1t ~/pickyour-releases/backups/'
# inspect first, then (only with a clear reason):
ssh dpc-godaddy 'tar -tzf ~/pickyour-releases/backups/docroot-<UTC>.tgz | head'
```

The docroot held only `.well-known/` and `cgi-bin/` before the first deploy. Running `restore` when no release was live returns it to exactly that state.
