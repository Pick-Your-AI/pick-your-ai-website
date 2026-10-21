import type { ComponentKind } from '../contracts';
/*
 * Full, printable summary of the current draft: locks, selections by tier, objectives, findings,
 * the cost breakdown (#cost), capacity and freshness evidence, and revision history. Results are
 * shown only for the exact head revision; stale results are labelled while re-evaluating.
 *
 * Styling follows the design mock's secondary pages (`.page-masthead` + `.panel` blocks).
 */
import { Link } from 'react-router';
import type { BuildSnapshot, CatalogItem, CostEstimate, Money } from '../contracts';
import { KIND_LABELS, TIERS, TIER_LABELS, kindsInTier } from '../contracts';
import { buildStaleness } from '../domain/freshness';
import { useValidatorsReady } from '../app/validators';
import { canExport, exportBuild, exportFileName } from '../domain/share';
import { useBuilder } from '../app/builder-context';
import { useData } from '../app/data-context';
import { useBuildAnalysis, useCatalog, useRuleset } from '../app/queries';
import { itemPath } from '../lib/catalog-view';
import { formatValue, humanize, settingsFields } from '../lib/schema-fields';
import { EmptyState, ErrorState, Loading, Notice } from '../components/feedback';
import { Icon } from '../components/icon';
import { PageHeader } from '../components/layout';
import { OutcomeBadge, SyntheticBadge } from '../components/status';
import { buildMarkdown, download } from '../features/builder/BuildToolbar';
import { incompleteBuild } from '../features/builder/incomplete';
import { costHeadline, flaggedFindings, formatMoney, overall } from '../features/builder/analysis';

const formatDate = (iso: string) => new Date(iso).toLocaleString();

function selectionLabel(
  build: BuildSnapshot,
  byId: ReadonlyMap<string, CatalogItem>,
  selectionId: string,
) {
  const s = build.selections.find((x) => x.id === selectionId);
  if (!s) return selectionId;
  const item = byId.get(s.catalog_item_id);
  return `${KIND_LABELS[s.kind]}: ${item?.name ?? s.catalog_item_id}${s.enabled ? '' : ' (disabled)'}`;
}

