/*
 * Browser-local build repository (My Builds). Drafts live only in this browser's localStorage;
 * nothing is sent anywhere. Each stored record is validated on read; corrupt records are reported,
 * not silently dropped or "repaired".
 */
import type { BuildSnapshot } from '../contracts';
import { validateContract } from '../contracts';
import { DataError } from './errors';
import type { BuildRepository, SavedBuildSummary, StoredBuild } from './types';

const PREFIX = 'pyai.build.';
const INDEX_KEY = 'pyai.builds.index';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

export function defaultStorage(): KeyValueStorage {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pyai.probe', '1');
      localStorage.removeItem('pyai.probe');
      return localStorage;
    }
  } catch {
    /* private mode or disabled storage */
  }
  return memoryStorage();
}

/** Drafts with fewer than two selections are not yet schema-valid snapshots; validate the rest. */
export function validateDraftBuild(build: unknown): string | null {
  if (!build || typeof build !== 'object') return 'not an object';
  const b = build as BuildSnapshot;
  const candidate =
    Array.isArray(b.selections) && b.selections.length < 2
      ? { ...b, selections: [...b.selections, ...PLACEHOLDER_SELECTIONS].slice(0, 2) }
      : b;
  const result = validateContract('BuildSnapshot', candidate);
  return result.ok ? null : result.summary;
}

const PLACEHOLDER_SELECTIONS = [
  {
    id: 'sel_placeholder_a',
    kind: 'workload',
    catalog_item_id: 'placeholder.item',
    catalog_item_version: '0',
    role: 'placeholder-a',
    enabled: false,
    settings: {},
  },
  {
    id: 'sel_placeholder_b',
    kind: 'workload',
    catalog_item_id: 'placeholder.item',
    catalog_item_version: '0',
    role: 'placeholder-b',
    enabled: false,
    settings: {},
  },
] as const;

export function parseStoredBuild(raw: string): StoredBuild {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (cause) {
    throw new DataError('malformed', 'Saved build is not valid JSON.', { cause });
  }
  const d = data as Partial<StoredBuild>;
  if (
    !d ||
    typeof d !== 'object' ||
    !d.build ||
    !Array.isArray(d.revisions) ||
    !Array.isArray(d.changes)
  ) {
    throw new DataError('malformed', 'Saved build record is incomplete.');
  }
  const problem = validateDraftBuild(d.build);
  if (problem)
    throw new DataError('malformed', `Saved build is invalid: ${problem}`, {
      contract: 'BuildSnapshot',
    });
  return d as StoredBuild;
}

export class LocalBuildRepository implements BuildRepository {
  private readonly storage: KeyValueStorage;
  constructor(storage: KeyValueStorage = defaultStorage()) {
    this.storage = storage;
  }

  private index(): string[] {
    try {
      const parsed = JSON.parse(this.storage.getItem(INDEX_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private writeIndex(ids: string[]) {
    this.storage.setItem(INDEX_KEY, JSON.stringify([...new Set(ids)]));
  }

  async list(): Promise<SavedBuildSummary[]> {
    const out: SavedBuildSummary[] = [];
    for (const id of this.index()) {
      const raw = this.storage.getItem(PREFIX + id);
      if (!raw) continue;
      try {
        const { build } = parseStoredBuild(raw);
        out.push({
          id: build.id,
          name: build.name,
          revision: build.revision,
          updatedAt: build.updated_at,
          selectionCount: build.selections.length,
        });
      } catch {
        out.push({
          id,
          name: '(unreadable saved build)',
          revision: 0,
          updatedAt: '',
          selectionCount: 0,
        });
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(buildId: string): Promise<StoredBuild> {
    const raw = this.storage.getItem(PREFIX + buildId);
    if (!raw) throw new DataError('not_found', `No saved build ${buildId} in this browser.`);
    return parseStoredBuild(raw);
  }

  async save(stored: StoredBuild, expectedRevision: number | null): Promise<StoredBuild> {
    const id = stored.build.id;
    const raw = this.storage.getItem(PREFIX + id);
    if (raw && expectedRevision !== null) {
      const current = parseStoredBuild(raw).build.revision;
      if (current !== expectedRevision) {
        throw new DataError(
          'conflict',
          `This build was changed in another tab (revision ${current}); reload it before saving.`,
          { status: 409 },
        );
      }
    }
    const problem = validateDraftBuild(stored.build);
    if (problem) throw new DataError('malformed', `Refusing to save an invalid build: ${problem}`);
    try {
      this.storage.setItem(PREFIX + id, JSON.stringify(stored));
    } catch (cause) {
      throw new DataError('unsupported', 'Browser storage is full or unavailable.', { cause });
    }
    this.writeIndex([id, ...this.index()]);
    return stored;
  }

  async remove(buildId: string): Promise<void> {
    this.storage.removeItem(PREFIX + buildId);
    this.writeIndex(this.index().filter((x) => x !== buildId));
  }
}
