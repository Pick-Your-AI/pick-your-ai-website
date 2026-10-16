/*
 * Component selection for one kind: search, schema-derived facet filters, sortable key columns,
 * compatibility buckets (compatible / unknown / incompatible — unknown is its own bucket), compare
 * checkboxes and add/replace. Filter and sort state live in the URL query string.
 */
import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { CatalogItem, ComponentKind } from '../../contracts';
import {
  KIND_LABELS,
  TIER_LABELS,
  isComponentKind,
  kindDef,
  kindFromSlug,
  labelInSentence,
  withArticle,
} from '../../contracts';
import { addOrReplace, replaceSelection } from '../../domain/build';
import { useBuilder } from '../../app/builder-context';
import { useCatalog, useCompatibleOptions, useRuleset } from '../../app/queries';
import { EmptyState, ErrorState, Loading, Notice } from '../../components/feedback';
import { PageHeader } from '../../components/layout';
import { SyntheticBadge, VerdictBadge, type VerdictValue } from '../../components/status';
import { KEY_FIELDS, idToSlug, itemPath, specValue } from '../../lib/catalog-view';
import { type FieldDef, formatValue, specFields } from '../../lib/schema-fields';
import NotFoundPage from '../../pages/NotFoundPage';

type Bucket = 'compatible' | 'with-unknown' | 'all';
const MAX_COMPARE = 4;

function useFacets(kind: ComponentKind | null) {
  return useMemo(() => {
    if (!kind) return [] as FieldDef[];
    return specFields(kind).filter(
      (f) => !f.isRef && ['enum', 'enum-array', 'boolean', 'integer', 'number'].includes(f.type),
    );
  }, [kind]);
}

