import type { BuildSnapshot, ComponentKind, CostEstimate, EvaluationReport } from '../../contracts';
import { KIND_LABELS, withArticle } from '../../contracts';
import type { Coverage } from '../../domain/activation';
import type { Outcome } from '../../components/status';
import { worstOutcome } from '../../components/status';

export type Finding = EvaluationReport['findings'][number];

/** Findings that need attention (fail or unknown), lettered A, B, C… in report order. */
export function flaggedFindings(
  report: EvaluationReport | undefined,
): (Finding & { letter: string })[] {
  if (!report) return [];
  return report.findings
    .filter((f) => f.outcome === 'fail' || f.outcome === 'unknown')
    .sort((a, b) => (a.outcome === b.outcome ? 0 : a.outcome === 'fail' ? -1 : 1))
    .map((f, i) => ({ ...f, letter: letterFor(i) }));
}

function letterFor(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function findingsForSelection(
  report: EvaluationReport | undefined,
  selectionId: string,
): Finding[] {
  return report?.findings.filter((f) => f.selection_ids.includes(selectionId)) ?? [];
}

export function selectionOutcome(
  report: EvaluationReport | undefined,
  selectionId: string,
  presenceRuleIds?: ReadonlySet<string>,
): Outcome | null {
  const applicable = findingsForSelection(report, selectionId).filter(
    (f) => f.outcome !== 'skipped' && !presenceRuleIds?.has(f.rule_id),
  );
  const outcome = worstOutcome(applicable.map((f) => f.outcome));
  return presenceRuleIds?.size && outcome !== 'fail' ? 'unknown' : outcome;
}

export function overall(report: EvaluationReport | undefined): Outcome | null {
  if (!report) return null;
  if (report.summary.failed) return 'fail';
  if (report.summary.unknown) return 'unknown';
  if (report.summary.passed) return 'pass';
  return 'skipped';
}

export function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function costHeadline(cost: CostEstimate | undefined): { text: string; detail: string } {
  if (!cost) return { text: 'Unknown', detail: 'No estimate yet.' };
  const total = formatMoney(cost.total.amount, cost.currency);
  if (cost.coverage === 'complete' && cost.line_items.length === 0) {
    return {
      text: 'No metered costs',
      detail: 'No selected component has a usage-priced rate yet.',
    };
  }
  if (cost.coverage === 'complete') {
    return {
      text: `${total} / ${cost.period_days} days`,
      detail: 'Synthetic estimate with complete coverage — not a quote.',
    };
  }
  if (cost.coverage === 'partial') {
    return {
      text: `≥ ${total} + unpriced`,
      detail: `${cost.unpriced_selection_ids.length} component(s) could not be priced, so the total is a lower bound.`,
    };
  }
  return { text: 'Unknown', detail: 'Nothing billable could be priced.' };
}

/**
 * Compact, coverage-aware total for a card or a list row.
 *
 * `costHeadline` is the sentence form used by the builder. A card has room for an amount plus one
 * qualifier, so this keeps the coverage decision in one place: a partial estimate is a lower bound
 * (`≥`), an estimate that priced nothing is `Unknown`, and neither is ever shown as a plain amount.
 */
export interface CostShort {
  /** Amount, or an explicit word when there is no trustworthy total. */
  text: string;
  /** Qualifier shown next to the amount: the period, or "lower bound". */
  qualifier: string | null;
  /** Explanation for a tooltip or caption; never states a lower bound as the full price. */
  note: string;
  /** True only when every selected component was priced. */
  complete: boolean;
}

export function costShort(cost: CostEstimate | undefined): CostShort {
  if (!cost)
    return {
      text: '—',
      qualifier: null,
      note: 'Nothing has been priced for this build yet.',
      complete: false,
    };
  const total = formatMoney(cost.total.amount, cost.currency);
  if (cost.coverage === 'complete') {
    if (cost.line_items.length === 0)
      return {
        text: 'No metered costs',
        qualifier: null,
        note: 'No selected component has a usage-priced rate yet.',
        complete: true,
      };
    return {
      text: total,
      qualifier: `per ${cost.period_days} days`,
      note: `Complete coverage over ${cost.period_days} days — synthetic estimate, not a quote.`,
      complete: true,
    };
  }
  if (cost.coverage === 'partial') {
    const unpriced = cost.unpriced_selection_ids.length;
    return {
      text: `≥ ${total}`,
      qualifier: 'lower bound',
      note: `${unpriced} component${unpriced === 1 ? '' : 's'} could not be priced, so this ${cost.period_days}-day total is a lower bound — not a quote.`,
      complete: false,
    };
  }
  return {
    text: 'Unknown',
    qualifier: null,
    note: 'Nothing billable could be priced, so no total is shown.',
    complete: false,
  };
}

export function nextAction(
  build: BuildSnapshot,
  coverage: Coverage,
  report: EvaluationReport | undefined,
  cost: CostEstimate | undefined,
): string {
  const missing = coverage.missing[0];
  if (!build.selections.length) return 'Start with T0: choose the workload you want to support.';
  if (missing)
    return `Choose ${withArticle(KIND_LABELS[missing as ComponentKind])} — it is needed for this deployment mode.`;
  if (coverage.dependsOnMode.length)
    return 'Choose a deployment mode so the builder knows which infrastructure is needed.';
  if (!report) return 'Compatibility results for this build are not available yet.';
  const fail = report?.findings.find((f) => f.outcome === 'fail');
  if (fail) return `Resolve the failing check: ${fail.message} ${fail.remediation}`.trim();
  const unknown = report?.findings.find((f) => f.outcome === 'unknown');
  if (unknown) return `Review what is unknown: ${unknown.message}`;
  if (cost && cost.coverage !== 'complete')
    return 'Pricing is incomplete — review unpriced components in the cost breakdown.';
  return 'All configured checks pass for this revision. Review the summary, then save or share it.';
}
