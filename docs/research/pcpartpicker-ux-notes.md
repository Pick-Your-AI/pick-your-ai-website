# PCPartPicker UX notes → pattern library for PickYour.AI

Observed live on pcpartpicker.com (US locale, anonymous session) on 2026-10-16 by Window 2, at a 1456 px desktop width and a 390 px mobile width.
This file only describes behaviour. No screenshots, branding, copy, icons or assets were taken from the site, and none may be.
PickYour.AI must keep its own identity. These notes are about interaction patterns, not the look.

Each pattern is tagged:

- **ADOPT**: use the interaction as is (it is generic, good UX).
- **ADAPT**: keep the idea and change it to fit AI stacks and our contract (`pass` / `fail` / `unknown` / `skipped` outcomes, `info` / `warning` / `error` severity).
- **AVOID**: do not copy it, with the reason.

---

## 1. Global shell and navigation

What PCPartPicker does:

- A thin dark top bar holds the logo, account links and region picker. Under it, a second bar holds the primary nav: Builder, Products (a mega-menu grouped by category: core parts, peripherals, displays, software, expansion, accessories), Guides, Completed Builds, Trends, Benchmarks, Forums, and a search icon.
- Every page has a full-width coloured title band with a single H1 ("Choose Your Parts", "Choose A Video Card", or the product name). Some pages put tabs inside the band (Overview / Prices By Merchant; Details / Reviews).
- On mobile the nav collapses to icon buttons (builder, products, search, account) plus a hamburger.

Patterns:

| # | Pattern | Tag | PickYour.AI translation |
|---|---|---|---|
| 1.1 | "Builder" is the first nav item and always one click away | ADOPT | `Builder` first in the nav. The Catalog mega-menu is grouped by tier T0–T6. |
| 1.2 | Products mega-menu grouped by category families | ADAPT | Group by T0 Requirements, T1 Models, T2 Infrastructure, T3 Knowledge & Retrieval, T4 Agents & Integrations, T5 Training, T6 Deployment & Ops. |
| 1.3 | Page title band with in-band tabs | ADAPT | Use a compact title row with tabs (e.g. Build: *Overview / Cost breakdown / Evidence*). Our own colours and type. |
| 1.4 | Mobile: icon shortcuts for Builder/Catalog/Search plus a hamburger | ADOPT | Keep "Builder" reachable in one tap on mobile, and show the build's selection count on the icon. |
| 1.5 | Region/currency selector in the header | AVOID (for now) | We have no live prices. Don't imply locale pricing until real data exists. |

## 2. Homepage

What it does: a single-line value proposition in three short imperative sentences, one-sentence subcopy, one primary CTA ("Start Your Build"), then a large live-looking preview of the builder table. Below that come curated build guides as cards (title, key parts, total, vote count) and a "Completed Builds" community strip.

| # | Pattern | Tag | Translation |
|---|---|---|---|
| 2.1 | One primary CTA straight into the builder | ADOPT | "Start a stack" → `/builder`. |
| 2.2 | Hero shows the actual product (builder table) rather than illustration | ADAPT | Show a static, clearly labelled *example* stack summary with T0–T6 rows. It must be marked as example or fixture data. |
| 2.3 | Curated starter builds ("Entry", "Great", "Excellent", "Magnificent") | ADAPT | "Starter stacks" (e.g. *Local RAG on a workstation*, *Managed-API agent*, *Fine-tune on rented GPUs*). Each opens prefilled in the builder. Use fixture data only, and say so. |
| 2.4 | Community completed builds, vote counts, usernames | AVOID (for now) | We have no accounts or moderation. Leave it out instead of faking it. |

## 3. The builder (the `/list/` part list)

This is the core pattern and the one most worth studying.

What it does:

