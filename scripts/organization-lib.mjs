// Strict, pinned importer and validator for the canonical organization directory bundle.
//
// The bundle (`docs/organization/current/*` in Pick-Your-AI/.github) is generated there by its own
// reviewed pipeline. This module never renders, re-derives or extends it: it only (1) checks that a
// candidate directory is exactly the expected shape, internally consistent and free of private or
// executable surprises, and (2) records/verifies which immutable upstream commit the vendored bytes
// came from. See docs/ORGANIZATION_DIRECTORY.md.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SOURCE_REPOSITORY = 'Pick-Your-AI/.github';
// Fixed on purpose: the upstream location is never taken from the pin, the bundle or the command line.
export const SOURCE_URL = 'https://github.com/Pick-Your-AI/.github.git';
export const SOURCE_PATH = 'docs/organization/current';
export const SOURCE_MAIN = 'main';
export const PUBLIC_DIR = 'public/organization';
export const PIN_FILE = 'contracts/organization/PIN.json';
/**
 * The ONLY `directory.js` revisions allowed to run on this host. The script executes in visitors'
 * browsers, and no static scan can prove what code does (`globalThis["fe"+"tch"]` defeats any
 * pattern), so production admission requires an exact reviewed hash. There is deliberately no
 * option, flag or pin field that adds to this list: a new script revision needs a code-review
 * change to this file. Current entry: `governance/directory.js` in Pick-Your-AI/.github, byte-equal
 * to the copy in the candidate bundle (9abadb5…); review of that source: see docs/ORGANIZATION_DIRECTORY.md.
 */
