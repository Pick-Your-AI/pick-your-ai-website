/*
 * Preview cost estimator (provisional — the authoritative pricing service and its usage model are
 * research issue #39). Implements the contract's pricing semantics (docs/PRICING_AND_GATES.md):
 *  - decimal-string arithmetic only, line amount = quantity × unit price, rounded half-up to cents;
 *  - `unknown` billing class is never zero: it leaves the selection unpriced;
 *  - free/included classifications bypass rate lookup only if verified, or if the build policy
 *    explicitly allows unverified catalog items (then a warning is recorded);
 *  - rates must match item id + version, be currently valid, match region when set, and use the
 *    build currency (no conversion is invented);
 *  - contract rates and rates with conditions stay unpriced: v1 has no admitted evidence that a
 *    build is eligible for a contract or satisfies a rate's free-text conditions;
 *  - simultaneously applicable rates for the same meter stay unpriced rather than
 *    summing alternative quotes or choosing a rate without a conflict-resolution policy;
 *  - coverage is `complete` only if nothing billable is left unpriced.
 */
import type { BuildSnapshot, CatalogItem, CostEstimate, Pricebook, Selection } from '../contracts';
import { addDecimals, decimalString, multiplyDecimals } from './decimal';
import { compareDateTimes } from './date-time';

type Line = CostEstimate['line_items'][number];
type Meter = Line['meter'];

export interface CostOptions {
  periodDays?: number;
  now?: string;
}

interface Projection {
  quantity: string;
  assumptions: string[];
}

function trimDecimal(n: number): string {
  // Usage projections are counts/ratios of integers; format to at most 6 places.
  return decimalString(Number(n.toFixed(6)), 6).replace(/\.?0+$/, '') || '0';
}

function project(
  meter: Meter,
  sel: Selection,
  item: CatalogItem,
  build: BuildSnapshot,
  periodDays: number,
): Projection | string {
  const o = build.objectives;
  const settings = sel.settings as Record<string, number | undefined>;
  const spec = item.spec as Record<string, unknown>;
  const requests = o.requests_per_day;
  switch (meter) {
    case 'input_tokens_1m':
    case 'output_tokens_1m':
    case 'embedding_tokens_1m': {
      const per = meter === 'output_tokens_1m' ? o.avg_output_tokens : o.avg_input_tokens;
      if (requests === undefined || per === undefined) {
        return 'Set requests per day and average tokens in the build objectives to project token usage.';
      }
      return {
        quantity: trimDecimal((requests * periodDays * per) / 1_000_000),
        assumptions: [
          `${requests} requests/day × ${periodDays} days × ${per} ${meter === 'output_tokens_1m' ? 'output' : 'input'} tokens; no caching or retries modelled.`,
        ],
      };
    }
    case 'request':
      if (requests === undefined) return 'Set requests per day to project request volume.';
      return {
        quantity: String(requests * periodDays),
        assumptions: [`${requests} requests/day × ${periodDays} days.`],
      };
    case 'gpu_hour': {
      if (item.kind === 'training_compute') {
        const budget = settings.gpu_hours_budget;
        if (budget === undefined)
          return 'Set a GPU-hours budget on the training compute selection.';
        return {
          quantity: trimDecimal(budget),
          assumptions: ['Training GPU hours equal the selected budget.'],
        };
      }
      const instances = settings.instances ?? 1;
      // Both explicit and default hours are monthly before the period is prorated below.
      const hours = settings.reserved_hours_per_month ?? 24 * 30;
      const devices = typeof spec.accelerator_count === 'number' ? spec.accelerator_count : 1;
      return {
        quantity: trimDecimal(instances * devices * hours * (periodDays / 30)),
        assumptions: [
          `${instances} instance(s) × ${devices} accelerator(s) × ${hours} h/month; always-on.`,
        ],
      };
    }
    case 'cpu_hour': {
      const instances = settings.instances ?? 1;
      const hours = settings.reserved_hours_per_month ?? 24 * 30;
      return {
        quantity: trimDecimal(instances * hours * (periodDays / 30)),
        assumptions: ['Always-on instances.'],
      };
    }
    // These meter names do not define seats, occurrences, licence quantities or proration rights.
    // The v1 settings have no admitted usage basis for them; a guessed unit could falsely turn
    // an incomplete estimate into complete coverage.
    case 'license_month':
    case 'one_time':
      return `No supported quantity or proration basis for meter "${meter}"; left unpriced rather than assuming one unit.`;
    case 'storage_gb_month': {
      const gb = settings.provisioned_gb;
      if (gb === undefined) return 'Set provisioned GB on the storage selection.';
      return {
        quantity: trimDecimal(gb * (periodDays / 30)),
        assumptions: [`${gb} GB provisioned for the period.`],
      };
    }
    default:
      return `No usage basis for meter "${meter}" in the v1 contract settings; left unpriced rather than guessed.`;
  }
}

function rateApplies(
  r: Pricebook['rates'][number],
  sel: Selection,
  build: BuildSnapshot,
  now: string,
): string | null {
  if (compareDateTimes(r.valid_from, now) > 0) return 'not yet valid';
  if (r.valid_until && compareDateTimes(r.valid_until, now) < 0)
    return `expired ${r.valid_until.slice(0, 10)}`;
  const region = (sel.settings as { region?: string }).region ?? build.objectives.region;
  if (r.region && r.region !== region) return `region ${r.region} ≠ ${region}`;
  if (r.unit_price.currency !== build.objectives.currency) {
    return `currency ${r.unit_price.currency} ≠ ${build.objectives.currency} (no conversion policy)`;
  }
  if (r.price_type === 'contract') {
    return 'contract eligibility cannot be established from v1 build evidence';
  }
  if (r.conditions?.length) {
    return 'rate conditions cannot be established from v1 build evidence';
  }
  return null;
}

