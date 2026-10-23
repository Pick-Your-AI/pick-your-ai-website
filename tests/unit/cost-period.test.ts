import { describe, expect, it } from 'vitest';
import type { Pricebook } from '../../src/contracts';
import { assertContract } from '../../src/contracts';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { estimateCost } from '../../src/domain/cost';
import { BY_ID, NOW, selfHosted } from './scenarios';

describe.each(['gpu_hour', 'cpu_hour'] as const)('%s period projection', (meter) => {
  const pricebook: Pricebook = {
    ...DEMO_PRICEBOOK,
    rates: DEMO_PRICEBOOK.rates
      .filter((rate) => rate.id === 'rate.demo.nimbus-1x-c24.gpu')
      .map((rate) => ({ ...rate, meter })),
  };

  function estimate(periodDays: number, reservedHours?: number) {
    const build = selfHosted();
    build.selections = build.selections.map((selection) =>
      selection.kind === 'compute_profile'
        ? {
            ...selection,
            settings: {
              instances: 2,
              ...(reservedHours === undefined ? {} : { reserved_hours_per_month: reservedHours }),
            },
          }
        : selection,
    );
    // Omitting the optional monthly reservation is a valid imported-build state.
    assertContract('BuildSnapshot', build);
    return assertContract(
      'CostEstimate',
      estimateCost(build, BY_ID, pricebook, { periodDays, now: NOW }),
    );
  }

  it.each([1, 15, 30, 60])('projects always-on hours once over %i days', (days) => {
    const result = estimate(days);
    expect(result.line_items).toHaveLength(1);
    expect(result.line_items[0]?.quantity).toBe(String(2 * 24 * days));
    expect(result.total.amount).toBe((2 * 24 * days * 1.1).toFixed(2));
  });

  it.each([15, 30, 60])('prorates explicit monthly reservations over %i days', (days) => {
    expect(estimate(days, 120).line_items[0]?.quantity).toBe(String((2 * 120 * days) / 30));
  });

  it('preserves an explicit zero-hour reservation', () => {
    expect(estimate(15, 0).line_items[0]?.quantity).toBe('0');
  });
});
