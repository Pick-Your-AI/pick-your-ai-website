# Troubleshooting

## Quick checks

```bash
curl -s "https://pickyour.ai/version.json?x=$RANDOM"                     # live commit
curl -sI https://pickyour.ai/builder | grep -iE '^HTTP|cache-control|cf-cache'
bash scripts/deploy/verify-live.sh <expected-sha>                        # full check, read-only
ssh dpc-godaddy 'bash -s' -- status < scripts/deploy/remote-release.sh   # host state
ssh dpc-godaddy 'tail -20 ~/pickyour-releases/.state/log'
```

To bypass Cloudflare and talk to the origin directly (the TLS certificate is still validated):

```bash
curl -sI --resolve pickyour.ai:443:107.180.118.46 https://pickyour.ai/
```

## Symptoms

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy job: `ssh: … Permission denied (publickey)` in **Configure SSH** | Key removed or rotated in cPanel, or the secret is stale | Account owner re-authorises the key in cPanel → SSH Access, or updates the secret ([environment-variables.md](environment-variables.md)) |
| `Host key verification failed` | Host key changed (migration) or the pin is wrong | Verify the new fingerprint out of band, then update `GODADDY_SSH_KNOWN_HOSTS` |
| `ssh: connect to host … port 22: Connection timed out` | GoDaddy blocking runner IPs or a host outage | Check from a local machine. If only Actions is blocked, ask GoDaddy to allowlist it, or use a self-hosted runner. Reachability from GitHub-hosted runners was verified on 2026-10-16. |
| `/dev/fd/…: No such file or directory` | Process substitution in a remote script (CageFS) | Use arrays or temp files instead of `<(...)` |
| `release <sha> version.json does not match` | Artifact from a different commit | Re-run the workflow. Never upload by hand. |
| Verify: `version.json commit '<old>' != <new>` | Activation did not complete, or a cache is serving stale JSON | Check `status` on the host. Check `cf-cache-status` (must be `DYNAMIC` or `BYPASS`). Purge that URL in Cloudflare if needed. |
| Every path returns **500** | Broken `.htaccess` (unsupported directive) | The deploy restores automatically. Test the change in a probe sub-dir ([release-procedure.md](release-procedure.md)). |
| Every path returns **403** | Docroot empty or not traversable | `ls -ld ~/public_html/pickyour.ai` must be `drwxr-xr-x`. `chmod 755` it, then re-run the deploy. |
| Deep link returns **404** | SPA fallback missing, or the route contains a dot (`/b/x.json`) | Routes must not end in `.ext`. Check that `public/.htaccess` is in `dist/`. |
| Missing `/assets/*.js` returns HTML instead of 404 | Fallback rewrote an asset path | Check the `RewriteCond %{REQUEST_URI} !^/assets/` rule |
| Browser shows an old version after a deploy | Old `index.html` cached | `index.html` is `no-cache`, so a hard refresh fixes it. If Cloudflare shows `HIT` on HTML, someone added a cache rule. Remove it. |
| Console: CSP blocked `img1.wsimg.com/...tccl.min.js`, an inline script, or `static.cloudflareinsights.com` | GoDaddy's origin traffic script / Cloudflare Web Analytics injection | Expected and harmless (blocked). To remove: GoDaddy support opt-out, or disable Cloudflare Web Analytics automatic setup. |
| Console: CSP blocked something from our own bundle | App uses inline script or style, or a new origin | Site workstream requests a CSP change in HANDOFF.md. Don't loosen the CSP blindly. |
| AutoSSL renewal failing | `.well-known` blocked or redirected | `.htaccess` must keep `RewriteRule ^(\.well-known|cgi-bin)(/|$) - [L]` first. Deploys never touch `.well-known`. |
| `timed out waiting for release lock` | Another release operation is running or stuck | Wait. A stale lock clears when its SSH session ends (`flock` on fd 9). |
| Two deploys queued | Expected | The `production` concurrency group runs them one at a time. A newer pending run replaces an older pending one. |

## Known incidents

- **2026-10-16, first deploy run [38921731368](https://github.com/Pick-Your-AI/pickyour.ai/actions/runs/38921731368).** Activation failed because CageFS has no `/dev/fd`, so nothing was changed. While the fix was being tested by hand, an `rsync -a` from a `mktemp` dir set the docroot directory to mode 700 and the user's own group, where it had been `750 user:nobody`. The account cannot `chgrp` back to `nobody`, so the docroot is now `755 user:user`. That is functionally equivalent, because the parent `public_html` is still `750 user:nobody`, which keeps other accounts out. Fixed in PR #8: `-rlt` only, and the mode is re-asserted after every sync.
