/*
 * Shared build (read-only preview). The build travels in the URL fragment (#b1.…), which browsers
 * never send to the server, or comes from a local export file. Previewing never touches the
 * viewer's drafts; only "Import to my builds" creates a new local build.
 */
import { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { BuildSnapshot } from '../contracts';
import { KIND_LABELS, TIERS, TIER_LABELS, kindsInTier } from '../contracts';
import { buildStaleness } from '../domain/freshness';
import { useValidatorsReady } from '../app/validators';
import { decodeShareFragment, importBuild, type ImportResult } from '../domain/share';
import { useBuilder } from '../app/builder-context';
import { useData } from '../app/data-context';
import { useBuildAnalysis, useCatalog } from '../app/queries';
import { itemPath } from '../lib/catalog-view';
import { humanize } from '../lib/schema-fields';
import { EmptyState, ErrorState, Loading, Notice } from '../components/feedback';
import { Icon } from '../components/icon';
import { PageHeader } from '../components/layout';
import { OutcomeBadge, SyntheticBadge } from '../components/status';
import { costHeadline, flaggedFindings, overall } from '../features/builder/analysis';

const PREVIEW_NOTE = 'Shared builds are previews; there is no server-side sharing yet.';

export default function SharedBuildPage() {
  const location = useLocation();
  const { mode } = useData();
  const validatorsLoaded = useValidatorsReady();
  const [file, setFile] = useState<{ name: string; result: ImportResult } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fromLink = useMemo(
    () => (location.hash && validatorsLoaded ? decodeShareFragment(location.hash, mode) : null),
    [location.hash, mode, validatorsLoaded],
  );
  const active = file?.result ?? fromLink;
  const build = active?.ok ? active.build : null;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const result = importBuild(await f.text(), mode);
    if (result.ok) {
      setFileError(null);
      setFile({ name: f.name, result });
    } else {
      setFileError(`Could not preview ${f.name}: ${result.error}`);
    }
  };

  const filePicker = (
    <>
      <button
        type="button"
        className="btn btn-outline btn-small"
        onClick={() => fileRef.current?.click()}
      >
        <Icon name="download" /> Preview an exported file
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );

  if (location.hash && !validatorsLoaded && !file) {
    return (
      <div className="app-page">
        <div className="container">
          <Loading label="Opening shared build…" />
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader
        compact
        breadcrumb="SHARED BUILD"
        eyebrow="SHARED BUILD · READ-ONLY PREVIEW"
        title={build ? build.name : 'Shared build'}
      >
        {PREVIEW_NOTE} Viewing a shared build never changes your own builds.
      </PageHeader>
      <div className="container summary-page">
        {fileError ? (
          <p role="alert" className="notice-error">
            {fileError}
          </p>
        ) : null}
        {file ? (
          <div className="local-note" role="status">
            <Icon name="info" />
            <span>
              Previewing file <strong>{file.name}</strong> — not saved.
            </span>
            <button
              type="button"
              className="btn btn-outline btn-small"
              onClick={() => setFile(null)}
            >
              Close file preview
            </button>
          </div>
        ) : null}
        {build && active?.ok ? (
          <SharedPreview build={build} warnings={active.warnings} filePicker={filePicker} />
        ) : (
          <>
            {active && !active.ok ? (
              <div role="alert" className="notice-error">
                <strong>This shared build cannot be opened. </strong>
                {active.error}
              </div>
            ) : null}
            <EmptyState
              title={active ? 'Try another link or a file' : 'No shared build in this link'}
              icon="info"
              action={filePicker}
            >
              A share link carries a whole build after the <code className="mono">#</code> in the
              address, so it is never uploaded. Create one with “Copy share link” in the{' '}
              <Link className="text-link" to="/builder">
                builder
              </Link>
              . You can also preview an exported <code className="mono">.json</code> file here
              without saving it, or import it from{' '}
              <Link className="text-link" to="/builds">
                My Builds
              </Link>
              .
            </EmptyState>
          </>
        )}
      </div>
    </div>
  );
}

function SharedPreview({
  build,
  warnings,
  filePicker,
}: {
  build: BuildSnapshot;
  warnings: string[];
  filePicker: React.ReactNode;
}) {
  const catalog = useCatalog();
  const analysis = useBuildAnalysis(build);
  const { startNew } = useBuilder();
  const { mode } = useData();
  const navigate = useNavigate();

  if (catalog.isError)
    return <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />;
  if (!catalog.data) return <Loading label="Loading catalog…" />;

  const byId = catalog.byId;
  const staleness = buildStaleness(build, catalog.data);
  const unresolved = build.selections.filter((s) => !byId.has(s.catalog_item_id)).length;
  const headline = costHeadline(analysis.costIsCurrent ? analysis.cost : undefined);
  const report = analysis.reportIsCurrent ? analysis.report : undefined;
  const outcome = overall(report);
  const flagged = flaggedFindings(report);

  return (
    <>
      <div className="summary-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            startNew(build, build.name);
            void navigate('/builder');
          }}
        >
          Import to my builds
        </button>
        {filePicker}
      </div>
      <p className="hint-text">
        Importing creates a new build in this browser and opens it in the builder. The original link
        is unchanged.
      </p>

      {warnings.length ? (
        <Notice tone="warning" title="Import warnings:">
          {warnings.join(' ')}
        </Notice>
      ) : null}
      {staleness.snapshotMismatch || staleness.driftedSelectionIds.length || unresolved ? (
        <Notice tone="warning" title="May not match this catalog.">
          {staleness.snapshotMismatch
            ? `This build is locked to catalog snapshot ${build.locks.catalog_snapshot_id}; this site has ${catalog.data.id}. `
            : ''}
          {unresolved
            ? `${unresolved} selection${unresolved === 1 ? ' is' : 's are'} not in this catalog. `
            : ''}
          {staleness.driftedSelectionIds.length
            ? `${staleness.driftedSelectionIds.length} selection(s) are pinned to a different catalog version. `
            : ''}
          Results below are evaluated against this site&apos;s catalog and may differ from what the
          author saw.
        </Notice>
      ) : null}
      {staleness.catalog.state === 'stale' ? (
        <Notice tone="warning">
          Catalog evidence is {staleness.catalog.ageDays} days old (stale).
        </Notice>
      ) : null}

      <div
        className={`compat-panel${outcome === 'fail' ? ' danger' : outcome === 'unknown' ? ' warning' : ''}`}
      >
        <div className="compat-title">
          <Icon
            name={
              outcome === 'fail' ? 'x-circle' : outcome === 'unknown' ? 'alert' : 'check-circle'
            }
          />
          {!report
            ? 'Evaluating this build…'
            : outcome === 'fail'
              ? `${report.summary.failed} failing check${report.summary.failed === 1 ? '' : 's'}`
              : outcome === 'unknown'
                ? `${report.summary.unknown} check${report.summary.unknown === 1 ? '' : 's'} unknown`
                : `${report.summary.passed} checks pass, ${report.summary.skipped} do not apply`}
        </div>
        <p>
          {!report
            ? 'The published rules are being evaluated against this site’s catalog.'
            : outcome === 'fail'
              ? 'This stack is not compatible as configured.'
              : outcome === 'unknown'
                ? 'No failures, but missing information is not treated as compatible.'
                : 'Compatibility is not proof of quality or production readiness.'}
        </p>
      </div>
      {analysis.evaluation.isError ? (
        <ErrorState
          error={analysis.evaluation.error}
          onRetry={() => void analysis.evaluation.refetch()}
        />
      ) : null}

      <section className="panel" aria-labelledby="shared-meta-heading">
        <h2 id="shared-meta-heading">About this build</h2>
        <dl className="kv">
          <dt>Revision</dt>
          <dd>{build.revision}</dd>
          <dt>Last updated</dt>
          <dd>
            <time dateTime={build.updated_at}>{new Date(build.updated_at).toLocaleString()}</time>
          </dd>
          <dt>Lifecycle</dt>
          <dd>{humanize(build.lifecycle)}</dd>
          <dt>Region</dt>
          <dd>{build.objectives.region}</dd>
          <dt>Data classification</dt>
          <dd>{humanize(build.objectives.data_classification)}</dd>
        </dl>
      </section>

      <section className="panel" aria-labelledby="shared-sel-heading">
        <h2 id="shared-sel-heading">Selections ({build.selections.length})</h2>
        {TIERS.map((tier) => {
          const rows = kindsInTier(tier).flatMap((k) =>
            build.selections.filter((s) => s.kind === k.kind),
          );
          if (!rows.length) return null;
          return (
            <div key={tier}>
              <h3>
                {tier} — {TIER_LABELS[tier]}
              </h3>
              <ul className="summary-list">
                {rows.map((s) => {
                  const item = byId.get(s.catalog_item_id);
                  return (
                    <li key={s.id}>
                      <strong>{KIND_LABELS[s.kind]}:</strong>{' '}
                      {item ? (
                        <>
                          <Link className="text-link" to={itemPath(item)}>
                            {item.name}
                          </Link>
                          {(item.tags ?? []).includes('synthetic') ? <SyntheticBadge /> : null}
                        </>
                      ) : (
                        <>
                          <span className="mono">{s.catalog_item_id}</span>{' '}
                          <span className="badge badge-unknown">Not in this catalog</span>
                        </>
                      )}{' '}
                      {s.role !== 'primary' ? <span className="dim">({s.role})</span> : null}{' '}
                      {!s.enabled ? <span className="dim">(disabled)</span> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="panel" aria-labelledby="shared-cost-heading">
        <h2 id="shared-cost-heading">Estimated cost</h2>
        {analysis.costQuery.isError ? (
          <ErrorState
            title="Cost estimate unavailable"
            error={analysis.costQuery.error}
            onRetry={() => void analysis.costQuery.refetch()}
          />
        ) : (
          <>
            <p className="summary-headline">{headline.text}</p>
            <p>{headline.detail}</p>
            {mode === 'fixture' ? (
              <p className="severity severity-warning">Synthetic demo prices — not a quote.</p>
            ) : null}
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="shared-findings-heading">
        <h2 id="shared-findings-heading">Findings</h2>
        {!report ? (
          <Loading label="Evaluating the shared build…" />
        ) : (
          <div className="issue-list">
            {flagged.length === 0 ? (
              <div className="issue">
                <Icon name="check-circle" />
                <span>No failing or unknown checks in this revision.</span>
              </div>
            ) : (
              flagged.map((f) => (
                <div className="issue" key={f.rule_id}>
                  <Icon name={f.outcome === 'fail' ? 'x-circle' : 'alert'} />
                  <span>
                    {f.message} {f.remediation} <OutcomeBadge outcome={f.outcome} />
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </>
  );
}
