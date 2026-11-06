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

interface SaveSession {
  revision: number | null;
  queue: BuildDraft[];
  running: boolean;
  conflict: boolean;
  error: Extract<SaveState, { status: 'error' }> | null;
}

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
  const draftRef = useRef<BuildDraft | null>(null);
  const saveSession = useRef<SaveSession | null>(null);
  const navigation = useRef(0);
  // Set once the user starts, opens or changes a build, so a slow initial load never overwrites it.
  const touched = useRef(false);
  const catalogById = catalog.byId;
  const snapshotId = catalog.data?.id;

  const activate = useCallback((next: BuildDraft, revision: number | null) => {
    saveSession.current = { revision, queue: [], running: false, conflict: false, error: null };
    draftRef.current = next;
    setDraft(next);
  }, []);

  // Load the current draft once the catalog is known.
  useEffect(() => {
    if (!snapshotId || ready) return;
    let cancelled = false;
    const id = readCurrentId();
    /*
     * The first visit opens an empty canvas, not a prefilled stack: a preselected demo stack would
     * read as a recommendation, and "unknown is not pass" applies to a build nobody has configured.
     * Templates remain an explicit choice on /templates.
     */
    const fresh = () => createDraft(createBuild({ catalogSnapshotId: snapshotId }));
    (id ? builds.get(id) : Promise.reject(new Error('none')))
      .then((stored) => {
        if (cancelled || touched.current) return;
        activate(stored, stored.build.revision);
      })
      .catch(() => {
        if (cancelled || touched.current) return;
        activate(fresh(), null);
      })
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [activate, builds, snapshotId, ready]);

  const persist = useCallback(
    (next: BuildDraft) => {
      const session = saveSession.current;
      if (!session) return;
      session.queue.push(next);
      if (session.conflict) {
        setSaveState(session.error!);
        return;
      }
      setSaveState({ status: 'saving' });
      if (session.running) return;
      session.running = true;
      session.error = null;
      // Each revision depends on the previous acknowledgement. Keep the queue
      // with the opened draft so late work cannot change another build's state.
      void (async () => {
        try {
          while (session.queue.length) {
            const pending = session.queue[0]!;
            await builds.save(pending, session.revision);
            session.revision = pending.build.revision;
            session.queue.shift();
            if (saveSession.current === session) writeCurrentId(pending.build.id);
          }
        } catch (e) {
          session.conflict = isDataError(e) && e.kind === 'conflict';
          session.error = {
            status: 'error',
            message: isDataError(e) ? e.message : 'Could not save this build.',
          };
        } finally {
          session.running = false;
          if (saveSession.current === session) {
            setSaveState(session.error ?? { status: 'saved' });
          }
        }
      })();
    },
    [builds],
  );

  const apply = useCallback<BuilderApi['apply']>(
    (change, summary, changedKinds) => {
      const current = draftRef.current;
      if (!current) return;
      touched.current = true;
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
      // Persist outside a state updater: React may replay updaters in StrictMode.
      draftRef.current = next;
      setDraft(next);
      persist(next);
    },
    [catalogById, graph.data, persist],
  );

  const startNew = useCallback<BuilderApi['startNew']>(
    (template, name) => {
      // Claim the draft immediately so a slower initial load cannot replace it.
      touched.current = true;
      const request = ++navigation.current;
      void (async () => {
        const catalogSnapshotId = snapshotId ?? (await catalogRepo.getSnapshot()).id;
        if (request !== navigation.current) return;
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
        setLastChange(null);
        activate(next, null);
        setReady(true);
        void persist(next);
      })();
    },
    [activate, persist, snapshotId, catalogRepo],
  );

  const open = useCallback<BuilderApi['open']>(
    async (buildId) => {
      const request = ++navigation.current;
      const stored = await builds.get(buildId);
      if (request !== navigation.current) return;
      touched.current = true;
      setLastChange(null);
      activate(stored, stored.build.revision);
      writeCurrentId(buildId);
      setSaveState({ status: 'saved' });
    },
    [activate, builds],
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
