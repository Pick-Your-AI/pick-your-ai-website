// @vitest-environment node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import acceptedLabels from '../../contracts/display-labels/v1.0.0.json';
import {
  KINDS,
  KIND_LABELS,
  TIERS,
  TIER_LABELS,
  TIER_SUMMARIES,
  kindFromSlug,
  kindSlug,
  labelInSentence,
  withArticle,
} from '../../src/contracts';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const releasePath = 'contracts/display-labels/v1.0.0.json';
const provenancePath = 'contracts/display-labels/PROVENANCE.json';
const releaseSha = '526af0435348c025d041a21a81fc574c3e0797a307768c79ff36bc444a66f623';
const sourceSha = 'd3548b303eaea7450615848db056f33f97d2cea6';
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
type JsonObject = Record<string, unknown>;
let fixture: string;

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(join(fixture, path), 'utf8')) as JsonObject;
}

function writeJson(path: string, value: JsonObject): void {
  writeFileSync(join(fixture, path), JSON.stringify(value, null, 2) + '\n');
}

function changeRelease(change: (value: JsonObject) => void): void {
  const release = readJson(releasePath);
  change(release);
  writeJson(releasePath, release);
  // A matching local digest alone must not turn an unsupported interface into accepted input.
  const provenance = readJson(provenancePath);
  provenance.sha256 = sha256(readFileSync(join(fixture, releasePath)));
  writeJson(provenancePath, provenance);
}