export const REVIEWED_DIRECTORY_SCRIPT_SHA256 = Object.freeze([
  '8d0bf2a17fc7fd1ed9bdf32ebd992425f42afdaa85c6d328bae370e60589f813',
]);
/** The complete canonical bundle travels together, README.md included and unchanged. */
const CORE_FILES = new Set(['index.html', 'directory.js', 'organization.json', 'README.md']);

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 200;
const NAME_RE = /^(?:README\.md|[a-z0-9][a-z0-9-]*\.(?:html|js|json|mmd|png|svg))$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ISO_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const GH_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const CORE_CHARTS = ['overview', 'hierarchy'];
const AREA_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const ORG_LINK_RE = /^https:\/\/github\.com\/(?:orgs\/)?Pick-Your-AI(?:\/|$)/;
const TOP_LEVEL_KEYS = [
  'areas',
  'coverage',
  'freshness_basis',
  'freshness_threshold_seconds',
  'observation',
  'organization',
  'project_roles',
  'projects',
  'relationships',
  'repositories',
  'roles',
  'routing',
  'schema_version',
  'teams',
  'unavailable_approved',
  'unmapped',
];
// A new top-level or tag type means the upstream renderer changed: fail until this list is reviewed.
const ALLOWED_TAGS = new Set([
  'html',
  'meta',
  'title',
  'style',
  'a',
  'header',
  'main',
  'footer',
  'p',
  'h1',
  'h2',
  'h3',
  'label',
  'input',
  'select',
  'option',
  'div',
  'span',
  'table',
  'caption',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'details',
  'summary',
  'code',
  'br',
  'ul',
  'li',
  'time',
  'script',
  'strong',
  'em',
]);
const FORBIDDEN_KEYS = new Set([
  'email',
  'emails',
  'mail',
  'members',
  'member_logins',
  'users',
  'invitations',
  'invitees',
  'roster',
  'avatar_url',
  'token',
  'secret',
  'private_key',
  'password',
]);
const SECRET_RE =
  /\bgh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const MENTION_RE = /(?:^|[\s(>"'])@[A-Za-z0-9][A-Za-z0-9-]*/;
const JS_FORBIDDEN =
  /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(|\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(|document\.write|\.innerHTML|\.outerHTML|insertAdjacentHTML|postMessage|localStorage|sessionStorage|indexedDB|WebSocket|sendBeacon|\bimportScripts\b|\bWorker\s*\(|location\s*(?:\.|=)/;

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameKeys = (value, keys) =>
  isObject(value) && Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');

function utf8(buffer, label, errors) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    errors.push(`${label}: not valid UTF-8`);
    return null;
  }
}

function* walkJson(value, path = '$') {
  yield [path, value];
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* walkJson(value[i], `${path}[${i}]`);
  } else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) yield* walkJson(v, `${path}.${k}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Bundle validation
// ---------------------------------------------------------------------------------------------

function checkNames(files, errors) {
  if (files.size === 0) errors.push('bundle is empty');
  if (files.size > MAX_FILES) errors.push(`bundle has ${files.size} files (limit ${MAX_FILES})`);
  let total = 0;
  for (const [name, data] of files) {
    if (!NAME_RE.test(name)) errors.push(`unexpected file name: ${JSON.stringify(name)}`);
    if (data.length === 0) errors.push(`${name}: empty file`);
    if (data.length > MAX_FILE_BYTES) errors.push(`${name}: larger than ${MAX_FILE_BYTES} bytes`);
    total += data.length;
  }
  if (total > MAX_TOTAL_BYTES) errors.push(`bundle is larger than ${MAX_TOTAL_BYTES} bytes`);
}

/**
 * The file inventory is closed: the four core files, plus exactly the chart triples the model
 * declares (`overview`, `hierarchy` and one `area-<area id>` per model area). Any other file, including
 * any extra .html/.js/.json, is refused, because every file in the bundle is copied to the host.
 */
function checkCompleteness(files, model, errors) {
  const charts = [...CORE_CHARTS];
  const seen = new Set();
  for (const area of Array.isArray(model?.areas) ? model.areas : []) {
    const id = area?.id;
    if (typeof id !== 'string' || !AREA_ID_RE.test(id) || seen.has(id))
      errors.push(`organization.json: area id ${JSON.stringify(id)} is invalid or duplicated`);
    else {
      seen.add(id);
      charts.push(`area-${id}`);
    }
  }
  const expected = new Set(charts);
  for (const name of CORE_FILES)
    if (!files.has(name)) errors.push(`missing required file: ${name}`);
  for (const name of files.keys()) {
    if (CORE_FILES.has(name)) continue;
    const m = /^(.+)\.(mmd|svg|png)$/.exec(name);
    if (!m || !expected.has(m[1]))
      errors.push(`unexpected file ${JSON.stringify(name)}: not part of the reviewed bundle`);
  }
  // Every chart travels as a Mermaid source plus both exports from the same revision.
  for (const stem of charts)
    for (const ext of ['mmd', 'svg', 'png'])
      if (!files.has(`${stem}.${ext}`)) errors.push(`chart ${stem} is missing its .${ext}`);
  return charts;
}

function checkExports(files, errors) {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const iend = Buffer.from('0000000049454e44ae426082', 'hex');
  for (const [name, data] of files) {
    if (name.endsWith('.png')) {
      if (!data.subarray(0, 8).equals(png)) errors.push(`${name}: not a PNG`);
      else if (!data.subarray(-12).equals(iend)) errors.push(`${name}: truncated PNG`);
    } else if (name.endsWith('.svg')) {
      const text = utf8(data, name, errors);
      if (text === null) continue;
      if (!/^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/.test(text)) errors.push(`${name}: not an SVG`);
      if (
        /<script\b|<foreignObject\b|<image\b|<iframe\b|<use\b[^>]*href\s*=\s*["'](?!#)|\bon[a-z]+\s*=|javascript:|@import|url\(\s*["']?(?:https?:|\/\/|data:)|(?:xlink:)?href\s*=\s*["'](?!#)/i.test(
          text,
        )
      )
        errors.push(`${name}: contains script, external reference or embedded content`);
    } else if (name.endsWith('.mmd')) {
      const text = utf8(data, name, errors);
      if (text === null) continue;
      if (!/^\s*(?:flowchart|graph)\b/.test(text)) errors.push(`${name}: not a Mermaid flowchart`);
      if (/\bclick\b|<script|javascript:|%%\{\s*init|securityLevel/i.test(text))
        errors.push(`${name}: Mermaid click/init directive or script`);
      if (MENTION_RE.test(text) || EMAIL_RE.test(text) || SECRET_RE.test(text))
        errors.push(`${name}: mention, email address or credential-like text`);
    }
  }
}

function checkScript(files, errors) {
  const data = files.get('directory.js');
  if (!data) return;
  // The control: only an exact, explicitly reviewed script revision is admitted. No caller can extend this.
  if (!REVIEWED_DIRECTORY_SCRIPT_SHA256.includes(sha256(data)))
    errors.push(
      `directory.js: sha256 ${sha256(data)} is not a reviewed script revision (REVIEWED_DIRECTORY_SCRIPT_SHA256); a new script needs a website code-review change`,
    );
  // Supplementary only: a pattern scan catches careless changes and gives a clearer message, but it is
  // NOT a proof of behaviour (computed property access, aliasing and encoding defeat it).
  const text = utf8(data, 'directory.js', errors);
  if (text !== null && JS_FORBIDDEN.test(text))
    errors.push('directory.js: uses a network, storage, dynamic-code or navigation API');
}

function parseModel(files, errors) {
  const text = utf8(files.get('organization.json') ?? Buffer.alloc(0), 'organization.json', errors);
  if (text === null) return null;
  let model;
  try {
    model = JSON.parse(text);
  } catch {
    errors.push('organization.json: malformed JSON');
    return null;
  }
  if (!sameKeys(model, TOP_LEVEL_KEYS)) {
    const have = isObject(model) ? Object.keys(model) : [];
    errors.push(
      `organization.json: unexpected top-level keys (extra: ${have.filter((k) => !TOP_LEVEL_KEYS.includes(k)).join(', ') || 'none'}; missing: ${TOP_LEVEL_KEYS.filter((k) => !have.includes(k)).join(', ') || 'none'})`,
    );
    return null;
  }
  if (model.schema_version !== 1) errors.push('organization.json: unsupported schema_version');
  const obs = model.observation;
  if (!isObject(obs)) {
    errors.push('organization.json: observation missing');
  } else {
    if (typeof obs.completed_at !== 'string' || !ISO_Z_RE.test(obs.completed_at))
      errors.push('organization.json: observation.completed_at must be a UTC ISO-8601 timestamp');
    if (!SHA1_RE.test(obs.source_revision ?? ''))
      errors.push('organization.json: observation.source_revision must be a full SHA-1');
    for (const key of ['policy_revision', 'mapping_revision'])
      if (!SHA256_RE.test(obs[key] ?? ''))
        errors.push(`organization.json: observation.${key} must be a SHA-256`);
  }
  if (model.organization?.login !== 'Pick-Your-AI')
    errors.push('organization.json: organization.login must be Pick-Your-AI');
  const start = errors.length;
  for (const [path, value] of walkJson(model)) {
    const key = path.split('.').pop();
    if (FORBIDDEN_KEYS.has(key)) errors.push(`organization.json: forbidden key at ${path}`);
    if (key === 'login' && path !== '$.organization.login')
      errors.push(`organization.json: personal login at ${path}`);
    if (typeof value === 'string') {
      if (EMAIL_RE.test(value) || SECRET_RE.test(value) || MENTION_RE.test(value))
        errors.push(`organization.json: email, @mention or credential-like text at ${path}`);
    }
  }
  for (const list of ['teams', 'repositories', 'projects', 'relationships'])
    if (!Array.isArray(model[list]) || !model[list].every(isObject))
      errors.push(`organization.json: ${list} must be a list of objects`);
  if (errors.length > start) return model;
  const ids = {
    team: new Set(model.teams.map((t) => String(t.id))),
    repository: new Set(model.repositories.map((r) => String(r.id))),
    project: new Set(model.projects.map((p) => String(p.id))),
  };
  for (const [kind, prefix] of [
    ['teams', 'https://github.com/orgs/Pick-Your-AI/teams/'],
    ['repositories', 'https://github.com/Pick-Your-AI/'],
    ['projects', 'https://github.com/orgs/Pick-Your-AI/projects/'],
  ])
    for (const entity of model[kind])
      if (typeof entity.url !== 'string' || !entity.url.startsWith(prefix))
        errors.push(`organization.json: ${kind} entity ${entity.id} has a non-canonical url`);
  for (const rel of model.relationships) {
    for (const end of [rel.from, rel.to]) {
      const [prefix, id] = String(end).split(':');
      if (!ids[prefix])
        errors.push(`organization.json: relationship endpoint ${end} has unknown type`);
      else if (!ids[prefix].has(id))
        errors.push(`organization.json: relationship endpoint ${end} is not in the model`);
    }
  }
  return model;
}

function checkIndex(files, model, charts, errors) {
  const html = utf8(files.get('index.html') ?? Buffer.alloc(0), 'index.html', errors);
  const facts = { inlineStyle: false };
  if (html === null) return facts;
  const tags = [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)];
  for (const [, name, attrs] of tags) {
    const tag = name.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) errors.push(`index.html: unreviewed element <${tag}>`);
    if (/\son[a-z]+\s*=/i.test(attrs)) errors.push(`index.html: inline event handler on <${tag}>`);
    if (/\sstyle\s*=/i.test(attrs)) errors.push(`index.html: style attribute on <${tag}>`);
  }
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  if (scripts.length !== 1 || scripts[0] !== '<script src="directory.js">')
    errors.push('index.html: exactly one external <script src="directory.js"> is required');
  if (/<script\b[^>]*>(?!\s*<\/script>)[^<]/i.test(html)) errors.push('index.html: inline script');
  if (/<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(html))
    errors.push('index.html: meta refresh');
  if (!/<html\s+lang="en">/.test(html)) errors.push('index.html: <html lang="en"> required');
  if (!/<title>[^<]+<\/title>/.test(html)) errors.push('index.html: <title> required');
  if (!/<meta name="viewport"/.test(html)) errors.push('index.html: viewport meta required');
  if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) errors.push('index.html: exactly one <h1>');
  if (!/<main[\s>]/.test(html)) errors.push('index.html: <main> landmark required');
  const styles = [...html.matchAll(/<style\b[^>]*>/gi)];
  facts.inlineStyle = styles.length > 0;
  if (styles.length > 1) errors.push('index.html: more than one <style> block');

  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1];
  if (!csp) {
    errors.push('index.html: embedded Content-Security-Policy required');
  } else {
    const directives = new Map(
      csp
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .filter((d) => d[0])
        .map(([name, ...values]) => [name, values.join(' ')]),
    );
    if (directives.get('script-src') !== "'self'")
      errors.push("index.html: CSP script-src must be exactly 'self'");
    if (directives.get('default-src') !== "'none'")
      errors.push("index.html: CSP default-src must be 'none'");
    if (/unsafe-eval|\*|https?:/.test(csp))
      errors.push('index.html: CSP allows eval or remote origins');
    facts.inlineStyle = /'unsafe-inline'/.test(directives.get('style-src') ?? '');
    if (styles.length > 0 && !facts.inlineStyle)
      errors.push('index.html: inline <style> without matching CSP style-src');
  }

  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const linked = new Set();
  for (const [, attr, value] of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
    if (value.startsWith('#')) {
      if (!ids.has(value.slice(1))) errors.push(`index.html: dangling fragment ${value}`);
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/')) {
      if (!ORG_LINK_RE.test(value))
        errors.push(`index.html: link outside the organization: ${value}`);
      if (attr === 'src') errors.push(`index.html: external src ${value}`);
    } else {
      const target = value.split('#')[0];
      linked.add(target);
      if (!NAME_RE.test(target) || !files.has(target))
        errors.push(`index.html: link to missing file ${value}`);
    }
  }
  for (const chart of charts)
    for (const ext of ['mmd', 'svg', 'png'])
      if (!linked.has(`${chart}.${ext}`)) errors.push(`index.html does not link ${chart}.${ext}`);
  if (!linked.has('organization.json')) errors.push('index.html does not link organization.json');

  if (model && model.observation) {
    const observed = /data-observed="([^"]*)"/.exec(html)?.[1];
    if (observed !== model.observation.completed_at)
      errors.push(
        'index.html: data-observed differs from organization.json observation.completed_at',
      );
    for (const [label, key] of [
      ['Source revision', 'source_revision'],
      ['Policy revision', 'policy_revision'],
      ['Mapping revision', 'mapping_revision'],
    ]) {
      const shown = new RegExp(`${label}: <code>([0-9a-f]+)</code>`).exec(html)?.[1];
      if (shown !== model.observation[key])
        errors.push(`index.html: ${label} differs from organization.json`);
    }
    for (const kind of ['teams', 'repositories', 'projects']) {
      const rows = [
        ...html.matchAll(new RegExp(`<tr data-kind="${kind}">.*?<a href="([^"]+)"`, 'g')),
      ].map((m) => m[1]);
      const expected = (model[kind] ?? []).map((e) => e.url).filter((u) => typeof u === 'string');
      const publicRows = new Set(rows);
      const missing = expected.filter((u) => !publicRows.has(u));
      const extra = rows.filter((u) => !expected.includes(u));
      if (rows.length !== publicRows.size) errors.push(`index.html: duplicate ${kind} rows`);
      if (missing.length || extra.length)
        errors.push(
          `index.html ${kind} rows differ from organization.json (missing ${missing.length}, extra ${extra.length})`,
        );
    }
  }
  return facts;
}

