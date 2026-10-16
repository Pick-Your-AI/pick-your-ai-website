# Design system and accessibility

## Identity

The site has its own original identity: deep teal (`brand-700 #0f766e`), slate neutrals and a single amber accent (`#f59e0b`). The logo and favicon are hand-made SVG. The illustrations were generated with Codex (see `ASSETS.md`). Nothing is copied from PCPartPicker, whose interaction patterns we take only from `research/pcpartpicker-ux-notes.md` as ADOPT/ADAPT items.

## Tokens (`src/styles/index.css`)

- Colours: `brand-50…950`, `accent-400…600`, and Tailwind slate/emerald/red/amber/sky/violet for status.
- Type: system UI stack plus a monospace stack for ids. Numbers use `.tabular` (tabular numerals).
- Dark mode: the `.dark` class on `<html>`, toggled from the header and stored in `pyai.theme`. It defaults to `prefers-color-scheme`.
- Motion: minimal. All animation and transition is disabled under `prefers-reduced-motion`.

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
