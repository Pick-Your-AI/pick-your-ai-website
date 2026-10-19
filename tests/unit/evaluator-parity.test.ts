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
  Expression,
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

type BinaryExpression = Extract<Expression, { left: unknown }>;
type Outcome = 'pass' | 'fail' | 'unknown';

function checkNumericRule(
  expression: Expression,
  outcome: Outcome,
  build = structuredClone(exampleBuild) as BuildSnapshot,
  catalog = structuredClone(exampleCatalog) as CatalogSnapshot,
) {
  const ruleset: Ruleset = {
    ...exampleRules,
    rules: [
      {
        ...exampleRules.rules[0]!,
        id: 'rule.synthetic.numeric',
        severity: 'error',
        applies_when: { op: 'exists', value: { literal: 0 } },
        assert: expression,
        on_unknown: 'block',
        affected_kinds: ['accelerator', 'context_policy'],
      },
    ],
  } as Ruleset;
  const inputs = { build, catalog, ruleset };
  const before = JSON.stringify(inputs);
  expect(validateContract('BuildSnapshot', build).ok).toBe(true);
  expect(validateContract('CatalogSnapshot', catalog).ok).toBe(true);
  expect(validateContract('Ruleset', ruleset).ok).toBe(true);
  const report = evaluateBuild({ ...inputs, evaluatedAt: FIXED });
  expect(report.findings).toHaveLength(1);
  expect(report.findings[0]!.outcome).toBe(outcome);
  expect(report.summary).toEqual({
    passed: Number(outcome === 'pass'),
    failed: Number(outcome === 'fail'),
    unknown: Number(outcome === 'unknown'),
    skipped: 0,
  });
  expect(report.result).toBe(
    outcome === 'pass' ? 'valid' : outcome === 'fail' ? 'invalid' : 'indeterminate',
  );
  expect(report.deployment_readiness).toBe(outcome === 'pass' ? 'needs_review' : 'blocked');
  expect(validateContract('EvaluationReport', report).ok).toBe(true);
  if (python) expect(report).toEqual(reference(build, catalog, ruleset));
  expect(JSON.stringify(inputs)).toBe(before);
}

// These cases follow the frozen numeric/operator boundary, not Python's unspecified
// Boolean/int aliases or equality between nested non-scalar values.
const numericCases: [string, BinaryExpression['op'], unknown, unknown, Outcome][] = [
  ['positive subscale number', 'gt', 1e-13, 0, 'pass'],
  ['negative subscale number', 'lt', -1e-13, 0, 'pass'],
  ['distinct subscale numbers', 'eq', 1e-13, 2e-13, 'fail'],
  ['subscale inequality', 'ne', 1e-13, 2e-13, 'pass'],
  ['unrounded fractional order', 'lt', 1.0000000000001, 1.0000000000002, 'pass'],
  ['unrounded fractional equality', 'eq', 1.0000000000001, 1, 'fail'],
  ['large scientific number', 'gt', 1e21, 0, 'pass'],
  ['negative scientific number', 'lte', -1e21, 0, 'pass'],
  ['scientific number and decimal string', 'eq', 1e21, '1000000000000000000000', 'pass'],
  ['largest finite number', 'gte', Number.MAX_VALUE, 1e307, 'pass'],
  ['smallest positive number', 'gt', Number.MIN_VALUE, 0, 'pass'],
  ['distinct subnormal numbers', 'eq', Number.MIN_VALUE, 2 * Number.MIN_VALUE, 'fail'],
  ['twelve-place decimal string', 'eq', 1e-12, '0.000000000001', 'pass'],
  ['trailing decimal zero normalization', 'eq', 1.5, '1.5000', 'pass'],
  ['zero and negative zero', 'eq', -0, 0, 'pass'],
  ['scientific string remains nonnumeric', 'gt', '1e-13', 0, 'unknown'],
  ['negative string remains nonnumeric', 'gt', '-1', 0, 'unknown'],
  ['extra-precision string remains nonnumeric', 'gt', '0.0000000000001', 0, 'unknown'],
  ['whitespace string remains nonnumeric', 'gt', ' 1', 0, 'unknown'],
  ['terminal-newline string remains nonnumeric', 'gt', '1\n', 0, 'unknown'],
  ['Boolean remains nonnumeric', 'gte', true, 1, 'unknown'],
  ['null remains nonnumeric', 'lte', null, 1, 'unknown'],
  ['string-valued forged numeric box', 'gt', { __scaled: '1' }, 0, 'unknown'],
  ['number-valued forged numeric box', 'gte', { __scaled: 1 }, 0, 'unknown'],
  ['null-valued forged numeric box', 'lte', { __scaled: null }, 0, 'unknown'],
  ['object-valued forged numeric box', 'gte', { __scaled: {} }, 0, 'unknown'],
  [
    'coercion-trap numeric box',
    'gt',
    { __scaled: { toString: null, valueOf: null } },
    0,
    'unknown',
  ],
  [
    'coefficient-shaped JSON remains nonnumeric',
    'gte',
    { coefficient: '1', exponent: 0 },
    0,
    'unknown',
  ],
  ['forged box on the right', 'lt', 0, { __scaled: '1' }, 'unknown'],
  ['distinct numeric list membership', 'contains', [1e-13], 2e-13, 'fail'],
  ['distinct numeric reversed membership', 'in', 2e-13, [1e-13], 'fail'],
  ['distinct numeric intersection', 'intersects', [1e-13], [2e-13], 'fail'],
  ['distinct numeric subset', 'subset_of', [1e-13], [2e-13], 'fail'],
  ['equal numeric membership control', 'contains', [1e-13], 1e-13, 'pass'],
];