function checkReadme(files, model, errors) {
  const text = files.has('README.md') ? utf8(files.get('README.md'), 'README.md', errors) : null;
  if (text === null) return;
  const observed = /Observation: (\S+)/.exec(text)?.[1];
  if (model?.observation && observed !== model.observation.completed_at)
    errors.push('README.md: Observation differs from organization.json');
  if (EMAIL_RE.test(text) || SECRET_RE.test(text))
    errors.push('README.md: email or credential-like text');
}

/**
 * Validates the complete canonical bundle. There are deliberately no options: nothing can relax a check.
 * @param {Map<string, Buffer>} files flat map of file name to bytes
 */
export function validateBundle(files) {
  const errors = [];
  checkNames(files, errors);
  const model = parseModel(files, errors);
  const charts = checkCompleteness(files, model, errors);
  checkExports(files, errors);
  checkScript(files, errors);
  const facts = checkIndex(files, model, charts, errors);
  checkReadme(files, model, errors);
  return {
    errors,
    facts: {
      ...facts,
      charts,
      observedAt: model?.observation?.completed_at ?? null,
      sourceRevision: model?.observation?.source_revision ?? null,
      counts: model
        ? {
            teams: model.teams?.length,
            repositories: model.repositories?.length,
            projects: model.projects?.length,
          }
        : null,
    },
  };
}