- **Fixed category rows in a fixed order**, one per component type (CPU, CPU Cooler, Motherboard, Memory, Storage, Video Card, Case, Power Supply, OS, Monitor). An empty row shows a single primary button, "Choose A …". A filled row shows the thumbnail, full product name, and the price columns Base / Promo / Shipping / Tax / Availability / Price / Where, plus Buy, configure (gear) and remove (×).
- **Secondary categories are collapsed** into grouped rows of links at the bottom ("Expansion Cards / Networking", "Peripherals", "Accessories / Other"), so the main table stays short.
- **Toolbar above the table**: the permalink in a copyable field, markup export buttons (forum markup, Reddit, HTML, plain text, BBCode), History, Save As, Start New.
- **Status strip directly under the toolbar**: a full-width bar coloured by overall compatibility. It is green with "Compatibility: See details below" when OK, and red with a warning icon ("Warning! These parts have potential incompatibilities. See details below") when not. Next to it is a separate blue pill, "Estimated Wattage: 105W", that recomputes on every change.
- **Running total** under the table.
- **Compatibility Notes section** below the table. Each note is a lettered, colour-coded badge (A, B, C …) with a severity word: *Problem* (red), *Warning* (amber), *Disclaimer* (blue). Example: Problem says that motherboard X and CPU Y are not compatible. Warning says the CPU has no stock cooler, so add one. Disclaimer says some physical constraints, such as RAM clearance, are not checked.
- **"Motherboard Usage" diagram**: a slot map (CPU socket, memory slots, M.2 slots, cooler mounts) where each attached part is drawn as a box linked to its slot. An incompatible part gets a red dashed connector, the same letter badge as its note, and an inline reason ("The CPU is not compatible with the motherboard").
- **The anonymous list persists** across page loads without an account (session-backed), and the permalink changes as the list changes.
- On mobile each row becomes a **stacked card**: the category heading, the product, a 2×N grid of labelled price fields, and full-width Configure / Remove buttons. The status strip and wattage pill stack vertically.

| # | Pattern | Tag | Translation |
|---|---|---|---|
| 3.1 | Fixed, ordered category rows with a "Choose …" CTA when empty | ADOPT | One row per T0–T6 slot, in tier order. An empty row shows "Choose a model" etc. Optional tiers (T5 Training, parts of T6) show **"Optional · Skip"** and can be marked `skipped`. |
| 3.2 | Secondary categories collapsed into link groups | ADAPT | Put rarely used slots (e.g. eval harness, observability, guardrails) in an "Add-ons" group per tier, so the core table stays scannable. |
| 3.3 | Overall status strip coloured by worst outcome | ADAPT | Strip summarises the **worst outcome across evaluations**: `fail` → error styling, any `unknown` → neutral/amber "N unknowns", all `pass` → success. **Never show green when anything is `unknown`.** Always use an icon and a word, never colour alone (WCAG). |
| 3.4 | A live derived metric next to the status (wattage) | ADAPT | Show live derived estimates such as *Est. GPU memory needed*, *Est. monthly cost*, and *Context window fit*. Each is labelled "estimate", links to its method, and shows "—" or "Unknown" when the inputs are missing. |
| 3.5 | Lettered, severity-labelled notes list | ADOPT | Findings list with letter badges and the severity words `Error` / `Warning` / `Info`, plus outcome chips `Fail` / `Unknown` / `Skipped`. Every finding names the affected components and gives the reason and a suggested fix (contract fields). |
| 3.6 | Explicit "not checked" disclaimer | ADOPT, strongly | It maps directly to our `unknown` / `skipped` honesty requirement. List what the rules engine did *not* evaluate. |
| 3.7 | Slot/usage diagram linking parts to the resource they consume | ADAPT | A "Stack wiring" view shows which model runs on which infra, which retrieval store feeds which agent, and the GPU memory and context budget used against capacity. Broken links get the same letter badge as their finding. This is a stretch goal, after the table works. |
| 3.8 | Inline gear "configure" per row | ADAPT | Per-row options such as quantization, region, instance count, and context length. A change invalidates the downstream evaluations, so show a "re-evaluating…" state on the affected rows. |
| 3.9 | Permalink, Save As, Start New, History | ADAPT | Local-first: *Save* to browser storage (My Builds), *Share* = URL-encoded build plus JSON export/import, *New*, *History* (local revision list). Don't show account-backed actions yet. |
| 3.10 | Export in multiple markups | ADAPT | Export as Markdown, JSON (contract-shaped), and plain text. Skip BBCode and forum markup. |
| 3.11 | Buy buttons, affiliate links, retailer logos per row | AVOID | We have no commerce and no verified prices. Use "Docs" or "Provider page" links at most, with no affiliate tracking. |
| 3.12 | Price breakdown columns (Base/Promo/Shipping/Tax) | AVOID | Too retail-specific. Use a single *Cost basis* column (e.g. "$/1M tokens", "$/GPU-hr", "self-hosted"), plus evidence freshness. |
| 3.13 | Mobile: rows → stacked cards with labelled field grid and full-width actions | ADOPT | Show the builder as cards under ~768 px. Keep the status strip **sticky** at the top on mobile, which PCPartPicker does not do and is an improvement for us. |

