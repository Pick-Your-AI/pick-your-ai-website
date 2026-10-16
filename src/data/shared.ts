import type {
  BuildSnapshot,
  CatalogItem,
  CatalogSnapshot,
  ComponentKind,
  Provenance,
  Ruleset,
} from '../contracts';
import { addOrReplace, replaceSelection } from '../domain/build';
import { evaluateBuild } from '../domain/evaluator';
import { itemFreshness } from '../domain/freshness';
import type { CompatibleOption, EvidenceProvider, ItemEvidence } from './types';

const RANK: Record<Provenance['verification_status'], number> = {
  unverified: 0,
  estimated: 1,
  user_supplied: 2,
  verified: 3,
};

/** Evidence is derived from catalog provenance; no separate evidence endpoint exists in v1. */
export class ProvenanceEvidenceProvider implements EvidenceProvider {
  async forItem(item: CatalogItem): Promise<ItemEvidence> {
    const best = [...item.provenance].sort(
      (a, b) => RANK[b.verification_status] - RANK[a.verification_status],
    )[0]!;
    return {
      itemId: item.id,
      itemVersion: item.version,
      provenance: item.provenance,
      verification: best.verification_status,
      freshness: itemFreshness(item),
      synthetic: (item.tags ?? []).includes('synthetic'),
    };
  }
}

/**
 * Evaluates each alternative by substituting it into the build (same selection id and role) and
 * running the published ruleset. Verdict: any failing rule touching the kind → incompatible; any
 * unknown → unknown; otherwise compatible (with the current picks and evidence only).
 */
export function compatibleOptionsLocal(
  build: BuildSnapshot,
  snapshot: CatalogSnapshot,
  ruleset: Ruleset,
  kind: ComponentKind,
  role: string,
): CompatibleOption[] {
  const candidates = snapshot.items.filter((i) => i.kind === kind);
  const existing = build.selections.find((s) => s.kind === kind && s.role === role);
  const relevant = ruleset.rules.filter((r) => (r.affected_kinds as string[]).includes(kind));
  const byId = new Map(snapshot.items.map((i) => [i.id, i]));
  return candidates.map((item) => {
    const hypothetical = existing
      ? replaceSelection(build, existing.id, item, byId)
      : addOrReplace(build, item, byId, { additional: true });
    // Evidence is tied to the current revision; a hypothetical build must not reuse it.
    const report = evaluateBuild({
      build: hypothetical,
      catalog: snapshot,
      ruleset: { ...ruleset, rules: relevant },
      resourceEstimate: null,
      costEstimate: null,
    });
    const fails = report.findings.filter((f) => f.outcome === 'fail').map((f) => f.rule_id);
    const unknowns = report.findings.filter((f) => f.outcome === 'unknown').map((f) => f.rule_id);
    return {
      catalog_item_id: item.id,
      catalog_item_version: item.version,
      verdict: fails.length ? 'incompatible' : unknowns.length ? 'unknown' : 'compatible',
      rule_ids: fails.length ? fails : unknowns,
    };
  });
}
