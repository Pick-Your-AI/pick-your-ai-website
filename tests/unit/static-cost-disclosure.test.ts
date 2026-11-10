/*
 * Flat periodic meters and pricebook-scoped caveats.
 *
 * Review finding: a published `license_month` rate produced no cost line item, because the meter
 * fell through to the generic "no usage basis" branch. A pricebook may legitimately declare a flat
 * licence or one-time charge, so the estimator must support it with an explicit basis rather than
 * dropping the rate silently.
 */
import { describe, expect, it } from 'vitest';
import type { Pricebook } from '../../src/contracts';
import { assertContract } from '../../src/contracts';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { estimateCost } from '../../src/domain/cost';
import { BY_ID, NOW, selfHosted } from './scenarios';

const baseRate = DEMO_PRICEBOOK.rates[0]!;

function pricebookWith(id: string, meter: Pricebook['rates'][number]['meter']): Pricebook {
  return assertContract('Pricebook', {
    ...DEMO_PRICEBOOK,
    id,
    rates: [{ ...baseRate, meter }],
  });
}

/** A selection on the metered item the rate targets, so the meter path is reachable. */
function meteredBuild() {
  const build = selfHosted();
  build.selections = build.selections.map((s) =>
    s.kind === 'compute_profile' ? { ...s, catalog_item_id: baseRate.catalog_item_id } : s,
  );
  return build;
}

describe('flat periodic meters produce an explicit line rather than vanishing', () => {
  it('prices a monthly licence by month, not by a guessed unit count', () => {
    const book = pricebookWith('prices.configured.1', 'license_month');
    const estimate = estimateCost(meteredBuild(), BY_ID, book, { periodDays: 30, now: NOW });
    const line = estimate.line_items.find((l) => l.meter === 'license_month');
    expect(line).toBeDefined();
    expect(line!.quantity).toBe('1');
    expect(line!.assumptions.join(' ')).toMatch(/Flat licence fee/);
  });

  it('prorates a monthly licence across a longer period', () => {
    const book = pricebookWith('prices.configured.1', 'license_month');
    const estimate = estimateCost(meteredBuild(), BY_ID, book, { periodDays: 90, now: NOW });
    const line = estimate.line_items.find((l) => l.meter === 'license_month');
    expect(line!.quantity).toBe('3');
  });

  it('treats one_time as a single, unprorated charge', () => {
    const book = pricebookWith('prices.configured.1', 'one_time');
    const estimate = estimateCost(meteredBuild(), BY_ID, book, { periodDays: 90, now: NOW });
    const line = estimate.line_items.find((l) => l.meter === 'one_time');
    expect(line).toBeDefined();
    expect(line!.quantity).toBe('1');
    expect(line!.assumptions.join(' ')).toMatch(/not prorated/i);
  });
});

describe('the preview caveat describes the pricebook actually priced', () => {
  it('calls the fixture demo pricebook synthetic', () => {
    const estimate = estimateCost(selfHosted(), new Map(), DEMO_PRICEBOOK, { now: NOW });
    expect(estimate.warnings.join(' ')).toMatch(/synthetic demo prices/);
  });

  it('does not call a configured pricebook synthetic, and keeps the quote cautions', () => {
    const book = pricebookWith('prices.configured.1', 'gpu_hour');
    const estimate = estimateCost(selfHosted(), new Map(), book, { now: NOW });
    const text = estimate.warnings.join(' ');
    expect(text).not.toMatch(/synthetic demo prices/);
    expect(text).toMatch(/configured pricebook prices\.configured\.1/);
    expect(text).toMatch(/Preview estimator/);
    expect(text).toMatch(/unverified estimates, not vendor quotes/);
    // Simplified-usage and not-a-quote cautions are retained.
    expect(text).toMatch(/simplified usage model/);
    expect(text).toMatch(/not modelled/);
  });
});