function matchesFacet(item: CatalogItem, f: FieldDef, raw: string): boolean {
  const v = specValue(item, f.key);
  if (f.type === 'enum') return raw.split(',').includes(String(v));
  if (f.type === 'enum-array') return Array.isArray(v) && raw.split(',').some((x) => v.includes(x));
  if (f.type === 'boolean') return raw === 'yes' ? v === true : v !== true;
  const min = Number(raw);
  return typeof v === 'number' && v >= min;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1; // unknown values sort last
  if (b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return formatValue(a).localeCompare(formatValue(b));
}

export default function SelectionPage() {
  const { kindSlug = '' } = useParams();
  const raw = kindFromSlug(kindSlug);
  const kind = isComponentKind(raw) ? raw : null;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { draft, apply } = useBuilder();
  const catalog = useCatalog();
  const ruleset = useRuleset();
  const facets = useFacets(kind);
  const build = draft?.build;
  const replaceId = params.get('replace');
  const adding = params.get('add') === '1';
  const replacing = build?.selections.find((s) => s.id === replaceId);
  const current = kind
    ? build?.selections.find((s) => s.kind === kind && s.role === 'primary')
    : undefined;
  const role = replacing?.role ?? (adding ? 'candidate' : 'primary');
  const options = useCompatibleOptions(build, (kind ?? 'workload') as ComponentKind, role);
  const ruleMessages = useMemo(
    () => new Map((ruleset.data?.rules ?? []).map((r) => [r.id, r.message])),
    [ruleset.data],
  );

  const q = params.get('q') ?? '';
  const sort = params.get('sort') ?? 'name';
  const dir = params.get('dir') === 'desc' ? -1 : 1;
  const bucket = (params.get('show') as Bucket | null) ?? 'with-unknown';
  const compare = (params.get('cmp') ?? '').split(',').filter(Boolean);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const verdicts = useMemo(() => {
    const m = new Map<string, { verdict: VerdictValue; rule_ids: string[] }>();
    for (const o of options.data ?? []) m.set(o.catalog_item_id, o);
    return m;
  }, [options.data]);

  const items = useMemo(
    () => (kind ? (catalog.data?.items ?? []).filter((i) => i.kind === kind) : []),
    [catalog.data, kind],
  );
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((i) => {
      if (term && ![i.name, i.description ?? '', i.id].some((s) => s.toLowerCase().includes(term)))
        return false;
      for (const f of facets) {
        const v = params.get(`f.${f.key}`);
        if (v && !matchesFacet(i, f, v)) return false;
      }
      return true;
    });
  }, [items, q, facets, params]);

  const counts = useMemo(() => {
    const c = { compatible: 0, unknown: 0, incompatible: 0 };
    for (const i of filtered) {
      const v = verdicts.get(i.id)?.verdict;
      if (v) c[v]++;
    }
    return c;
  }, [filtered, verdicts]);

  const visible = useMemo(() => {
    const keep = filtered.filter((i) => {
      const v = verdicts.get(i.id)?.verdict;
      if (!v || bucket === 'all') return true;
      if (bucket === 'compatible') return v === 'compatible';
      return v !== 'incompatible';
    });
    return [...keep].sort((a, b) => {
      if (sort === 'name') return dir * a.name.localeCompare(b.name);
      return dir * compareValues(specValue(a, sort), specValue(b, sort));
    });
  }, [filtered, verdicts, bucket, sort, dir]);

  if (!kind) return <NotFoundPage />;
  const label = KIND_LABELS[kind];
  const def = kindDef(kind);
  const keyFields = KEY_FIELDS[kind];
  const activeFacets = facets.filter((f) => params.get(`f.${f.key}`));

  const choose = (item: CatalogItem) => {
    if (!build) return;
    if (replacing) {
      apply(
        (b) => replaceSelection(b, replacing.id, item, catalog.byId),
        `Replaced ${label} with ${item.name}`,
        [kind],
      );
    } else {
      apply(
        (b) => addOrReplace(b, item, catalog.byId, { additional: adding }),
        `${current && !adding ? 'Replaced' : 'Added'} ${label}: ${item.name}`,
        [kind],
      );
    }
    navigate('/builder');
  };

  const toggleCompare = (id: string) => {
    const next = compare.includes(id)
      ? compare.filter((x) => x !== id)
      : [...compare, id].slice(0, MAX_COMPARE);
    update({ cmp: next.join(',') || null });
  };

  const sortHeader = (key: string, text: string) => {
    const active = sort === key;
    return (
      <th scope="col" aria-sort={active ? (dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          className="inline-flex items-center gap-1 font-semibold uppercase"
          onClick={() => update({ sort: key, dir: active && dir === 1 ? 'desc' : null })}
        >
          {text}
          <span aria-hidden="true">{active ? (dir === 1 ? '▲' : '▼') : '↕'}</span>
        </button>
      </th>
    );
  };

  const actionLabel = (item: CatalogItem) => {
    const selected = replacing
      ? replacing.catalog_item_id === item.id
      : current?.catalog_item_id === item.id && !adding;
    if (selected) return { text: 'Selected', disabled: true };
    if (replacing || (current && !adding && def.cardinality === 'one') || (current && !adding))
      return { text: 'Replace', disabled: false };
    return { text: 'Add', disabled: false };
  };

  const reasons = (id: string) => {
    const v = verdicts.get(id);
    if (!v || !v.rule_ids.length) return null;
    return (
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer">Why?</summary>
        <ul className="mt-1 list-disc pl-4">
          {v.rule_ids.map((r) => (
            <li key={r}>
              {ruleMessages.get(r) ?? r} <code className="muted font-mono">{r}</code>
            </li>
          ))}
        </ul>
      </details>
    );
  };

  return (
    <>
      <PageHeader
        eyebrow={`${def.tier} · ${TIER_LABELS[def.tier]}`}
        title={replacing ? `Replace ${labelInSentence(label)}` : `Choose ${withArticle(label)}`}
      >
        {def.notes}{' '}
        {def.cardinality === 'many'
          ? 'A build can include more than one.'
          : 'A build has at most one.'}
      </PageHeader>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[16rem_1fr]">
        <aside aria-label="Filters" className="grid content-start gap-4">
          <div className="card p-3 text-sm">
            <p className="font-semibold">Your stack</p>
            <p className="muted">
              {build?.selections.length ?? 0} components · revision {build?.revision ?? '—'}
            </p>
            {current ? (
              <p className="mt-1">
                Current {labelInSentence(label)}: {catalog.byId.get(current.catalog_item_id)?.name}
              </p>
            ) : null}
            <Link to="/builder" className="link mt-2 inline-block">
              Back to builder
            </Link>
          </div>
          <fieldset className="card p-3 text-sm">
            <legend className="px-1 font-semibold">Compatibility filter</legend>
            {(
              [
                ['compatible', `No rule failures only (${counts.compatible})`],
                ['with-unknown', `Include unknown (${counts.compatible + counts.unknown})`],
                ['all', `Show all, incl. incompatible (${filtered.length})`],
              ] as const
            ).map(([value, text]) => (
              <label key={value} className="mt-1 flex min-h-6 items-center gap-2">
                <input
                  type="radio"
                  name="bucket"
                  checked={bucket === value}
                  onChange={() => update({ show: value === 'with-unknown' ? null : value })}
                />
                {text}
              </label>
            ))}
            <p className="hint">
              Checks use the published rules against your current stack (revision{' '}
              {build?.revision ?? '—'}).
            </p>
          </fieldset>
          {facets.length ? (
            <div className="card grid gap-3 p-3 text-sm">
              <p className="font-semibold">Filter by specification</p>
              {facets.map((f) => {
                const value = params.get(`f.${f.key}`) ?? '';
                const id = `facet-${f.key}`;
                if (f.type === 'boolean') {
                  return (
                    <div key={f.key}>
                      <label htmlFor={id} className="label">
                        {f.label}
                      </label>
                      <select
                        id={id}
                        className="input"
                        value={value}
                        onChange={(e) => update({ [`f.${f.key}`]: e.target.value || null })}
                      >
                        <option value="">Any</option>
                        <option value="yes">Yes</option>
                        <option value="no">No / not specified</option>
                      </select>
                    </div>
                  );
                }
                if (f.type === 'integer' || f.type === 'number') {
                  return (
                    <div key={f.key}>
                      <label htmlFor={id} className="label">
                        {f.label} — at least
                      </label>
                      <input
                        id={id}
                        className="input"
                        inputMode="numeric"
                        value={value}
                        onChange={(e) =>
                          update({ [`f.${f.key}`]: e.target.value.replace(/[^0-9.]/g, '') || null })
                        }
                      />
                    </div>
                  );
                }
                const selected = value ? value.split(',') : [];
                const present = new Set(
                  items.flatMap((i) => {
                    const v = specValue(i, f.key);
                    return Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)];
                  }),
                );
                const opts = (f.options ?? []).filter((o) => present.has(o));
                if (!opts.length) return null;
                return (
                  <fieldset key={f.key}>
                    <legend className="label">{f.label}</legend>
                    {opts.map((o) => (
                      <label key={o} className="flex min-h-6 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected.includes(o)}
                          onChange={() => {
                            const next = selected.includes(o)
                              ? selected.filter((x) => x !== o)
                              : [...selected, o];
                            update({ [`f.${f.key}`]: next.join(',') || null });
                          }}
                        />
                        {o.replace(/_/g, ' ')}
                      </label>
                    ))}
                  </fieldset>
                );
              })}
            </div>
          ) : null}
        </aside>
        <div className="min-w-0">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-60 flex-1">
              <label htmlFor="sel-search" className="label">
                Search {labelInSentence(label)} records
              </label>
              <input
                id="sel-search"
                type="search"
                className="input"
                value={q}
                onChange={(e) => update({ q: e.target.value || null })}
              />
            </div>
          </div>
          <p className="mt-3 text-sm" aria-live="polite">
            Showing {visible.length} of {items.length}: {counts.compatible} with no rule failures ·{' '}
            {counts.unknown} unknown · {counts.incompatible} incompatible
            {bucket !== 'all' && counts.incompatible ? ' (hidden)' : ''}.
          </p>
          {activeFacets.length || q ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="muted">Filtered by:</span>
              {q ? (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => update({ q: null })}
                >
                  Search “{q}” <span aria-hidden="true">×</span>
                  <span className="sr-only">remove</span>
                </button>
              ) : null}
              {activeFacets.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => update({ [`f.${f.key}`]: null })}
                >
                  {f.label}: {params.get(`f.${f.key}`)?.replace(/_/g, ' ')}{' '}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">remove filter</span>
                </button>
              ))}
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() =>
                  update({
                    q: null,
                    ...Object.fromEntries(facets.map((f) => [`f.${f.key}`, null])),
                  })
                }
              >
                Clear all
              </button>
            </div>
          ) : null}
          {catalog.isPending || options.isPending ? (
            <Loading label="Checking compatibility…" />
          ) : null}
          {catalog.isError ? (
            <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
          ) : null}
          {options.isError ? (
            <ErrorState error={options.error} onRetry={() => void options.refetch()} />
          ) : null}
          {kind === 'deployment_mode' || kind === 'workload' ? null : !build?.selections.some(
              (s) => s.kind === 'deployment_mode',
            ) ? (
            <div className="mt-3">
              <Notice tone="warning" title="No deployment mode yet.">
                Many checks depend on the deployment mode, so most results will be Unknown until you
                choose one.
              </Notice>
            </div>
          ) : null}
          {!catalog.isPending && visible.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No matching records">
                {items.length === 0
                  ? 'This catalog snapshot has no records of this kind yet.'
                  : 'Try clearing filters or including incompatible results.'}
              </EmptyState>
            </div>
          ) : null}
          {visible.length ? (
            <>
              <div
                className="mt-4 hidden overflow-x-auto md:block"
                tabIndex={0}
                role="region"
                aria-label="Scrollable table"
              >
                <table className="data-table card">
                  <caption className="sr-only">
                    {label} records with compatibility against your current stack
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="sr-only">Compare</span>
                      </th>
                      {sortHeader('name', 'Name')}
                      {keyFields.map((k) =>
                        sortHeader(k, specFields(kind).find((f) => f.key === k)?.label ?? k),
                      )}
                      <th scope="col">Compatibility</th>
                      <th scope="col">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((i) => {
                      const a = actionLabel(i);
                      const v = verdicts.get(i.id);
                      return (
                        <tr key={i.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Compare ${i.name}`}
                              checked={compare.includes(i.id)}
                              disabled={!compare.includes(i.id) && compare.length >= MAX_COMPARE}
                              onChange={() => toggleCompare(i.id)}
                            />
                          </td>
                          <th scope="row" className="font-normal">
                            <Link className="link" to={itemPath(i)}>
                              {i.name}
                            </Link>
                            {i.tags?.includes('synthetic') ? (
                              <SyntheticBadge className="ml-1" />
                            ) : null}
                          </th>
                          {keyFields.map((k) => {
                            const value = specValue(i, k);
                            return (
                              <td
                                key={k}
                                className={value === undefined ? 'muted italic' : 'tabular'}
                              >
                                {formatValue(value)}
                              </td>
                            );
                          })}
                          <td>
                            {v ? (
                              <VerdictBadge verdict={v.verdict} />
                            ) : (
                              <span className="muted text-xs">Checking…</span>
                            )}
                            {reasons(i.id)}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              disabled={a.disabled || !build}
                              onClick={() => choose(i)}
                            >
                              {a.text}
                              <span className="sr-only"> {i.name}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="mt-4 grid gap-3 md:hidden">
                {visible.map((i) => {
                  const a = actionLabel(i);
                  const v = verdicts.get(i.id);
                  return (
                    <li key={i.id} className="card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <Link className="link" to={itemPath(i)}>
                          {i.name}
                        </Link>
                        {v ? <VerdictBadge verdict={v.verdict} /> : null}
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        {keyFields.map((k) => (
                          <div key={k}>
                            <dt className="muted">
                              {specFields(kind).find((f) => f.key === k)?.label ?? k}
                            </dt>
                            <dd>{formatValue(specValue(i, k))}</dd>
                          </div>
                        ))}
                      </dl>
                      {reasons(i.id)}
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          className="btn-primary flex-1"
                          disabled={a.disabled || !build}
                          onClick={() => choose(i)}
                        >
                          {a.text}
                          <span className="sr-only"> {i.name}</span>
                        </button>
                        <label className="btn-secondary">
                          <input
                            type="checkbox"
                            checked={compare.includes(i.id)}
                            disabled={!compare.includes(i.id) && compare.length >= MAX_COMPARE}
                            onChange={() => toggleCompare(i.id)}
                          />
                          Compare<span className="sr-only"> {i.name}</span>
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      </div>
      {compare.length ? (
        <div className="no-print sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
            <span className="text-sm">
              {compare.length} selected for comparison (max {MAX_COMPARE})
            </span>
            <Link
              to={`/compare?ids=${compare.map(idToSlug).join(',')}`}
              className={`btn-primary ${compare.length < 2 ? 'pointer-events-none opacity-60' : ''}`}
              aria-disabled={compare.length < 2}
            >
              Compare {compare.length}
            </Link>
            <button type="button" className="btn-ghost" onClick={() => update({ cmp: null })}>
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
