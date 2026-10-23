import { describe, expect, it } from 'vitest';
import type { Pricebook } from '../../src/contracts';
import { validateContract } from '../../src/contracts';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { estimateCost } from '../../src/domain/cost';
import { apiChat, BY_ID } from './scenarios';

function pricebook(window: { valid_from: string; valid_until?: string }): Pricebook {
  return {
    ...DEMO_PRICEBOOK,
    rates: DEMO_PRICEBOOK.rates
      .filter((rate) => rate.catalog_item_id === 'demo.model.aurora-large')
      .map((rate) => ({ ...rate, ...window })),
  };
}

describe('price validity instants', () => {
  it.each([
    {
      name: 'a start with a positive offset on the next calendar day',
      now: '2026-10-19T23:45:00Z',
      valid_from: '2026-10-20T00:30:00+02:00',
      admitted: true,
    },
    {
      name: 'a future start with a negative offset on the previous calendar day',
      now: '2026-10-20T01:00:00Z',
      valid_from: '2026-10-19T23:30:00-02:00',
      admitted: false,
    },
    {
      name: 'an expired positive-offset endpoint on the next calendar day',
      now: '2026-10-19T23:45:00Z',
      valid_from: '2026-10-01T00:00:00Z',
      valid_until: '2026-10-20T00:30:00+02:00',
      admitted: false,
    },
    {
      name: 'an active negative-offset endpoint on the previous calendar day',
      now: '2026-10-20T01:00:00Z',
      valid_from: '2026-10-01T00:00:00Z',
      valid_until: '2026-10-19T23:30:00-02:00',
      admitted: true,
    },
    {
      name: 'inclusive start and expiry expressed with equivalent offsets',
      now: '2026-10-19T12:00:00Z',
      valid_from: '2026-10-19T13:00:00+01:00',
      valid_until: '2026-10-19T11:00:00-01:00',
      admitted: true,
    },
    {
      name: 'inclusive whole-second and fractional-zero representations',
      now: '2026-10-19T12:00:00.000Z',
      valid_from: '2026-10-19T12:00:00Z',
      valid_until: '2026-10-19T12:00:00.000000Z',
      admitted: true,
    },
    {
      name: 'a fractional start after the observation whole second',
      now: '2026-10-19T12:00:00Z',
      valid_from: '2026-10-19T12:00:00.5Z',
      admitted: false,
    },
    {
      name: 'a whole-second expiry before the fractional observation',
      now: '2026-10-19T12:00:00.5Z',
      valid_from: '2026-10-01T00:00:00Z',
      valid_until: '2026-10-19T12:00:00Z',
      admitted: false,
    },
    {
      name: 'a future start beyond millisecond precision',
      now: '2026-10-19T12:00:00.123Z',
      valid_from: '2026-10-19T12:00:00.1230000001Z',
      admitted: false,
    },
    {
      name: 'an expiry beyond millisecond precision',
      now: '2026-10-19T12:00:00.1230000001Z',
      valid_from: '2026-10-01T00:00:00Z',
      valid_until: '2026-10-19T12:00:00.123Z',
      admitted: false,
    },
    {
      name: 'equivalent high-precision endpoints with offsets',
      now: '2026-10-19T12:00:00.123400000Z',
      valid_from: '2026-10-19T13:00:00.1234+01:00',
      valid_until: '2026-10-19T11:00:00.123400-01:00',
      admitted: true,
    },
    {
      name: 'a leap-second start before the following whole second',
      now: '2017-01-01T00:00:00Z',
      valid_from: '2017-01-01T00:59:60.9+01:00',
      admitted: true,
    },
    {
      name: 'a leap-second expiry before the following whole second',
      now: '2017-01-01T00:00:00Z',
      valid_from: '2016-01-01T00:00:00Z',
      valid_until: '2017-01-01T00:59:60.9+01:00',
      admitted: false,
    },
    {
      name: 'a leap second after the preceding fractional second',
      now: '2016-12-31T23:59:59.999Z',
      valid_from: '2017-01-01T00:59:60+01:00',
      admitted: false,
    },
    {
      name: 'an ordinary open-ended active rate',
      now: '2026-10-19T12:00:00Z',
      valid_from: '2026-10-01T00:00:00Z',
      admitted: true,
    },
    {
      name: 'an ordinary expired rate',
      now: '2026-10-19T12:00:00Z',
      valid_from: '2026-10-01T00:00:00Z',
      valid_until: '2026-10-18T12:00:00Z',
      admitted: false,
    },
  ])('$name', ({ now, valid_from, valid_until, admitted }) => {
    const build = apiChat();
    const prices = pricebook({
      valid_from,
      ...(valid_until ? { valid_until } : {}),
    });
    expect(validateContract('Pricebook', prices).ok).toBe(true);
    const originalPrices = structuredClone(prices);
    const originalBuild = structuredClone(build);
    const cost = estimateCost(build, BY_ID, prices, { now });

    expect(validateContract('CostEstimate', cost).ok).toBe(true);
    expect(cost.estimated_at).toBe(now);
    expect(cost.coverage).toBe(admitted ? 'complete' : 'unknown');
    expect(cost.total.amount).toBe(admitted ? '324.00' : '0.00');
    expect(cost.line_items.map((line) => line.meter)).toEqual(
      admitted ? ['input_tokens_1m', 'output_tokens_1m'] : [],
    );
    expect(cost.unpriced_selection_ids).toEqual(admitted ? [] : ['sel_model']);
    expect(prices).toEqual(originalPrices);
    expect(build).toEqual(originalBuild);
  });
});
