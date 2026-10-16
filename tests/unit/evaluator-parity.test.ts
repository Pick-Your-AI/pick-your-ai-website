/*
 * The site must not invent its own compatibility policy. These tests show that the TypeScript
 * interpreter produces the same EvaluationReport as the research repository's reference
 * interpreter (contracts/v1/reference/evaluate.py) for the upstream examples and for every
 * synthetic scenario. The Python comparison runs whenever a Python 3 interpreter is available
 * (always in CI).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import exampleBuild from '../../contracts/v1/examples/build.json';
import exampleCatalog from '../../contracts/v1/examples/catalog.json';
import exampleCost from '../../contracts/v1/examples/cost-estimate.json';
import exampleReport from '../../contracts/v1/examples/evaluation-report.json';
import exampleResource from '../../contracts/v1/examples/resource-estimate.json';
import exampleRules from '../../contracts/v1/examples/ruleset.json';
import type {
  BuildSnapshot,
  CatalogSnapshot,
  CostEstimate,
  ResourceEstimate,
  Ruleset,
} from '../../src/contracts';
import { BASELINE_RULESET, validateContract } from '../../src/contracts';
import { evaluateBuild } from '../../src/domain/evaluator';
import {
  CATALOG,
  apiChat,
  contradictory,
  ragMismatch,
  resourceEstimate,
  selfHosted,
} from './scenarios';

const FIXED = '2026-10-16T09:00:00Z'; // evaluate.py stamps this fixed time

describe('evaluator vs upstream example report', () => {
  it('reproduces examples/evaluation-report.json exactly', () => {
    const report = evaluateBuild({
      build: exampleBuild as BuildSnapshot,
      catalog: exampleCatalog as CatalogSnapshot,
      ruleset: exampleRules as Ruleset,
      resourceEstimate: exampleResource as ResourceEstimate,
      costEstimate: exampleCost as CostEstimate,
      evaluatedAt: FIXED,
    });
    expect(report).toEqual(exampleReport);
    expect(report.summary).toEqual({ passed: 41, failed: 0, unknown: 0, skipped: 4 });
    expect(validateContract('EvaluationReport', report).ok).toBe(true);
  });
});

function findPython(): string | null {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info[0])'], {
      encoding: 'utf8',
    });
    if (r.status === 0 && r.stdout.trim() === '3') return cmd;
  }
  return null;
}

const python = findPython();
const REFERENCE = resolve(import.meta.dirname, '../../contracts/v1/reference/evaluate.py');

function reference(
  build: BuildSnapshot,
  catalog: CatalogSnapshot,
  ruleset: Ruleset,
  resource?: ResourceEstimate,
): unknown {
  const dir = mkdtempSync(join(tmpdir(), 'pyai-parity-'));
  try {
    const write = (name: string, data: unknown) => {
      const p = join(dir, name);
      writeFileSync(p, JSON.stringify(data));
      return p;
    };
    const args = [
      '-I',
      REFERENCE,
      '--build',
      write('build.json', build),
      '--catalog',
      write('catalog.json', catalog),
      '--rules',
      write('rules.json', ruleset),
    ];
    if (resource) args.push('--resource', write('resource.json', resource));
    const r = spawnSync(python!, args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`evaluate.py failed: ${r.stderr}`);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const scenarios: [string, () => BuildSnapshot, ((b: BuildSnapshot) => ResourceEstimate)?][] = [
  ['api chat (optional tiers omitted)', apiChat],
  ['contradictory selections', contradictory],
  ['self-hosted without capacity evidence', selfHosted],
  [
    'self-hosted with calibrated evidence',
    selfHosted,
    (b) => resourceEstimate(b, '20.0', 'calibrated'),
  ],
  ['self-hosted over capacity', selfHosted, (b) => resourceEstimate(b, '30.0', 'verified')],
  [
    'self-hosted with low-confidence evidence',
    selfHosted,
    (b) => resourceEstimate(b, '20.0', 'estimated'),
  ],
  ['RAG dimension mismatch', ragMismatch],
];

describe.skipIf(!python)('evaluator parity with reference/evaluate.py', () => {
  it.each(scenarios)('%s', (_name, make, resourceFor) => {
    const build = make();
    const resource = resourceFor?.(build);
    const ours = evaluateBuild({
      build,
      catalog: CATALOG,
      ruleset: BASELINE_RULESET,
      resourceEstimate: resource ?? null,
      evaluatedAt: FIXED,
    });
    expect(ours).toEqual(reference(build, CATALOG, BASELINE_RULESET, resource));
  });
});
