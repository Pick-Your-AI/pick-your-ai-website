# Design system and accessibility

## Identity

The site has its own original identity, defined by the approved design mock
(`docs/design/pickyourai-complete.html`, kept in the repository verbatim as the reference): a deep navy "space"
palette with a mint accent, Space Grotesk display type, DM Sans body text and IBM Plex Mono for
labels, ids and figures. Nothing is copied from PCPartPicker, whose interaction patterns we take
only from `research/pcpartpicker-ux-notes.md` as ADOPT/ADAPT items.

## Where the styles live

| File                         | Purpose                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/styles/mock.css`        | The mock's stylesheet, ported verbatim, scoped so the theme class applies to `html`. **Do not hand-edit design rules here**; it is the fidelity reference. Rules for mock screens this app does not implement were moved out (see `mock-legacy.css`).                                                                                                                                             |
| `src/styles/fonts.css`       | The four self-hosted `@font-face` declarations (Space Grotesk, DM Sans, IBM Plex Mono 400/600). No `unicode-range`: the files are already subset to the glyphs the UI renders, and a Google-style latin range would exclude `→ ≥ ≠ ≤ ⊆ ✓ ✕`.                                                                                                                                                      |
| `src/styles/index.css`       | Imports `fonts.css` and `mock.css`, then adds only functional glue: accessibility helpers (`.sr-only`, focus ring), loading/error/notice states, form grid, `.badge*` / `.severity*` status chips, `.panel` and `.data-table` for summary pages, and the measured contrast patch.                                                                                                                 |
| `src/styles/dense.css`       | The parts-register layer (builder, catalog, compare). **Imported by the modules that render it**, not by `index.css`, so the marketing pages do not download table CSS they cannot match.                                                                                                                                                                                                         |
| `src/styles/mock-legacy.css` | **Not imported — ships nothing.** Mock rules for screens this app does not implement (the multi-step builder wizard, the old catalog directory and compare panels, the marketing build-section band). Kept as an unshipped reference instead of deleted; each rule was verified unreferenced across 444 route loads in both themes. Move a rule back into `mock.css` if the screen is ever built. |
| `src/components/icon.tsx`    | The mock's 33-glyph inline sprite plus `<Icon name="…" />`. Inline on purpose: an external `<use href>` sprite is fetched before any icon can paint.                                                                                                                                                                                                                                              |
| `src/components/parts.tsx`   | The shared parts-register primitives (`PartsHead`, the sortable table pieces, chips, findings) used by builder, catalog and compare.                                                                                                                                                                                                                                                              |

No utility framework is used: components carry the mock's semantic class names
(`.hero`, `.parts-page`, `.pt`, `.pchip`, …), and Tailwind is not a dependency.

## Tokens (`mock.css`, `:root` / `html.light`)

- Surfaces: `--bg #080e16`, `--bg2`, `--surface`, `--surface2`, `--surface3`; borders `--line`, `--line2`.
- Text: `--text #eaf2f3`, `--muted #91a5b3`, `--dim` (lifted from `#627784` to `#809ba8` for AA — see below).
- Accents: `--accent #69e5bd` (mint), `--accent2 #28b899`, plus `--orange`, `--red`, `--blue` for status.
- Type: `--display` Space Grotesk, `--body` DM Sans, `--mono` IBM Plex Mono (loaded from Google Fonts in `index.html`).
- Shape: `--radius 12px`, `--shadow` for floating panels.
- Theme: the `light` class on `<html>`, applied before first paint by `public/theme-init.js` and toggled from the header; the choice is stored in `pyai.theme`. Dark is the default (as in the mock).
- Motion: minimal (hover lifts, the `live-dot` pulse, the toast slide). Everything is disabled under `prefers-reduced-motion`.

## Contrast floor

