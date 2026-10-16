/* Candidate ranking must attribute only the findings a candidate introduces. */
import { describe, expect, it } from 'vitest';
import { BASELINE_RULESET } from '../../src/contracts';
import { createBuild } from '../../src/domain/build';
import { compatibleOptionsLocal } from '../../src/data/shared';
import { CATALOG, NOW, buildWith, contradictory, item } from './scenarios';

const options = (build: Parameters<typeof compatibleOptionsLocal>[0], kind: string) =>
  compatibleOptionsLocal(build, CATALOG, BASELINE_RULESET, kind as never, 'primary');

describe('compatible options', () => {
  it('does not mark every workload incompatible on an empty build', () => {
    const empty = createBuild({ id: 'build.test.empty', catalogSnapshotId: CATALOG.id, now: NOW });
    const opts = options(empty, 'workload');
    expect(opts.length).toBeGreaterThan(0);
    // Only the restricted-data workload introduces its own failing rule (redaction monitoring).
    const incompatible = opts.filter((o) => o.verdict === 'incompatible');
    expect(incompatible.map((o) => o.catalog_item_id)).toEqual([
      item('workload', 'restricted-assistant').id,
    ]);
    expect(opts.flatMap((o) => o.rule_ids)).not.toContain('rule.required.foundation');
  });

  it('does not blame candidates for a foundation rule that fails either way', () => {
    const partial = buildWith([['workload', 'support-chat']]);
    for (const o of options(partial, 'deployment_mode'))
      expect(o.rule_ids).not.toContain('rule.required.foundation');
  });

  it('still reports a contradiction the candidate introduces', () => {
    const verdicts = new Map(options(contradictory(), 'model').map((o) => [o.catalog_item_id, o]));
    const weightsOnly = verdicts.get(item('model', 'open-8b').id)!;
    expect(weightsOnly.verdict).toBe('incompatible');
    expect(weightsOnly.rule_ids.length).toBeGreaterThan(0);
    expect(verdicts.get(item('model', 'aurora-large').id)!.verdict).not.toBe('incompatible');
  });
});
