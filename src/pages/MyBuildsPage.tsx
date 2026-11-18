/*
 * My Builds (mock: `#buildsScreen` + `renderBuildsPage()` and the `data-saved-action` handlers).
 *
 * Build storage comes from the configured repository; HTTP builds retain a browser-local index.
 * The page keeps the safety rules of the previous implementation — every destructive action has an inline confirm
 * step (never a native confirm), records that cannot be read are explained rather than hidden, and
 * export is blocked with a reason when the build is not yet a contract-valid snapshot.
 */
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { BuildSnapshot, CostEstimate } from '../contracts';
import { kindDef } from '../contracts';
import { createDraft, newBuildId } from '../domain/build';
import { canExport, exportBuild, exportFileName, importBuild } from '../domain/share';
import type { BuildRepository, SavedBuildSummary } from '../data/types';
import { isDataError } from '../data/errors';
import { useBuilder } from '../app/builder-context';
import { useData } from '../app/data-context';
import { useBuildAnalysis } from '../app/queries';
import { LAYERS } from '../lib/layers';
import { ErrorState, Loading, useToast } from '../components/feedback';
import { Icon } from '../components/icon';
import { PageHeader } from '../components/layout';
import { download } from '../features/builder/BuildToolbar';
import { costShort } from '../features/builder/analysis';

const LIST_KEY = ['builds', 'list'] as const;
const UNREADABLE = '(unreadable saved build)';

type SortKey = 'updated' | 'name' | 'cost';

interface BuildDetail {
  build: BuildSnapshot;
  /**
   * The estimator's result, kept whole: storing only the amount lost the coverage and the period, so
   * an all-unpriced build displayed as $0/mo and a partial total displayed as complete.
   */
  cost: CostEstimate;
  conflicts: number;
  unknown: number;
}

function validationStatus(conflicts: number, unknown: number): string {
  const statuses = [];
  if (conflicts) statuses.push(`${conflicts} conflict${conflicts === 1 ? '' : 's'}`);
  if (unknown) statuses.push(`${unknown} unknown`);
  return statuses.join(' · ') || 'No conflicts';
}

const errorText = (e: unknown, fallback: string) =>
  isDataError(e) || e instanceof Error ? e.message : fallback;

const isUnreadable = (summary: SavedBuildSummary) =>
  summary.name === UNREADABLE && summary.revision === 0;

/** Layers filled = distinct tiers with at least one enabled selection. */
function filledLayers(build: BuildSnapshot): number {
  return new Set(build.selections.filter((s) => s.enabled).map((s) => kindDef(s.kind).tier)).size;
}

const formatDate = (iso: string) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'unknown date';

