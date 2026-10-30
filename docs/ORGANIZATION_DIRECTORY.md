# Organization directory (`/organization/`)

This describes how the website will serve the organization's current directory at `/organization/`. **It does
not serve one yet:** today `https://pickyour.ai/organization/` falls through to the site's home page, and
No organization directory is published until a reviewed bundle is admitted and deployed. The directory is
**generated and reviewed in `Pick-Your-AI/.github`** (`docs/organization/current/`). The website ingests that
bundle byte for byte and never renders, extends or duplicates it: there is no second renderer, no second
registry and no roster or private state here.

> **Status (2026-10-30): no bundle is admitted.** `contracts/organization/PIN.json` records
> candidate `9abadb5fe22115da900dd86483c7428bc8b44b0e` (head of unmerged `.github` PR #24) as
> **eligibility: pending**. It has no recorded independent human approval and is not an ancestor of
> `.github` `main` (checked against `main` at `88c3cc229cb4`, which has no `docs/organization/` at all).
> It is not approved and not deployable. Until a reviewed commit is admitted, `/organization` shows a plain
> "not published yet" page with no organization data. Nothing in this repository is marked human-approved or
> deployed.

## What is pinned

| Item          | Value                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Source        | `Pick-Your-AI/.github`, path `docs/organization/current/`, one **full 40-character commit SHA**    |
| Destination   | `public/organization/` (Vite copies `public/` into `dist/`; nothing is rendered or rewritten)      |
| Pin           | `contracts/organization/PIN.json`: source SHA, merged PR, human review, per-file SHA-256 and sizes |
| Files         | The complete canonical bundle together, **including `README.md` unchanged**                        |
| Upstream host | Fixed in `scripts/organization-lib.mjs`; never read from the pin, the bundle or the command line   |

Branches, tags and short SHAs are refused. A moving ref cannot be pinned. `README.md` contains a
repository-relative link (`../../ORGANIZATION.md`); the website does not link to it and it is not a website
route. Policy and maintenance documents are linked by absolute `.github` URLs.

## What the validator enforces

`scripts/organization-lib.mjs` (run by `npm run organization:verify`, `check-dist.mjs`, CI and the importer)
takes no options and fails closed on:

- **A closed file inventory.** Exactly `index.html`, `directory.js`, `organization.json` and `README.md`, plus
  exactly the chart triples the model declares: `overview`, `hierarchy` and one `area-<area id>` for every entry
  in `organization.json` `areas`, each with `.mmd`, `.svg` and `.png`, all linked from `index.html`. Any other
  file is refused (including any extra `.html`, `.js`, `.json`, `.md` or an unknown chart stem), because
  everything in the bundle is copied to the host. Flat, reviewed names only; no symlinks; size limits.
- **A reviewed script, by hash.** `directory.js` runs in visitors' browsers. Production admission requires its
  SHA-256 to be in `REVIEWED_DIRECTORY_SCRIPT_SHA256`, currently the single canonical script
  (`8d0bf2a1…f813`, byte-equal in `.github` `governance/directory.js` and the candidate bundle). No flag,
  option, pin field or environment variable can add to that list; **a new script revision needs an explicit
  website code-review change to that constant.** The pattern scan that also runs on the script (network,
  storage, dynamic-code and navigation APIs) is **supplementary, not a proof of behaviour**: computed access such as
  `globalThis["fetch"](…)` defeats any such scan, which is exactly why the hash is the control.
- **Same revision.** The observation time, source revision, policy revision and mapping revision shown in
  `index.html` and `README.md` equal those in `organization.json`; the table rows are exactly the model's
  teams, repositories and Projects (by URL); relationship endpoints exist in the model.
- **Strict shape.** `organization.json` must have exactly the reviewed top-level keys; unreviewed HTML elements
  fail too. An upstream renderer or schema change therefore fails here until this validator is reviewed.
- **Privacy.** No roster, member, invitation, email, avatar, token or personal-login keys; no email addresses,
  `@mentions` or credential-shaped strings in the model or Mermaid sources.
- **Safety of the rest.** One external script and no inline script, event handler, `style` attribute, remote
  link or resource (links may only go to `github.com/Pick-Your-AI` or `github.com/orgs/Pick-Your-AI`). SVGs may
  not contain scripts, handlers, `foreignObject`, images or external references. PNGs must be complete. Mermaid
  sources may not contain `click`/`init` directives. The embedded CSP must keep `script-src 'self'`.
- **Bytes.** Every file equals its pinned SHA-256; `public/organization/` contains exactly the pinned set;
  **unadmitted bytes in the tree fail the build**; `dist/organization/` must equal the pin (or be absent).

The checks are structural. They do not make a bundle approved, and a hash pin is only as trustworthy as the
review recorded beside it.

## Admission: what counts as approved

There is **one** admission path: the commit is already an **ancestor of `.github` `main`** (checked live with
`git merge-base --is-ancestor` after fetching `main`), and the pin records the merged pull request, the URL of
the independent **human** review, and the reviewer's login. Automatic review, bot reactions and check results
are not approval. The importer cannot verify a review by itself; the website PR review is the control. There
is no path for an unmerged commit or an owner-granted exception, and `.github` PRs #22 → #23 → #24 must merge,
in that order, with genuine human approval before any bundle can be admitted.

`npm run organization:verify -- --upstream` (run in CI) re-fetches the pinned commit, compares every byte,
re-validates the full bundle and re-checks ancestry. A pin whose commit is not on `main` fails.

## Proposing a bundle (current path: manual, by an authorized human)

Collection, organization-artifact approval, website source-pin approval and publication are **four separate
steps with separate timestamps**; nothing here collapses them.

1. In `.github`, the refresh workflow proposes a generated artifact PR. A genuinely independent human
   reviews it and it is merged. (Observation time: `organization.json` `observation.completed_at`.)
2. An authorized website maintainer starts from `main` on a `feat/…` branch and runs, with the **full merged SHA**:

   ```sh
   npm ci
   npm run organization:update -- --ref <40-char-sha> \
     --pull-request https://github.com/Pick-Your-AI/.github/pull/<n> \
     --review-url https://github.com/Pick-Your-AI/.github/pull/<n>#pullrequestreview-<id> \
     --reviewer <github-login-of-the-human-reviewer>
   ```

   The importer fetches that commit's data from the fixed upstream, refuses it unless it validates and is on
   `main`, then rewrites `public/organization/` and `PIN.json` atomically. Nothing from the fetched commit is
   executed, and no branch such as `automation/current-organization` is ever followed.

3. Run the checks in `AGENTS.md`, open a PR, and merge through `ci-required` and one non-author approval.
   Merging to `main` deploys; that merge is the **website source-pin approval**.
4. Verify the live site. The deployed website commit is `version.json.commit`. **The published time is the
   successful deployment readback, not the observation time.** The directory page says so itself.

A changed bundle is a changed build input and therefore a new website commit. `version.json` keeps its exact
shape and an immutable release is never overwritten under an old commit identity; the live-admission and
rollback machinery work unchanged.

### Automatic propagation is not available

A proposal workflow is **prepared for the operations owner in `ops-proposal.patch` but is not installed and
cannot work today**. It needs a writer that may create a branch and open a PR here, and that is a missing
owner gate: the repository's Actions setting for creating pull requests is off (so the workflow token cannot
open one), the contributor-boundary rules apply to `feat/*` branches (the prepared workflow therefore uses a
`contrib/…` branch), and a PR opened with the workflow token would not start CI anyway. The collector App must
not receive website write access. A separate, narrowly scoped publication identity would be needed, and
enabling settings or bypasses is not part of this work. Until then **propagation is manual**, and automatic
end-to-end publication remains an open acceptance item.