export function hashFiles(files) {
  return [...files]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, data]) => ({
      path,
      sha256: sha256(data),
      bytes: data.length,
    }));
}

// ---------------------------------------------------------------------------------------------
// Reading bundles
// ---------------------------------------------------------------------------------------------

/** Reads a flat directory of regular files; symlinks and nested directories are rejected. */
export function readBundleDir(dir) {
  const files = new Map();
  const errors = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (!stat.isFile()) errors.push(`${entry}: not a regular file`);
    else files.set(entry, readFileSync(full));
  }
  return { files, errors };
}

const git = (cwd, args, options = {}) =>
  execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_TOTAL_BYTES,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
    ...options,
  });

/** Reads the bundle at exactly `sha` from a git repository, refusing symlinks and submodules. */
export function readBundleFromGit(repoDir, sha) {
  if (!SHA1_RE.test(sha)) throw new Error('an exact 40-character commit SHA is required');
  const listing = git(repoDir, ['ls-tree', '-r', '-z', '--full-tree', sha, '--', SOURCE_PATH])
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const files = new Map();
  const errors = [];
  for (const line of listing) {
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!m) {
      errors.push(`unparseable tree entry: ${JSON.stringify(line)}`);
      continue;
    }
    const [, mode, type, oid, path] = m;
    const name = path.slice(SOURCE_PATH.length + 1);
    if (mode !== '100644' || type !== 'blob') errors.push(`${path}: unsupported mode ${mode}`);
    else if (name.includes('/')) errors.push(`${path}: nested path`);
    else files.set(name, git(repoDir, ['cat-file', 'blob', oid]));
  }
  if (files.size === 0) errors.push(`no ${SOURCE_PATH} in ${sha}`);
  return { files, errors };
}