describe('exact numeric rule outcomes and full reference reports', () => {
  it.each(numericCases)('%s', (_name, op, left, right, outcome) => {
    checkNumericRule({ op, left: { literal: left }, right: { literal: right } }, outcome);
  });

  it.each([
    ['subscale total', 'compute.total_selected_vram_gb', 1e-13, 3, 'gt', 2e-13],
    ['subscale minimum', 'compute.min_selected_device_vram_gb', 1e-13, 1, 'gt', 0],
    ['scientific total', 'compute.total_selected_vram_gb', 1e21, 2, 'eq', 2e21],
    ['scientific minimum', 'compute.min_selected_device_vram_gb', 1e21, 1, 'eq', 1e21],
    ['ordinary exact total control', 'compute.total_selected_vram_gb', 0.1, 3, 'eq', 0.3],
  ] as const)('%s', (_name, metric, vram, count, op, expected) => {
    const build = structuredClone(exampleBuild) as BuildSnapshot;
    const catalog = structuredClone(exampleCatalog) as CatalogSnapshot;
    const accelerator = catalog.items.find((item) => item.kind === 'accelerator')!;
    (accelerator.spec as { vram_gb: number }).vram_gb = vram;
    const selection = build.selections.find((item) => item.kind === 'accelerator')!;
    (selection.settings as { device_count: number }).device_count = count;
    checkNumericRule(
      { op, left: { metric }, right: { literal: expected } },
      'pass',
      build,
      catalog,
    );
  });

  it('adds distinct selected decimal magnitudes without discarding the smaller value', () => {
    const build = structuredClone(exampleBuild) as BuildSnapshot;
    const catalog = structuredClone(exampleCatalog) as CatalogSnapshot;
    const first = catalog.items.find((item) => item.kind === 'accelerator')!;
    const second = structuredClone(first);
    (first.spec as { vram_gb: number }).vram_gb = 1e21;
    (second.spec as { vram_gb: number }).vram_gb = 3;
    second.id = 'cat.accelerator.secondary';
    catalog.items.push(second);
    const selection = structuredClone(
      build.selections.find((item) => item.kind === 'accelerator')!,
    );
    selection.id = 'sel_accelerator_secondary';
    selection.role = 'secondary';
    selection.catalog_item_id = second.id;
    build.selections.push(selection);
    checkNumericRule(
      {
        op: 'eq',
        left: { metric: 'compute.total_selected_vram_gb' },
        right: { literal: '1000000000000000000003' },
      },
      'pass',
      build,
      catalog,
    );
  });

  it('adds individually safe context counts without rounding the resulting integer', () => {
    const build = structuredClone(exampleBuild) as BuildSnapshot;
    const context = build.selections.find((item) => item.kind === 'context_policy')!;
    Object.assign(context.settings, {
      requested_context_tokens: Number.MAX_SAFE_INTEGER,
      reserved_output_tokens: 2,
    });
    checkNumericRule(
      {
        op: 'eq',
        left: { metric: 'context.total_requested_tokens' },
        right: { literal: '9007199254740993' },
      },
      'pass',
      build,
    );
  });

  it.each([
    ['context total in a numeric list', 'in', 4096, 512, [4608], 'pass'],
    ['numeric list contains the context total', 'contains', 4096, 512, [4608], 'pass'],
    ['context membership does not coerce decimal strings', 'in', 4096, 512, ['4608'], 'fail'],
    ['reverse context membership does not coerce strings', 'contains', 4096, 512, ['4608'], 'fail'],
    [
      'exact large context list member',
      'in',
      Number.MAX_SAFE_INTEGER,
      3,
      [9007199254740994],
      'pass',
    ],
    [
      'unrepresentable context total is not a rounded member',
      'in',
      Number.MAX_SAFE_INTEGER,
      2,
      [9007199254740992],
      'fail',
    ],
  ] as const)('%s', (_name, op, requested, reserved, allowed, outcome) => {
    const build = structuredClone(exampleBuild) as BuildSnapshot;
    const context = build.selections.find((item) => item.kind === 'context_policy')!;
    Object.assign(context.settings, {
      requested_context_tokens: requested,
      reserved_output_tokens: reserved,
    });
    const metric = { metric: 'context.total_requested_tokens' } as const;
    const list = { literal: [...allowed] };
    checkNumericRule(
      { op, left: op === 'in' ? metric : list, right: op === 'in' ? list : metric },
      outcome,
      build,
    );
  });
});
