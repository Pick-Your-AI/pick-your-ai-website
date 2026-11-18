import type { CostEstimate } from '../contracts';

/**
 * A quote has one currency. The v1 contract supplies no pinned conversion policy, so
 * money in another currency cannot establish its total. This checks internal consistency;
 * a coherent foreign-currency quote remains evidence whose budget comparison is Unknown.
 */
export function hasConsistentCostCurrency(estimate: CostEstimate): boolean {
  const currency = estimate.currency;
  return (
    estimate.subtotal.currency === currency &&
    estimate.tax.currency === currency &&
    estimate.total.currency === currency &&
    estimate.line_items.every(
      (line) => line.unit_price.currency === currency && line.amount.currency === currency,
    )
  );
}
