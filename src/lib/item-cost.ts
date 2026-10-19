/*
 * Per-item price presentation for the catalog cards and the builder's parts register.
 *
 * The design mock shows an illustrative monthly amount on every component. Rather than invent
 * numbers, this module runs the real preview estimator (domain/cost.ts) over a one-item probe build
 * that shares the current build's objectives, policy and pricebook. The result is therefore exactly
 * what the estimate would charge for that item — including every billable meter — and it is
 * `Unknown`, never zero, when no applicable rate exists.
 *
 * Two rules keep the row honest, because the aggregate estimator already models them:
 *  - a component can have several meters, so every line for the selection is summed. If any meter
 *    stayed unpriced the row is a lower bound, not a complete monthly price;
 *  - free/included is a *policy* outcome, not a property of the item. An unverified free item is
 *    unpriced unless the build policy allows unverified catalog items, so the row is derived from
 *    the estimator's admission decision instead of short-circuiting it.
 *
 * Amounts are synthetic (see methodology → pricing).
 */
import type { BuildSnapshot, CatalogItem, CostEstimate, Pricebook } from '../contracts';
import { estimateCost } from '../domain/cost';
import { addOrReplace } from '../domain/build';
import { addDecimals } from '../domain/decimal';

export interface ItemPrice {
  /** Amount as a decimal string, or null when the item cannot be priced. */
  amount: string | null;
  currency: string;
  /** Short label for a card: "$45", "≥ $45", "Included", "Included (unverified)" or "Unknown". */
  label: string;
  /** Longer label for tables: "Example / month", "Lower bound · 1 meter unpriced" … */
  note: string;
  /** True when the amount covers only some of the item's applicable meters. */
  partial: boolean;
  /** True when the estimator admitted the item as free/included. */
  included: boolean;
}

const UNKNOWN: ItemPrice = {
  amount: null,
  currency: 'USD',
  label: 'Unknown',
  note: 'No applicable demo rate',
  partial: false,
  included: false,
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

/** The probe selection for one item, preserving the settings the user already configured. */
function probeBuild(
  item: CatalogItem,
  build: BuildSnapshot,
  catalog: ReadonlyMap<string, CatalogItem>,
): BuildSnapshot {
  const base: BuildSnapshot = { ...build, id: `probe.${item.id}`, revision: 1, selections: [] };
  const existing = build.selections.find((s) => s.catalog_item_id === item.id);
  if (existing) {
    // Reuse the current selection verbatim: instances, region, budget and reserved hours all
    // change the projected quantity, so defaulting them here would misprice the row.
    return { ...base, selections: [{ ...existing, enabled: true }] };
  }
  return addOrReplace(base, item, catalog);
}

/** Sum every line the estimator produced for this one selection. */
function linesFor(estimate: CostEstimate, selectionId: string) {
  return estimate.line_items.filter((line) => line.selection_id === selectionId);
}

/** Price of one catalog item under the given build objectives, policy and pricebook. */
export function itemPrice(
  item: CatalogItem,
  build: BuildSnapshot | null | undefined,
  catalog: ReadonlyMap<string, CatalogItem>,
  pricebook: Pricebook | undefined,
): ItemPrice {
  const currency = build?.objectives.currency ?? 'USD';
  if (item.billing_class === 'unknown') return { ...UNKNOWN, currency };
  if (!build || !pricebook) return { ...UNKNOWN, currency };

  const probe = probeBuild(item, build, catalog);
  const selection = probe.selections[0];
  if (!selection) return { ...UNKNOWN, currency };

  const estimate = estimateCost(probe, catalog, pricebook);
  const lines = linesFor(estimate, selection.id);
  const unpriced = estimate.unpriced_selection_ids.includes(selection.id);

  // Free/included: the estimator decides admission. Unverified free items are unpriced unless the
  // build policy allows them, and then it records a warning — surface that on the row.
  if (item.billing_class === 'free' || item.billing_class === 'included') {
    if (unpriced) {
      return {
        amount: null,
        currency,
        label: 'Unknown',
        note: `"${item.billing_class}" billing is unverified and the build policy does not allow unverified catalog items, so it is not treated as zero cost.`,
        partial: false,
        included: false,
      };
    }
    const verified = item.provenance.some((p) => p.verification_status === 'verified');
    return {
      amount: '0.00',
      currency,
      label: verified ? 'Included' : 'Included*',
      note: verified
        ? `Free or included billing, verified by recorded provenance.`
        : 'Free or included billing (unverified demo data; the build policy allows unverified items).',
      partial: false,
      included: true,
    };
  }

  if (!lines.length) return { ...UNKNOWN, currency };

  // Every applicable meter is summed with the estimator's exact decimal semantics.
  const amount = addDecimals(
    lines.map((line) => line.amount.amount),
    2,
  );
  const meters = lines.map((line) => line.meter.replace(/_/g, ' ')).join(', ');
  const note = unpriced
    ? `Lower bound · ${lines.length} of this component's meters priced (${meters}); at least one meter has no applicable rate.`
    : `Example / ${estimate.period_days} days (${meters})`;

  return {
    amount,
    currency,
    label: unpriced ? `≥ ${formatAmount(amount, currency)}` : formatAmount(amount, currency),
    note,
    partial: unpriced,
    included: false,
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
