# PickYour.AI

Build a compatible AI stack, part by part.

PickYour.AI is a static React + TypeScript single-page app for comparing and
assembling AI stacks like a PC parts list: start with workload and deployment
mode, then choose models, infrastructure, data, tooling, and deployment
Evidence while checking compatibility as you go.

- Live site: https://pickyour.ai
- Research and contracts: [Pick-Your-AI/pick-your-ai-research](https://github.com/Pick-Your-AI/pick-your-ai-research)
- Contributor recognition planning: [pick-your-ai-leaderboard](https://github.com/Pick-Your-AI/pick-your-ai-leaderboard) · [Delivery project](https://github.com/orgs/Pick-Your-AI/projects/6) · [Program tracking](https://github.com/Pick-Your-AI/pick-your-ai-website/issues/1)

> Preview status. The real component catalog is still being researched. Every
> component, price, and compatibility result on the site today is synthetic
> demonstration data, clearly labelled as such.

## What this repo contains

This repository is the website frontend and build tooling for PickYour.AI. It
is a static SPA served by Apache on GoDaddy shared hosting, with compatibility
logic and catalog rules driven by the vendorized research contract under
`contracts/v1/`.

- React 19 + TypeScript + Vite
- Static build output for GoDaddy shared hosting
- Contract-first compatibility evaluation from the research repo
- Synthetic fixture data until real catalog research lands
- Accessibility-first UI work aiming for WCAG 2.2 AA

## Quick start

Requirements: Node 22 LTS or newer, npm, and git.

```sh
npm ci
npm run dev
```

The app runs in fixture mode by default for local development. For different data
modes, copy `.env.example` to `.env.local` and set `VITE_DATA_MODE` to
`fixture` or `http`.

## Scripts

```sh
npm ci
npm run dev                 # http://localhost:5173
npm run build               # static production build in dist/
npm run preview             # preview dist/ on port 4317
npm run format              # format files
npm run format:check        # check formatting
npm run lint                # ESLint (zero warnings enforced)
npm run typecheck           # TypeScript strict checks
npm run contracts:verify    # validate vendored contract integrity
npm run contracts:update    # re-vendor contracts from a specific upstream SHA
npm run contracts:types     # regenerate generated contract types
npm test                    # Vitest unit/integration tests
npm run test:e2e            # Playwright + axe smoke tests against preview build
npm run audit               # production dependency audit
```

## Documentation

| Topic | Document |
| --- | --- |
| Architecture, state and data flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Research-to-website traceability | [docs/RESEARCH_MAPPING.md](docs/RESEARCH_MAPPING.md) |
| Moving from fixtures to real data | [docs/DATA_INTEGRATION.md](docs/DATA_INTEGRATION.md) |
| Product, journeys, sitemap | [docs/PRODUCT.md](docs/PRODUCT.md) |
| Design system and accessibility | [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) |
| Testing strategy | [docs/TESTING.md](docs/TESTING.md) |
| Deployment build contract | [docs/DEPLOYMENT_CONTRACT.md](docs/DEPLOYMENT_CONTRACT.md) |
| Asset provenance | [docs/ASSETS.md](docs/ASSETS.md) |
| Operations and deployment | [docs/operations/](docs/operations/) |
| Contribution workflow and rules | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Agent instructions | [AGENTS.md](AGENTS.md) |

## Contract and source-of-truth rules

- `contracts/v1/` is vendored from `Pick-Your-AI/pick-your-ai-research` and is
  treated as authoritative.
- The generated types in `src/contracts/generated/` are produced by
  `npm run contracts:types`; do not edit them by hand.
- Compatibility results must use the contract-defined enums and identifiers,
  including `pass`, `fail`, `unknown`, and `skipped`.
- Unknown information is never treated as compatible.
- No credentials, private build content, or secret values are committed to the
  repo.

## Building and deployment

This site is intentionally static. The host has no Node runtime, so the
production build must generate a full static `dist/` directory and remain
compatible with the deployment contract in `docs/DEPLOYMENT_CONTRACT.md`.

Before opening a PR, the repo expects the following checks to pass:

```sh
npm ci
npm run format:check && npm run lint && npm run typecheck
npm run contracts:verify
npm test
npm run build && npm run test:e2e
npm run audit
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md)
before making changes.

Work on a `feat/...`, `fix/...`, `docs/...`, or `ci/...` branch. Changes are
merged through a pull request with the required CI status green.

## License

[MIT](LICENSE)
