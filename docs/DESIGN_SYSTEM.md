# Design system and accessibility

## Identity

The local ASCII study uses warm paper, ink and deep teal (`brand-700 #0f766e`), with amber retained in the original SVG mark. The homepage and empty builder use original character-rendered 3D stacks. The references are shitty-prompts.com and polymathic.mov; their code and artwork are not copied. See `ASCII_ART_DIRECTION.md` for the brief and current review status.

The logo and favicon remain hand-made SVG. Earlier raster assets remain on disk with provenance in `ASSETS.md`. Nothing is copied from PCPartPicker, whose interaction patterns we take only from `research/pcpartpicker-ux-notes.md` as ADOPT/ADAPT items.

## Tokens (`src/styles/index.css`, `src/styles/art-direction.css`)

- Colours: paper `#f8f6ef`, ink `#202922`, teal `#0f766e`; dark paper `#111713`, ink `#e8e9de`, signal `#91d7bd`. Slate tokens follow the paper/ink palette; emerald/red/amber/sky/violet remain available for explicit statuses.
- Type: Helvetica/system sans for display and body, system monospace for labels and ids. Numbers use `.tabular` (tabular numerals). Display size, scene height and all palette values are CSS variables for live art direction.
- Dark mode: the `.dark` class on `<html>`, toggled from the header and stored in `pyai.theme`. It defaults to `prefers-color-scheme`.
- Motion: the ASCII hero rotates at a capped 12 frames per second, only while onscreen and visible. It has pause and assemble/explode controls. Reduced motion selects a still frame and disables rotation. Other animation and transition is disabled under `prefers-reduced-motion`.

## Component library

| Component                                                                                                                                          | File                      | Notes                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.card`, `.btn-primary/secondary/ghost/danger`, `.btn-sm`, `.input`, `.label`, `.hint`, `.link`, `.eyebrow`, `.muted`, `.data-table`, `.prose-doc` | `index.css`               | Minimum 40 px button height (32 px for small), 24 px targets for checkboxes and radios                                                                    |
| `OutcomeBadge`, `SeverityLabel`, `VerdictBadge`, `SyntheticBadge`                                                                                  | `components/status.tsx`   | **Icon + word**, never colour alone. Unknown uses amber with a ? icon and is never green                                                                  |
| `Loading`, `ErrorState`, `EmptyState`, `Notice`                                                                                                    | `components/feedback.tsx` | Explicit loading, empty, error (with contract-validation details) and stale states                                                                        |
| `Layout`, `PageHeader`, `DemoBanner`, `ThemeToggle`                                                                                                | `components/layout.tsx`   | Skip link, focus moves to h1 on navigation, demo banner as `role="note"`                                                                                  |
| Icons                                                                                                                                              | `components/icons.tsx`    | Original inline SVG, `aria-hidden` unless titled                                                                                                          |
| Builder pieces                                                                                                                                     | `features/builder/*`      | `BuilderTable`, `SummaryPanel` (aside + mobile sticky bar), `FindingsList` (lettered), `SettingsForm` (from the schema), `ObjectivesForm`, `BuildToolbar` |

## Status semantics

| Outcome | Look              | Meaning                                                       |
| ------- | ----------------- | ------------------------------------------------------------- |
| Pass    | green ✓ "Pass"    | The published rule found no problem for this revision         |
| Fail    | red ✕ "Fail"      | Hard incompatibility. Error severity blocks                   |
| Unknown | amber ? "Unknown" | Not enough information. **Never treated as compatible**       |
| Skipped | grey – "Skipped"  | The rule's condition does not apply. This is not an assertion |

Severity (Error / Warning / Info) is printed next to the outcome as its own word. The overall strip shows the worst outcome and is green only when nothing is failing or unknown.

## Accessibility requirements (WCAG 2.2 AA)

- Keyboard: everything is operable with native controls, focus is always visible (3 px ring), and the skip link works.
- Structure: one h1 per page, ordered headings, landmarks (`header`, `nav` with labels, `main`, `aside`, `footer`), tables with captions and `scope`, sortable headers with `aria-sort`.
- Forms: visible labels, required markers, inline errors linked by `aria-describedby` and `aria-invalid`.
- Announcements: re-evaluation results in an `aria-live="polite"` region, and status messages for save, copy and import.
- Colour: contrast meets AA in both themes. Status always pairs an icon with a word.
- Target size: 24×24 minimum (2.5.8). Scrollable tables are focusable regions.
- Mobile: the builder and selection lists become cards below 768 px, the summary becomes a sticky expandable bar, and layouts are verified at 390 px and 1440 px. Widths of 320 px and up are supported.
- Verification: axe (WCAG 2.0/2.1/2.2 A and AA tags) runs on every route on desktop and mobile in CI (`tests/e2e/smoke.spec.ts`).
