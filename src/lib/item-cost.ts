/*
 * Per-item price presentation for the design mock's catalog cards.
 *
 * The mock shows an illustrative monthly amount on every component. Rather than invent numbers,
 * this module runs the real preview estimator (domain/cost.ts) over a one-item probe build that
 * shares the current build's objectives and pricebook. The result is therefore exactly the amount
 * the estimate would charge for that item, and it is `Unknown` — never zero — when no applicable
 * rate exists. Amounts are synthetic (see methodology → pricing).
 */
import type { BuildSnapshot, CatalogItem, Pricebook } from '../contracts';
import { estimateCost } from '../domain/cost';
import { addOrReplace } from '../domain/build';

export interface ItemPrice {
  /** Amount as a decimal string, or null when the item cannot be priced. */
  amount: string | null;
  currency: string;
  /** Short label for a card: "$45", "Included*" or "Unknown". */
  label: string;
  /** Longer label for tables: "Example / month", "Included (unverified)" … */
  note: string;
}

const UNKNOWN: ItemPrice = {
  amount: null,
  currency: 'USD',
  label: 'Unknown',
  note: 'No applicable demo rate',
};

export function formatAmount(amount: string, currency = 'USD'): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Price of one catalog item under the given build objectives and pricebook. */
export function itemPrice(
  item: CatalogItem,
  build: BuildSnapshot | null | undefined,
  catalog: ReadonlyMap<string, CatalogItem>,
  pricebook: Pricebook | undefined,
): ItemPrice {
  const included: ItemPrice = {
    amount: '0.00',
    currency: build?.objectives.currency ?? 'USD',
    label: 'Included*',
    note: 'Free or included billing (unverified demo data)',
  };
  if (item.billing_class === 'free' || item.billing_class === 'included') return included;
  if (item.billing_class === 'unknown') return UNKNOWN;
  if (!build || !pricebook) return UNKNOWN;

  // A probe build with this single selection: the estimator then charges exactly this item.
  const probe: BuildSnapshot = {
    ...build,
    id: `probe.${item.id}`,
    revision: 1,
    selections: [],
  };
  const withItem = addOrReplace(probe, item, catalog);
  const estimate = estimateCost(withItem, catalog, pricebook);
  const line = estimate.line_items.find((l) => l.selection_id === withItem.selections[0]?.id);
  if (!line) return UNKNOWN;
  return {
    amount: line.amount.amount,
    currency: line.amount.currency,
    label: formatAmount(line.amount.amount, line.amount.currency),
    note: `Example / ${estimate.period_days} days (${line.meter.replace(/_/g, ' ')})`,
  };
}

/** All item prices for a catalog snapshot, keyed by catalog item id. */
export function itemPriceMap(
  items: readonly CatalogItem[],
  build: BuildSnapshot | null | undefined,
  pricebook: Pricebook | undefined,
): Map<string, ItemPrice> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const map = new Map<string, ItemPrice>();
  for (const item of items) map.set(item.id, itemPrice(item, build, byId, pricebook));
  return map;
}

/** Total label for a summary panel: "$125" plus a "/mo*" suffix rendered separately by the UI. */
export function totalLabel(amount: string | undefined, currency = 'USD'): string {
  if (!amount) return '—';
  return formatAmount(amount, currency);
}