## 4. Category product selection (`/products/<category>/`)

What it does:

- Two columns. The **left sidebar** holds a mini "Part List" card (part count, running total, estimated wattage) and a **Compatibility Filter** checkbox, which is on by default. Below that come Merchants / Pricing options, then collapsible filter groups: a price range slider with numeric endpoints, Manufacturer (All plus a checkbox list with "Show more"), Rating (stars), and category-specific specs (Chipset, Memory, Length, …).
- **The main area** has a count headline ("6814 Compatible Products"). A sub-line says either "No products are incompatible with your Part List" or "Show 4750 products incompatible with your Part List". When filters apply, a "Filtered by:" row shows removable chips (e.g. MANUFACTURER: EVGA ×). The area also has an in-category search box, Select All / Select None / **Compare Selected**, and "Add From Filter".
- **Dense sortable table**: checkbox, thumbnail, name, 5–7 key spec columns chosen per category, rating with count, price, and an Add button. Every column header has a sort chevron.
- With the compatibility filter **off**, incompatible products stay in the list, but the Add button changes state: red with a "blocked" icon for incompatible, amber with a warning icon for "compatible with caveats", blue "+" for OK. The state comes from button styling, and there is no tooltip explaining why.
- **Filter and sort state live in the URL fragment**, so a filtered view is linkable and survives reload.
- On mobile the sidebar becomes a full-screen "Filters" sheet with a back arrow and a live result count in its header. There is a separate "Sort" button, and the table rows become cards with a 3-column labelled spec grid.

| # | Pattern | Tag | Translation |
|---|---|---|---|
| 4.1 | Compatibility filter on by default with a count of hidden items and a one-click reveal | ADOPT | "Showing 42 compatible with your stack · Show 17 incompatible · 9 unknown". **Unknown must be its own bucket**, not merged into compatible. |
| 4.2 | Mini build summary in the selection sidebar | ADOPT | Keep the build context visible while browsing: selected count per tier, worst outcome, cost estimate. |
| 4.3 | Faceted filters: range slider + checkbox lists + "Show more" | ADOPT | Facets come from the catalog schema per category (e.g. Models: modality, context length, license, open-weights, provider; Infra: GPU memory, region, managed vs self-hosted). |
| 4.4 | Active-filter chips with × to remove | ADOPT | Include a "Clear all" control. |
| 4.5 | Per-category spec columns in the table | ADOPT | Each category declares its 4–6 key columns. Missing values render as "—" with an accessible "not available" label, never as 0. |
| 4.6 | Sortable column headers | ADOPT | Use `aria-sort` on headers. Sort with "unknown" values last. |
| 4.7 | Add button changes colour for incompatible/warning items, without explanation | ADAPT | Keep the per-row outcome, but **show it as a text chip** ("Incompatible", "Check", "Unknown") and give the reason in a disclosure or tooltip that keyboard users can reach. Do not rely on colour alone. |
| 4.8 | Filter/sort state encoded in URL | ADOPT | Use query params (not the hash), so routes stay SPA-friendly and shareable. |
| 4.9 | Mobile full-screen filter sheet with live count; separate Sort | ADOPT | Use the dialog pattern with focus trap and a "Show N results" button. |
| 4.10 | Checkbox multi-select → "Compare Selected" | ADOPT | Cap it at 2–4 items and show a sticky compare tray at the bottom. |
| 4.11 | Star ratings and review counts | AVOID | We have no review corpus. Use **evidence quality and freshness** instead (source count and last-verified date). |
| 4.12 | "Add From Filter" (parametric selection) | ADAPT, later | See §7. |

