import type {
  BuildSnapshot,
  CatalogItem,
  CatalogSnapshot,
  ComponentKind,
  Provenance,
  Ruleset,
} from '../contracts';
import { addOrReplace, removeSelection, replaceSelection } from '../domain/build';
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

const OUTCOME_RANK: Record<string, number> = { pass: 0, skipped: 0, unknown: 1, fail: 2 };

/**
 * Evaluates each alternative by substituting it into the build (same selection id and role) and
 * running the published ruleset. A finding counts against a candidate only when the candidate makes
 * that rule's outcome worse than it is with the slot left empty, so a rule that already fails for an
 * unfinished build (e.g. `rule.required.foundation` before T0/T1 are chosen) does not mark every
 * option incompatible. Verdict: any attributable fail → incompatible; any attributable unknown →
 * unknown; otherwise compatible (with the current picks and evidence only).
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
  const scoped = { ...ruleset, rules: relevant };
  // Evidence is tied to the current revision; hypothetical builds must not reuse it.
  const evaluate = (b: BuildSnapshot) =>
    evaluateBuild({
      build: b,
      catalog: snapshot,
      ruleset: scoped,
      resourceEstimate: null,
      costEstimate: null,
    });
  const worst = (b: BuildSnapshot) => {
    const m = new Map<string, number>();
    for (const f of evaluate(b).findings)
      m.set(f.rule_id, Math.max(m.get(f.rule_id) ?? 0, OUTCOME_RANK[f.outcome] ?? 0));
    return m;
  };
  const baseline = worst(existing ? removeSelection(build, existing.id) : build);
  return candidates.map((item) => {
    const hypothetical = existing
      ? replaceSelection(build, existing.id, item, byId)
      : addOrReplace(build, item, byId, { additional: true });
    const introduced = [...worst(hypothetical)].filter(([id, r]) => r > (baseline.get(id) ?? 0));
    const fails = introduced.filter(([, r]) => r === OUTCOME_RANK.fail).map(([id]) => id);
    const unknowns = introduced.filter(([, r]) => r === OUTCOME_RANK.unknown).map(([id]) => id);
    return {
      catalog_item_id: item.id,
      catalog_item_version: item.version,
      verdict: fails.length ? 'incompatible' : unknowns.length ? 'unknown' : 'compatible',
      rule_ids: fails.length ? fails : unknowns,
    };
  });
}
