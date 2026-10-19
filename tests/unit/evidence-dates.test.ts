import { describe, expect, it } from 'vitest';
import { validateContract } from '../../src/contracts';
import {
  evidenceDateLabel,
  freshness,
  itemFreshness,
  buildStaleness,
} from '../../src/domain/freshness';
import { apiChat, CATALOG, item } from './scenarios';

describe('evidence dates without a TTL', () => {
  it.each(['2000-01-01T00:00:00Z', '2030-01-01T00:00:00Z'])(
    'retains %s without claiming freshness or expiry',
    (date) => {
      expect(freshness(date)).toEqual({ checkedAt: date, basis: 'capture' });
      expect(evidenceDateLabel(freshness(date))).toBe(`Catalog captured: ${date.slice(0, 10)}`);
    },
  );
  it('distinguishes an item update fallback from an actual recorded source check', () => {
    const model = {
      ...item('model', 'aurora-large'),
      provenance: [],
      updated_at: '2000-01-01T00:00:00Z',
    };
    expect(evidenceDateLabel(itemFreshness(model))).toBe('Item updated: 2000-01-01');
    const checked = { ...model, provenance: item('model', 'aurora-large').provenance };
    expect(evidenceDateLabel(itemFreshness(checked))).toMatch(/^Latest recorded source check:/);
  });
  it.each([
    {
      name: 'a positive offset crossing a date boundary',
      earlier: '2026-10-20T00:30:00+02:00',
      later: '2026-10-19T23:45:00Z',
    },
    {
      name: 'a negative offset crossing a date boundary',
      earlier: '2026-10-20T01:00:00Z',
      later: '2026-10-19T23:30:00-02:00',
    },
    {
      name: 'fractional and whole seconds',
      earlier: '2026-10-19T12:00:00Z',
      later: '2026-10-19T12:00:00.5Z',
    },
    {
      name: 'fractional seconds beyond millisecond precision',
      earlier: '2026-10-19T12:00:00.123Z',
      later: '2026-10-19T12:00:00.1230000001Z',
    },
    {
      name: 'fractional precision combined with an offset',
      earlier: '2026-10-19T13:00:00.1231+01:00',
      later: '2026-10-19T12:00:00.1232Z',
    },
    {
      name: 'a leap second after the preceding whole second',
      earlier: '2016-12-31T23:59:59.999Z',
      later: '2017-01-01T00:59:60+01:00',
    },
    {
      name: 'a whole second after a leap second',
      earlier: '2017-01-01T00:59:60.9+01:00',
      later: '2017-01-01T00:00:00Z',
    },
  ])('selects the latest recorded instant across $name', ({ earlier, later }) => {
    const original = item('model', 'aurora-large');
    for (const timestamps of [
      [earlier, later],
      [later, earlier],
    ]) {
      const model = {
        ...original,
        provenance: timestamps.map((checked_at) => ({
          ...original.provenance[0]!,
          checked_at,
        })),
      };
      expect(validateContract('CatalogItem', model).ok).toBe(true);
      const before = structuredClone(model);
      const date = itemFreshness(model);
      expect(date).toEqual({ checkedAt: later, basis: 'source_check' });
      expect(evidenceDateLabel(date)).toBe(`Latest recorded source check: ${later.slice(0, 10)}`);
      expect(model).toEqual(before);
    }
  });
  it('still reports missing selected items independently of capture dates', () => {
    const build = apiChat();
    const snapshot = {
      ...CATALOG,
      items: CATALOG.items.filter((i) => i.id !== 'demo.model.aurora-large'),
    };
    expect(buildStaleness(build, snapshot).missingSelectionIds).toEqual(['sel_model']);
  });
});
