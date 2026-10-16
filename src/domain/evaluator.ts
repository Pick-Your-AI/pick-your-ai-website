/*
 * TypeScript port of the research contract's reference rule interpreter
 * (contracts/v1/reference/evaluate.py, Pick-Your-AI/pick-your-ai-research).
 *
 * This is NOT an independent compatibility policy: it interprets the published, versioned Ruleset
 * (baseline/core-ruleset.json) with the contract's three-valued semantics. Parity with the Python
 * reference is asserted by tests/unit/evaluator-parity.test.ts against outputs produced by
 * evaluate.py. Like the reference, it is not a calibrated VRAM estimator or a deployment gate.
 */
import type {
  BuildSnapshot,
  CatalogItem,
  CatalogSnapshot,
  CostEstimate,
  EvaluationReport,
  Expression,
  ResourceEstimate,
  Ruleset,
  Selection,
} from '../contracts';
import { compareScaled, toScaled } from './decimal';

/** The third truth value. */
export const UNKNOWN: unique symbol = Symbol('unknown');
type Unknown = typeof UNKNOWN;
type Tri = boolean | Unknown;
type Value = unknown;

type Operand = Extract<Expression, { left: unknown }>['left'];
type Ref = Extract<Operand, { ref: unknown }>['ref'];

export interface EvaluationInputs {
  build: BuildSnapshot;
  catalog: CatalogSnapshot;
  ruleset: Ruleset;
  /** Development/test override only (reference `--metrics`); never used by the site UI. */
  metrics?: Record<string, unknown>;
  costEstimate?: CostEstimate | null;
  resourceEstimate?: ResourceEstimate | null;
  /** Timestamp to stamp on the report (reference uses a fixed fixture time). */
  evaluatedAt?: string;
}

export type Finding = EvaluationReport['findings'][number];

function pointerGet(document: unknown, pointer: string): Value | Unknown {
  if (!pointer.startsWith('/')) return UNKNOWN;
  let cur: unknown = document;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) {
      if (!/^[0-9]+$/.test(key) || Number(key) >= cur.length) return UNKNOWN;
      cur = cur[Number(key)];
    } else if (cur !== null && typeof cur === 'object') {
      if (!Object.prototype.hasOwnProperty.call(cur, key)) return UNKNOWN;
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return UNKNOWN;
    }
  }
  return cur;
}

/** Python-style structural equality (used for `==`, membership and set operations). */
function pyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = toScaled(a);
  const nb = toScaled(b);
  if (typeof a === 'number' && typeof b === 'number' && na !== null && nb !== null)
    return na === nb;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => pyEqual(x, b[i]));
  }
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every((k) => pyEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    );
  }
  return false;
}

const contains = (list: unknown[], item: unknown) => list.some((x) => pyEqual(x, item));

function and(values: Tri[]): Tri {
  if (values.includes(false)) return false;
  if (values.includes(UNKNOWN)) return UNKNOWN;
  return true;
}

function or(values: Tri[]): Tri {
  if (values.includes(true)) return true;
  if (values.includes(UNKNOWN)) return UNKNOWN;
  return false;
}

const RESOURCE_RANK = { unverified: 0, estimated: 1, calibrated: 2, verified: 3 } as const;

export class RuleEvaluator {
  private readonly build: BuildSnapshot;
  private readonly ruleset: Ruleset;
  private readonly catalog: Map<string, CatalogItem>;
  private readonly active: Selection[];
  private readonly metrics: Record<string, unknown>;
  private readonly costEstimate: CostEstimate | null;
  private readonly resourceEstimate: ResourceEstimate | null;
  private readonly evaluatedAt: string;

  constructor(inputs: EvaluationInputs) {
    this.build = inputs.build;
    this.ruleset = inputs.ruleset;
    this.catalog = new Map(inputs.catalog.items.map((i) => [i.id, i]));
    this.active = inputs.build.selections.filter((s) => s.enabled);
    this.metrics = inputs.metrics ?? {};
    this.costEstimate = inputs.costEstimate ?? null;
    this.resourceEstimate = inputs.resourceEstimate ?? null;
    this.evaluatedAt = inputs.evaluatedAt ?? new Date().toISOString();
  }

  /** A kind/role/selection reference must match exactly one enabled selection. */
  private selected(ref: {
    kind?: string;
    role?: string;
    selection_id?: string;
  }): Selection | Unknown {
    const matches = this.active.filter(
      (s) =>
        (!ref.kind || s.kind === ref.kind) &&
        (!ref.role || s.role === ref.role) &&
        (!ref.selection_id || s.id === ref.selection_id),
    );
    return matches.length === 1 ? matches[0]! : UNKNOWN;
  }

  private settings(s: Selection): Record<string, unknown> {
    return s.settings as Record<string, unknown>;
  }