## Host requirements (operations-owned files; prepared, not applied)

The concrete proposal is `docs/organization-operations.patch`. After owner review,
apply it to the reviewed base with `git apply --index --unidiff-zero
docs/organization-operations.patch`. This zero-context patch requires an unchanged
index matching its base blobs; it is not applied by this integration.

The static page works only if the host cooperates:

- **CSP.** The canonical page embeds one `<style>` block and its SVG exports carry inline styles, but the site
  CSP says `style-src 'self'`. Measured in Chromium with the current header: the page loses its styling and an
  opened SVG logs hundreds of CSP errors; with `style-src 'self' 'unsafe-inline'` scoped to `/organization/`
  both render. `script-src 'self'` is unchanged, and live verification parses the effective policy strictly
  (`script-src` must be only `'self'`; `script-src-elem` and `script-src-attr` may not widen it). The durable
  fix is for the generator to emit an external stylesheet; then the exception is removed.
- **MIME.** `.mmd` has no default type; with `nosniff` that is a blank download. Serve it as `text/plain`.
- **Live verification.** Must check that the actual `/organization/` response is **byte-identical to the
  pinned `index.html`** (a marker is not enough: it could accept a stale or wrong canonical route), plus every
  file's bytes and MIME type, the redirect from `/organization`, and the CSP.
