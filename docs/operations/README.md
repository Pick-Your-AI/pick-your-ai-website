# Operations

How PickYour.AI is built, deployed, served and recovered. The operations workstream owns these files, together with `.github/workflows/deploy-production.yml`, `.github/workflows/e2e-live.yml`, `public/.htaccess`, `scripts/deploy/` and `tests/e2e-live/`.

| Document | Use it when |
|---|---|
| [deployment-runbook.md](deployment-runbook.md) | You want to know how a merge reaches production, or a deploy failed |
| [release-procedure.md](release-procedure.md) | You are shipping a change, or changing the pipeline itself |
| [backup-and-rollback.md](backup-and-rollback.md) | You need to roll back, or want to know what is retained |
| [dns-and-ssl.md](dns-and-ssl.md) | You are touching Cloudflare, certificates, redirects or caching |
| [environment-variables.md](environment-variables.md) | You need a secret, variable or build input |
| [troubleshooting.md](troubleshooting.md) | Something on the live site looks wrong |

Build contract (the producer side, owned by the site workstream): [`docs/DEPLOYMENT_CONTRACT.md`](../DEPLOYMENT_CONTRACT.md).

## At a glance

```
PR ──► CI (ci.yml, required check `ci-required`) ──► merge to main (ruleset: PR + ci-required)
                                                          │
                     push to main ───────────────────────►│ Deploy production
                                                          ├─ CI again via workflow_call (exact SHA)
                                                          ├─ site-dist artifact → commit == github.sha
                                                          ├─ rsync → ~/pickyour-releases/<sha>  (staged)
                                                          ├─ validate on host
                                                          ├─ activate → public_html/pickyour.ai
                                                          │    (.well-known + cgi-bin preserved)
                                                          ├─ verify through Cloudflare (version.json SHA, routes, headers)
                                                          ├─ failure ⇒ restore what was live before
                                                          └─ prune to 5 releases
                                                          ▼
                                                    E2E live (Playwright at 1440/1024/768/375)
```

- **Production:** https://pickyour.ai (apex is canonical; `www` returns 301 to the apex).
- **Origin:** GoDaddy cPanel "Web Hosting Ultimate" (shared, CloudLinux/CageFS, Apache). Addon docroot `/home/ofufzq652wn5/public_html/pickyour.ai`.
- **Edge:** Cloudflare (proxied, SSL mode Full (strict)).
- **Transport:** SSH (rsync over ssh) with the account owner's key, stored as a GitHub environment secret.
