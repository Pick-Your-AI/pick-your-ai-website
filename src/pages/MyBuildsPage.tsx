/*
 * My Builds: builds saved in this browser's localStorage. Nothing is synced or uploaded; accounts
 * are a future capability. Destructive actions use an inline confirm step (never a modal dialog),
 * and unreadable records are shown with an explanation rather than hidden.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { canExport, exportBuild, exportFileName, importBuild } from '../domain/share';
import type { SavedBuildSummary } from '../data/types';
import { isDataError } from '../data/errors';
import { useBuilder } from '../app/builder-context';
import { useData } from '../app/data-context';
import { EmptyState, ErrorState, Loading, Notice } from '../components/feedback';
import { IconDownload, IconTrash, IconUpload } from '../components/icons';
import { PageHeader } from '../components/layout';
import { download } from '../features/builder/BuildToolbar';

const LIST_KEY = ['builds', 'list'] as const;
const UNREADABLE = '(unreadable saved build)';

const errorText = (e: unknown, fallback: string) =>
  isDataError(e) || e instanceof Error ? e.message : fallback;

export default function MyBuildsPage() {
  const { builds, mode } = useData();
  const { draft, open, startNew } = useBuilder();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: LIST_KEY, queryFn: () => builds.list() });
  const [status, setStatus] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['builds'] });

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    const result = importBuild(await file.text(), mode);
    if (!result.ok) {
      setImportError(`Import failed: ${result.error}`);
      return;
    }
    startNew(result.build, result.build.name);
    void invalidate();
    navigate('/builder');
  };

  return (
    <>
      <PageHeader eyebrow="My Builds" title="My builds">
        Builds saved in this browser. Open one to keep editing, duplicate it to try an alternative,
        or export it as a file.
      </PageHeader>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6">
        <Notice title="Stored only in this browser.">
          Builds are kept in this browser&apos;s local storage. They are not synced to other devices
          or uploaded anywhere, and clearing site data deletes them — export a file to keep a copy.
          Accounts and cloud saving are a future capability; this is a preview.
        </Notice>

        <div className="flex flex-wrap items-center gap-2">
          <Link className="btn-primary" to="/builder">
            Open the builder
          </Link>
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
            <IconUpload /> Import a build file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void onImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <p className="hint w-full sm:mt-0 sm:w-auto">
            Imports a PickYour.AI JSON export as a new build and opens it.
          </p>
        </div>
        {importError ? (
          <p role="alert" className="text-sm text-red-800 dark:text-red-300">
            {importError}
          </p>
        ) : null}
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-emerald-900 dark:text-emerald-200"
        >
          {status}
        </p>

        <section aria-labelledby="saved-heading">
          <h2 id="saved-heading" className="text-lg font-semibold">
            Saved builds{list.data ? ` (${list.data.length})` : ''}
          </h2>
          <div className="mt-3">
            {list.isError ? (
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            ) : !list.data ? (
              <Loading label="Loading saved builds…" />
            ) : list.data.length === 0 ? (
              <EmptyState
                title="No saved builds yet"
                action={
                  <Link className="btn-primary" to="/builder">
                    Start a stack
                  </Link>
                }
              >
                Builds are saved here automatically as you edit them in the builder.
              </EmptyState>
            ) : (
              <ul className="grid gap-3">
                {list.data.map((summary) => (
                  <BuildCard
                    key={summary.id}
                    summary={summary}
                    current={summary.id === draft?.build.id}
                    onOpen={async () => {
                      await open(summary.id);
                      navigate('/builder');
                    }}
                    onDuplicate={async () => {
                      const stored = await builds.get(summary.id);
                      startNew(stored.build, `${stored.build.name} (copy)`);
                      void invalidate();
                      navigate('/builder');
                    }}
                    onExport={async () => {
                      const stored = await builds.get(summary.id);
                      const problem = canExport(stored.build);
                      if (problem) throw new Error(problem);
                      download(
                        exportFileName(stored.build),
                        JSON.stringify(exportBuild(stored.build, mode), null, 2) + '\n',
                      );
                      setStatus(`Exported "${stored.build.name}".`);
                    }}
                    onDelete={async () => {
                      await builds.remove(summary.id);
                      if (summary.id === draft?.build.id) startNew();
                      await invalidate();
                      setStatus(`Deleted "${summary.name}" from this browser.`);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function BuildCard({
  summary,
  current,
  onOpen,
  onDuplicate,
  onExport,
  onDelete,
}: {
  summary: SavedBuildSummary;
  current: boolean;
  onOpen: () => Promise<void>;
  onDuplicate: () => Promise<void>;
  onExport: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const unreadable = summary.name === UNREADABLE && summary.revision === 0;
  const headingId = `build-${summary.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const exportProblem =
    summary.selectionCount < 2 ? 'Add at least 2 components before exporting.' : null;

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e, `${label} failed.`));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="font-semibold break-words">
            {unreadable ? 'Unreadable saved build' : summary.name}
            {current ? (
              <span className="ml-2 inline-block rounded-full bg-brand-100 px-2 py-0.5 align-middle text-xs font-semibold text-brand-900 dark:bg-brand-900 dark:text-brand-100">
                Current
              </span>
            ) : null}
          </h3>
          {unreadable ? (
            <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
              The saved record <code className="font-mono text-xs break-all">{summary.id}</code> is
              damaged or no longer matches the build contract, so it cannot be opened. It has not
              been changed or repaired. You can delete it.
            </p>
          ) : (
            <p className="muted mt-1 text-sm tabular">
              Revision {summary.revision} · {summary.selectionCount} selection
              {summary.selectionCount === 1 ? '' : 's'} · updated{' '}
              {summary.updatedAt ? (
                <time dateTime={summary.updatedAt}>
                  {new Date(summary.updatedAt).toLocaleString()}
                </time>
              ) : (
                'unknown'
              )}
            </p>
          )}
        </div>
        {!confirming ? (
          <div className="flex flex-wrap gap-2">
            {!unreadable ? (
              <>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={Boolean(busy)}
                  onClick={() => void run('Open', onOpen)}
                >
                  Open<span className="sr-only"> {summary.name}</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={Boolean(busy)}
                  onClick={() => void run('Duplicate', onDuplicate)}
                >
                  Duplicate<span className="sr-only"> {summary.name}</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={Boolean(busy) || Boolean(exportProblem)}
                  title={exportProblem ?? undefined}
                  onClick={() => void run('Export', onExport)}
                >
                  <IconDownload /> Export JSON<span className="sr-only"> of {summary.name}</span>
                </button>
              </>
            ) : null}
            <button
              ref={deleteRef}
              type="button"
              className="btn-danger btn-sm"
              disabled={Boolean(busy)}
              onClick={() => setConfirming(true)}
            >
              <IconTrash /> Delete
              <span className="sr-only"> {unreadable ? 'unreadable build' : summary.name}</span>
            </button>
          </div>
        ) : null}
      </div>
      {exportProblem && !unreadable ? <p className="hint">JSON export: {exportProblem}</p> : null}
      {confirming ? (
        <ConfirmDelete
          name={unreadable ? 'this unreadable build' : `“${summary.name}”`}
          current={current}
          busy={busy === 'Delete'}
          onConfirm={() => void run('Delete', onDelete)}
          onCancel={() => {
            setConfirming(false);
            // Return focus to the control that opened the confirm step.
            requestAnimationFrame(() => deleteRef.current?.focus());
          }}
        />
      ) : null}
      {busy ? (
        <p className="muted mt-2 text-sm" role="status">
          {busy}…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function ConfirmDelete({
  name,
  current,
  busy,
  onConfirm,
  onCancel,
}: {
  name: string;
  current: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div
      role="group"
      aria-label="Confirm delete"
      className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
    >
      <p>
        Delete {name} from this browser? This cannot be undone
        {current ? '; a new empty build will become your current draft' : ''}.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={onConfirm}>
          Yes, delete
        </button>
        <button
          ref={cancelRef}
          type="button"
          className="btn-secondary btn-sm"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