## 5. Product detail (`/product/<id>/…`)

What it does: the title band shows the category eyebrow, the full product name, and the rating. A left card holds the image gallery, a QTY selector with **Add to Part List**, a rating histogram, and save/inventory actions that need login. The right column has a merchant price table (merchant, base, shipping, availability, total, Buy, "last updated N minutes ago"), legal footnotes, a price alert that needs login, and a price-history chart with a range selector. Below that come a specs list, "Compatible Parts" deep links ("View Compatible Cases / Motherboards / Power Supplies"), reviews, and "Builds using this part". A sidebar block shows each spec with its sibling values in the same product family, so the user can jump to a variant.

| # | Pattern | Tag | Translation |
|---|---|---|---|
| 5.1 | Primary "Add to build" next to the identity block | ADOPT | "Add to stack (T1 · Model)". If the slot is already filled, the label is "Replace current selection". |
| 5.2 | Full spec table | ADOPT | Group specs into sections. Each value carries its own provenance (source, retrieved-at), and unknowns are explicit. |
| 5.3 | "View compatible X" deep links into filtered category lists | ADOPT | E.g. from a model: "Compatible inference runtimes", "Infra that fits this model". These link into the selection list with the filter pre-applied. |
| 5.4 | "Last updated N minutes ago" on prices | ADAPT | Show **evidence freshness** on every price, benchmark or limit, and flag stale data. |
| 5.5 | Price history chart | AVOID (now) | We have no real time series. A synthetic chart would mislead users. |
| 5.6 | Variant switcher (sibling values per spec) | ADAPT | Model family variants (sizes, quantizations, context lengths) as chips. |
| 5.7 | Retailer list, Buy buttons, affiliate disclosure | AVOID | Not our model. |

## 6. Compare (`/products/compare/<id>,<id>/`)

What it does: a side-by-side column per product (image, name, Add, lowest price), then **aligned spec rows** with the label repeated above each value. Empty values are left blank. It has its own permalink plus the same markup export buttons.

| # | Pattern | Tag | Translation |
|---|---|---|---|
| 6.1 | Shareable compare URL | ADOPT | `/compare?ids=a,b,c`. |
| 6.2 | Aligned spec rows | ADOPT | Also add a "**Highlight differences**" toggle and "Hide identical rows", which PCPartPicker lacks. |
| 6.3 | Blank cell for missing values | AVOID | Render "Unknown", or "Not applicable" when it truly isn't. |
| 6.4 | Add-to-build from compare | ADOPT | Put an "Add to stack" button in each column. |
| 6.5 | Compare whole configurations | ADAPT (new) | PickYour.AI's Compare page also compares **two builds**: per-tier diff, outcome diff, and cost-estimate diff. |

## 7. Guides, parametric selections and shared lists

What it does: a guide page has prose rationale per category beside an embedded read-only part list with a "**Customize This Part List**" button. Some rows are not a fixed product but a **parametric filter** ("From parametric filter: Form Factor: ATX, Micro ATX · Chipset: B650 · …"), and the site resolves it to the cheapest matching compatible item. Other rows are a **parametric selection**, an explicit allow-list of interchangeable products. Shared lists are read-only views with the same compatibility block and a permalink.

