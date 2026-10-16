/*
 * Bidirectional invalidation over the contract dependency graph (docs/DEPENDENCIES.md, "Change
 * handling" step 4): the kinds affected by a change are the graph neighbours of every changed kind
 * in BOTH directions, through edges that are active before OR after the change. Edges whose
 * activation is unknown count as active. This is traversal of direct adjacency, not a topological
 * sort; full re-evaluation of the ruleset remains the reproducible fallback.
 */
import type { ComponentKind, DependencyGraph } from '../contracts';
import { type BuildContext, edgeActive } from './activation';

export type GraphEdge = DependencyGraph['edges'][number];

export interface InvalidationResult {
  changedKinds: ComponentKind[];
  /** Kinds (other than the changed ones) whose evaluations, estimates and quotes are now stale. */
  affectedKinds: ComponentKind[];
  /** Edges that caused each affected kind, for explanations. */
  via: GraphEdge[];
}

export function affectedByChange(
  graph: DependencyGraph,
  changedKinds: Iterable<ComponentKind>,
  before: BuildContext,
  after: BuildContext,
): InvalidationResult {
  const changed = new Set(changedKinds);
  const affected = new Set<ComponentKind>();
  const via: GraphEdge[] = [];
  for (const edge of graph.edges) {
    const ends: [ComponentKind, ComponentKind] = [edge.dependent_kind, edge.depends_on_kind];
    const activeBefore = edgeActive(edge.activation, before, ends);
    const activeAfter = edgeActive(edge.activation, after, ends);
    const active = activeBefore !== false || activeAfter !== false;
    if (!active) continue;
    const touchesDependent = changed.has(edge.dependent_kind);
    const touchesDependency = changed.has(edge.depends_on_kind);
    if (!touchesDependent && !touchesDependency) continue;
    // Both ends of an active edge participate.
    for (const k of ends) {
      if (!changed.has(k)) affected.add(k);
    }
    via.push(edge);
  }
  return { changedKinds: [...changed], affectedKinds: [...affected], via };
}

/** Graph neighbours of a kind regardless of activation, split by direction (for detail pages). */
export function neighbours(graph: DependencyGraph, kind: ComponentKind) {
  return {
    dependsOn: graph.edges.filter((e) => e.dependent_kind === kind),
    dependents: graph.edges.filter((e) => e.depends_on_kind === kind),
  };
}
