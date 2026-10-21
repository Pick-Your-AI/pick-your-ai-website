/*
 * Shared primitives for the "parts list" pages (builder, catalog, compare).
 *
 * These follow the interaction patterns recorded in docs/research/pcpartpicker-ux-notes.md:
 * fixed category rows, a compatibility filter on by default with separate incompatible/unknown
 * buckets, dense sortable tables, lettered findings, and aligned comparison rows. The visual layer
 * is src/styles/dense.css.
 *
 * Status is always an icon AND a word — never colour alone — and `unknown` is never styled as a
 * pass (AGENTS.md, "Unknown is not pass").
 */
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CatalogItem, CostEstimate, EvaluationReport } from '../contracts';
import { Icon, type IconName } from './icon';
import { costShort } from '../lib/item-cost';

// --------------------------------------------------------------------------------- chips -----

export type Verdict = 'compatible' | 'incompatible' | 'unknown';

const VERDICT: Record<Verdict, { label: string; cls: string; ico: IconName }> = {
  compatible: { label: 'Compatible', cls: 'pchip-pass', ico: 'check' },
  incompatible: { label: 'Incompatible', cls: 'pchip-fail', ico: 'x-circle' },
  unknown: { label: 'Unknown', cls: 'pchip-unknown', ico: 'alert' },
};

export function CompatChip({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict];
  return (
    <span className={`pchip ${v.cls}`}>
      <Icon name={v.ico} />
      {v.label}
    </span>
  );
}

/** Contract billing class as a short, non-monetary label. */
export function BillingChip({ item }: { item: CatalogItem }) {
  const label: Record<CatalogItem['billing_class'], string> = {
    free: 'Free',
    included: 'Included',
    metered: 'Metered',
    unknown: 'Unknown billing',
  };
  const cls =
    item.billing_class === 'unknown'
      ? 'pchip pchip-unknown'
      : item.billing_class === 'metered'
        ? 'pchip'
        : 'pchip pchip-pass';
  return <span className={cls}>{label[item.billing_class]}</span>;
}

// --------------------------------------------------------------------------------- head ------

export function PartsHead({
  crumbs,
  title,
  description,
  actions,
  tabs,
}: {
  crumbs?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <>
      <div className="parts-head">
        <div>
          {crumbs ? <div className="crumbs">{crumbs}</div> : null}
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="parts-head-actions">{actions}</div> : null}
      </div>
      {tabs ? <div className="parts-tabs">{tabs}</div> : null}
    </>
  );
}

// --------------------------------------------------------------------------------- sort ------

export type SortDir = 'asc' | 'desc';

export function SortCaret({ dir }: { dir: SortDir | null }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="currentColor"
    >
      <path d="M5 1 9 6H1z" opacity={dir === 'asc' ? 1 : 0.35} />
      <path d="M5 9 1 4h8z" opacity={dir === 'desc' ? 1 : 0.35} />
    </svg>
  );
}

export function SortHeader({
  label,
  sortKey,
  sort,
  dir,
  onSort,
  numeric,
}: {
  label: string;
  sortKey: string;
  sort: string;
  dir: SortDir;
  onSort: (key: string) => void;
  numeric?: boolean;
}) {
  const active = sort === sortKey;
  return (
    <th
      scope="col"
      className={numeric ? 'num' : undefined}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={numeric ? 'pt-sort num' : 'pt-sort'}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <SortCaret dir={active ? dir : null} />
      </button>
    </th>
  );
}

// --------------------------------------------------------------------------------- status ----

