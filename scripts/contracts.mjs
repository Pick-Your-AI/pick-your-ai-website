#!/usr/bin/env node
// Vendors and verifies frozen contracts/v1 and the separately pinned accepted display-label sidecar.
//
//   node scripts/contracts.mjs update [--ref <sha|branch>]   re-vendor from upstream at a pinned SHA
//   node scripts/contracts.mjs verify                        check vendored bytes (offline)
//   node scripts/contracts.mjs verify --upstream             also compare with upstream at the pinned SHA
//
// Verification has four layers:
//   1. Every file listed in contracts/PROVENANCE.json matches its recorded SHA-256 (no local edits).
//   2. Every file listed in the upstream IMPORT_MANIFEST.json matches the hash that the research
//      repo's own UPSTREAM_SHA256SUMS records for its source path (the frozen v1.0.0 baseline).
//   3. The selected accepted label sidecar matches its independent pin and this exact registry.
//   4. (--upstream) Both artifacts match their separate immutable upstream Git revisions.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const VENDOR_DIR = join(ROOT, 'contracts', 'v1');
const PROVENANCE = join(ROOT, 'contracts', 'PROVENANCE.json');
const UPSTREAM_REPO = 'https://github.com/Pick-Your-AI/pick-your-ai-research.git';
const UPSTREAM_PATH = 'contracts/v1';
const LABEL_VERSION = '1.0.0';
const LABEL_FILE = join(ROOT, 'contracts', 'display-labels', `v${LABEL_VERSION}.json`);
const LABEL_PROVENANCE = join(ROOT, 'contracts', 'display-labels', 'PROVENANCE.json');
const LABEL_SOURCE_PATH = `research/T0-configuration/display-labels/v${LABEL_VERSION}.json`;
const LABEL_DECISION =
  'research/T0-configuration/component-schema-compatibility.md#display-label-sidecar-decision--2026-10-19';

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out.sort();
}

const rel = (base, file) => relative(base, file).split(sep).join('/');

function parseSums(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (m) map.set(m[2].trim(), m[1]);
  }
  return map;
}

