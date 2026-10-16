# Product overview

**PickYour.AI is a parts list for AI systems.** Users pick components across seven tiers (T0 Requirements → T6 Operations). The builder then shows what is selected, what is still needed, which choices are incompatible and why, what is **unknown**, and what the stack may cost when prices are evidenced.

It is a decision-support tool, not a chatbot, and it does not try to be a model leaderboard. Its job is to keep a traceable, revisioned record of a configuration and the evidence behind each verdict. The market research supports this positioning as a hypothesis; see `RESEARCH_MAPPING.md`.

## Current scope (preview)

| Delivered                                           | Preview / not yet                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| All 29 component kinds across T0–T6; optional T3–T5 | Real catalog data (research in progress)                           |
| Compatibility from the published v1 ruleset         | Calibrated capacity (VRAM) estimates, so these show as **Unknown** |
| Revisioned local drafts, export/import, share links | Accounts and server-side sharing                                   |
| Preview cost estimates with coverage                | Real prices or quotes                                              |
| Compare components, builds and revisions            | Deployment from the site                                           |

## Sitemap and navigation

The primary nav is **Builder** (with a selection count), Catalog, Compare, My Builds, Methodology and About. The footer links Methodology, About, Privacy & terms, the source and the research repository, and shows the build SHA, data mode and contract version.

```text
/                      Home: value proposition, how it works, starter stacks (demo), honesty principles
/builder               AI Stack Builder (T0–T6 rows, summary, findings, toolbar)
/catalog               Tiers → kinds, global search
/catalog/:kind         Component selection: search, facets, sort, compatibility buckets, compare tray
/catalog/:kind/:item   Component details: spec, dependencies, rules, cost context, evidence
/compare               Components (?ids=), builds (?builds=), revisions (?revisions=)
/summary               Printable build summary with cost breakdown
/builds                My Builds (browser-local)
/shared                Read-only shared build preview → import
/methodology           Outcomes, invalidation, pricing, evidence, data mode, all rules and edges
/about, /legal         Project context; privacy and terms
```

## User journeys

1. **Start from a starter.** Home, then _Open in builder_, gives a pre-filled demo stack. The user reviews its findings, swaps the model, sees the invalidation notice and new results, and exports or shares it.
2. **Build from scratch.** The builder shows "Choose a workload", and the need badges then guide the user through T0 and T1. Picking a deployment mode turns T2 kinds into _Needed_ or _Not needed_. Optional tiers stay collapsed. The next-action hint names the next missing piece.
3. **Choose with constraints.** On a selection page the compatibility filter hides incompatible options by default but still counts them. Unknown options form their own bucket, each with a "Why?" list of rules. The user filters by spec facets, compares up to four options, then adds one.
4. **Resolve a conflict.** A lettered finding names the affected components and gives the reason and a suggested fix. The user replaces or configures a component, and the finding updates for the new revision.
5. **Keep and share.** The draft autosaves locally. My Builds lists, opens, duplicates, exports and deletes builds. A share link carries the build in the URL fragment, and the recipient sees a read-only preview and can import it.
6. **Compare.** The user compares two revisions to see what changed and how outcomes and cost moved, or compares two saved builds.

## Terminology

Use **stack/build**, **component**, **kind** and **tier** as the core nouns. The outcome words are **Pass, Fail, Unknown and Skipped**. Severity is a separate dimension, with the words **Error, Warning and Info**. "Compatible" is used only for rule passes and is always qualified ("rules pass"; "No rule failures"). Missing data is always "Unknown" or "Not specified", never blank or 0. The label "Synthetic" marks demo data.
