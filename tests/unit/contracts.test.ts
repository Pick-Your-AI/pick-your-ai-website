import { describe, expect, it } from 'vitest';
import exampleBuild from '../../contracts/v1/examples/build.json';
import exampleCatalog from '../../contracts/v1/examples/catalog.json';
import exampleCost from '../../contracts/v1/examples/cost-estimate.json';
import exampleGraph from '../../contracts/v1/examples/dependency-graph.json';
import exampleEval from '../../contracts/v1/examples/evaluation-report.json';
import examplePricebook from '../../contracts/v1/examples/pricebook.json';
import exampleResource from '../../contracts/v1/examples/resource-estimate.json';
import exampleManifest from '../../contracts/v1/examples/deployment-manifest.json';
import {
  BASELINE_GRAPH,
  BASELINE_RULESET,
  KINDS,
  KIND_LABELS,
  TIERS,
  kindsInTier,
  validateContract,
} from '../../src/contracts';
import { DEMO_CATALOG, DEMO_ITEMS } from '../../src/data/fixture/catalog';

describe('component registry', () => {
  it('defines the 29 canonical kinds across T0–T6', () => {
    expect(KINDS).toHaveLength(29);
    expect(TIERS.map((t) => kindsInTier(t).length)).toEqual([2, 3, 5, 5, 5, 4, 5]);
    for (const k of KINDS) expect(KIND_LABELS[k.kind]).toBeTruthy();
  });
});

describe('generated validators accept the upstream examples', () => {
  it.each([
    ['BuildSnapshot', exampleBuild],
    ['CatalogSnapshot', exampleCatalog],
    ['CostEstimate', exampleCost],
    ['DependencyGraph', exampleGraph],
    ['EvaluationReport', exampleEval],
    ['Pricebook', examplePricebook],
    ['ResourceEstimate', exampleResource],
    ['DeploymentManifest', exampleManifest],
  ] as const)('%s', (name, data) => {
    const result = validateContract(name, data);
    expect(result.ok, result.ok ? '' : result.summary).toBe(true);
  });

  it('baseline graph and ruleset are valid and complete', () => {
    expect(validateContract('DependencyGraph', BASELINE_GRAPH).ok).toBe(true);
    expect(validateContract('Ruleset', BASELINE_RULESET).ok).toBe(true);
    expect(BASELINE_GRAPH.edges).toHaveLength(59);
    expect(BASELINE_RULESET.rules).toHaveLength(45);
  });

  it('rejects malformed payloads', () => {
    const bad = { ...exampleBuild, revision: 0 };
    const result = validateContract('BuildSnapshot', bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.summary).toMatch(/revision/);
    const wrongKind = { ...exampleCatalog.items[0], kind: 'gpu' };
    expect(validateContract('CatalogItem', wrongKind).ok).toBe(false);
  });
});

describe('synthetic demo catalog', () => {
  it('validates against the catalog snapshot schema', () => {
    const result = validateContract('CatalogSnapshot', DEMO_CATALOG);
    expect(result.ok, result.ok ? '' : JSON.stringify(result.errors.slice(0, 3))).toBe(true);
  });

  it('covers every kind and is labelled synthetic and unverified', () => {
    for (const k of KINDS) expect(DEMO_ITEMS.some((i) => i.kind === k.kind)).toBe(true);
    for (const i of DEMO_ITEMS) {
      expect(i.tags).toContain('synthetic');
      expect(i.provenance.every((p) => p.verification_status === 'unverified')).toBe(true);
      expect(i.provenance[0]?.notes).toMatch(/SYNTHETIC/);
    }
  });

  it('has unique ids and resolvable catalog references', () => {
    const ids = new Set(DEMO_ITEMS.map((i) => i.id));
    expect(ids.size).toBe(DEMO_ITEMS.length);
    const refs = DEMO_ITEMS.flatMap((i) =>
      Object.entries(i.spec as Record<string, unknown>).flatMap(([key, v]) =>
        key.endsWith('_ref') ? [v] : key.endsWith('_refs') ? (v as string[]) : [],
      ),
    );
    for (const r of refs) expect(ids.has(r as string), String(r)).toBe(true);
  });
});