/** True when `sha` is reachable from `ref`; false when it is a different line of history. */
export function isAncestor(repoDir, sha, ref) {
  try {
    git(repoDir, ['merge-base', '--is-ancestor', sha, ref]);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

/**
 * Fetches the exact commit and the default branch from the fixed upstream (blobless: only the
 * bundle's blobs are downloaded) into a throwaway repository. Content is data; nothing is executed.
 * `url` is overridable for tests only; the CLI never passes it.
 */
export function fetchUpstream(sha, url = SOURCE_URL) {
  if (!SHA1_RE.test(sha)) throw new Error('an exact 40-character commit SHA is required');
  const dir = mkdtempSync(join(tmpdir(), 'pyai-organization-'));
  git(dir, ['init', '-q']);
  git(dir, ['remote', 'add', 'origin', url]);
  git(dir, [
    'fetch',
    '-q',
    '--filter=blob:none',
    'origin',
    `+refs/heads/${SOURCE_MAIN}:refs/remotes/origin/${SOURCE_MAIN}`,
    sha,
  ]);
  return {
    dir,
    main: `refs/remotes/origin/${SOURCE_MAIN}`,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------------------------
// Pin
// ---------------------------------------------------------------------------------------------

const urlOf = (value, pattern) => typeof value === 'string' && pattern.test(value);
const SOURCE_PR_RE = /^https:\/\/github\.com\/Pick-Your-AI\/\.github\/pull\/\d+(?:#[\w-]+)?$/;

export function emptyPin() {
  return {
    schemaVersion: 1,
    sourceRepository: SOURCE_REPOSITORY,
    sourcePath: SOURCE_PATH,
    destination: PUBLIC_DIR,
    note: 'Vendored verbatim from an admitted immutable .github commit. Do not edit by hand; use `npm run organization:update` (docs/ORGANIZATION_DIRECTORY.md).',
    candidate: null,
    admitted: null,
  };
}

export function validatePin(pin) {
  const errors = [];
  if (
    !sameKeys(pin, [
      'schemaVersion',
      'sourceRepository',
      'sourcePath',
      'destination',
      'note',
      'candidate',
      'admitted',
    ])
  )
    return ['pin: unexpected or missing fields'];
  if (pin.schemaVersion !== 1) errors.push('pin: unsupported schemaVersion');
  if (pin.sourceRepository !== SOURCE_REPOSITORY) errors.push('pin: sourceRepository mismatch');
  if (pin.sourcePath !== SOURCE_PATH) errors.push('pin: sourcePath mismatch');
  if (pin.destination !== PUBLIC_DIR) errors.push('pin: destination mismatch');
  const { candidate, admitted } = pin;
  if (candidate !== null) {
    if (!sameKeys(candidate, ['sourceSha', 'eligibility', 'reason']))
      errors.push('pin: candidate fields');
    else {
      if (!SHA1_RE.test(candidate.sourceSha))
        errors.push('pin: candidate.sourceSha must be a full SHA');
      if (candidate.eligibility !== 'pending')
        errors.push('pin: a candidate can only be recorded as eligibility "pending"');
      if (typeof candidate.reason !== 'string' || !candidate.reason.trim())
        errors.push('pin: candidate.reason must state why it is not admitted');
      if (admitted && candidate.sourceSha === admitted.sourceSha)
        errors.push('pin: candidate was admitted; remove the candidate record');
    }
  }
  if (admitted === null) return errors;
  const common = ['sourceSha', 'observedAt', 'basis', 'approval', 'ancestorOfMain', 'files'];
  if (!sameKeys(admitted, common)) return [...errors, 'pin: admitted fields'];
  if (!SHA1_RE.test(admitted.sourceSha)) errors.push('pin: admitted.sourceSha must be a full SHA');
  if (!ISO_Z_RE.test(admitted.observedAt ?? '')) errors.push('pin: admitted.observedAt');
  const { approval } = admitted;
  if (admitted.basis === 'merged-main') {
    if (admitted.ancestorOfMain !== true)
      errors.push('pin: merged-main admission requires ancestorOfMain: true');
    if (
      !sameKeys(approval, ['pullRequest', 'humanReviewUrl', 'humanReviewer']) ||
      !urlOf(approval.pullRequest, SOURCE_PR_RE) ||
      !urlOf(approval.humanReviewUrl, SOURCE_PR_RE) ||
      !GH_LOGIN_RE.test(approval.humanReviewer ?? '')
    )
      errors.push('pin: merged-main approval needs pullRequest, humanReviewUrl and humanReviewer');
  } else {
    // The only admission path is a commit already merged into .github main with a human review.
    // No unmerged-commit exception has been granted, so none is representable in the pin.
    errors.push('pin: admitted.basis must be merged-main');
  }
  if (!Array.isArray(admitted.files) || admitted.files.length === 0) {
    errors.push('pin: admitted.files must be a nonempty list');
  } else {
    const seen = new Set();
    for (const f of admitted.files) {
      if (
        !sameKeys(f, ['path', 'sha256', 'bytes']) ||
        !NAME_RE.test(f.path) ||
        !SHA256_RE.test(f.sha256) ||
        !Number.isInteger(f.bytes)
      )
        errors.push(`pin: malformed file entry ${JSON.stringify(f?.path)}`);
      else if (seen.has(f.path)) errors.push(`pin: duplicate file ${f.path}`);
      else seen.add(f.path);
    }
  }
  return errors;
}

export function readPin(root) {
  return JSON.parse(readFileSync(join(root, PIN_FILE), 'utf8'));
}

export function writePin(root, pin) {
  mkdirSync(join(root, 'contracts/organization'), { recursive: true });
  writeFileSync(join(root, PIN_FILE), JSON.stringify(pin, null, 2) + '\n');
}

// ---------------------------------------------------------------------------------------------
// Verification of the checked-out tree and of a build output
// ---------------------------------------------------------------------------------------------

/** Compares a directory with the pin. Used for both `public/organization` and `dist/organization`. */
function compareDirectory(dir, pin, label) {
  const errors = [];
  const admitted = pin.admitted;
  if (!admitted) {
    if (existsSync(dir))
      errors.push(
        `${label} exists but no bundle is admitted; remove it or admit a reviewed commit`,
      );
    return { errors, files: null };
  }
  if (!existsSync(dir))
    return { errors: [`${label} is missing but a bundle is admitted`], files: null };
  const { files, errors: readErrors } = readBundleDir(dir);
  errors.push(...readErrors.map((e) => `${label}/${e}`));
  const expected = new Map(admitted.files.map((f) => [f.path, f]));
  for (const name of files.keys())
    if (!expected.has(name)) errors.push(`${label}/${name}: not in the pin`);
  for (const [name, entry] of expected) {
    const data = files.get(name);
    if (!data) errors.push(`${label}/${name}: missing`);
    else if (data.length !== entry.bytes || sha256(data) !== entry.sha256)
      errors.push(`${label}/${name}: differs from the pinned bytes`);
  }
  return { errors, files };
}

export function verifyLocal(root) {
  const pin = readPin(root);
  const errors = validatePin(pin);
  if (errors.length) return { errors, pin, facts: null };
  const { errors: dirErrors, files } = compareDirectory(join(root, PUBLIC_DIR), pin, PUBLIC_DIR);
  errors.push(...dirErrors);
  let facts = null;
  if (files && !dirErrors.length) {
    const result = validateBundle(files);
    errors.push(...result.errors);
    facts = result.facts;
    if (pin.admitted.observedAt !== facts.observedAt)
      errors.push('pin: observedAt differs from the bundle');
  }
  return { errors, pin, facts };
}

export function verifyDist(root, distDir = join(root, 'dist')) {
  const pin = readPin(root);
  const errors = validatePin(pin);
  if (errors.length) return { errors, pin };
  const out = compareDirectory(join(distDir, 'organization'), pin, 'dist/organization');
  return { errors: [...errors, ...out.errors], pin };
}

/** Verifies the pin against upstream bytes and (for merged-main) ancestry. Needs network. */
export function verifyUpstream(root, { url } = {}) {
  const pin = readPin(root);
  const errors = validatePin(pin);
  if (errors.length || !pin.admitted) return { errors, pin };
  const upstream = fetchUpstream(pin.admitted.sourceSha, url);
  try {
    const { files, errors: readErrors } = readBundleFromGit(upstream.dir, pin.admitted.sourceSha);
    errors.push(...readErrors);
    const expected = new Map(pin.admitted.files.map((f) => [f.path, f]));
    for (const name of files.keys())
      if (!expected.has(name)) errors.push(`upstream has unpinned file ${name}`);
    for (const [name, entry] of expected) {
      const data = files.get(name);
      if (!data) errors.push(`upstream is missing ${name}`);
      else if (sha256(data) !== entry.sha256) errors.push(`upstream ${name} differs from the pin`);
    }
    errors.push(...validateBundle(files).errors);
    if (!isAncestor(upstream.dir, pin.admitted.sourceSha, upstream.main))
      errors.push(
        `${pin.admitted.sourceSha} is not an ancestor of ${SOURCE_REPOSITORY}@${SOURCE_MAIN}`,
      );
  } finally {
    upstream.cleanup();
  }
  return { errors, pin };
}

// ---------------------------------------------------------------------------------------------
// Admission (writes public/organization and the pin)
// ---------------------------------------------------------------------------------------------

/**
 * Admits one immutable upstream commit. Refuses unless the whole bundle validates and the commit is an
 * ancestor of upstream main (merged). `approval` records the merged pull request and the independent
 * human review; the importer cannot verify a review itself, so the website PR review is the control.
 * There is no unmerged or owner-exception path.
 */
export function admit(root, { sha, approval, url }) {
  const upstream = fetchUpstream(sha, url);
  try {
    const { files, errors } = readBundleFromGit(upstream.dir, sha);
    errors.push(...validateBundle(files).errors);
    const ancestorOfMain = isAncestor(upstream.dir, sha, upstream.main);
    if (!ancestorOfMain)
      errors.push(
        `${sha} is not an ancestor of ${SOURCE_REPOSITORY}@${SOURCE_MAIN}; it is not merged`,
      );
    let model = null;
    try {
      model = JSON.parse(files.get('organization.json')?.toString('utf8') ?? 'null');
    } catch {
      /* reported by validateBundle */
    }
    const pin = readPin(root);
    pin.admitted = {
      sourceSha: sha,
      observedAt: model?.observation?.completed_at ?? '',
      basis: 'merged-main',
      approval,
      ancestorOfMain,
      files: hashFiles(files),
    };
    if (pin.candidate?.sourceSha === sha) pin.candidate = null;
    errors.push(...validatePin(pin));
    if (errors.length) return { errors, pin: null };
    const dest = join(root, PUBLIC_DIR);
    const stage = `${dest}.incoming`;
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    for (const [name, data] of files) writeFileSync(join(stage, name), data);
    rmSync(dest, { recursive: true, force: true });
    renameSync(stage, dest);
    writePin(root, pin);
    return { errors: [], pin };
  } finally {
    upstream.cleanup();
  }
}
