/* Evidence dates are descriptive, never an expiry policy. Research #41 adopts no TTL:
 * version-pinned facts do not expire; current-state facts retain their access dates.
 */
import type { BuildSnapshot, CatalogItem, CatalogSnapshot } from '../contracts';

export type EvidenceDate = { checkedAt: string; basis: 'source_check' | 'item_update' | 'capture' };

export function freshness(timestamp: string): EvidenceDate {
  return { checkedAt: timestamp, basis: 'capture' };
}

function sourceCheckOrder(timestamp: string) {
  // Contract timestamps include offsets, arbitrary fractional precision and leap seconds.
  // Compare UTC whole seconds first, keeping a leap second after :59 and before the next minute.
  const wholeSecond = timestamp
    .replace(/\.\d+/, '')
    .replace(/:60(?=[Zz+-])/, ':59')
    .replace(/([+-]\d{2})$/, '$1:00');
  return {
    wholeSecond: Date.parse(wholeSecond),
    leapSecond: timestamp.slice(17, 19) === '60' ? 1 : 0,
    fraction: timestamp.match(/\.(\d+)/)?.[1] ?? '',
  };
}

function compareSourceChecks(left: string, right: string): number {
  const a = sourceCheckOrder(left);
  const b = sourceCheckOrder(right);
  const seconds = a.wholeSecond - b.wholeSecond || a.leapSecond - b.leapSecond;
  if (seconds) return seconds;
  // Padding compares every recorded decimal digit without rounding through a JS number.
  const precision = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(precision, '0');
  const bFraction = b.fraction.padEnd(precision, '0');
  return aFraction < bFraction ? -1 : aFraction > bFraction ? 1 : 0;
}

export function itemFreshness(item: CatalogItem): EvidenceDate {
  const latest = item.provenance
    .map((p) => p.checked_at)
    .sort(compareSourceChecks)
    .at(-1);
  return { checkedAt: latest ?? item.updated_at, basis: latest ? 'source_check' : 'item_update' };
}

export function evidenceDateLabel(date: EvidenceDate): string {
  const label =
    date.basis === 'source_check'
      ? 'Latest recorded source check'
      : date.basis === 'item_update'
        ? 'Item updated'
        : 'Catalog captured';
  return `${label}: ${date.checkedAt.slice(0, 10)}`;
}

export interface BuildStaleness {
  snapshotMismatch: boolean;
  /** Selections whose pinned catalog item is missing or has a different version. */
  driftedSelectionIds: string[];
  missingSelectionIds: string[];
  catalog: EvidenceDate;
}

export function buildStaleness(build: BuildSnapshot, snapshot: CatalogSnapshot): BuildStaleness {
  const byId = new Map(snapshot.items.map((i) => [i.id, i]));
  const drifted: string[] = [];
  const missing: string[] = [];
  for (const s of build.selections) {
    const item = byId.get(s.catalog_item_id);
    if (!item) missing.push(s.id);
    else if (item.version !== s.catalog_item_version) drifted.push(s.id);
  }
  return {
    snapshotMismatch: build.locks.catalog_snapshot_id !== snapshot.id,
    driftedSelectionIds: drifted,
    missingSelectionIds: missing,
    catalog: freshness(snapshot.captured_at),
  };
}
