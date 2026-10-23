# ASCII art direction study

Tracking: [#32](https://github.com/Pick-Your-AI/pick-your-ai-website/issues/32) and
[#33](https://github.com/Pick-Your-AI/pick-your-ai-website/issues/33).
Review: [PR #323](https://github.com/Pick-Your-AI/pick-your-ai-website/pull/323).

## Scope

Run `npm ci` and `npm run dev`, then open `/ascii-study`. This separate review page
preserves the warm paper/ink proposal alongside the approved main UI. Its stylesheet is
scoped under `.ascii-study` and follows the shared light/dark toggle. The homepage,
application shell, builder and parts registers retain main's design. No deployment or
production design approval is implied by this study.

The original study was based on `c731bc451d227eac843750418b6de3c3377ea90b`; the conflict
resolution incorporates main at `27f230c2b7a42249bc3f3ebad2be9269740ee767`. The saved
[home](design/ascii-study/home.png) and [builder](design/ascii-study/builder.png) images
show that historical proposal, not the current integrated page. The builder image is
retained for discussion; its artwork is not applied to the current builder.

## Visual references and geometry

The original author cited [shitty-prompts.com](https://shitty-prompts.com) and
[polymathic.mov](https://polymathic.mov) as visual references. The scene is original
mathematical geometry, rendered as text without a bitmap generator or third-party renderer.

The scene contains seven slabs with two chips on each. The exploded default frame has
seven separate row bands at the 24 sampled viewing angles. Assembly and some viewing angles overlap their silhouettes;
the compact image does not promise seven visibly distinct bands. This is an abstract
layer study, not a dependency diagram: it contains no connecting geometry and its slabs
are not labelled as individual contract tiers. The adjacent list provides the actual
T0-to-T6 order, names, kind counts and registry-derived optional activation.

## Current dials

| Dial             | Value                                       | Where                           |
| ---------------- | ------------------------------------------- | ------------------------------- |
| Paper / ink      | `#f8f6ef` / `#202922`                       | `src/styles/art-direction.css`  |
| Dark paper / ink | `#111713` / `#e8e9de`                       | same                            |
| Signal           | `#0f766e` light, `#91d7bd` dark             | same                            |
| Display type     | 78�116 px on desktop, responsive            | `--display-size`                |
| ASCII frame      | 96 columns � 68 rows                        | `src/components/AsciiStack.tsx` |
| Rotation         | 12 scheduled updates/sec, 0.085 radians/sec | `ART` in the component          |
| Layer spacing    | compact 0.48, exploded 1.12 scene units     | `src/lib/ascii-stack.ts`        |

The interval exists only while the scene intersects the viewport and the document is
visible. Pause, reduced motion, offscreen state and unmount clear it. Browser scheduling
can delay updates; 12 is the requested cadence, not a measured frame-rate guarantee.
There is no module-load render. Action buttons change their labels without `aria-pressed`;
reduced-motion status is plain text. Controls are underlined at rest.

## Reproduction and evidence

Run the repository checks from `AGENTS.md`:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run contracts:verify
npm test
npm run build
node scripts/check-dist.mjs
npm run test:e2e
npm run audit
```

Focused coverage:

```sh
npx vitest run tests/unit/ascii-stack.test.ts tests/unit/ascii-animation.test.tsx
npx playwright test tests/e2e/ascii-art.spec.ts
```

The geometry tests reject a single noise band or fewer than seven default slabs and check
the intended glyph set. These checks do not certify artistic quality. Lifecycle tests
check timer cadence and teardown under visibility, pause and reduced-motion changes.
Browser tests cover both themes, accessibility, narrow widths, starter selection, blank-build
creation, registry-derived labels and CSS isolation after client navigation.

The browser test writes screenshots into its ignored `test-results/` output. Re-run it to
produce current local images; those generated paths are not published evidence. No portable
CPU, paint-time or device-performance measurement is claimed. Design acceptance and
karutoil's re-review remain separate from automated validation.

## Validation of the review fixes (2026-10-23)

Formatting, lint, typecheck, contract verification, the static build, `check-dist` and
production dependency audit passed. The unit suite passed 482 tests plus 115 deployment
admission checks. Playwright passed 134 tests with 16 existing project-specific skips.
The three-layer and noise-band mutations were both rejected by the geometry tests.
The desktop light screenshot was inspected after the pitch correction. Hosted CI and
independent review are reported separately in the PR.