function verify() {
  const result = spawnSync(process.execPath, ['scripts/contracts.mjs', 'verify'], {
    cwd: fixture,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  expect(result.error).toBeUndefined();
  return { status: result.status, output: result.stdout + result.stderr };
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'website-display-labels-'));
  cpSync(join(repository, 'contracts'), join(fixture, 'contracts'), { recursive: true });
  mkdirSync(join(fixture, 'scripts'));
  copyFileSync(join(repository, 'scripts/contracts.mjs'), join(fixture, 'scripts/contracts.mjs'));
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

describe('accepted display-label release', () => {
  it('imports the exact accepted artifact independently of frozen v1', () => {
    const bytes = readFileSync(join(repository, releasePath));
    expect(bytes.byteLength).toBe(1594);
    expect(sha256(bytes)).toBe(releaseSha);
    const provenance = readJson(provenancePath);
    expect(provenance.sourceSha).toBe(sourceSha);
    expect(provenance.sha256).toBe(releaseSha);
    expect(acceptedLabels.sidecar_version).toBe('1.0.0');
    expect(acceptedLabels.locale).toBe('en');
    expect(acceptedLabels.status).toBe('accepted');
    expect(Object.keys(acceptedLabels.labels).sort()).toEqual(KINDS.map((k) => k.kind).sort());
    expect(readJson('contracts/PROVENANCE.json').sourceSha).toBe(
      'd4bdca479f78439b3b98e7418b37acbaccbaa63c',
    );
  });

  it('exports the imported label object without a second kind table or legacy module', () => {
    expect(KIND_LABELS).toBe(acceptedLabels.labels);
    expect(Object.isFrozen(KIND_LABELS)).toBe(true);
    expect(existsSync(join(repository, 'src/contracts/labels.ts'))).toBe(false);
  });

  it('keeps consumer tier labels and grammar separate from canonical identifiers', () => {
    expect(Object.keys(TIER_LABELS)).toEqual(TIERS);
    expect(Object.keys(TIER_SUMMARIES)).toEqual(TIERS);
    for (const { kind } of KINDS) expect(kindFromSlug(kindSlug(kind))).toBe(kind);
    expect(labelInSentence(KIND_LABELS.model)).toBe('AI model');
    expect(withArticle(KIND_LABELS.embedding_model)).toBe('an embedding model');
    expect(withArticle(KIND_LABELS.mcp_server)).toBe('an MCP server');
  });

  it('runs label admission in the ordinary offline contract command', () => {
    const result = verify();
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('46 files intact');
    expect(result.output).toContain('Display labels v1.0.0 (en) @ d3548b303eae: 29 labels');
  });

  const unsupported: [string, (value: JsonObject) => void, string][] = [
    [
      'proposed status',
      (value) => {
        value.status = 'proposed';
      },
      'status must be accepted',
    ],
    [
      'future version',
      (value) => {
        value.sidecar_version = '1.0.1';
      },
      'unsupported sidecar version',
    ],
    [
      'unselected locale',
      (value) => {
        value.locale = 'fr';
      },
      'locale must be en',
    ],
    [
      'wrong registry version',
      (value) => {
        value.registry_version = '2.0.0';
      },
      'registry version mismatch',
    ],
    [
      'wrong registry bytes',
      (value) => {
        value.registry_sha256 = '0'.repeat(64);
      },
      'registry hash mismatch',
    ],
    [
      'unknown envelope member',
      (value) => {
        value.fallback = true;
      },
      'sidecar fields',
    ],
    [
      'missing source reference',
      (value) => {
        delete value.source_url;
      },
      'sidecar fields',
    ],
    [
      'mutable source reference',
      (value) => {
        value.source_url =
          'https://github.com/Pick-Your-AI/pick-your-ai-website/blob/main/src/contracts/labels.ts';
      },
      'immutable source reference',
    ],
    [
      'wrong decision record',
      (value) => {
        value.decision_record = 'unreviewed.md';
      },
      'decision record mismatch',
    ],
    [
      'array labels',
      (value) => {
        value.labels = [];
      },
      'labels must be an object',
    ],
    [
      'null labels',
      (value) => {
        value.labels = null;
      },
      'labels must be an object',
    ],
    [
      'missing kind',
      (value) => {
        delete (value.labels as JsonObject).workload;
      },
      'label keys must match',
    ],
    [
      'same-size foreign kind',
      (value) => {
        const labels = value.labels as JsonObject;
        delete labels.workload;
        labels.unknown_kind = 'Workload / Use Case';
      },
      'label keys must match',
    ],
    [
      'empty label',
      (value) => {
        (value.labels as JsonObject).workload = '';
      },
      'nonempty trimmed strings',
    ],
    [
      'padded label',
      (value) => {
        (value.labels as JsonObject).workload = ' Workload / Use Case';
      },
      'nonempty trimmed strings',
    ],
    [
      'non-string label',
      (value) => {
        (value.labels as JsonObject).workload = 42;
      },
      'nonempty trimmed strings',
    ],
    [
      'duplicate label',
      (value) => {
        const labels = value.labels as JsonObject;
        labels.workload = labels.model;
      },
      'labels must be distinct',
    ],
  ];

  it.each(unsupported)('rejects %s even with a coherent local digest', (_name, change, reason) => {
    changeRelease(change);
    const result = verify();
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain(reason);
  });

  const badProvenance: [string, (value: JsonObject) => void, string][] = [
    [
      'mutable Git ref',
      (value) => {
        value.sourceSha = 'main';
      },
      'immutable source SHA',
    ],
    [
      'another repository',
      (value) => {
        value.sourceRepository = 'untrusted/research';
      },
      'source repository mismatch',
    ],
    [
      'traversal path',
      (value) => {
        value.sourcePath = '../untrusted.json';
      },
      'source path mismatch',
    ],
    [
      'another selected version',
      (value) => {
        value.sidecarVersion = '0.1.0';
      },
      'provenance version mismatch',
    ],
    [
      'another selected locale',
      (value) => {
        value.locale = 'de';
      },
      'provenance locale mismatch',
    ],
    [
      'unbound decision URL',
      (value) => {
        value.decisionRecord =
          'https://github.com/Pick-Your-AI/pick-your-ai-research/blob/main/research/T0-configuration/component-schema-compatibility.md';
      },
      'provenance decision mismatch',
    ],
    [
      'missing digest',
      (value) => {
        delete value.sha256;
      },
      'provenance fields',
    ],
    [
      'extra provenance member',
      (value) => {
        value.current = true;
      },
      'provenance fields',
    ],
  ];

  it.each(badProvenance)('rejects provenance with %s', (_name, change, reason) => {
    const provenance = readJson(provenancePath);
    change(provenance);
    writeJson(provenancePath, provenance);
    const result = verify();
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain(reason);
  });

  it('rejects changed artifact bytes without updating their recorded digest', () => {
    writeFileSync(
      join(fixture, releasePath),
      readFileSync(join(fixture, releasePath), 'utf8') + '\n',
    );
    const result = verify();
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('sidecar hash mismatch');
  });

  it.each([releasePath, provenancePath])('rejects malformed JSON in %s', (path) => {
    writeFileSync(join(fixture, path), '{');
    const result = verify();
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('display-label input');
  });
});
