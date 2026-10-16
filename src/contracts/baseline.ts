import provenance from '../../contracts/PROVENANCE.json';
import graphJson from '../../contracts/v1/baseline/core-dependency-graph.json';
import rulesetJson from '../../contracts/v1/baseline/core-ruleset.json';
import type { DependencyGraph, Ruleset } from './generated/contract-types';

/** Baseline v1 dependency graph (59 edges) — consumed as-is, never modified. */
export const BASELINE_GRAPH = graphJson as DependencyGraph;
/** Baseline v1 ruleset (45 rules) — the only compatibility policy the site applies. */
export const BASELINE_RULESET = rulesetJson as Ruleset;

export const CONTRACT_PROVENANCE = {
  sourceRepository: provenance.sourceRepository,
  sourceSha: provenance.sourceSha,
  contractVersion: provenance.contractVersion,
} as const;
