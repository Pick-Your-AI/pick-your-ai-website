# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Project bootstrap: Vite + React 19 + TypeScript (strict), Tailwind CSS 4, React Router, TanStack Query, ESLint, Prettier, Vitest, Playwright with axe.
- `dist/version.json` build stamp (commit, build time, contract version and source SHA, data mode) and a footer build indicator.
- Vendored research contract v1.0.0 from `Pick-Your-AI/pick-your-ai-research@d4bdca4` with provenance manifest and hash verification (`npm run contracts:verify`).
- CI workflow (`CI`) with the `ci-required` aggregate check, reusable via `workflow_call`, uploading the `site-dist` artifact.
- Repository governance: `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`, issue and PR templates, Dependabot.