function cloneAt(ref) {
  const dir = mkdtempSync(join(tmpdir(), 'pyai-contract-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] })
      .toString()
      .trim();
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  git('remote', 'add', 'origin', UPSTREAM_REPO);
  git('fetch', '-q', '--depth', '1', 'origin', ref);
  git('checkout', '-q', 'FETCH_HEAD');
  return { dir, sha: git('rev-parse', 'HEAD') };
}

function checkBaseline(errors) {
  const manifestFile = join(VENDOR_DIR, 'IMPORT_MANIFEST.json');
  const sumsFile = join(VENDOR_DIR, 'UPSTREAM_SHA256SUMS');
  if (!existsSync(manifestFile) || !existsSync(sumsFile)) {
    errors.push('IMPORT_MANIFEST.json or UPSTREAM_SHA256SUMS missing from contracts/v1');
    return 0;
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const sums = parseSums(readFileSync(sumsFile, 'utf8'));
  let checked = 0;
  for (const entry of manifest.files) {
    const expected = sums.get(entry.source_path);
    const file = join(VENDOR_DIR, entry.path);
    if (!expected) errors.push(`UPSTREAM_SHA256SUMS has no entry for ${entry.source_path}`);
    else if (expected !== entry.sha256)
      errors.push(`IMPORT_MANIFEST and UPSTREAM_SHA256SUMS disagree for ${entry.source_path}`);
    if (!existsSync(file)) errors.push(`missing baseline file ${entry.path}`);
    else if (expected && sha256(file) !== expected)
      errors.push(`baseline hash mismatch: ${entry.path}`);
    checked++;
  }
  return checked;
}

function checkDisplayLabels(errors) {
  const initialErrors = errors.length;
  let provenance, sidecar, registry;
  try {
    provenance = JSON.parse(readFileSync(LABEL_PROVENANCE, 'utf8'));
    sidecar = JSON.parse(readFileSync(LABEL_FILE, 'utf8'));
    registry = JSON.parse(
      readFileSync(join(VENDOR_DIR, 'schemas/component-registry.json'), 'utf8'),
    );
  } catch {
    errors.push('unreadable or malformed display-label input');
    return null;
  }
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fields = (value, expected) =>
    object(value) && Object.keys(value).sort().join('\n') === expected.sort().join('\n');
  if (
    !fields(provenance, [
      'sourceRepository',
      'sourcePath',
      'sourceSha',
      'sidecarVersion',
      'locale',
      'sha256',
      'decisionRecord',
      'note',
    ])
  ) {
    errors.push('display-label provenance fields do not match the selected interface');
    return null;
  }
  if (
    !fields(sidecar, [
      'sidecar_version',
      'status',
      'locale',
      'registry_version',
      'registry_sha256',
      'source_url',
      'labels',
      'decision_record',
    ])
  ) {
    errors.push('display-label sidecar fields do not match the selected interface');
    return null;
  }
  if (provenance.sourceRepository !== 'Pick-Your-AI/pick-your-ai-research')
    errors.push('display-label source repository mismatch');
  if (provenance.sourcePath !== LABEL_SOURCE_PATH)
    errors.push('display-label source path mismatch');
  if (typeof provenance.sourceSha !== 'string' || !/^[0-9a-f]{40}$/.test(provenance.sourceSha))
    errors.push('display-label immutable source SHA required');
  if (provenance.sidecarVersion !== LABEL_VERSION)
    errors.push('display-label provenance version mismatch');
  if (provenance.locale !== 'en') errors.push('display-label provenance locale mismatch');
  if (
    provenance.decisionRecord !==
    `https://github.com/Pick-Your-AI/pick-your-ai-research/blob/${provenance.sourceSha}/${LABEL_DECISION}`
  )
    errors.push('display-label provenance decision mismatch');
  if (typeof provenance.note !== 'string' || !provenance.note.trim())
    errors.push('display-label provenance note must be a nonempty string');
  if (
    typeof provenance.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(provenance.sha256) ||
    sha256(LABEL_FILE) !== provenance.sha256
  )
    errors.push('display-label sidecar hash mismatch');
  if (sidecar.sidecar_version !== LABEL_VERSION)
    errors.push('display-label unsupported sidecar version');
  if (sidecar.status !== 'accepted') errors.push('display-label status must be accepted');
  if (sidecar.locale !== 'en') errors.push('display-label locale must be en');
  if (sidecar.registry_version !== registry.schema_version)
    errors.push('display-label registry version mismatch');
  if (sidecar.registry_sha256 !== sha256(join(VENDOR_DIR, 'schemas/component-registry.json')))
    errors.push('display-label registry hash mismatch');
  if (
    typeof sidecar.source_url !== 'string' ||
    !/^https:\/\/github\.com\/Pick-Your-AI\/pick-your-ai-website\/blob\/[0-9a-f]{40}\/src\/contracts\/labels\.ts$/.test(
      sidecar.source_url,
    )
  )
    errors.push('display-label immutable source reference required');
  if (sidecar.decision_record !== LABEL_DECISION)
    errors.push('display-label decision record mismatch');
  if (!object(sidecar.labels)) {
    errors.push('display labels must be an object');
  } else {
    if (!fields(sidecar.labels, Object.keys(registry.kinds)))
      errors.push('display-label keys must match the exact registry kinds');
    const labels = Object.values(sidecar.labels);
    if (labels.some((label) => typeof label !== 'string' || !label || label.trim() !== label))
      errors.push('display labels must be nonempty trimmed strings');
    if (new Set(labels).size !== labels.length) errors.push('display labels must be distinct');
  }
  return errors.length === initialErrors ? provenance : null;
}

function verify({ upstream }) {
  const errors = [];
  if (!existsSync(PROVENANCE))
    throw new Error('contracts/PROVENANCE.json not found; run `npm run contracts:update`');
  const prov = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
  const recorded = new Map(prov.files.map((f) => [f.path, f.sha256]));
  const present = walk(VENDOR_DIR).map((f) => rel(VENDOR_DIR, f));
  for (const p of present)
    if (!recorded.has(p)) errors.push(`untracked file in contracts/v1: ${p}`);
  for (const [p, h] of recorded) {
    const file = join(VENDOR_DIR, p);
    if (!existsSync(file)) errors.push(`missing vendored file: ${p}`);
    else if (sha256(file) !== h) errors.push(`modified vendored file: ${p}`);
  }
  const baseline = checkBaseline(errors);
  const labels = checkDisplayLabels(errors);
  if (upstream) {
    const { dir, sha } = cloneAt(prov.sourceSha);
    try {
      if (sha !== prov.sourceSha)
        errors.push(`upstream resolved to ${sha}, expected ${prov.sourceSha}`);
      const up = walk(join(dir, UPSTREAM_PATH)).map((f) => [
        rel(join(dir, UPSTREAM_PATH), f),
        sha256(f),
      ]);
      for (const [p, h] of up)
        if (recorded.get(p) !== h) errors.push(`differs from upstream: ${p}`);
      if (up.length !== recorded.size)
        errors.push(`file count ${recorded.size} != upstream ${up.length}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (labels) {
      const { dir, sha } = cloneAt(labels.sourceSha);
      try {
        if (sha !== labels.sourceSha)
          errors.push(`display-label upstream resolved to ${sha}, expected ${labels.sourceSha}`);
        const published = readFileSync(join(dir, labels.sourcePath));
        if (!published.equals(readFileSync(LABEL_FILE)))
          errors.push('display-label sidecar differs from pinned upstream bytes');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  if (errors.length) {
    console.error(`Contract verification FAILED (${errors.length}):\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(
    `Contract v${prov.contractVersion} @ ${prov.sourceSha.slice(0, 12)}: ${recorded.size} files intact, ` +
      `${baseline} baseline files match UPSTREAM_SHA256SUMS${upstream ? ', identical to upstream' : ''}.`,
  );
  console.log(
    `Display labels v${labels.sidecarVersion} (${labels.locale}) @ ${labels.sourceSha.slice(0, 12)}: ` +
      `29 labels match the frozen registry${upstream ? ', identical to pinned upstream' : ''}.`,
  );
}

function update(ref) {
  const { dir, sha } = cloneAt(ref);
  try {
    const src = join(dir, UPSTREAM_PATH);
    rmSync(VENDOR_DIR, { recursive: true, force: true });
    cpSync(src, VENDOR_DIR, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(VENDOR_DIR, 'IMPORT_MANIFEST.json'), 'utf8'));
    const prov = {
      sourceRepository: 'Pick-Your-AI/pick-your-ai-research',
      sourcePath: UPSTREAM_PATH,
      sourceSha: sha,
      contractVersion: manifest.contract_version,
      vendoredAt: new Date().toISOString(),
      note: 'Vendored verbatim. Do not edit; propose changes via research issue #40, then run `npm run contracts:update -- --ref <sha>`.',
      files: walk(VENDOR_DIR).map((f) => ({ path: rel(VENDOR_DIR, f), sha256: sha256(f) })),
    };
    writeFileSync(PROVENANCE, JSON.stringify(prov, null, 2) + '\n');
    console.log(`Vendored contracts/v1 @ ${sha} (${prov.files.length} files).`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  verify({ upstream: false });
}

const [cmd, ...rest] = process.argv.slice(2);
const refIdx = rest.indexOf('--ref');
if (cmd === 'update') update(refIdx >= 0 ? rest[refIdx + 1] : 'main');
else if (cmd === 'verify') verify({ upstream: rest.includes('--upstream') });
else {
  console.error('usage: contracts.mjs update [--ref <sha>] | verify [--upstream]');
  process.exit(2);
}
