/*
 * Meter names alone do not establish licence quantities, event counts or proration rights.
 * These regressions replace the candidate's invented one-unit expectations with fail-closed
 * assertions: the selected metered item must remain unpriced, with an actionable warning.
 * The configured-pricebook caveats remain independently covered below.
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

function expectUnsupported(estimate: ReturnType<typeof estimateCost>, meter: string) {
  expect(estimate.line_items.some((line) => line.meter === meter)).toBe(false);
  expect(estimate.unpriced_selection_ids).toContain('sel_compute_profile');
  expect(estimate.coverage).not.toBe('complete');
  expect(estimate.warnings.join(' ')).toContain(
    `No supported quantity or proration basis for meter "${meter}"`,
  );
}

describe('unsupported flat meters preserve incomplete coverage', () => {
  it('does not assume one monthly licence for a metered selection', () => {
    const book = pricebookWith('prices.configured.1', 'license_month');
    const estimate = estimateCost(meteredBuild(), BY_ID, book, { periodDays: 30, now: NOW });
    expectUnsupported(estimate, 'license_month');
  });

  it('does not invent a licence proration rule for a longer period', () => {
    const book = pricebookWith('prices.configured.1', 'license_month');
    const estimate = estimateCost(meteredBuild(), BY_ID, book, { periodDays: 90, now: NOW });
    expectUnsupported(estimate, 'license_month');
  });

  it('does not infer a one-time occurrence count from the meter name', () => {
    const book = pricebookWith('prices.configured.1', 'one_time');
    const estimate = estimateCost(meteredBuild(), BY_ID, book, { periodDays: 90, now: NOW });
    expectUnsupported(estimate, 'one_time');
  });

  it('does not treat a zero unit price as evidence for a quantity', () => {
    const book = pricebookWith('prices.configured.1', 'license_month');
    book.rates[0]!.unit_price = { ...book.rates[0]!.unit_price, amount: '0.00' };
    const estimate = estimateCost(meteredBuild(), BY_ID, book, { now: NOW });
    expectUnsupported(estimate, 'license_month');
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
