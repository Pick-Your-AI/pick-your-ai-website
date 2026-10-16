/*
 * The working build ("current draft"). Every change is committed as a new revision, persisted to
 * the BuildRepository with compare-and-swap on the previous revision, and analysed for cross-tier
 * invalidation against the contract dependency graph.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BuildSnapshot, CatalogItem, ComponentKind } from '../contracts';
import { buildContext } from '../domain/activation';
import { type BuildDraft, commit, createBuild, createDraft } from '../domain/build';
import { affectedByChange, type InvalidationResult } from '../domain/invalidation';
import { isDataError } from '../data/errors';
import { useData } from './data-context';
import { useCatalog, useGraph } from './queries';

const CURRENT_KEY = 'pyai.currentBuildId';

export interface LastChange extends InvalidationResult {
  revision: number;
  summary: string;
}

type SaveState = { status: 'idle' | 'saving' | 'saved' } | { status: 'error'; message: string };

interface BuilderApi {
  draft: BuildDraft | null;
  ready: boolean;
  catalogById: ReadonlyMap<string, CatalogItem>;
  lastChange: LastChange | null;
  saveState: SaveState;
  /** Commit a change as a new revision. */
  apply: (
    change: (b: BuildSnapshot) => BuildSnapshot,
    summary: string,
    changedKinds: ComponentKind[],
  ) => void;
  /** Start a new build (optionally from a template build) and make it current. */
  startNew: (template?: BuildSnapshot, name?: string) => void;
  open: (buildId: string) => Promise<void>;
  /** Restore an older revision's content as a new revision. */
  restore: (revision: number) => void;
}

const BuilderContext = createContext<BuilderApi | null>(null);

function readCurrentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}
function writeCurrentId(id: string) {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    /* storage unavailable: draft lives in memory only */
  }
}

export function BuilderProvider({ children }: { children: ReactNode }) {
  const { builds, catalog: catalogRepo } = useData();
  const catalog = useCatalog();
  const graph = useGraph();
  const [draft, setDraft] = useState<BuildDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [lastChange, setLastChange] = useState<LastChange | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const savedRevision = useRef<number | null>(null);
  // Set once the user starts, opens or changes a build, so a slow initial load never overwrites it.
  const touched = useRef(false);
  const catalogById = catalog.byId;
  const snapshotId = catalog.data?.id;

  // Load the current draft once the catalog is known.
  useEffect(() => {
    if (!snapshotId || ready) return;
    let cancelled = false;
    const id = readCurrentId();
    const fresh = () => createDraft(createBuild({ catalogSnapshotId: snapshotId }));
    (id ? builds.get(id) : Promise.reject(new Error('none')))
      .then((stored) => {
        if (cancelled || touched.current) return;
        setDraft(stored);
        savedRevision.current = stored.build.revision;
      })
      .catch(() => {
        if (cancelled || touched.current) return;
        setDraft(fresh());
        savedRevision.current = null;
      })
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [builds, snapshotId, ready]);

  const persist = useCallback(
    async (next: BuildDraft) => {
      setSaveState({ status: 'saving' });
      try {
        await builds.save(next, savedRevision.current);
        savedRevision.current = next.build.revision;
        writeCurrentId(next.build.id);
        setSaveState({ status: 'saved' });
      } catch (e) {
        setSaveState({
          status: 'error',
          message: isDataError(e) ? e.message : 'Could not save this build.',
        });
      }
    },
    [builds],
  );

  const apply = useCallback<BuilderApi['apply']>(
    (change, summary, changedKinds) => {
      setDraft((current) => {
        if (!current) return current;
        const next = commit(current, change, summary, changedKinds);
        if (graph.data) {
          const before = buildContext(current.build, catalogById);
          const after = buildContext(next.build, catalogById);
          setLastChange({
            ...affectedByChange(graph.data, changedKinds, before, after),
            revision: next.build.revision,
            summary,
          });
        }
        void persist(next);
        return next;
      });
    },
    [catalogById, graph.data, persist],
  );

  const startNew = useCallback<BuilderApi['startNew']>(
    (template, name) => {
      // Claim the draft immediately so a slower initial load cannot replace it.
      touched.current = true;
      void (async () => {
        const catalogSnapshotId = snapshotId ?? (await catalogRepo.getSnapshot()).id;
        const base = createBuild({ catalogSnapshotId, name });
        const build: BuildSnapshot = template
          ? {
              ...template,
              id: base.id,
              revision: 1,
              created_at: base.created_at,
              updated_at: base.updated_at,
              lifecycle: 'draft',
              owner_ref: base.owner_ref,
              name: name ?? template.name,
            }
          : base;
        const next = createDraft(
          build,
          template ? `Created from "${template.name}"` : 'Created build',
        );
        touched.current = true;
        savedRevision.current = null;
        setLastChange(null);
        setDraft(next);
        setReady(true);
        void persist(next);
      })();
    },
    [persist, snapshotId, catalogRepo],
  );

  const open = useCallback<BuilderApi['open']>(
    async (buildId) => {
      const stored = await builds.get(buildId);
      touched.current = true;
      savedRevision.current = stored.build.revision;
      setLastChange(null);
      setDraft(stored);
      writeCurrentId(buildId);
      setSaveState({ status: 'saved' });
    },
    [builds],
  );

  const restore = useCallback<BuilderApi['restore']>(
    (revision) => {
      const old = draft?.revisions.find((r) => r.revision === revision);
      if (!old) return;
      apply(
        (b) => ({
          ...b,
          name: old.name,
          objectives: old.objectives,
          selections: old.selections,
          links: old.links,
          policy: old.policy,
        }),
        `Restored content of revision ${revision}`,
        [...new Set([...old.selections, ...(draft?.build.selections ?? [])].map((s) => s.kind))],
      );
    },
    [apply, draft],
  );

  const value = useMemo<BuilderApi>(
    () => ({ draft, ready, catalogById, lastChange, saveState, apply, startNew, open, restore }),
    [draft, ready, catalogById, lastChange, saveState, apply, startNew, open, restore],
  );
  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>;
}

export function useBuilder(): BuilderApi {
  const ctx = useContext(BuilderContext);
  if (!ctx) throw new Error('BuilderProvider missing');
  return ctx;
}
