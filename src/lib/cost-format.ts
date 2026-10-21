import type { CostEstimate } from '../contracts';

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