  private spec(item: CatalogItem): Record<string, unknown> {
    return item.spec as Record<string, unknown>;
  }

  private metric(name: string): Value | Unknown {
    if (Object.prototype.hasOwnProperty.call(this.metrics, name)) return this.metrics[name];
    if (
      name.startsWith('inference.') ||
      name.startsWith('training.') ||
      name.startsWith('compute.estimated_')
    ) {
      const doc = this.resourceEstimate;
      if (doc && doc.build_id === this.build.id && doc.build_revision === this.build.revision) {
        const minimum = this.build.policy?.min_resource_confidence ?? 'calibrated';
        for (const estimate of doc.estimates) {
          if (
            estimate.metric === name &&
            RESOURCE_RANK[estimate.confidence] >= RESOURCE_RANK[minimum]
          ) {
            return estimate.value;
          }
        }
      }
      return UNKNOWN;
    }
    if (name === 'context.total_requested_tokens') {
      const s = this.selected({ kind: 'context_policy', role: 'primary' });
      if (s === UNKNOWN) return UNKNOWN;
      const a = this.settings(s).requested_context_tokens;
      const b = this.settings(s).reserved_output_tokens;
      if (a === undefined || b === undefined) return UNKNOWN;
      return (a as number) + (b as number);
    }
    if (name === 'compute.total_selected_vram_gb') {
      const matches = this.active.filter((s) => s.kind === 'accelerator');
      if (!matches.length) return UNKNOWN;
      let total = 0n;
      for (const s of matches) {
        const item = this.catalog.get(s.catalog_item_id);
        if (!item) return UNKNOWN;
        const v = toScaled(this.spec(item).vram_gb);
        const count = this.settings(s).device_count;
        if (v === null || typeof count !== 'number') return UNKNOWN;
        total += v * BigInt(count);
      }
      return { __scaled: total };
    }
    if (name === 'compute.min_selected_device_vram_gb') {
      const matches = this.active.filter((s) => s.kind === 'accelerator');
      if (!matches.length) return UNKNOWN;
      let min: bigint | null = null;
      for (const s of matches) {
        const item = this.catalog.get(s.catalog_item_id);
        const vram = item ? this.spec(item).vram_gb : undefined;
        if (typeof vram !== 'number') return UNKNOWN;
        const v = toScaled(vram)!;
        if (min === null || v < min) min = v;
      }
      return { __scaled: min };
    }
    if (name === 'tools.mutating_count') {
      const matches = this.active.filter(
        (s) => s.kind === 'tool' && this.settings(s).enabled !== false,
      );
      let n = 0;
      for (const s of matches) {
        const item = this.catalog.get(s.catalog_item_id);
        if (!item) return UNKNOWN;
        const sideEffect = this.spec(item).side_effect;
        if (sideEffect === undefined) return UNKNOWN;
        n += sideEffect === 'mutating' ? 1 : 0;
      }
      return n;
    }
    if (name === 'cost.monthly_total_amount') {
      const q = this.costEstimate;
      if (
        !q ||
        q.coverage !== 'complete' ||
        q.build_revision !== this.build.revision ||
        q.build_id !== this.build.id ||
        q.period_days !== 30
      ) {
        return UNKNOWN;
      }
      if (q.currency !== this.build.objectives.currency) return UNKNOWN;
      return q.total.amount;
    }
    // Runtime memory is deliberately never guessed from weight size.
    return UNKNOWN;
  }

  private value(operand: Operand): Value | Unknown {
    if ('literal' in operand) return operand.literal;
    if ('metric' in operand) return this.metric(operand.metric);
    const ref: Ref = operand.ref;
    if (ref.scope === 'build') return pointerGet(this.build, ref.pointer);
    const sel = this.selected(ref);
    if (sel === UNKNOWN) return UNKNOWN;
    if (ref.scope === 'selection') return pointerGet(sel, ref.pointer);
    const item = this.catalog.get(sel.catalog_item_id);
    if (!item || item.version !== sel.catalog_item_version) return UNKNOWN;
    return pointerGet(item, ref.pointer);
  }

  private compare(op: string, l: Value | Unknown, r: Value | Unknown): Tri {
    if (l === UNKNOWN || r === UNKNOWN) return UNKNOWN;
    const nl = numericOf(l);
    const nr = numericOf(r);
    if (op === 'eq' || op === 'ne') {
      const equal = nl !== null && nr !== null ? nl === nr : pyEqual(plain(l), plain(r));
      return op === 'eq' ? equal : !equal;
    }
    if (op === 'lt' || op === 'lte' || op === 'gt' || op === 'gte') {
      if (nl === null || nr === null) return UNKNOWN;
      const c = compareScaled(nl, nr);
      return op === 'lt' ? c < 0 : op === 'lte' ? c <= 0 : op === 'gt' ? c > 0 : c >= 0;
    }
    if (op === 'contains' || op === 'in') {
      const [container, item] = op === 'contains' ? [l, r] : [r, l];
      if (typeof container === 'string') {
        return typeof item === 'string' ? container.includes(item) : UNKNOWN;
      }
      return Array.isArray(container) ? contains(container, item) : UNKNOWN;
    }
    if (op === 'intersects') {
      return Array.isArray(l) && Array.isArray(r) ? l.some((x) => contains(r, x)) : UNKNOWN;
    }
    if (op === 'subset_of') {
      return Array.isArray(l) && Array.isArray(r) ? l.every((x) => contains(r, x)) : UNKNOWN;
    }
    return UNKNOWN;
  }