export function StatusStrip({
  outcome,
  headline,
  detail,
  stats,
}: {
  outcome: 'pass' | 'fail' | 'unknown' | 'none';
  headline: string;
  detail?: string;
  stats: { label: string; value: string; unknown?: boolean }[];
}) {
  const cls =
    outcome === 'fail'
      ? 'pstatus-main pstatus-fail'
      : outcome === 'unknown'
        ? 'pstatus-main pstatus-unknown'
        : outcome === 'pass'
          ? 'pstatus-main pstatus-pass'
          : 'pstatus-main pstatus-neutral';
  const ico: IconName =
    outcome === 'fail'
      ? 'x-circle'
      : outcome === 'unknown'
        ? 'alert'
        : outcome === 'pass'
          ? 'check-circle'
          : 'info';
  return (
    <div className="pstatus" data-testid="overall-status">
      <div className={cls}>
        <Icon name={ico} />
        <span>
          {headline}
          {detail ? (
            <>
              {' '}
              <small>{detail}</small>
            </>
          ) : null}
        </span>
      </div>
      {stats.map((s) => (
        <div className="pstat" key={s.label}>
          <span className="pstat-label">{s.label}</span>
          <span className={s.unknown ? 'pstat-value is-unknown' : 'pstat-value'}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------------- rail ------

export function Box({
  title,
  action,
  children,
  tight,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  tight?: boolean;
}) {
  return (
    <section className="pbox">
      <div className="pbox-head">
        <span>{title}</span>
        {action}
      </div>
      <div className={tight ? 'pbox-body tight' : 'pbox-body'}>{children}</div>
    </section>
  );
}

/** The build context kept visible while browsing the catalog (research §4.2). */
export function MiniBuild({
  selected,
  required,
  outcome,
  cost,
  conflicts,
  unknown,
  incomplete,
}: {
  selected: number;
  required: { done: number; total: number };
  outcome: 'pass' | 'fail' | 'unknown' | 'none';
  cost: CostEstimate | undefined;
  conflicts: number;
  unknown: number;
  /** Presence-only incompleteness (#294): a missing required pick is not an incompatibility. */
  incomplete?: { chosen: number; total: number; remediation: string } | undefined;
}) {
  // An empty stack has no cost yet — `$0.00` would read as a measured zero.
  const total = costShort(selected === 0 ? undefined : cost);
  return (
    <Box title="Your stack">
      <div className="pbox-row">
        <span>Components</span>
        <strong>{selected}</strong>
      </div>
      <div className="pbox-row">
        <span>Required</span>
        <strong>
          {required.done}/{required.total}
        </strong>
      </div>
      <div className="pbox-row">
        <span>Conflicts</span>
        <strong>{conflicts}</strong>
      </div>
      <div className="pbox-row">
        <span>Unknown checks</span>
        <strong>{unknown}</strong>
      </div>
      <div className="pbox-row total">
        <span>Est. {cost?.period_days ?? 30}-day cost</span>
        <strong title={total.note}>{total.text}</strong>
      </div>
      {/*
        The status line grows from one line to three once an evaluation lands, which used to push the
        whole table down by ~47 px on mobile (CLS 0.066, the largest layout shift on the parts routes).
        Reserving the taller box keeps the row count stable through that transition.
      */}
      <p className="pbox-note pbox-note-reserved" data-testid="overall-status">
        {incomplete
          ? `Incomplete — ${incomplete.chosen} of ${incomplete.total} required choices made. ${incomplete.remediation} Provisional inference from presence rules; the contract finding is unchanged.`
          : outcome === 'fail'
            ? 'Failing checks block this configuration.'
            : outcome === 'unknown'
              ? 'Some checks cannot be decided yet.'
              : outcome === 'pass'
                ? 'No published rule fails for this revision.'
                : 'Not evaluated yet.'}{' '}
        Estimates are synthetic demo data, not quotes.
      </p>
      <div style={{ padding: '0 10px 10px' }}>
        <Link className="pbtn" to="/builder" style={{ width: '100%' }}>
          <Icon name="layers" /> Open builder
        </Link>
      </div>
    </Box>
  );
}

// ------------------------------------------------------------------- compatibility filter ----

export interface Bucket {
  key: Verdict;
  count: number;
}

/**
 * Compatibility filter, on by default, with `unknown` as its own bucket (research §4.1).
 * Implemented as checkboxes so a keyboard user can pick any combination; the summary line states
 * how many rows are hidden.
 */
export function CompatFilter({
  buckets,
  value,
  onChange,
  total,
}: {
  buckets: Bucket[];
  value: Verdict[];
  onChange: (next: Verdict[]) => void;
  total: number;
}) {
  const toggle = (key: Verdict) => {
    const next = value.includes(key) ? value.filter((v) => v !== key) : [...value, key];
    onChange(next.length ? next : [key]);
  };
  const shown = buckets.filter((b) => value.includes(b.key)).reduce((n, b) => n + b.count, 0);
  return (
    <Box title="Compatibility" tight>
      <div className="pfacet-body" style={{ paddingTop: 8 }}>
        {buckets.map((b) => {
          const v = VERDICT[b.key];
          return (
            <label key={b.key} className={b.count === 0 ? 'popt is-zero' : 'popt'}>
              <input
                type="checkbox"
                checked={value.includes(b.key)}
                onChange={() => toggle(b.key)}
              />
              <span className={`pchip ${v.cls}`}>
                <Icon name={v.ico} />
                {v.label}
              </span>
              <span className="popt-count">{b.count}</span>
            </label>
          );
        })}
      </div>
      <p className="pbox-note" aria-live="polite">
        Showing {shown} of {total}. Unknown is never counted as compatible.
      </p>
    </Box>
  );
}

/** Collapsible facet group, matching the research's "filter groups with Show more". */
export function Facet({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="pfacet">
      <button
        type="button"
        className="pfacet-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {title}
        <Icon className={open ? 'facet-caret is-open' : 'facet-caret'} name="arrow-right" />
      </button>
      {open ? (
        <div className="pfacet-body" id={id}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface ActiveFilter {
  key: string;
  label: string;
  value: string;
}

export function ActiveFilters({
  filters,
  onRemove,
  onClear,
}: {
  filters: ActiveFilter[];
  onRemove: (key: string) => void;
  onClear: () => void;
}) {
  if (!filters.length) return null;
  return (
    <div className="pchips">
      <span className="pchips-label">Filtered by</span>
      {filters.map((f) => (
        <span className="pchip-x" key={f.key}>
          <span>
            {f.label}: <strong>{f.value}</strong>
          </span>
          <button
            type="button"
            aria-label={`Remove filter ${f.label}: ${f.value}`}
            onClick={() => onRemove(f.key)}
          >
            <Icon name="x" />
          </button>
        </span>
      ))}
      <button type="button" className="pbtn pbtn-ghost" onClick={onClear}>
        Clear all
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------------- findings ------

/** Lettered, severity-labelled findings (research §3.5). */
export function Findings({
  report,
  lettered,
}: {
  report: EvaluationReport | undefined;
  lettered: { rule_id: string; letter: string }[];
}) {
  const letters = new Map(lettered.map((l) => [l.rule_id, l.letter]));
  const rows =
    report?.findings.filter((f) => f.outcome === 'fail' || f.outcome === 'unknown') ?? [];
  if (!report) return null;
  if (!rows.length)
    return (
      <div className="pnotice">
        <Icon name="check-circle" />
        <span>
          <strong>No failing or unknown checks.</strong> {report.summary.passed} rules pass and{' '}
          {report.summary.skipped} do not apply to this configuration.
        </span>
      </div>
    );
  return (
    <div className="pfindings">
      {rows.map((f) => {
        const letter = letters.get(f.rule_id) ?? '·';
        return (
          <div className={`pfinding pfinding-${f.outcome}`} key={`${f.rule_id}-${f.code}`}>
            <span className="pfinding-letter" aria-hidden="true">
              {letter}
            </span>
            <div className="pfinding-body">
              <strong>{f.message}</strong>
              <p>{f.remediation}</p>
              <p className="dim mono" style={{ fontSize: 10 }}>
                {f.rule_id}
              </p>
            </div>
            <div className="pfinding-meta">
              <span
                className={
                  f.severity === 'error'
                    ? 'pchip pchip-fail'
                    : f.severity === 'warning'
                      ? 'pchip pchip-unknown'
                      : 'pchip'
                }
              >
                {f.severity === 'error' ? 'Error' : f.severity === 'warning' ? 'Warning' : 'Info'}
              </span>
              <span className={f.outcome === 'fail' ? 'pchip pchip-fail' : 'pchip pchip-unknown'}>
                {f.outcome === 'fail' ? 'Fail' : 'Unknown'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Explicit "what the engine did not evaluate" note (research §3.6). */
export function NotEvaluated({ report }: { report: EvaluationReport | undefined }) {
  if (!report) return null;
  const skipped = report.findings.filter((f) => f.outcome === 'skipped').length;
  const unknown = report.findings.filter((f) => f.outcome === 'unknown').length;
  return (
    <div className="pnotice">
      <Icon name="info" />
      <span>
        <strong>What was not checked.</strong> {skipped} rule
        {skipped === 1 ? '' : 's'} do not apply to this configuration, and {unknown} could not be
        decided from the recorded evidence. Real-world performance, answer quality and vendor
        support are outside this rule set.
      </span>
    </div>
  );
}

export function CompareTray({
  count,
  onClear,
  onCompare,
  max,
}: {
  count: number;
  onClear: () => void;
  onCompare: () => void;
  max: number;
}) {
  if (!count) return null;
  return (
    <div className="ptray" role="region" aria-label="Comparison selection">
      <span className="ptray-count">
        {count} of {max} selected
      </span>
      <button type="button" className="pbtn pbtn-ghost" onClick={onClear}>
        Clear
      </button>
      <button type="button" className="pbtn pbtn-primary" onClick={onCompare}>
        Compare <Icon name="arrow-right" />
      </button>
    </div>
  );
}

/** Right-aligned money with an explicit "unknown" fallback (research §8.3). */
export function Money({
  amount,
  currency = 'USD',
  unknownLabel = 'Unknown',
  approximate,
}: {
  amount: string | null;
  currency?: string;
  unknownLabel?: string;
  approximate?: boolean;
}) {
  if (amount === null) return <span className="dim">{unknownLabel}</span>;
  const n = Number(amount);
  if (!Number.isFinite(n)) return <span className="dim">{unknownLabel}</span>;
  const text = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
  return (
    <span className="cmp-num">
      {approximate ? '≥ ' : ''}
      {text}
    </span>
  );
}
