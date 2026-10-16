# Environment variable reference

## GitHub environment `production`

Deployment branch policy: `main` only. Secrets are only readable by jobs that declare `environment: production`, which means the `deploy` and `rollback` jobs.

| Name | Kind | Value / format | Used by |
|---|---|---|---|
| `GODADDY_SSH_PRIVATE_KEY` | secret | OpenSSH private key of the hosting account owner (existing key, not rotated by this project) | `scripts/deploy/setup-ssh.sh` |
| `GODADDY_SSH_KNOWN_HOSTS` | secret | Pinned `known_hosts` lines for `107.180.118.46` (ed25519 `SHA256:KbP3SqcY…`, ecdsa `SHA256:sjyTpjdp…`, rsa `SHA256:mFJZbUNi…`) | `setup-ssh.sh` (`StrictHostKeyChecking yes`) |
| `GODADDY_HOST` | variable | `107.180.118.46` | `setup-ssh.sh` |
| `GODADDY_PORT` | variable | `22` | `setup-ssh.sh` |
| `GODADDY_USERNAME` | variable | `ofufzq652wn5` | `setup-ssh.sh` |
| `GODADDY_DEPLOY_PATH` | variable | `/home/ofufzq652wn5/public_html/pickyour.ai` | Documentation. `remote-release.sh` hard-codes and enforces the same path as a safety rail. |
| `PRODUCTION_URL` | variable | `https://pickyour.ai` | `verify-live.sh`, environment URL, `e2e-live.yml` |

Rules:

- Never print, `cat` or `echo` the key. `setup-ssh.sh` writes it with `umask 077` and the job deletes it in an `always()` step.
- To rotate the key, the account owner adds the new public key in cPanel → SSH Access, updates the secret (`gh secret set GODADDY_SSH_PRIVATE_KEY -e production < key`), runs a redeploy, and then removes the old public key.
- If the host key changes (server migration), re-pin it with `ssh-keyscan -t ed25519,ecdsa,rsa <host>`, compare the fingerprints out of band, and update `GODADDY_SSH_KNOWN_HOSTS`.

## Build inputs (see `docs/DEPLOYMENT_CONTRACT.md`)

| Name | Default | Notes |
|---|---|---|
| `PYAI_COMMIT_SHA` | `GITHUB_SHA`, then `git rev-parse HEAD` | Stamped into `version.json`. CI sets it to `${{ github.sha }}`. |
| `VITE_DATA_MODE` | `fixture` | `fixture` or `http` |
| `VITE_API_BASE_URL` | empty | Only used in `http` mode. If set to another origin, `connect-src` in `public/.htaccess` must allow it. |

## Script inputs

| Script | Variable | Default | Meaning |
|---|---|---|---|
| `verify-live.sh` | `VERIFY_ATTEMPTS` / `VERIFY_SLEEP` | `12` / `5` | Retries while waiting for `version.json` to show the new SHA |
| `remote-release.sh` | `PYAI_DOCROOT` | `~/public_html/pickyour.ai` | Any other value is refused |
| `e2e-live` specs | `PRODUCTION_URL`, `EXPECTED_SHA` | `https://pickyour.ai`, empty | `EXPECTED_SHA` is set for push-triggered deploys |