  expr(expression: Expression): Tri {
    const e = expression as Record<string, unknown> & { op: string };
    switch (e.op) {
      case 'exists': {
        const v = this.value(e.value as Operand);
        return v !== UNKNOWN && v !== null && v !== undefined;
      }
      case 'all':
      case 'any': {
        const values = (e.args as Expression[]).map((x) => this.expr(x));
        return e.op === 'all' ? and(values) : or(values);
      }
      case 'not': {
        const x = this.expr(e.arg as Expression);
        return x === UNKNOWN ? UNKNOWN : !x;
      }
      case 'implies': {
        const a = this.expr(e.if as Expression);
        const b = this.expr(e.then as Expression);
        return or([a === UNKNOWN ? UNKNOWN : !a, b]);
      }
      default:
        return this.compare(e.op, this.value(e.left as Operand), this.value(e.right as Operand));
    }
  }

  evaluate(): EvaluationReport {
    const rules = this.ruleset.rules;
    const findings: Finding[] = rules.map((rule) => {
      const applicable = this.expr(rule.applies_when);
      const result: Tri | null =
        applicable === true ? this.expr(rule.assert) : applicable === false ? null : UNKNOWN;
      const outcome: Finding['outcome'] =
        result === null ? 'skipped' : result === UNKNOWN ? 'unknown' : result ? 'pass' : 'fail';
      const flagged = outcome === 'fail' || outcome === 'unknown';
      const selectionIds = [
        ...new Set(
          this.active
            .filter((s) => (rule.affected_kinds as string[]).includes(s.kind))
            .map((s) => s.id),
        ),
      ].sort();
      return {
        rule_id: rule.id,
        outcome,
        severity: rule.severity,
        code: rule.id.replace(/\./g, '_').toUpperCase(),
        message: flagged ? rule.message : `${rule.id}: ${outcome}`,
        remediation: flagged ? rule.remediation : '',
        selection_ids: selectionIds,
      };
    });
    const count = (o: Finding['outcome']) => findings.filter((f) => f.outcome === o).length;
    const summary = {
      passed: count('pass'),
      failed: count('fail'),
      unknown: count('unknown'),
      skipped: count('skipped'),
    };
    const failures = findings.some((f) => f.outcome === 'fail' && f.severity === 'error');
    const unknowns = findings.some((f) => f.outcome === 'unknown');
    const unknownBlocks = findings.some(
      (f, i) => f.outcome === 'unknown' && rules[i]!.on_unknown === 'block',
    );
    const policy = this.build.policy ?? {};
    const readiness: EvaluationReport['deployment_readiness'] =
      failures || unknownBlocks || (unknowns && (policy.fail_on_unknown ?? false))
        ? 'blocked'
        : 'needs_review';
    // Even a structurally valid compatibility result is not proof of quality-evaluation gate success.
    return {
      schema_version: this.build.schema_version,
      id: `evaluation.${this.build.id}.r${this.build.revision}`,
      build_id: this.build.id,
      build_revision: this.build.revision,
      catalog_snapshot_id: this.build.locks.catalog_snapshot_id,
      ruleset_id: this.ruleset.id,
      ruleset_version: this.ruleset.version,
      dependency_graph_id: this.build.locks.dependency_graph_id,
      dependency_graph_revision: this.build.locks.dependency_graph_revision,
      evaluated_at: this.evaluatedAt,
      result: failures ? 'invalid' : unknowns ? 'indeterminate' : 'valid',
      deployment_readiness: readiness,
      findings,
      summary,
    };
  }
}

/** Internal wrapper for exact decimal metric values so they never round-trip through floats. */
interface ScaledBox {
  __scaled: bigint;
}
const isScaledBox = (v: unknown): v is ScaledBox =>
  typeof v === 'object' && v !== null && '__scaled' in v;
const numericOf = (v: unknown) => (isScaledBox(v) ? v.__scaled : toScaled(v));
const plain = (v: unknown) => (isScaledBox(v) ? v.__scaled : v);

export function evaluateBuild(inputs: EvaluationInputs): EvaluationReport {
  return new RuleEvaluator(inputs).evaluate();
}