The mock's two dimmest greys fall below WCAG AA on some surfaces. `index.css` lifts them to the
nearest tone that still reads as "dim" and passes 4.5:1, and expresses light-theme colours with the
theme's own variables so the always-dark blocks (builder shell, preview panel, rule board, modal)
keep their dark palette. `--on-accent` selects ink (#072b25) or white for accent-filled buttons per
theme. Both themes are verified by axe on every route.

## Component library

| Component                                                                                                                                              | File                      | Notes                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.btn`, `.btn-primary`, `.btn-outline`, `.btn-ghost`, `.btn-small`, `.icon-button`, `.card-select`, `.small-action`, `.filter-chip`, `.directory-pill` | `mock.css`                | Minimum 42 px button height (33–34 px for small), visible 2 px focus ring                                                                                                         |
| `.hero`, `.stats-band`, `.template-grid`, `.catalog-row`, `.how-grid`, `.cta-box`, `.footer-*`                                                         | `mock.css`                | Home page sections, one per mock block                                                                                                                                            |
| `.builder-shell`, `.step-sidebar`, `.summary-sidebar`                                                                                                  | `mock.css` (unrendered)   | The mock's seven-step builder wizard. **The app does not render these** — the builder is the dense register in `dense.css`; kept because overrides in `index.css` reference them. |
| `.page-masthead`, `.directory-*`, `.compare-*`, `.saved-*`, `.template-showcase`, `.method-*`, `.about-*`, `.detail-*`                                 | `mock.css`                | Secondary pages, mirroring the mock's screens                                                                                                                                     |
| `OutcomeBadge`, `SeverityLabel`, `VerdictBadge`, `SyntheticBadge`                                                                                      | `components/status.tsx`   | **Icon + word**, never colour alone. Unknown is amber with an alert icon and is never styled as a pass                                                                            |
| `Loading`, `ErrorState`, `EmptyState`, `Notice`, `Modal`, `useToast`                                                                                   | `components/feedback.tsx` | Explicit loading, empty, error (with contract-validation details), warning and success states, the mock's modal and toast                                                         |
| `Layout`, `PageHeader`, `Brand`, `DemoBanner`, `ThemeToggle` (header)                                                                                  | `components/layout.tsx`   | Skip link, focus moves to the h1 on navigation, demo banner as `role="note"`, stack counter, mobile menu                                                                          |
| Builder pieces                                                                                                                                         | `features/builder/*`      | `BuilderPage` (mock layout), `SettingsForm` (from the schema), `ObjectivesForm`, `analysis.ts` (findings, cost headline), `BuildToolbar.tsx` (download)                           |

## Presentation helpers

- `lib/layers.ts` — the seven layers are the contract's seven tiers (no invented taxonomy); also the logo tile text/colour.
- `lib/item-cost.ts` — a per-item price from the **real** preview estimator over a one-item probe build. Every applicable meter is summed; if any meter has no rate the row is a lower bound (`≥ … partial`), and it is `Unknown` when none applies. Free/included is decided by the build policy (`allow_unverified_catalog_items`), not by the item's billing class, so an unverified free item reads `Included*` with a caveat rather than `$0`.
- `lib/compat.ts` — per-candidate verdicts (`compatible | incompatible | unknown`) for catalog cards and rows.

## Two visual registers

The site has two intentional registers that share one palette and one type scale:

1. **Marketing pages** (discover, starter builds, methodology, about, legal) — the mock's editorial
   layout: hero, display headings, cards, generous spacing.
2. **Parts pages** (builder, catalog, compare) — a dense, data-first register modelled on the
   PCPartPicker patterns in `docs/research/pcpartpicker-ux-notes.md`: a compact title, a toolbar, a
   table that is the page, 44 px rows, tabular numerals, and status carried in the table itself.
   Implemented in `dense.css` on top of the same tokens; no second palette is introduced.

## Status semantics

| Outcome | Look              | Meaning                                                       |
| ------- | ----------------- | ------------------------------------------------------------- |
| Pass    | green ✓ "Pass"    | The published rule found no problem for this revision         |
| Fail    | red ✕ "Fail"      | Hard incompatibility. Error severity blocks                   |
| Unknown | amber ! "Unknown" | Not enough information. **Never treated as compatible**       |
| Skipped | grey · "Skipped"  | The rule's condition does not apply. This is not an assertion |

Severity (Error / Warning / Info) is printed next to the outcome as its own word. The summary panel
shows the worst outcome and is styled as a warning whenever anything is unknown or unselected.

## Accessibility requirements (WCAG 2.2 AA)

- Keyboard: everything is operable with native controls (the builder's summary rows are real buttons), focus is always visible, and the skip link works.
- Structure: one h1 per page, ordered headings, landmarks (`header`, `nav` with labels, `main`, `footer`), tables with captions and `scope`, scrollable regions focusable.
- Forms: visible labels, required markers, inline errors linked by `aria-describedby` and `aria-invalid`.
- Announcements: re-evaluation results appear in an `aria-live="polite"` region; save, copy, import and delete report through the toast (`role="status"`) or an alert.
- Colour: contrast meets AA in both themes (see the contrast floor above). Status always pairs an icon with a word.
- Target size: 24×24 minimum (2.5.8).
- Mobile: the header collapses to a menu at 760 px, the builder's step list becomes a horizontal strip and its columns stack, directory rows become two-column cards. Verified at 390 px and 1440 px; widths of 320 px and up are supported.
- Verification: axe (WCAG 2.0/2.1/2.2 A and AA tags) runs on every route on desktop and mobile in CI (`tests/e2e/smoke.spec.ts`).