| # | Pattern | Tag | Translation |
|---|---|---|---|
| 7.1 | Read-only shared view + "Customize" (copy into my builder) | ADOPT | The `/b/<encoded>` shared build page has an **Import to my builds** button. The shared view never mutates the viewer's drafts. |
| 7.2 | Rationale prose next to each selection | ADOPT | Each starter stack explains "why this component" per tier. |
| 7.3 | **Parametric slots** (requirements instead of a fixed product) | ADAPT (high value) | This is a natural fit for AI stacks. A T0 requirement like "open-weights, ≥ 32k context, fits 24 GB" can stay a *constraint* until a concrete pick is made. The UI shows the constraint set and the matching candidates. Resolution belongs to the research rules engine, not the website. |
| 7.4 | Vote counts, comment threads | AVOID | Out of scope; would need moderation. |

## 8. Price display

What it does: prices are right-aligned and bold. The row total is green. Out-of-stock rows show greyed strikethrough with the label "Out of stock". "+" after a price means extra charges may apply. A running total sits under the table. Affiliate and accuracy disclaimers sit directly under any price table.

| # | Pattern | Tag | Translation |
|---|---|---|---|
| 8.1 | Right-aligned tabular numerals, single running total | ADOPT | Use `font-variant-numeric: tabular-nums`. |
| 8.2 | Disclaimer right under any monetary figure | ADOPT | "Estimates from fixture data, not quotes", plus the evidence date. |
| 8.3 | "+" suffix for incomplete totals | ADAPT | If any selected component has an unknown cost, the total shows "≥ $X" or "$X + unknown", and **never a clean total**. |
| 8.4 | Green colour for prices | AVOID | Green is reserved for `pass`. Using it for money confuses status semantics. |

## 9. Mobile behaviour summary (observed at 390 px)

- Builder rows turn into stacked cards. Key fields sit in a labelled 2-column grid, and actions become full-width buttons.
- The toolbar wraps into three lines (permalink, markup icons, History/Save/New). The status bar and wattage pill stack.
- Product lists turn into cards with name, rating and price on top and a 3-column spec grid below.
- Filters move into a full-screen sheet. Sort is its own button.
- Gaps to improve on: the overall status is **not sticky**, so it scrolls away, and the running total is only at the bottom. PickYour.AI should keep a compact sticky summary bar (outcome + count of unknowns + estimate) on mobile that expands into the full summary.

## 10. Accessibility observations (things to do better)

- Incompatibility in the selection list comes only from button colour and icon, with no reason given. We should add text and a reason.
- Severity letters (A/B/C) do pair a colour with a word, which is good and worth adopting.
- Missing spec values appear as blank or as "—" without a label. We should give an explicit accessible label.
- Announce status changes: when a selection changes the overall outcome, use an `aria-live="polite"` message (e.g. "1 new error: model exceeds GPU memory").

## 11. Top 10 for Window 1, in priority order

1. A fixed T0–T6 row table with "Choose …" empty states and **Optional · Skip** for optional tiers (3.1).
2. An overall outcome strip and a live estimate pill. Unknown must never look like pass (3.3, 3.4).
3. Lettered findings with severity word, affected components, reason, and fix, plus a "not evaluated" disclaimer (3.5, 3.6).
4. A selection page with the compatibility filter on by default and **separate Incompatible / Unknown buckets** (4.1).
5. Faceted filters, active chips, sortable columns, and URL-encoded state (4.3, 4.4, 4.6, 4.8).
6. A per-row outcome as a text chip with an accessible reason (4.7).
7. Compare with aligned rows and a highlight-differences toggle (6.2).
8. A read-only shared build view with "Import to my builds" (7.1). Local-first save/export/import (3.9, 3.10).
9. Mobile card layout, a full-screen filter sheet, and a **sticky compact summary** (3.13, 4.9, §9).
10. Parametric (constraint) slots as a later enhancement, with resolution owned by the research rules engine (7.3).

Avoid: retail Buy/affiliate UI, star ratings, price-history charts, community votes and comments, green prices, and any blank cell that could be read as "fine".