- **Cache.** The existing `no-cache, must-revalidate` outside `/assets/` already applies.

### Hosting gate: host-injected monitoring (verified 2026-10-30)

The production host currently injects its own monitoring into HTML responses: an inline script plus an external
script from the host provider's CDN, neither part of this repository. The existing CSP blocks their execution
but cannot preserve **byte identity**, so the exact-bytes check on `/organization/` will correctly fail until
the operations owner opts this site out of host-injected monitoring and verifies byte equality. Do not weaken
the hash check and do not strip or ignore injected scripts to get a deployment through. This needs an
action in the hosting account that no one has authorized this work to take. Account and block identifiers
are intentionally not recorded here.

`/organization/` must be linked with a **plain anchor**, not a router `Link`: it is a separate document, and a
client-side navigation would show the pending page instead. `directory.js` loads relatively, so the trailing
slash matters; Apache redirects `/organization` to `/organization/` once the directory exists.

## Navigation and accessibility

The About page ("Who maintains what, and who do I ask?") links to `/organization/` and to the canonical policy
(`.github/docs/governance/ESCALATION.md`); the pending page and the directory itself link the policy and the
maintenance guide. The website neither copies nor paraphrases the policy. The shared header and footer are
unchanged. The static page is checked in Chromium for filters, link integrity, keyboard use (skip link, search
focus), axe WCAG 2.2 AA and 320 px reflow (`tests/e2e/organization.spec.ts`); `/organization/` is also in the
one-h1, accessible-name, no-third-party-request and no-horizontal-scroll route sweeps. The page's freshness line
is generated by `directory.js` from the model's observation time and its "proposed" three-hour threshold; it
makes no publication claim.

## Verifying a candidate locally (never admits)

```sh
node scripts/organization.mjs inspect --source-dir /path/to/docs/organization/current
node scripts/organization.mjs inspect --local-repo /path/to/.github --sha <40-char-sha> --expect-sha <40-char-sha>
```

`inspect` validates structure and prints per-file hashes. It writes nothing and always reports
`ELIGIBILITY: PENDING`. To look at a candidate in a browser, copy its files into the ephemeral, git-ignored
`dist/organization/` only; `node scripts/organization.mjs verify-dist` (and `check-dist.mjs`) will then
correctly refuse that build output until the bytes are admitted.

## Rollback and disabling

- **Bad bundle live:** revert the admitting PR (restores the previous pin and bytes together), or use the
  operations rollback to a retained release (`docs/operations/backup-and-rollback.md`).
- **Stop publishing the directory:** revert to the "no bundle admitted" pin (`admitted: null`, remove
  `public/organization/`). `/organization/` returns to the pending page.
