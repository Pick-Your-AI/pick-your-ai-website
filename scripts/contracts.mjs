#!/usr/bin/env node
// Vendors and verifies the research contract (Pick-Your-AI/pick-your-ai-research contracts/v1).
//
//   node scripts/contracts.mjs update [--ref <sha|branch>]   re-vendor from upstream at a pinned SHA
//   node scripts/contracts.mjs verify                        check vendored bytes (offline)
//   node scripts/contracts.mjs verify --upstream             also compare with upstream at the pinned SHA
//
// Verification has three layers:
//   1. Every file listed in contracts/PROVENANCE.json matches its recorded SHA-256 (no local edits).
//   2. Every file listed in the upstream IMPORT_MANIFEST.json matches the hash that the research
//      repo's own UPSTREAM_SHA256SUMS records for its source path (the frozen v1.0.0 baseline).
//   3. (--upstream) The vendored tree is byte-identical to upstream contracts/v1 at the pinned SHA.
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
  }
  if (errors.length) {
    console.error(`Contract verification FAILED (${errors.length}):\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(
    `Contract v${prov.contractVersion} @ ${prov.sourceSha.slice(0, 12)}: ${recorded.size} files intact, ` +
      `${baseline} baseline files match UPSTREAM_SHA256SUMS${upstream ? ', identical to upstream' : ''}.`,
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
