/*
 * Freshness and staleness (provisional — the staleness policy is research issue #41). The preview
 * flags catalog snapshots and items older than STALE_AFTER_DAYS, selections pinned to an item
 * version that no longer matches the catalog, and builds locked to a different snapshot.
 */
import type { BuildSnapshot, CatalogItem, CatalogSnapshot } from '../contracts';

export const STALE_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;

export function ageDays(timestamp: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(timestamp).getTime()) / DAY_MS);
}

export type Freshness = { state: 'fresh' | 'stale'; ageDays: number; checkedAt: string };

export function freshness(timestamp: string, now: Date = new Date()): Freshness {
  const age = ageDays(timestamp, now);
  return {
    state: age > STALE_AFTER_DAYS ? 'stale' : 'fresh',
    ageDays: Math.max(0, age),
    checkedAt: timestamp,
  };
}

export function itemFreshness(item: CatalogItem, now?: Date): Freshness {
  const latest =
    item.provenance
      .map((p) => p.checked_at)
      .sort()
      .at(-1) ?? item.updated_at;
  return freshness(latest, now);
}

export interface BuildStaleness {
  snapshotMismatch: boolean;
  /** Selections whose pinned catalog item is missing or has a different version. */
  driftedSelectionIds: string[];
  missingSelectionIds: string[];
  catalog: Freshness;
}

export function buildStaleness(
  build: BuildSnapshot,
  snapshot: CatalogSnapshot,
  now?: Date,
): BuildStaleness {
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
    catalog: freshness(snapshot.captured_at, now),
  };
}