export default function BuildSummaryPage() {
  useValidatorsReady(); // re-render once export validation is possible
  const { draft, ready } = useBuilder();
  const { mode } = useData();
  const catalog = useCatalog();
  const ruleset = useRuleset();
  const build = draft?.build;
  const analysis = useBuildAnalysis(build);

  if (catalog.isError) {
    return (
      <div className="app-page">
        <div className="container">
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        </div>
      </div>
    );
  }
  if (!ready || !draft || !build || !catalog.data) {
    return (
      <div className="app-page">
        <div className="container">
          <Loading label="Loading build summary…" />
        </div>
      </div>
    );
  }

  const byId = catalog.byId;
  const exportProblem = canExport(build);
  const staleness = buildStaleness(build, catalog.data);
  const stalePicks = [...staleness.driftedSelectionIds, ...staleness.missingSelectionIds];
  const resources = analysis.resources;
  const report = analysis.reportIsCurrent ? analysis.report : undefined;
  const incomplete = incompleteBuild(build, report, ruleset.data);
  const outcome = overall(report);
  const flagged = flaggedFindings(report);

  return (
    <div className="app-page">
      <PageHeader
        compact
        breadcrumb="BUILD SUMMARY"
        eyebrow="FULL BUILD SUMMARY"
        title={build.name}
      >
        Everything about revision {build.revision} of this stack on one page. Use Print for a paper
        or PDF copy.
      </PageHeader>
      <div className="container summary-page">
        <div className="no-print summary-actions">
          <Link className="btn btn-outline btn-small" to="/builder">
            Back to builder
          </Link>
          <button
            type="button"
            className="btn btn-outline btn-small"
            onClick={() => window.print()}
          >
            Print
          </button>
          <button
            type="button"
            className="btn btn-outline btn-small"
            disabled={Boolean(exportProblem)}
            aria-describedby={exportProblem ? 'export-problem' : undefined}
            onClick={() =>
              download(
                exportFileName(build),
                JSON.stringify(exportBuild(build, mode), null, 2) + '\n',
              )
            }
          >
            <Icon name="download" /> Export JSON
          </button>
          <button
            type="button"
            className="btn btn-outline btn-small"
            disabled={!build.selections.length}
            onClick={() =>
              download(
                exportFileName(build).replace(/\.json$/, '.md'),
                buildMarkdown(build, byId),
                'text/markdown',
              )
            }
          >
            <Icon name="download" /> Export Markdown
          </button>
        </div>
        {exportProblem ? (
          <p id="export-problem" className="hint-text no-print">
            JSON export unavailable: {exportProblem}
          </p>
        ) : null}

        {mode === 'fixture' ? (
          <Notice title="Demo data.">
            Components, prices and compatibility results here are synthetic demonstration data — not
            real products, quotes or measurements.
          </Notice>
        ) : null}

        <div
          className={`compat-panel${!report ? ' neutral' : outcome === 'fail' && !incomplete ? ' danger' : outcome === 'unknown' || incomplete ? ' warning' : ''}`}
          data-testid="overall-status"
        >
          <div className="compat-title">
            <Icon
              name={
                !report
                  ? 'info'
                  : incomplete
                    ? 'alert'
                    : outcome === 'fail'
                      ? 'x-circle'
                      : outcome === 'unknown'
                        ? 'alert'
                        : 'check-circle'
              }
            />
            <strong>
              {!report
                ? 'Not evaluated yet'
                : incomplete
                  ? 'Incomplete'
                  : outcome === 'fail'
                    ? 'Incompatible'
                    : outcome === 'unknown'
                      ? 'Unknowns'
                      : 'Compatible (rules pass)'}
            </strong>
            {!report
              ? null
              : incomplete
                ? ` — ${incomplete.chosen} of ${incomplete.total} required choices made`
                : outcome === 'fail'
                  ? ` — ${report.summary.failed} failing check${report.summary.failed === 1 ? '' : 's'}`
                  : outcome === 'unknown'
                    ? ` — ${report.summary.unknown} check${report.summary.unknown === 1 ? '' : 's'} unknown`
                    : ` — ${report.summary.passed} checks pass, ${report.summary.skipped} do not apply`}
          </div>
          <p>
            {!report
              ? 'Add components and the published rules will be evaluated for this revision.'
              : incomplete
                ? `${incomplete.remediation} Provisional inference from presence rules; the contract findings below are unchanged.`
                : outcome === 'fail'
                  ? 'This stack is not compatible as configured. Fixes are listed below.'
                  : outcome === 'unknown'
                    ? 'No failures, but missing information is not treated as compatible.'
                    : 'Compatibility is not proof of quality or production readiness.'}
          </p>
          {!analysis.reportIsCurrent && analysis.report ? (
            <p className="hint-text" role="status">
              Previous evaluation: revision {analysis.report.build_revision}
              {analysis.report.build_id !== build.id ? ' of another build' : ''}. These results are
              not current.
            </p>
          ) : null}
        </div>
        {analysis.evaluation.isError ? (
          <ErrorState
            error={analysis.evaluation.error}
            onRetry={() => void analysis.evaluation.refetch()}
          />
        ) : null}

        <section className="panel" aria-labelledby="meta-heading">
          <h2 id="meta-heading">Build details</h2>
          <dl className="kv">
            <dt>Revision</dt>
            <dd>{build.revision}</dd>
            <dt>Created</dt>
            <dd>
              <time dateTime={build.created_at}>{formatDate(build.created_at)}</time>
            </dd>
            <dt>Updated</dt>
            <dd>
              <time dateTime={build.updated_at}>{formatDate(build.updated_at)}</time>
            </dd>
            <dt>Lifecycle</dt>
            <dd>{humanize(build.lifecycle)}</dd>
            <dt>Owner</dt>
            <dd className="mono">{build.owner_ref}</dd>
            <dt>Catalog snapshot</dt>
            <dd className="mono">{build.locks.catalog_snapshot_id}</dd>
            <dt>Ruleset</dt>
            <dd className="mono">
              {build.locks.ruleset_id}@{build.locks.ruleset_version}
            </dd>
            <dt>Dependency graph</dt>
            <dd className="mono">
              {build.locks.dependency_graph_id} r{build.locks.dependency_graph_revision}
            </dd>
            <dt>Pricebook</dt>
            <dd className="mono">{build.locks.pricebook_id ?? 'Not specified'}</dd>
          </dl>
        </section>

        <SelectionsSection build={build} byId={byId} />

        <section className="panel" aria-labelledby="objectives-heading">
          <h2 id="objectives-heading">Objectives and policy</h2>
          <div className="summary-split">
            <div>
              <h3>Objectives</h3>
              <KeyValues
                entries={Object.entries(build.objectives).map(([k, v]) => [
                  humanize(k),
                  k === 'monthly_budget_amount' && typeof v === 'string'
                    ? formatMoney(v, build.objectives.currency)
                    : formatValue(v),
                ])}
              />
            </div>
            <div>
              <h3>Policy</h3>
              {build.policy && Object.keys(build.policy).length ? (
                <KeyValues
                  entries={Object.entries(build.policy).map(([k, v]) => [
                    humanize(k),
                    formatValue(v),
                  ])}
                />
              ) : (
                <p>No policy set.</p>
              )}
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="findings-heading">
          <h2 id="findings-heading">Findings</h2>
          {!report ? (
            build.selections.length ? (
              <Loading label={`Evaluating revision ${build.revision}…`} />
            ) : (
              <EmptyState
                title="Nothing to evaluate yet"
                action={
                  <Link className="btn btn-primary btn-small" to="/builder">
                    Open the builder
                  </Link>
                }
              >
                Choose at least one component and the published rules will run.
              </EmptyState>
            )
          ) : (
            <>
              <p>
                {report.findings.length} rule outcome{report.findings.length === 1 ? '' : 's'} for
                revision {report.build_revision}: {report.summary.passed} pass,{' '}
                {report.summary.failed} fail, {report.summary.unknown} unknown,{' '}
                {report.summary.skipped} not applicable. Readiness:{' '}
                {humanize(report.deployment_readiness)}.
              </p>
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
                        <strong>{f.letter}.</strong> {f.message} {f.remediation}{' '}
                        <OutcomeBadge outcome={f.outcome} />
                      </span>
                    </div>
                  ))
                )}
              </div>
              {report.findings.length ? (
                <details className="summary-details">
                  <summary>All rule outcomes ({report.findings.length})</summary>
                  <div
                    className="table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="Scrollable table"
                  >
                    <table className="data-table">
                      <caption className="sr-only">Every rule outcome for this revision</caption>
                      <thead>
                        <tr>
                          <th scope="col">Rule</th>
                          <th scope="col">Outcome</th>
                          <th scope="col">Severity</th>
                          <th scope="col">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.findings.map((f) => (
                          <tr key={f.rule_id}>
                            <th scope="row" className="mono">
                              {f.rule_id}
                            </th>
                            <td>
                              <OutcomeBadge outcome={f.outcome} />
                            </td>
                            <td>{humanize(f.severity)}</td>
                            <td>
                              {f.message}
                              {f.remediation ? (
                                <span className="muted"> {f.remediation}</span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}
            </>
          )}
        </section>

        <section id="cost" className="panel" aria-labelledby="cost-heading">
          <h2 id="cost-heading">Cost breakdown</h2>
          {analysis.costQuery.isError ? (
            <ErrorState
              title="Cost estimate unavailable"
              error={analysis.costQuery.error}
              onRetry={() => void analysis.costQuery.refetch()}
            />
          ) : analysis.costIsCurrent && analysis.cost ? (
            <CostBreakdown cost={analysis.cost} build={build} byId={byId} />
          ) : (
            <Loading label={`Estimating cost for revision ${build.revision}…`} />
          )}
        </section>

        <div className="summary-split">
          <section className="panel" aria-labelledby="capacity-heading">
            <h2 id="capacity-heading">Capacity evidence</h2>
            {!resources ? (
              <Loading label="Checking capacity evidence…" />
            ) : resources.status === 'available' ? (
              <>
                <p>Estimator evidence for revision {resources.estimate.build_revision}:</p>
                <ul>
                  {resources.estimate.estimates.map((e, i) => (
                    <li key={i}>
                      <strong>{humanize(e.metric.split('.').at(-1) ?? e.metric)}:</strong> {e.value}{' '}
                      {e.unit}{' '}
                      <span className="dim">
                        ({humanize(e.confidence)}, {e.estimator_id}@{e.estimator_version})
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>{resources.reason}</p>
            )}
            <p className="dim">
              Without calibrated capacity evidence, memory and throughput checks stay unknown rather
              than passing.
            </p>
          </section>

          <section className="panel" aria-labelledby="freshness-heading">
            <h2 id="freshness-heading">Evidence dates</h2>
            <p>
              Catalog {catalog.data.id} captured{' '}
              <time dateTime={staleness.catalog.checkedAt}>
                {staleness.catalog.checkedAt.slice(0, 10)}
              </time>
              . Capture date does not establish currentness or independent verification.
            </p>
            {staleness.snapshotMismatch ? (
              <p className="severity severity-warning">
                This build is locked to snapshot {build.locks.catalog_snapshot_id}; this site has{' '}
                {catalog.data.id}. A different snapshot alone does not invalidate this build.
              </p>
            ) : null}
            {stalePicks.length ? (
              <>
                <p className="severity severity-warning">
                  These selections no longer match the catalog:
                </p>
                <ul>
                  {staleness.missingSelectionIds.map((id) => (
                    <li key={id}>{selectionLabel(build, byId, id)} — not in this catalog</li>
                  ))}
                  {staleness.driftedSelectionIds.map((id) => (
                    <li key={id}>{selectionLabel(build, byId, id)} — catalog version changed</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Every selection matches its pinned catalog version.</p>
            )}
          </section>
        </div>

        <section className="panel" aria-labelledby="history-heading">
          <h2 id="history-heading">Revision history</h2>
          <ol className="summary-history">
            {[...draft.changes].reverse().map((c) => (
              <li key={c.revision}>
                <span className="mono">r{c.revision}</span>
                <span>{c.summary}</span>
                <time className="dim" dateTime={c.at}>
                  {formatDate(c.at)}
                </time>
              </li>
            ))}
          </ol>
          {draft.revisions.length >= 2 ? (
            <p className="no-print">
              <Link className="text-link" to="/compare?mode=builds">
                Compare two revisions
              </Link>
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function KeyValues({ entries }: { entries: [string, string][] }) {
  return (
    <dl className="kv">
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function settingsSummary(settings: object, kind: ComponentKind): string {
  const entries = Object.entries(settings as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  if (!entries.length) return 'Defaults';
  return entries
    .map(
      ([k, v]) =>
        `${humanize(k)}: ${formatValue(
          v,
          settingsFields(kind).find((f) => f.key === k),
        )}`,
    )
    .join(' · ');
}

function SelectionsSection({
  build,
  byId,
}: {
  build: BuildSnapshot;
  byId: ReadonlyMap<string, CatalogItem>;
}) {
  return (
    <section className="panel" aria-labelledby="selections-heading">
      <h2 id="selections-heading">Selections</h2>
      {build.selections.length === 0 ? (
        <EmptyState
          title="No components selected yet"
          action={
            <Link className="btn btn-primary btn-small" to="/builder">
              Open the builder
            </Link>
          }
        >
          Start with T0: what should the system do, and how will it be deployed?
        </EmptyState>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="data-table">
            <caption className="sr-only">Selected components grouped by tier</caption>
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col">Selection</th>
                <th scope="col">Role</th>
                <th scope="col">Enabled</th>
                <th scope="col">Key settings</th>
              </tr>
            </thead>
            {TIERS.map((tier) => {
              const rows = kindsInTier(tier).flatMap((k) =>
                build.selections.filter((s) => s.kind === k.kind),
              );
              if (!rows.length) return null;
              return (
                <tbody key={tier}>
                  <tr>
                    <th scope="rowgroup" colSpan={5}>
                      {tier} — {TIER_LABELS[tier]}
                    </th>
                  </tr>
                  {rows.map((s) => {
                    const item = byId.get(s.catalog_item_id);
                    return (
                      <tr key={s.id}>
                        <th scope="row">{KIND_LABELS[s.kind]}</th>
                        <td>
                          {item ? (
                            <span>
                              <Link className="text-link" to={itemPath(item)}>
                                {item.name}
                              </Link>
                              {(item.tags ?? []).includes('synthetic') ? <SyntheticBadge /> : null}
                            </span>
                          ) : (
                            <span>
                              <span className="mono">{s.catalog_item_id}</span>{' '}
                              <strong className="severity severity-error">
                                Not in this catalog
                              </strong>
                            </span>
                          )}
                          <span className="dim">v{s.catalog_item_version}</span>
                        </td>
                        <td>{s.role}</td>
                        <td>{s.enabled ? 'Yes' : 'No (disabled)'}</td>
                        <td className="dim">{settingsSummary(s.settings, s.kind)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </section>
  );
}

function CostBreakdown({
  cost,
  build,
  byId,
}: {
  cost: CostEstimate;
  build: BuildSnapshot;
  byId: ReadonlyMap<string, CatalogItem>;
}) {
  const headline = costHeadline(cost);
  const money = (m: Money) => formatMoney(m.amount, m.currency);
  const totals: [string, Money][] = [
    ['Subtotal', cost.subtotal],
    ['Tax', cost.tax],
    [cost.coverage === 'complete' ? 'Total' : 'Total of priced items (lower bound)', cost.total],
  ];
  return (
    <>
      <p className="summary-headline" data-testid="cost-headline">
        {headline.text}
      </p>
      <p>
        {headline.detail} Coverage: <strong>{humanize(cost.coverage)}</strong>. Pricebook{' '}
        {cost.pricebook_id}, {cost.period_days}-day period, estimated{' '}
        <time dateTime={cost.estimated_at}>{formatDate(cost.estimated_at)}</time>.
      </p>
      {cost.line_items.length ? (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="data-table">
            <caption>Synthetic demo prices — not a quote</caption>
            <thead>
              <tr>
                <th scope="col">Selection</th>
                <th scope="col">Meter</th>
                <th scope="col">Quantity</th>
                <th scope="col">Unit price</th>
                <th scope="col">Amount</th>
                <th scope="col">Method</th>
                <th scope="col">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {cost.line_items.map((li) => (
                <tr key={li.id}>
                  <th scope="row">
                    {selectionLabel(build, byId, li.selection_id)}
                    {li.assumptions.length ? (
                      <ul className="summary-assumptions">
                        {li.assumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    ) : null}
                  </th>
                  <td>{humanize(li.meter)}</td>
                  <td>{li.quantity}</td>
                  <td>{money(li.unit_price)}</td>
                  <td>{money(li.amount)}</td>
                  <td>{humanize(li.method)}</td>
                  <td>{humanize(li.confidence)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {totals.map(([label, m]) => (
                <tr key={label}>
                  <th scope="row" colSpan={4}>
                    {label}
                  </th>
                  <td>
                    <strong>{money(m)}</strong>
                  </td>
                  <td colSpan={2} />
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      ) : (
        <p>No line items could be priced.</p>
      )}
      {cost.coverage !== 'complete' ? (
        <p className="severity severity-warning">
          Estimate: <strong>{headline.text}</strong>. Coverage is {cost.coverage}, so the true total
          can be higher than the priced items — unpriced components are not zero cost.
        </p>
      ) : null}
      {cost.unpriced_selection_ids.length ? (
        <>
          <h3>Unpriced selections ({cost.unpriced_selection_ids.length})</h3>
          <ul>
            {cost.unpriced_selection_ids.map((id) => (
              <li key={id}>{selectionLabel(build, byId, id)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {cost.warnings.length ? (
        <>
          <h3>Warnings ({cost.warnings.length})</h3>
          <ul>
            {cost.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
