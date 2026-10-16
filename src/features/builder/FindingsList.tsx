import { useMemo, useState } from 'react';
import type { BuildSnapshot, CatalogItem, EvaluationReport } from '../../contracts';
import { KIND_LABELS } from '../../contracts';
import { OutcomeBadge, SeverityLabel } from '../../components/status';
import { flaggedFindings } from './analysis';

export function selectionLabel(
  build: BuildSnapshot,
  byId: ReadonlyMap<string, CatalogItem>,
  selectionId: string,
) {
  const s = build.selections.find((x) => x.id === selectionId);
  if (!s) return selectionId;
  const item = byId.get(s.catalog_item_id);
  return `${KIND_LABELS[s.kind]}: ${item?.name ?? s.catalog_item_id}${s.enabled ? '' : ' (disabled)'}`;
}

export function FindingsList({
  report,
  build,
  byId,
  ruleTitles,
}: {
  report: EvaluationReport | undefined;
  build: BuildSnapshot;
  byId: ReadonlyMap<string, CatalogItem>;
  ruleTitles?: ReadonlyMap<string, string>;
}) {
  const flagged = useMemo(() => flaggedFindings(report), [report]);
  const [showAll, setShowAll] = useState(false);
  if (!report) return null;
  const others = report.findings.filter((f) => f.outcome === 'pass' || f.outcome === 'skipped');
  return (
    <section aria-labelledby="findings-heading" className="card p-4">
      <h2 id="findings-heading" className="text-lg font-semibold">
        Compatibility findings
      </h2>
      <p className="muted mt-1 text-sm">
        Ruleset{' '}
        <code className="font-mono">
          {report.ruleset_id}@{report.ruleset_version}
        </code>{' '}
        evaluated against revision {report.build_revision}. A pass means the published rules found
        no problem for this revision; it is not proof of quality or production readiness.
      </p>
      {flagged.length === 0 ? (
        <p className="mt-3 text-sm">No failing or unknown checks.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {flagged.map((f) => (
            <li
              key={f.rule_id}
              className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded bg-slate-900 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900"
                  aria-label={`Finding ${f.letter}`}
                >
                  {f.letter}
                </span>
                <OutcomeBadge outcome={f.outcome} />
                <SeverityLabel severity={f.severity} />
                <code className="muted font-mono text-xs">{f.rule_id}</code>
              </div>
              <p className="mt-2 font-medium">{f.message}</p>
              {f.outcome === 'unknown' ? (
                <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
                  Not enough information to decide — this is <strong>not</strong> treated as
                  compatible.
                </p>
              ) : null}
              {f.remediation ? (
                <p className="mt-1 text-sm">
                  <span className="font-semibold">Suggested fix:</span> {f.remediation}
                </p>
              ) : null}
              {f.selection_ids.length ? (
                <p className="muted mt-1 text-sm">
                  Affects: {f.selection_ids.map((id) => selectionLabel(build, byId, id)).join('; ')}
                </p>
              ) : null}
              {ruleTitles?.get(f.rule_id) ? (
                <p className="muted mt-1 text-xs">{ruleTitles.get(f.rule_id)}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <details
        className="mt-4"
        open={showAll}
        onToggle={(e) => setShowAll((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium">
          Passed and skipped checks ({report.summary.passed} passed, {report.summary.skipped}{' '}
          skipped)
        </summary>
        <p className="muted mt-2 text-xs">
          Skipped means the rule&apos;s condition does not apply to this build (for example, a RAG
          rule when no RAG pipeline is selected). Skipped is not an assertion of compatibility.
        </p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {others.map((f) => (
            <li key={f.rule_id} className="flex items-center gap-2">
              <OutcomeBadge outcome={f.outcome} />
              <code className="font-mono text-xs break-all">{f.rule_id}</code>
            </li>
          ))}
        </ul>
      </details>
      <p className="muted mt-4 border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
        <strong>Not evaluated by these rules:</strong> measured model quality, latency and
        throughput, real vendor pricing and availability, licence terms beyond catalog metadata,
        security reviews, and runtime memory without calibrated capacity evidence.
      </p>
    </section>
  );
}
