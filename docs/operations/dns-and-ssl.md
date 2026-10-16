# DNS, SSL, redirects and caching

State verified on 2026-10-16. **Change nothing here without recording the before and after state in this file.**

## Domain and DNS

- Registrar: GoDaddy.com, LLC (RDAP). Registered 2026-10-16, expires 2028-10-16. The domain is **not** in the GoDaddy account that holds the hosting. It is registered elsewhere at GoDaddy.
- Nameservers: Cloudflare (`cora.ns.cloudflare.com`, `nick.ns.cloudflare.com`). The zone `pickyour.ai` is on the Free plan and lives in the Cloudflare account labelled "Andrew@peltekci.com's Account".
- Records (all three that exist):

| Name | Type | Content | Proxy |
|---|---|---|---|
| `pickyour.ai` | A | `107.180.118.46` (GoDaddy origin) | Proxied |
| `www.pickyour.ai` | CNAME | `pickyour.ai` | Proxied |
| `_dmarc.pickyour.ai` | TXT | `v=DMARC1; p=quarantine; …` | DNS only |

There are **no MX records** (and no `mail` record), so the domain receives no mail today. If mail is added later, leave those records alone in any web change.

## TLS

| Hop | Certificate | Notes |
|---|---|---|
| Browser → Cloudflare | Cloudflare Universal SSL, `*.pickyour.ai, pickyour.ai` (Let's Encrypt), expires 2027-01-14, auto-renews | Minimum TLS 1.2, TLS 1.3 on |
| Cloudflare → origin | cPanel AutoSSL (Let's Encrypt), `pickyour.ai, www.pickyour.ai`, expires 2027-01-14, auto-renews | Validated by Cloudflare because SSL mode is **Full (strict)** |

AutoSSL renews through `/.well-known/` in the docroot. The `.htaccess` never rewrites or redirects `/.well-known/`, and deploys never modify it.

## Redirects

| Request | Handled by | Result |
|---|---|---|
| `http://…` | Cloudflare "Always Use HTTPS" (on) | 301 → `https://…` |
| `https://www.pickyour.ai/…` | origin `.htaccess` | 301 → `https://pickyour.ai/…` (path and query kept) |
| direct-to-origin plain HTTP | origin `.htaccess` (guarded by `X-Forwarded-Proto`) | 301 → https |

Cloudflare has no Redirect Rules or Page Rules for this zone.

## Caching

- Origin headers (from `public/.htaccess`):
  - `/assets/*`: `public, max-age=31536000, immutable` (content-hashed names)
  - everything else (HTML, SPA routes, `version.json`, `favicon.svg`, `theme-init.js`): `no-cache, must-revalidate`
- Cloudflare: Caching Level Standard, Browser Cache TTL 4 hours, **no Cache Rules**. HTML and JSON are not edge-cached by default (`cf-cache-status: DYNAMIC`), and `no-cache` passes through unchanged. Verified by `verify-live.sh` on every deploy.
- Result: a new deploy is visible on the next page load, and old hashed chunks stay valid until the next deploy deletes them.
- Purging: not needed and not automated. The deploy has no Cloudflare API token. If a stale object is ever served, use Cloudflare → Caching → Configuration → Custom Purge (URL) with the account owner, and record it here.

## Security headers (origin)

The CSP is `default-src 'self'` with `script-src 'self'`, `style-src 'self'` and `img-src 'self' data:`. It also sets `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'` and `upgrade-insecure-requests`.

The other headers:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- a restrictive `Permissions-Policy`
- `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`
- `Strict-Transport-Security: max-age=31536000`. There is no `includeSubDomains` or `preload`, because other subdomains (cPanel, mail) are outside this project.

CSP changes are requested by the site workstream in the coordination `HANDOFF.md` and applied in `public/.htaccess`.

### Platform-injected scripts

- GoDaddy appends a "traffic-assets" monitoring script to HTML responses at the origin: an inline `<script>` plus `img1.wsimg.com/traffic-assets/js/tccl.min.js`.
- Cloudflare may inject its Web Analytics beacon (`static.cloudflareinsights.com`).

The CSP blocks both, which is intended (no third-party trackers), but they show up as console errors and cost a few Lighthouse "Best Practices" points. To remove them at the source, the account owner can:

- ask GoDaddy hosting support to opt the account out of the traffic monitoring script
- disable automatic Web Analytics for the zone in Cloudflare

## Apache capabilities (verified)

- mod_rewrite, mod_headers and mod_expires all work from `.htaccess` in the addon docroot (tested with a probe directory, since removed).
- PHP 8.3, python3, rsync 3.1.3 and git are present. Node is not. Login shell is bash. Quota is 75 GB / 250k inodes.
