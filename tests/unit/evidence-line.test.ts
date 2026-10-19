/*
 * Evidence presentation regressions (research #41: no blanket evidence TTL).
 *
 * The redesign's builder register once derived `stale` from `days > 30` and rendered the strongest
 * raw provenance status as an unqualified "Verified" badge. Both are wrong:
 *  - an observation date is descriptive, so an old-but-unchanged fact is not stale;
 *  - a historical `verified` label may record a source check only, so it must carry its caveat
 *    instead of being promoted into current independent verification.
 */
import { describe, expect, it } from 'vitest';
import type { CatalogItem, Provenance } from '../../src/contracts';
import { evidenceDateLabel, itemFreshness } from '../../src/domain/freshness';
import { evidenceLine } from '../../src/features/builder/evidence';
import { item } from './scenarios';

const provenance = (checked_at: string, status: Provenance['verification_status']): Provenance => ({
  checked_at,
  verification_status: status,
  notes: 'synthetic demo provenance',
});

describe('evidenceLine never invents an expiry policy', () => {
  it.each([
    ['a date far in the past', '2000-01-01T00:00:00Z'],
    ['a date in the future', '2030-01-01T00:00:00Z'],
    ['a recent date', '2026-10-16T00:00:00Z'],
  ])('presents %s without a stale verdict', (_label, checkedAt) => {
    const original = item('model', 'aurora-large');
    const stale: CatalogItem = { ...original, provenance: [provenance(checkedAt, 'unverified')] };
    const evidence = evidenceLine(stale);
    expect(evidence.checkedAt).toBe(checkedAt);
    expect(evidence.label).toContain(checkedAt.slice(0, 10));
    // No age, no day count, no freshness/expiry word anywhere in the presentation.
    expect(evidence.label).not.toMatch(/\d+\s*d\b|\bstale\b|\bexpired\b/i);
    expect(evidence.detail).not.toMatch(/\bstale\b|\bexpired\b|\bTTL\b/i);
    expect(evidence.detail).toMatch(/does not establish currentness or independent verification/);
  });

  it('does not change an old-but-unchanged item as time passes', () => {
    // A version-pinned fact does not expire: the label is identical regardless of "now".
    const original = item('model', 'aurora-large');
    const old: CatalogItem = {
      ...original,
      provenance: [provenance('2019-05-05T00:00:00Z', 'unverified')],
    };
    const first = evidenceLine(old);
    const second = evidenceLine(structuredClone(old));
    expect(second).toEqual(first);
    expect(first.label).toBe(`Recorded: unverified · 2019-05-05`);
  });
});

describe('evidenceLine keeps raw provenance caveated', () => {
  it('does not promote a historical verified label into an unqualified badge', () => {
    const original = item('model', 'aurora-large');
    const historical: CatalogItem = {
      ...original,
      provenance: [provenance('2020-01-01T00:00:00Z', 'verified')],
    };
    const evidence = evidenceLine(historical);
    expect(evidence.status).toBe('verified');
    // The word is qualified as a *record* and the caveat travels with it.
    expect(evidence.label).toContain('Recorded: verified');
    expect(evidence.label).not.toBe('Verified');
    expect(evidence.detail).toMatch(/Recorded provenance only/);
    expect(evidence.detail).toMatch(/does not establish currentness or independent verification/);
  });

  it('reports the strongest recorded status without inventing one', () => {
    const original = item('model', 'aurora-large');
    const mixed: CatalogItem = {
      ...original,
      provenance: [
        provenance('2026-01-01T00:00:00Z', 'unverified'),
        provenance('2026-02-01T00:00:00Z', 'user_supplied'),
      ],
    };
    expect(evidenceLine(mixed).status).toBe('user_supplied');
  });

  it('falls back to the item update date, and says which basis it used', () => {
    const original = item('model', 'aurora-large');
    const bare: CatalogItem = {
      ...original,
      provenance: [],
      updated_at: '2021-03-04T00:00:00Z',
    };
    expect(evidenceLine(bare).label).toBe('Recorded: unverified · 2021-03-04');
    expect(evidenceLine(bare).detail).toMatch(/^Item updated: 2021-03-04/);
    // A real source check is distinguished from an item update.
    expect(evidenceDateLabel(itemFreshness(original))).toMatch(/^Latest recorded source check:/);
  });

  it('picks the latest check across timezone offsets rather than string order', () => {
    const original = item('model', 'aurora-large');
    const offsets: CatalogItem = {
      ...original,
      provenance: [
        provenance('2026-10-20T00:30:00+02:00', 'unverified'),
        provenance('2026-10-19T23:45:00Z', 'unverified'),
      ],
    };
    // 2026-10-19T22:30Z is earlier than 2026-10-19T23:45Z, so the Z timestamp wins.
    expect(evidenceLine(offsets).checkedAt).toBe('2026-10-19T23:45:00Z');
  });
});
