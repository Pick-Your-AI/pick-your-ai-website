# Local ASCII art direction

Tracking: https://github.com/Pick-Your-AI/pickyour.ai/issues/32

## Integration for re-review (2026-10-23)

The branch now incorporates current main. Open `/ascii-study` after `npm run dev` to review the proposal. The approved homepage, application shell and builder remain on main's design; study CSS is scoped to its page and uses the shared theme toggle. Tier links use the current catalog layer query and Start a stack creates a blank build. The screenshots and verification below describe the original study, not the integrated revision. The original builder still-frame proposal remains visible in the archived screenshot; it is not applied to the current builder. Design approval is still pending.

### Integrated revision validation

- Formatting, lint, TypeScript, contract verification and production dependency audit: pass.
- Unit suite: 478 tests passed; deployment-admission tests: 115 passed.
- Static build and `scripts/check-dist.mjs`: pass.
- Playwright: 134 passed, 16 existing project-specific skips. Includes study animation,
  reduced motion, light/dark axe checks, narrow widths, explicit blank-build creation,
  starter selection and CSS isolation after client-side navigation.
- Desktop light and mobile dark screenshots inspected. This verifies rendering, not design approval.

## Brief

Refresh the existing frontend with an original 3D ASCII aesthetic inspired by
https://shitty-prompts.com and https://polymathic.mov. Keep the functional stack
builder, canonical research contract, synthetic-data disclosures and explicit
unknown states. Work in an isolated local worktree and display it on localhost
for live art direction. No publication or deployment is included.

## Source and isolation

The source was downloaded from the public upstream main archive on 2026-10-17.
The main API reported `c731bc451d227eac843750418b6de3c3377ea90b` immediately
after download. The archive was seeded into a separate local repository, then
a clean linked worktree was created on `job/pickyour-ascii`.

## Reference observations

- shitty-prompts.com: oversized sans typography, near-black background, mint
  character-rendered spheres, fine borders, small monospace labels, pause control.
- polymathic.mov: warm paper background (`#fdf9f3`), ink (`#060605`), ember
  (`#c2410c`), pixel display typography, ray-cast character forms, subtle texture.
- Proposed synthesis: warm paper and ink for a clear working tool, restrained
  teal for actions, large editorial type, and a rotating exploded ASCII stack
  that describes the product's tiers.

## Task graph

```text
source + references
       |
       v
visual brief + canonical tier mapping
       |
       +----> Sol: page composition + shared visual system
       |
       +----> Luna: ASCII stack renderer + motion controls
       |
       +----> Luna: functional / accessibility review
                        |
                        v
                  integration + checks
                        |
                        v
               localhost art direction
```

The OpenRig CLI is blocked from this sandbox (`EPERM`). A direct `/healthz`
audit confirms the existing daemon is healthy; it has not been restarted.
The choice to use built-in GPT agents instead is pending with Ari. Do not
represent prepared tasks as running agents. The prepared native rig and task
bodies are in the maintainer workspace's `context/frontend-swarm/` directory.

## Done test

- Character-based 3D artwork visible in the actual frontend, with pause,
  reduced-motion support and bounded rendering work.
- Cohesive homepage, navigation, builder and catalogue styling at desktop and
  mobile widths. Visible keyboard focus and sufficient text contrast.
- Existing starter, builder, selection, save, compare and share flows preserved.
- No modifications to vendored contracts, generated types, operations or deploy files.
- Typecheck, lint, unit tests, static production build, contract verification and
  browser/accessibility checks pass, or existing failures are documented with evidence.
- Local preview remains available for Ari's visual feedback; taste is not declared locked.

## Current dials

| Dial             | Value                                   | Where                           |
| ---------------- | --------------------------------------- | ------------------------------- |
| Paper / ink      | `#f8f6ef` / `#202922`                   | `src/styles/art-direction.css`  |
| Dark paper / ink | `#111713` / `#e8e9de`                   | same                            |
| Signal           | `#0f766e` light, `#91d7bd` dark         | same                            |
| Display type     | 78–116 px on desktop, responsive        | `--display-size`                |
| ASCII frame      | 96 columns × 68 rows                    | `src/components/AsciiStack.tsx` |
| Rotation         | 12 fps cap, 0.085 radians/sec           | `ART` in the component          |
| Layer spacing    | compact 0.48, exploded 1.12 scene units | `src/lib/ascii-stack.ts`        |

## Verification, first study

Commands run against the current implementation:

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm test`: **69 passed** across 7 files.
- `npm run contracts:verify`: 46 vendored files intact; 43 baseline files match.
- `npm run build`: static output built; the pre-existing large-validator-chunk warning remains.
- `node scripts/check-dist.mjs`: pass.
- `npx playwright test --config _local-playwright.mjs --workers 2`: **39 passed,
  3 intentionally skipped** across desktop Chromium and Pixel 7. The skips are
  the existing project-specific desktop/mobile alternatives.
- New browser coverage: animated frame changes, pause stability, compact/exploded
  state, reduced motion, light/dark axe checks on affected routes, width checks
  through 320 px. Existing builder, selection, persistence, export and sharing
  checks remain green.
- Prettier on all changed files and `git diff --check`: pass.

The temporary ignored `_local-playwright.mjs` points to the matching official
Chromium headless shell under `/tmp/pickyour-playwright` and uses IPv4. The
default local browser version was absent. Direct preview startup returned
`EPERM`; running the existing Playwright command through its available tool
path completed the suite. No project dependency or committed runner config changed.

Saved full-page renders are under `test-results/ascii-art-reduced-motion-k-4db0e-ayouts-fit-at-narrow-widths-{desktop,mobile}-chromium/`.
Both light and dark themes and a 320 px render were reviewed. A local 50-frame
Node measurement averaged 13.43 ms per frame; this is a development-machine
observation, not a mobile performance guarantee.

The first study is ready for visual direction, not taste approval. The requested
Sol/Luna swarm and formal GitHub assignment are still pending. No agent swarm
has been launched, and no push, deployment or design-lock commit was made.

The final audit confirmed through the GitHub connector that `PUSHINGSQUARES`
has pull access but no push or triage permission. An explicit assignment request
returned `403 Resource not accessible by integration`. The native rig spec
validates locally; the agent-spec validator cannot finish while CLI access
returns `EPERM`. Those gates have recurred across three consecutive goal turns.

## Work log

- 2026-10-17: Inspected both reference sites and source architecture. Created
  GitHub tracking issue #32. Assignee controls are absent for the signed-in
  account; CLI assignment also cannot reach the API from this sandbox.
- 2026-10-17: Initial `npm ci` failed with `ENOTFOUND registry.npmjs.org`.
  Downloaded lockfile package archives using the available curl network path;
  completed an offline install in a temporary cache.
- 2026-10-17: Built the first local study independently while the swarm transport
  choice remained pending. Added original ray-cast ASCII geometry and motion
  controls, replaced both raster illustration usages, and applied the paper/ink
  visual system across the existing application. Progress posted to
  https://github.com/Pick-Your-AI/pickyour.ai/issues/32#issuecomment-6227255829;
  renderer tracked by issue #33. All checks above are current.