export function estimateCost(
  build: BuildSnapshot,
  catalog: ReadonlyMap<string, CatalogItem>,
  pricebook: Pricebook,
  opts: CostOptions = {},
): CostEstimate {
  const periodDays = opts.periodDays ?? 30;
  const now = opts.now ?? new Date().toISOString();
  const currency = build.objectives.currency;
  const lines: Line[] = [];
  const unpriced = new Set<string>();
  /*
   * The preview caveat must describe the pricebook that was actually priced. The fixture demo
   * pricebook is synthetic; a configured pricebook is not, even though its rates may be unverified
   * estimates. The domain cannot see build configuration, so it reads the pricebook's own identity
   * and rate provenance instead of assuming.
   */
  const syntheticPricebook = pricebook.id.startsWith('prices.demo.');
  const unverifiedRates = pricebook.rates.some(
    (r) => r.provenance.verification_status !== 'verified',
  );
  const warnings: string[] = [
    syntheticPricebook
      ? 'Preview estimator: synthetic demo prices and a simplified usage model. Not a quote.'
      : `Preview estimator over the configured pricebook ${pricebook.id} and a simplified usage model. ${
          unverifiedRates
            ? 'Its rates are unverified estimates, not vendor quotes.'
            : 'Rates are source-recorded, not vendor quotes.'
        }`,
    'Taxes, network egress, caching, retries and minimum commitments are not modelled.',
  ];
  const unverifiedBypass: string[] = [];

  for (const sel of build.selections.filter((s) => s.enabled)) {
    const item = catalog.get(sel.catalog_item_id);
    if (!item || item.version !== sel.catalog_item_version) {
      unpriced.add(sel.id);
      warnings.push(
        `${sel.id}: catalog item ${sel.catalog_item_id}@${sel.catalog_item_version} not found in the snapshot.`,
      );
      continue;
    }
    if (item.billing_class === 'free' || item.billing_class === 'included') {
      const verified = item.provenance.some((p) => p.verification_status === 'verified');
      if (!verified) {
        if (build.policy?.allow_unverified_catalog_items) unverifiedBypass.push(item.name);
        else {
          unpriced.add(sel.id);
          warnings.push(
            `${sel.id}: "${item.billing_class}" billing is unverified, so it cannot be treated as zero cost.`,
          );
        }
      }
      continue;
    }
    if (item.billing_class === 'unknown') {
      unpriced.add(sel.id);
      warnings.push(`${sel.id}: billing class is unknown — not zero cost.`);
      continue;
    }
    // metered
    const candidates = pricebook.rates.filter(
      (r) => r.catalog_item_id === item.id && r.catalog_item_version === item.version,
    );
    if (!candidates.length) {
      unpriced.add(sel.id);
      warnings.push(`${sel.id}: no rate for ${item.name} in pricebook ${pricebook.id}.`);
      continue;
    }
    const applicability = candidates.map((rate) => ({
      rate,
      problem: rateApplies(rate, sel, build, now),
    }));
    for (const { rate: r, problem } of applicability) {
      if (problem) {
        unpriced.add(sel.id);
        warnings.push(`${sel.id}: rate ${r.id} not applicable (${problem}).`);
        continue;
      }
      const conflicting = applicability.filter(
        (candidate) => candidate.problem === null && candidate.rate.meter === r.meter,
      );
      if (conflicting.length > 1) {
        unpriced.add(sel.id);
        warnings.push(
          `${sel.id}: rate ${r.id} left unpriced: multiple applicable rates for meter ${r.meter}, including any overlapping global and matching-region rates; v1 build evidence supplies no precedence or stacking basis.`,
        );
        continue;
      }
      const p = project(r.meter, sel, item, build, periodDays);
      if (typeof p === 'string') {
        unpriced.add(sel.id);
        warnings.push(`${sel.id}: ${p}`);
        continue;
      }
      lines.push({
        id: `line.${sel.id.replace(/_/g, '-')}.${r.meter.replace(/_/g, '-')}`,
        selection_id: sel.id,
        price_rate_id: r.id,
        meter: r.meter,
        quantity: p.quantity,
        unit_price: r.unit_price,
        amount: { amount: multiplyDecimals(p.quantity, r.unit_price.amount, 2), currency },
        method: 'workload_projection',
        confidence: 'low',
        assumptions: [
          ...p.assumptions,
          `Rate ${r.id} is ${r.price_type} (${r.provenance.verification_status}).`,
        ],
      });
    }
  }
  if (unverifiedBypass.length) {
    warnings.push(
      `${unverifiedBypass.length} component(s) are treated as included/free based on unverified catalog data (build policy allows unverified items).`,
    );
  }
  const subtotal = addDecimals(
    lines.map((l) => l.amount.amount),
    2,
  );
  const coverage: CostEstimate['coverage'] =
    unpriced.size === 0 ? 'complete' : lines.length > 0 ? 'partial' : 'unknown';
  return {
    schema_version: '1.0.0',
    id: `estimate.${build.id}.r${build.revision}`,
    build_id: build.id,
    build_revision: build.revision,
    pricebook_id: pricebook.id,
    estimated_at: now,
    period_days: periodDays,
    currency,
    line_items: lines,
    subtotal: { amount: subtotal, currency },
    tax: { amount: '0.00', currency },
    total: { amount: subtotal, currency },
    coverage,
    unpriced_selection_ids: [...unpriced].sort(),
    warnings,
  };
}
