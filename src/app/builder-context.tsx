/*
 * The working build ("current draft"). Valid changes enter an immutable save queue with
 * compare-and-swap on the acknowledged revision; incomplete HTTP edits remain staged locally.
 * The provider also coordinates current selection and forgetting with pending saves/navigation.
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
import { useQueryClient } from '@tanstack/react-query';
import type { BuildSnapshot, CatalogItem, ComponentKind } from '../contracts';
import { validateContract, validatorsReady } from '../contracts';
import { buildContext } from '../domain/activation';
import { type BuildDraft, commit, createBuild, createDraft } from '../domain/build';
import { affectedByChange, type InvalidationResult } from '../domain/invalidation';
import { isDataError } from '../data/errors';
import { useData } from './data-context';
import { buildQueryKey } from './build-query-key';
import { forgetCurrentId, readCurrentId, writeCurrentId } from './current-build-id';
import { useCatalog, useGraph } from './queries';

export interface LastChange extends InvalidationResult {
  revision: number;
  summary: string;
}

type SaveState = { status: 'idle' | 'saving' | 'saved' } | { status: 'error'; message: string };

interface SaveSession {
  buildId: string;
  navigation: number;
  /** Only an HTTP draft with no dispatched creation may coalesce edits at revision 1. */
  preCreate: boolean;
  /** Invalid current content is staged outside the immutable write queue. */
  stagedError: Extract<SaveState, { status: 'error' }> | null;
  revision: number | null;
  queue: BuildDraft[];
  running: boolean;
  conflict: boolean;
  error: Extract<SaveState, { status: 'error' }> | null;
}

interface BuilderApi {
  draft: BuildDraft | null;
  ready: boolean;
  loadError: unknown | null;
  /** Retry loading the remembered build after a recoverable failure. */
  retryLoad: () => void;
  catalogById: ReadonlyMap<string, CatalogItem>;
  lastChange: LastChange | null;
  saveState: SaveState;
  /** Edit the draft; schema-valid HTTP snapshots enter the next immutable save revision. */
  apply: (
    change: (b: BuildSnapshot) => BuildSnapshot,
    summary: string,
    changedKinds: ComponentKind[],
  ) => void;
  /** Start a new build (optionally from a template build) and make it current. */
  startNew: (template?: BuildSnapshot, name?: string) => void;
  open: (buildId: string) => Promise<void>;
  /** Remove a browser entry and retire its pending client writes without deleting API data. */
  remove: (buildId: string) => Promise<void>;
  /** Restore an older revision's content as a new revision. */
  restore: (revision: number) => void;
}

const BuilderContext = createContext<BuilderApi | null>(null);

