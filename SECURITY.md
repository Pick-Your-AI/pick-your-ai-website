# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub security advisories](https://github.com/Pick-Your-AI/pickyour.ai/security/advisories/new). Do not open a public issue. We aim to acknowledge reports within five business days.

## Scope

- The static website served at https://pickyour.ai and its build pipeline in this repository.
- Research data and contracts are maintained in `Pick-Your-AI/pick-your-ai-research`; report issues there through its own security policy.

## Practices

- The site is fully static. It has no server-side code, accounts, or cookies, and stores builds only in the visitor's browser (`localStorage`).
- No third-party trackers or analytics are loaded.
- All data from providers (fixtures today, the contract API later) is validated against the JSON Schemas at runtime before use; imported build files are validated the same way and rendered as text, never as HTML.
- Deployment credentials live only in the GitHub `production` environment. They are never exposed to the client bundle, committed, or logged.
- GitHub Actions use least-privilege `permissions` and are pinned to full commit SHAs. Dependabot monitors npm and Actions dependencies; CI runs `npm audit` and dependency review.
- Security headers and the Content Security Policy are served from `public/.htaccess` (owned by operations).