export default function MyBuildsPage() {
  const { builds, mode, pricing, compatibility } = useData();
  const storage = builds.storageKind;
  const { draft, open, startNew, remove, loadError, retryLoad } = useBuilder();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: LIST_KEY, queryFn: () => builds.list() });
  const [sort, setSort] = useState<SortKey>('updated');
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const analysis = useBuildAnalysis(draft?.build ?? null);
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['builds'] }),
    [queryClient],
  );

  const summaries = list.data ?? [];
  // The list can be a browser index. Read each head independently so its current metadata is
  // available even while another build or its analysis is still loading.
  const heads = useQueries({
    queries: summaries.map((summary) => ({
      queryKey: ['builds', 'head', summary.id, summary.revision],
      enabled: !isUnreadable(summary),
      queryFn: async () => (await builds.get(summary.id)).build,
    })),
  });
  const details = useQueries({
    queries: summaries.map((summary, index) => {
      const head = heads[index];
      const build = head?.data;
      return {
        queryKey: ['builds', 'details', summary.id, build?.revision],
        enabled: Boolean(build) && !head?.isError,
        queryFn: async (): Promise<BuildDetail> => {
          if (!build) throw new Error('Saved build has not been read.');
          const cost = await pricing.estimate(build);
          const report = await compatibility.evaluate(build, { costEstimate: cost });
          return {
            build,
            cost,
            conflicts: report.summary.failed,
            unknown: report.summary.unknown,
          };
        },
      };
    }),
  });
  const cards = summaries.map((summary, index) => {
    const head = heads[index];
    const build = head?.data;
    return {
      summary: build
        ? {
            id: summary.id,
            name: build.name,
            revision: build.revision,
            updatedAt: build.updated_at,
            selectionCount: build.selections.length,
          }
        : summary,
      build,
      detail: !head?.isError && !details[index]?.isError ? details[index]?.data : undefined,
      refreshFailed: Boolean(head?.isError),
    };
  });

  // The draft is persisted asynchronously; refresh the library whenever the current build changes.
  const draftId = draft?.build.id;
  useEffect(() => {
    if (draftId) void invalidate();
  }, [draftId, invalidate]);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    setImportNotice(null);
    const result = importBuild(await file.text(), mode);
    if (!result.ok) {
      setImportError(`Import failed: ${result.error}`);
      return;
    }
    startNew(result.build, result.build.name);
    if (result.warnings.length) setImportNotice(result.warnings.join(' '));
    void invalidate();
    void navigate('/builder');
  };

  const saveCopy = () => {
    if (!draft) return;
    startNew(draft.build, `${draft.build.name} (copy)`);
    toast('Saved a copy of your current build.');
  };

  const duplicate = async (summary: SavedBuildSummary) => {
    const stored = await builds.get(summary.id);
    const now = new Date().toISOString();
    const copy: BuildSnapshot = {
      ...stored.build,
      id: newBuildId(),
      name: `${stored.build.name} (copy)`,
      revision: 1,
      lifecycle: 'draft',
      created_at: now,
      updated_at: now,
    };
    await builds.save(createDraft(copy), null);
    await invalidate();
    toast('Build duplicated.');
  };

  const exportOne = async (summary: SavedBuildSummary) => {
    const stored = await builds.get(summary.id);
    const problem = canExport(stored.build);
    if (problem) throw new Error(problem);
    download(
      exportFileName(stored.build),
      JSON.stringify(exportBuild(stored.build, mode), null, 2) + '\n',
    );
    toast('Saved build exported.');
  };

  const removeOne = async (summary: SavedBuildSummary) => {
    await remove(summary.id);
    await invalidate();
    toast(
      storage === 'http'
        ? 'Build forgotten in this browser. The API-stored build was not deleted.'
        : storage === 'local'
          ? 'Saved build deleted from this browser.'
          : 'Build removed using the configured storage provider.',
    );
  };

  const sorted = [...cards].sort((a, b) => {
    if (sort === 'name') return a.summary.name.localeCompare(b.summary.name);
    if (sort === 'cost') {
      const ca = a.detail?.cost;
      const cb = b.detail?.cost;
      if (!ca && !cb) return b.summary.updatedAt.localeCompare(a.summary.updatedAt);
      if (!ca) return 1;
      if (!cb) return -1;
      // Rank by coverage first: a lower bound is not "cheaper" than a complete total.
      const rank = (cost: CostEstimate) =>
        cost.coverage === 'complete' ? 0 : cost.coverage === 'partial' ? 1 : 2;
      const byCoverage = rank(ca) - rank(cb);
      if (byCoverage) return byCoverage;
      return Number(ca.total.amount) - Number(cb.total.amount);
    }
    return b.summary.updatedAt.localeCompare(a.summary.updatedAt);
  });

  const workingTotal = analysis.costIsCurrent ? analysis.cost : undefined;
  const workingCost = costShort(workingTotal);
  const workingSummary = analysis.reportIsCurrent ? analysis.report?.summary : undefined;
  const workingLayers = draft ? filledLayers(draft.build) : 0;

  return (
    <div className="app-page">
      <PageHeader
        compact
        breadcrumb="WORKSPACE"
        eyebrow="YOUR WORKSPACE"
        title={
          <>
            Good builds are
            <br />
            <span>worth keeping.</span>
          </>
        }
        aside={
          <div className="builds-header-actions">
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => fileRef.current?.click()}
            >
              ↥ Import JSON
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                startNew();
                void navigate('/builder');
                toast('New blank build created.');
              }}
            >
              <Icon name="plus" /> New configuration
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                void onImport(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        }
      >
        Explore iterations, duplicate your ideas, or pick up right where you left off.{' '}
        {storage === 'local'
          ? 'Stored in your browser for this preview.'
          : storage === 'http'
            ? 'Build snapshots are saved to the configured API.'
            : 'Build storage is managed by the configured provider.'}
      </PageHeader>

      <div className="container saved-layout">
        <div className="local-note">
          <Icon name="info" />
          <span>
            {storage === 'http' ? (
              <>
                <strong>API-backed workspace.</strong> Complete build snapshots are sent to the
                configured API. My Builds uses a browser-stored list, so clearing site data or
                forgetting a build removes its browser copy and list entry, without requesting
                deletion from the API. Retain the build ID or an exported copy: this list cannot
                rediscover forgotten API-stored builds. The API&apos;s retention policy is not
                specified here.
              </>
            ) : storage === 'local' ? (
              <>
                <strong>Local workspace.</strong> Your saved configurations live in this
                browser&apos;s storage. They are not synchronized or backed up. Export JSON to keep
                a portable copy.
              </>
            ) : (
              <>
                <strong>Configured workspace.</strong> The storage provider manages saving and
                removal. This page does not establish where it stores builds or how long it retains
                them. Export JSON to keep a portable copy.
              </>
            )}
          </span>
        </div>

        {importError ? (
          <p className="notice-error" role="alert">
            {importError}
          </p>
        ) : null}
        {importNotice ? (
          <p className="notice-ok" role="status">
            {importNotice}
          </p>
        ) : null}

        <div className="saved-section-heading">
          <div>
            <span className="eyebrow">CONTINUE WHERE YOU LEFT OFF</span>
            <h2>Currently editing</h2>
          </div>
          <span className="workspace-count">{draft ? '01' : '00'} ACTIVE BUILD</span>
        </div>

        {!draft ? (
          loadError != null ? (
            <ErrorState error={loadError} onRetry={retryLoad} />
          ) : (
            <Loading label="Loading your working build…" />
          )
        ) : (
          <div className="working-card">
            <div className="working-symbol">
              <Icon name="layers" />
            </div>
            <div>
              <h3>{draft.build.name}</h3>
              <p>
                Your current, editable configuration · {workingLayers} of {LAYERS.length} layers
                selected
              </p>
              <div className="build-meta-row">
                <span title={workingCost.note}>
                  {workingCost.text}
                  {workingCost.qualifier ? ` ${workingCost.qualifier}` : ''}
                </span>
                <span>
                  {workingSummary
                    ? validationStatus(workingSummary.failed, workingSummary.unknown)
                    : 'Not checked'}
                </span>
                <span>IN PROGRESS</span>
              </div>
            </div>
            <div className="working-actions">
              <button className="btn btn-outline btn-small" type="button" onClick={saveCopy}>
                Save a copy
              </button>
              <button
                className="btn btn-primary btn-small"
                type="button"
                onClick={() => void navigate('/builder')}
              >
                Continue editing →
              </button>
            </div>
          </div>
        )}

        <div className="saved-section-heading lower">
          <div>
            <span className="eyebrow">SAVED CONFIGURATIONS</span>
            <h2>
              Your library <span className="count-light">({summaries.length})</span>
            </h2>
          </div>
          <div className="saved-sort">
            <label htmlFor="savedSort">SORT BY</label>
            <select
              className="form-select"
              id="savedSort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="updated">Recently edited</option>
              <option value="name">Name A–Z</option>
              <option value="cost">Example cost</option>
            </select>
          </div>
        </div>

        <div className="saved-grid">
          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : !list.data ? (
            <Loading label="Loading saved builds…" />
          ) : sorted.length === 0 ? (
            <div className="saved-empty">
              <Icon name="layers" />
              <h3>No saved configurations yet</h3>
              <p>
                Your current stack is ready to save. Give it a name in the builder, then hit Save.
              </p>
              <button className="btn btn-primary" type="button" onClick={saveCopy}>
                Save your current build →
              </button>
            </div>
          ) : (
            sorted.map(({ summary, build, detail, refreshFailed }) => (
              <SavedCard
                key={summary.id}
                summary={summary}
                build={build}
                detail={detail}
                refreshFailed={refreshFailed}
                current={summary.id === draft?.build.id}
                storage={storage}
                onOpen={async () => {
                  await open(summary.id);
                  void navigate('/builder');
                }}
                onDuplicate={() => duplicate(summary)}
                onExport={() => exportOne(summary)}
                onDelete={() => removeOne(summary)}
              />
            ))
          )}
        </div>

        <div className="saved-bottom">
          <span>Looking for a starting point? Browse complete, editable configurations.</span>
          <Link to="/templates">
            View starter builds <Icon name="arrow-right" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function SavedCard({
  summary,
  build,
  detail,
  refreshFailed,
  current,
  storage,
  onOpen,
  onDuplicate,
  onExport,
  onDelete,
}: {
  summary: SavedBuildSummary;
  build: BuildSnapshot | undefined;
  detail: BuildDetail | undefined;
  refreshFailed: boolean;
  current: boolean;
  storage: BuildRepository['storageKind'];
  onOpen: () => Promise<void>;
  onDuplicate: () => Promise<void>;
  onExport: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const unreadable = isUnreadable(summary);
  const label = unreadable ? 'this unreadable build' : `“${summary.name}”`;
  const removalLabel = storage === 'http' ? 'Forget' : storage === 'local' ? 'Delete' : 'Remove';
  const exportProblem =
    build && build.selections.length < 2 ? 'Add at least 2 components before exporting.' : null;

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const run = async (labelText: string, action: () => Promise<void>) => {
    setBusy(labelText);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e, `${labelText} failed.`));
    } finally {
      setBusy(null);
    }
  };

  const layers = detail ? filledLayers(detail.build) : null;
  // Coverage-aware: a partial estimate reads as a lower bound, never as the full monthly price.
  const cost = costShort(detail?.cost);

  return (
    <article className="saved-card">
      <div className="saved-card-top">
        <div className="saved-card-brand">
          <Icon name={unreadable ? 'alert' : 'layers'} />
        </div>
        <h3>
          {unreadable ? 'Unreadable saved build' : summary.name}
          {current ? <span className="count-light"> (current)</span> : null}
        </h3>
        {unreadable ? (
          <p>
            The saved record <code>{summary.id}</code> is damaged or no longer matches the build
            contract, so it cannot be opened. It has not been changed or repaired. You can delete
            it.
          </p>
        ) : (
          <p>
            Edited {formatDate(summary.updatedAt)} · Revision {summary.revision} ·{' '}
            {layers === null
              ? `${summary.selectionCount} selection${summary.selectionCount === 1 ? '' : 's'}`
              : `${layers} of ${LAYERS.length} layers configured`}
          </p>
        )}
        {!unreadable ? (
          <div className="saved-card-metrics">
            <div>
              <small>ESTIMATED BASELINE*</small>
              <strong title={cost.note}>
                {cost.text}
                {cost.qualifier ? <span className="pt-sub"> {cost.qualifier}</span> : null}
              </strong>
            </div>
            <div>
              <small>DEMO VALIDATION</small>
              <strong>
                {detail ? validationStatus(detail.conflicts, detail.unknown) : 'Not checked'}
              </strong>
            </div>
          </div>
        ) : null}
      </div>

      <div className="saved-card-actions">
        {!unreadable ? (
          <>
            <button
              className="open"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run('Open', onOpen)}
            >
              Open build →
            </button>
            <button
              type="button"
              aria-label={`Duplicate ${summary.name}`}
              title="Duplicate"
              disabled={Boolean(busy)}
              onClick={() => void run('Duplicate', onDuplicate)}
            >
              <Icon name="copy" />
            </button>
            <button
              type="button"
              aria-label={`Export JSON of ${summary.name}`}
              title={exportProblem ?? 'Export JSON'}
              disabled={Boolean(busy) || Boolean(exportProblem)}
              onClick={() => void run('Export', onExport)}
            >
              <Icon name="download" />
            </button>
          </>
        ) : null}
        <button
          ref={deleteRef}
          type="button"
          aria-label={`${removalLabel} ${unreadable ? 'unreadable saved build' : summary.name}`}
          title={removalLabel}
          disabled={Boolean(busy)}
          onClick={() => setConfirming(true)}
        >
          <Icon name="x" />
        </button>
      </div>

      {refreshFailed ? (
        <p className="notice-error" role="alert">
          Could not refresh this saved build. Showing its last known details; current analysis is
          unavailable. You can try opening it again or {removalLabel.toLowerCase()} its entry.
        </p>
      ) : null}

      {exportProblem ? <p className="hint-text">JSON export: {exportProblem}</p> : null}

      {confirming ? (
        <div
          className="notice-error"
          role="group"
          aria-label={`Confirm ${removalLabel.toLowerCase()}`}
        >
          <p>
            {storage === 'http'
              ? `Forget ${label} in this browser? The API-stored build will not be deleted. Its browser copy and entry in My Builds will be removed; retain its ID or export it first to access it again.`
              : storage === 'local'
                ? `Delete ${label} from this browser? This cannot be undone. Export it first if you need a backup.`
                : `Remove ${label} using the configured storage provider? Export it first if you need a backup.`}
            {current ? ' A new empty build will become your current draft.' : ''}
          </p>
          <p>
            <button
              className="btn btn-outline btn-small"
              type="button"
              disabled={busy === 'Delete'}
              onClick={() =>
                void run('Delete', onDelete).then(() => {
                  setConfirming(false);
                })
              }
            >
              Yes, {removalLabel.toLowerCase()}
            </button>{' '}
            <button
              ref={cancelRef}
              className="btn btn-outline btn-small"
              type="button"
              disabled={busy === 'Delete'}
              onClick={() => {
                setConfirming(false);
                requestAnimationFrame(() => deleteRef.current?.focus());
              }}
            >
              Cancel
            </button>
          </p>
        </div>
      ) : null}

      {busy ? (
        <p className="hint-text" role="status">
          {busy}…
        </p>
      ) : null}
      {error ? (
        <p className="notice-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