export function BuilderProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { builds, catalog: catalogRepo } = useData();
  const catalog = useCatalog();
  const graph = useGraph();
  const [draft, setDraft] = useState<BuildDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<unknown | null>(null);
  const [lastChange, setLastChange] = useState<LastChange | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const draftRef = useRef<BuildDraft | null>(null);
  const saveSession = useRef<SaveSession | null>(null);
  const removedThrough = useRef(new Map<string, number>());
  const navigation = useRef(0);
  const rememberedBuild = useRef<{ id: string | null } | null>(null);
  // Set once the user starts, opens or changes a build, so a slow initial load never overwrites it.
  const touched = useRef(false);
  const catalogById = catalog.byId;
  const snapshotId = catalog.data?.id;

  const activate = useCallback(
    (next: BuildDraft, revision: number | null, openedAt = navigation.current) => {
      saveSession.current = {
        buildId: next.build.id,
        navigation: openedAt,
        preCreate: builds.storageKind === 'http' && revision === null,
        stagedError: null,
        revision,
        queue: [],
        running: false,
        conflict: false,
        error: null,
      };
      draftRef.current = next;
      setDraft(next);
      setLoadError(null);
    },
    [builds.storageKind],
  );

  // Load the current draft once the catalog is known.
  useEffect(() => {
    if (!snapshotId || ready) return;
    let cancelled = false;
    const { id } = (rememberedBuild.current ??= { id: readCurrentId() });
    /*
     * The first visit opens an empty canvas, not a prefilled stack: a preselected demo stack would
     * read as a recommendation, and "unknown is not pass" applies to a build nobody has configured.
     * Templates remain an explicit choice on /templates.
     */
    const fresh = () => createDraft(createBuild({ catalogSnapshotId: snapshotId }));
    void (async () => {
      try {
        // Once an HTTP draft is editable, every edit can be gated synchronously without
        // collapsing separate valid revisions while a lazy validator or a write is pending.
        if (builds.storageKind === 'http') await validatorsReady;
        if (cancelled || touched.current) return;
        const stored = await (id ? builds.get(id) : Promise.resolve(null));
        if (cancelled || touched.current) return;
        if (!id) activate(fresh(), null);
        else if (stored) activate(stored, stored.build.revision);
        else throw new Error('Could not read the current build.');
      } catch (error) {
        if (cancelled || touched.current) return;
        if (isDataError(error) && error.kind === 'not_found') {
          activate(fresh(), null);
        } else {
          // Keep the remembered ID and leave the editor empty until this same build can load.
          setLoadError(error ?? new Error('Could not load the current build.'));
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activate, builds, snapshotId, ready]);

  const retryLoad = useCallback(() => {
    if (loadError === null || touched.current) return;
    setLoadError(null);
    setReady(false);
  }, [loadError]);

  const persist = useCallback(
    (next: BuildDraft) => {
      const session = saveSession.current;
      if (!session) return;
      const retired = () =>
        session.navigation <= (removedThrough.current.get(session.buildId) ?? -1);
      if (retired()) return;
      if (builds.storageKind === 'http') {
        const result = validateContract('BuildSnapshot', next.build);
        if (!result.ok) {
          session.stagedError = { status: 'error', message: result.summary };
          setSaveState(session.error ?? session.stagedError);
          return;
        }
        session.stagedError = null;
        // From this point the valid revision is immutable, even if an earlier write is
        // still pending or this request fails. Only invalid, unqueued content may coalesce.
        session.preCreate = false;
      }
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
            if (retired()) {
              session.queue.length = 0;
              break;
            }
            const pending = session.queue[0]!;
            await builds.save(pending, session.revision);
            if (retired()) {
              session.queue.length = 0;
              break;
            }
            session.revision = pending.build.revision;
            session.queue.shift();
            if (builds.storageKind === 'http') {
              // Pre-save reads may already have failed or still be resolving a missing revision.
              // Reset cancels those reads before refreshing this exact acknowledged snapshot;
              // later queued/staged content has its own key and is never reset here.
              const key = buildQueryKey(pending.build);
              for (const queryKey of [
                ['cost', ...key],
                ['resources', ...key],
                ['evaluation', ...key],
                ['options', ...key],
                ['compat-kind', ...key],
                ['compare', 'cost', ...key],
                ['compare', 'evaluation', ...key],
              ]) {
                void queryClient.resetQueries({ queryKey });
              }
            }
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
          if (saveSession.current === session && !retired()) {
            setSaveState(session.error ?? session.stagedError ?? { status: 'saved' });
          }
        }
      })();
    },
    [builds, queryClient],
  );

  const apply = useCallback<BuilderApi['apply']>(
    (change, summary, changedKinds) => {
      const current = draftRef.current;
      if (!current) return;
      touched.current = true;
      const committed = commit(current, change, summary, changedKinds);
      const session = saveSession.current;
      const replaceStaged = session?.preCreate || session?.stagedError;
      const build = replaceStaged
        ? { ...committed.build, revision: current.build.revision }
        : committed.build;
      const next: BuildDraft = replaceStaged
        ? {
            build,
            revisions: [...current.revisions.slice(0, -1), build],
            changes: [
              ...current.changes.slice(0, -1),
              { revision: build.revision, at: build.updated_at, summary, changedKinds },
            ],
          }
        : committed;
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

  const createNew = useCallback(
    async (
      request: number,
      expectedSession: SaveSession | null | undefined,
      ...[template, name]: Parameters<BuilderApi['startNew']>
    ) => {
      // A removal fallback must yield to a newer completed open, including the same request.
      const canActivate = () =>
        request === navigation.current &&
        (expectedSession === undefined || saveSession.current === expectedSession);
      try {
        if (builds.storageKind === 'http') await validatorsReady;
      } catch (error) {
        if (!canActivate()) return;
        setLoadError(error ?? new Error('Could not load build validators.'));
        setReady(true);
        setSaveState({ status: 'error', message: 'Could not load build validators.' });
        return;
      }
      if (!canActivate()) return;
      const catalogSnapshotId = snapshotId ?? (await catalogRepo.getSnapshot()).id;
      if (!canActivate()) return;
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
      activate(next, null, request);
      // An unsaved HTTP draft must not leave the previous build selected on reload.
      writeCurrentId(null);
      setReady(true);
      void persist(next);
    },
    [activate, persist, snapshotId, catalogRepo, builds.storageKind],
  );

  const startNew = useCallback<BuilderApi['startNew']>(
    (...args) => {
      // Claim the draft immediately so a slower initial load cannot replace it.
      touched.current = true;
      void createNew(++navigation.current, undefined, ...args);
    },
    [createNew],
  );

  const open = useCallback<BuilderApi['open']>(
    async (buildId) => {
      const request = ++navigation.current;
      const superseded = () =>
        request !== navigation.current || request <= (removedThrough.current.get(buildId) ?? -1);
      if (builds.storageKind === 'http') await validatorsReady;
      if (superseded()) return;
      const stored = await builds.get(buildId);
      if (superseded()) return;
      touched.current = true;
      setLastChange(null);
      activate(stored, stored.build.revision, request);
      setReady(true);
      writeCurrentId(buildId);
      setSaveState({ status: 'saved' });
    },
    [activate, builds],
  );

  const remove = useCallback<BuilderApi['remove']>(
    async (buildId) => {
      const request = navigation.current;
      const remembered = rememberedBuild.current?.id ?? readCurrentId();
      await builds.remove(buildId);
      // Retire only actions at or before this removal; an explicit later reopen remains usable.
      removedThrough.current.set(
        buildId,
        Math.max(request, removedThrough.current.get(buildId) ?? -1),
      );
      const current = draftRef.current;
      const session = saveSession.current;
      const reopened = current?.build.id === buildId && session && session.navigation > request;
      const removedCurrent = !reopened && forgetCurrentId(buildId);
      if (rememberedBuild.current?.id === buildId) rememberedBuild.current = { id: null };
      if (
        (current?.build.id === buildId && !reopened) ||
        (!current && (removedCurrent || remembered === buildId))
      ) {
        touched.current = true;
        // Preserve a newer pending navigation. If it fails, this fresh draft remains usable;
        // if it completes before the fallback, expectedSession prevents replacing its result.
        const fallbackRequest =
          request === navigation.current ? ++navigation.current : navigation.current;
        await createNew(fallbackRequest, session);
      }
    },
    [builds, createNew],
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
    () => ({
      draft,
      ready,
      loadError,
      retryLoad,
      catalogById,
      lastChange,
      saveState,
      apply,
      startNew,
      open,
      remove,
      restore,
    }),
    [
      draft,
      ready,
      loadError,
      retryLoad,
      catalogById,
      lastChange,
      saveState,
      apply,
      startNew,
      open,
      remove,
      restore,
    ],
  );
  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>;
}

export function useBuilder(): BuilderApi {
  const ctx = useContext(BuilderContext);
  if (!ctx) throw new Error('BuilderProvider missing');
  return ctx;
}
