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

describe('meters with no contract quantity basis do not fake a period total', () => {
  /*
   * contracts/v1/pricebook.schema.json lists license_month and one_time in the meter enum and
   * defines no unit, proration rule or period semantics for either. These tests pin the two
   * things that must therefore be true: the rate is visible, and no arithmetic is invented.
   */
  it('reports a monthly licence without deriving a prorated month count', () => {
    const book = pricebookWith('prices.configured.1', 'license_month');
    const estimate = estimateCost(meteredBuild(), BY_ID, book, { periodDays: 30, now: NOW });
    const line = estimate.line_items.find((l) => l.meter === 'license_month');
    expect(line).toBeDefined();
    expect(line!.assumptions.join(' ')).toMatch(/no quantity basis for this meter/i);
  });

  it('does not scale a monthly licence when the period triples', () => {
    const book = pricebookWith('prices.configured.1', 'license_month');
    const thirty = estimateCost(meteredBuild(), BY_ID, book, { periodDays: 30, now: NOW });
    const ninety = estimateCost(meteredBuild(), BY_ID, book, { periodDays: 90, now: NOW });
    const q = (e: ReturnType<typeof estimateCost>) =>
      e.line_items.find((l) => l.meter === 'license_month')!.quantity;
    expect(q(ninety)).toBe(q(thirty));
  });

  it('never stamps a one_time charge with a proration rule the contract does not define', () => {
    const book = pricebookWith('prices.configured.1', 'one_time');
    const estimate = estimateCost(meteredBuild(), BY_ID, book, { periodDays: 90, now: NOW });
    const line = estimate.line_items.find((l) => l.meter === 'one_time');
    expect(line).toBeDefined();
    expect(line!.assumptions.join(' ')).toMatch(/no quantity basis for this meter/i);
    expect(line!.assumptions.join(' ')).not.toMatch(/not prorated/i);
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

describe('every published citation points at an immutable revision', () => {
  /*
   * A `/blob/main/` citation is a mutable alias: the licence text can change under a URL that
   * supposedly documents a pinned catalog_item_version. The pilot pricebook claimed full pinning
   * while its licence link still tracked main.
   */
  const loadRates = async () => {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile('public/v1/pricebooks/prices.pilot.1', 'utf8');
    const book = JSON.parse(raw) as {
      rates: {
        id: string;
        catalog_item_version: string;
        provenance: { source_uri: string };
      }[];
    };
    return book.rates;
  };

  it('has no branch-tracking source URLs', async () => {
    const mutable = (await loadRates())
      .filter((r) => /\/blob\/(main|master)\//.test(r.provenance.source_uri))
      .map((r) => `${r.id}: ${r.provenance.source_uri}`);
    expect(mutable).toEqual([]);
  });

  it('pins each citation to the revision its rate declares', async () => {
    const mismatched = (await loadRates())
      .filter((r) => !r.provenance.source_uri.includes(r.catalog_item_version))
      .map((r) => `${r.id}: ${r.provenance.source_uri}`);
    expect(mismatched).toEqual([]);
  });
});
