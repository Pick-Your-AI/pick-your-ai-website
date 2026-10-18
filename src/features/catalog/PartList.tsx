/*
 * Dense part list — the catalog's core screen.
 *
 * Follows the PCPartPicker category-selection pattern in docs/research/pcpartpicker-ux-notes.md §4:
 * a compatibility filter that is on by default with **separate** compatible / incompatible / unknown
 * buckets, a mini build summary in the rail, per-category spec columns, sortable headers with
 * `aria-sort`, active-filter chips, checkbox multi-select into a compare tray, and all of that state
 * in the URL so a filtered view is linkable.
 *
 * Two modes: `all` lists every kind grouped by layer (the /catalog index); `kind` lists one
 * component kind with its own spec columns (the /catalog/:kindSlug picker).
 */
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { CatalogItem, ComponentKind, Tier } from '../../contracts';
import {
  KINDS,
  KIND_LABELS,
  kindDef,
  kindsInTier,
  labelInSentence,
  withArticle,
} from '../../contracts';
import { buildContext, coverage, kindNeed } from '../../domain/activation';
import { addOrReplace, replaceSelection } from '../../domain/build';
import { useBuilder } from '../../app/builder-context';
import { useBuildAnalysis, useCatalog, usePricebook } from '../../app/queries';
import { Icon } from '../../components/icon';
import {
  ActiveFilters,
  Box,
  CompatChip,
  CompatFilter,
  CompareTray,
  Facet,
  MiniBuild,
  Money,
  PartsHead,
  SortHeader,
  type ActiveFilter,
  type SortDir,
  type Verdict,
} from '../../components/parts';
import { itemPrice } from '../../lib/item-cost';
import { KEY_FIELDS, itemPath, kindPath, rowSubtitle, specValue } from '../../lib/catalog-view';
import { useCompatByKind, verdictFor } from '../../lib/compat';
import { LAYERS, headlineKind, itemLogo, layerOf } from '../../lib/layers';
import { humanize, formatValue } from '../../lib/schema-fields';
import { useToast } from '../../components/feedback';

const MAX_COMPARE = 3;

interface Row {
  item: CatalogItem;
  verdict: Verdict;
  price: ReturnType<typeof itemPrice>;
  tier: Tier;
}

const VERDICT_RANK: Record<Verdict, number> = { compatible: 0, unknown: 1, incompatible: 2 };

export function PartList({
  mode,
  kind,
  layer,
}: {
  mode: 'all' | 'kind';
  kind?: ComponentKind;
  layer?: Tier;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { draft, apply } = useBuilder();
  const catalog = useCatalog();
  const pricebook = usePricebook();
  const analysis = useBuildAnalysis(draft?.build);

  const build = draft?.build;

  // ---- URL state (research §4.8) ----------------------------------------------------------
  const q = params.get('q') ?? '';
  const sort = params.get('sort') ?? 'recommended';
  const dir: SortDir = params.get('dir') === 'desc' ? 'desc' : 'asc';
  const bucketParam = params.get('show');
  const buckets: Verdict[] = bucketParam
    ? (bucketParam.split(',').filter(Boolean) as Verdict[])
    : ['compatible', 'unknown'];
  const ossOnly = params.get('oss') === '1';
  // Deep links from the builder's "Change" action: replace an existing selection, then return.
  const replaceId = params.get('replace');
  const selectedIds = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, MAX_COMPARE);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  // Every kind in scope: one kind on a picker page, a tier's kinds for a layer, all kinds otherwise.
  const kinds = useMemo<ComponentKind[]>(
    () =>
      mode === 'kind' && kind
        ? [kind]
        : layer
          ? kindsInTier(layer).map((k) => k.kind)
          : KINDS.map((k) => k.kind),
    [mode, kind, layer],
  );

  const compat = useCompatByKind(build, kinds);
  const byId = catalog.byId;

  const ctx = useMemo(() => (build ? buildContext(build, byId) : undefined), [build, byId]);
  const cov = useMemo(() => (build && ctx ? coverage(build, ctx) : undefined), [build, ctx]);

  if (catalog.isError)
    return (
      <div className="pnotice pnotice-fail">
        <Icon name="x-circle" />
        <span>
          <strong>Could not load the catalog.</strong>{' '}
          {catalog.error instanceof Error ? catalog.error.message : 'Unknown error'}
        </span>
      </div>
    );
  if (!catalog.data || !build || !ctx || !cov) return null;

  // ---- rows --------------------------------------------------------------------------------
  const pool = catalog.data.items.filter((i) =>
    mode === 'kind' && kind ? i.kind === kind : layer ? kindDef(i.kind).tier === layer : true,
  );

  const rows: Row[] = pool.map((item) => ({
    item,
    verdict: verdictFor(compat.data, item.kind, item.id),
    price: itemPrice(item, build, byId, pricebook.data),
    tier: kindDef(item.kind).tier,
  }));

  const bucketCount = {
    compatible: rows.filter((r) => r.verdict === 'compatible').length,
    incompatible: rows.filter((r) => r.verdict === 'incompatible').length,
    unknown: rows.filter((r) => r.verdict === 'unknown').length,
  };

  const query = q.trim().toLowerCase();
  const specFields = mode === 'kind' && kind ? KEY_FIELDS[kind].slice(0, 4) : [];

  const filtered = rows.filter(({ item, verdict }) => {
    if (!buckets.includes(verdict)) return false;
    if (ossOnly && !item.license?.spdx_id) return false;
    if (!query) return true;
    return [item.name, item.description, KIND_LABELS[item.kind], ...(item.tags ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  const value = (r: Row, key: string): string | number => {
    if (key === 'name') return r.item.name.toLowerCase();
    if (key === 'cost') return r.price.amount === null ? Infinity : Number(r.price.amount);
    if (key === 'outcome') return VERDICT_RANK[r.verdict];
    if (key === 'kind') return KIND_LABELS[r.item.kind];
    if (key.startsWith('spec:')) {
      const v = specValue(r.item, key.slice(5));
      if (v === undefined || v === null) return Infinity; // unknown values sort last
      if (Array.isArray(v)) return v.length;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'number') return v;
      return String(v).toLowerCase();
    }
    return 0;
  };

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sort === 'recommended') {
      cmp =
        VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || a.item.name.localeCompare(b.item.name);
    } else {
      const av = value(a, sort);
      const bv = value(b, sort);
      cmp = av < bv ? -1 : av > bv ? 1 : a.item.name.localeCompare(b.item.name);
      if (dir === 'desc') cmp = -cmp;
    }
    return cmp;
  });

  const onSort = (key: string) => {
    if (sort === key) update({ sort: key, dir: dir === 'asc' ? 'desc' : 'asc' });
    else update({ sort: key, dir: 'asc' });
  };

  const inStack = (item: CatalogItem) =>
    build.selections.some((s) => s.enabled && s.catalog_item_id === item.id);

  const add = (item: CatalogItem) => {
    if (replaceId) {
      const target = build.selections.find((s) => s.id === replaceId);
      if (!target) {
        toast('That selection no longer exists. Choose a component instead.');
        return;
      }
      apply(
        (b) => replaceSelection(b, replaceId, item, byId),
        `Replaced ${KIND_LABELS[item.kind]} with ${item.name}`,
        [item.kind],
      );
      toast(`${item.name} replaced ${KIND_LABELS[item.kind]}.`);
      void navigate('/builder');
      return;
    }
    apply((b) => addOrReplace(b, item, byId), `Selected ${KIND_LABELS[item.kind]}: ${item.name}`, [
      item.kind,
    ]);
    toast(`${item.name} ${inStack(item) ? 'is already in' : 'added to'} your stack.`);
  };

  const toggleCompare = (id: string) => {
    if (selectedIds.includes(id)) update({ ids: selectedIds.filter((x) => x !== id).join(',') });
    else if (selectedIds.length >= MAX_COMPARE) toast(`Compare up to ${MAX_COMPARE} components.`);
    else update({ ids: [...selectedIds, id].join(',') });
  };

  const activeFilters: ActiveFilter[] = [];
  if (query) activeFilters.push({ key: 'q', label: 'Search', value: q });
  if (ossOnly) activeFilters.push({ key: 'oss', label: 'Licence', value: 'Open source only' });
  if (bucketParam)
    activeFilters.push({
      key: 'show',
      label: 'Outcome',
      value: buckets.map((b) => b[0]!.toUpperCase() + b.slice(1)).join(', '),
    });

  const layerOfRow = (tier: Tier) => layerOf(tier);
  const single = mode === 'kind' && kind ? kind : undefined;
  // "Choose an AI model", "Choose a hosting platform" — articles handled by the contract labels.
  const heading = single
    ? `Choose ${withArticle(KIND_LABELS[single])}`
    : layer
      ? `Choose ${labelInSentence(layerOf(layer).name)}`
      : 'All components';

  const requiredFor = (k: ComponentKind) => kindNeed(k, ctx.mode) === 'needed';

  return (
    <>
      <PartsHead
        crumbs={
          <>
            <Link to="/">PickYour.AI</Link> <span>/</span>
            <Link to="/catalog">Component catalog</Link>
            {single ? (
              <>
                <span>/</span> {KIND_LABELS[single]}
              </>
            ) : layer ? (
              <>
                <span>/</span> {layerOf(layer).name}
              </>
            ) : null}
          </>
        }
        title={heading}
        description={
          single
            ? `Part of ${layerOf(kindDef(single).tier).name}. Columns are contract spec fields; a value the catalog does not record shows as "—", never as zero.`
            : 'Every component kind, grouped by layer. The compatibility filter is on by default, and unknown is its own bucket.'
        }
        actions={
          <>
            <Link className="pbtn" to="/builder">
              <Icon name="layers" /> Back to builder
            </Link>
            <Link className="pbtn pbtn-primary" to="/compare">
              <Icon name="compare" /> Compare
            </Link>
          </>
        }
      />

      {replaceId ? (
        <div className="pnotice" style={{ marginBottom: 12 }}>
          <Icon name="arrow-right" />
          <span>
            <strong>Replacing a component.</strong> Choosing a product here swaps it into your stack
            and returns to the builder. <Link to="/builder">Cancel</Link>
          </span>
        </div>
      ) : null}

      <div className="parts-cols">
        <aside className="prail" aria-label="Build context and filters">
          <MiniBuild
            selected={build.selections.filter((s) => s.enabled).length}
            required={{
              done: cov.needed.length - cov.missing.length,
              total: cov.needed.length,
            }}
            outcome={
              analysis.report?.summary.failed
                ? 'fail'
                : analysis.report?.summary.unknown
                  ? 'unknown'
                  : analysis.report
                    ? 'pass'
                    : 'none'
            }
            cost={analysis.costIsCurrent ? analysis.cost : undefined}
            conflicts={analysis.report?.summary.failed ?? 0}
            unknown={analysis.report?.summary.unknown ?? 0}
          />

          <CompatFilter
            buckets={[
              { key: 'compatible', count: bucketCount.compatible },
              { key: 'unknown', count: bucketCount.unknown },
              { key: 'incompatible', count: bucketCount.incompatible },
            ]}
            value={buckets}
            onChange={(next) => update({ show: next.join(',') })}
            total={rows.length}
          />

          <Box title="Filters" tight>
            <div className="pfacet">
              <div className="pfacet-body" style={{ paddingTop: 8 }}>
                <label className="popt">
                  <input
                    type="checkbox"
                    checked={ossOnly}
                    onChange={(e) => update({ oss: e.target.checked ? '1' : null })}
                  />
                  Open source only
                </label>
              </div>
            </div>
            {mode === 'all' ? (
              <Facet title="Layer">
                <Link
                  className={layer ? 'popt' : 'popt'}
                  to="/catalog"
                  style={{ fontWeight: layer ? 400 : 600 }}
                >
                  All layers
                </Link>
                {LAYERS.map((l) => (
                  <Link
                    key={l.tier}
                    className="popt"
                    to={`/catalog?layer=${l.tier}`}
                    style={{ fontWeight: layer === l.tier ? 600 : 400 }}
                  >
                    {l.tier} · {l.name}
                  </Link>
                ))}
              </Facet>
            ) : null}
            {mode === 'all' && layer
              ? kindsInTier(layer).map((k) => (
                  <div className="popt" key={k.kind}>
                    <Link to={kindPath(k.kind)}>{KIND_LABELS[k.kind]}</Link>
                    <span className="popt-count">
                      {catalog.data.items.filter((i) => i.kind === k.kind).length}
                    </span>
                  </div>
                ))
              : null}
          </Box>
        </aside>

        <div>
          <div className="plist-head">
            <h2>{heading}</h2>
            <span className="count" aria-live="polite">
              {sorted.length} of {rows.length} products · {bucketCount.compatible} compatible ·{' '}
              {bucketCount.unknown} unknown · {bucketCount.incompatible} incompatible
            </span>
          </div>

          <div className="pbar">
            <div className="pbar-field">
              <Icon name="search" />
              <input
                aria-label="Search these components"
                className="pbar-input"
                placeholder="Search by name, kind or tag…"
                type="search"
                value={q}
                onChange={(e) => update({ q: e.target.value || null })}
                style={{ fontWeight: 400 }}
              />
            </div>
            <div className="pbar-actions">
              <button
                type="button"
                className="pbtn pbtn-ghost"
                onClick={() =>
                  update({
                    show: buckets.includes('incompatible')
                      ? 'compatible,unknown'
                      : 'compatible,unknown,incompatible',
                  })
                }
              >
                {buckets.includes('incompatible')
                  ? `Hide ${bucketCount.incompatible} incompatible`
                  : `Show ${bucketCount.incompatible} incompatible`}
              </button>
              {selectedIds.length ? (
                <button
                  type="button"
                  className="pbtn pbtn-ghost"
                  onClick={() => update({ ids: null })}
                >
                  Clear selection
                </button>
              ) : null}
            </div>
          </div>

          <ActiveFilters
            filters={activeFilters}
            onRemove={(key) => update({ [key]: null })}
            onClear={() => update({ q: null, oss: null, show: null, sort: null, dir: null })}
          />

          <div className="pt-wrap">
            <div className="pt-scroll" tabIndex={0} role="region" aria-label="Scrollable part list">
              <table className="pt">
                <caption>
                  {sorted.length} component{sorted.length === 1 ? '' : 's'}
                  {single ? ` · ${KIND_LABELS[single]}` : ''} · synthetic demo catalog
                </caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 34 }}>
                      <span className="sr-only">Compare</span>
                    </th>
                    <SortHeader
                      label="Component"
                      sortKey="name"
                      sort={sort}
                      dir={dir}
                      onSort={onSort}
                    />
                    {single ? null : (
                      <SortHeader
                        label="Kind"
                        sortKey="kind"
                        sort={sort}
                        dir={dir}
                        onSort={onSort}
                      />
                    )}
                    {specFields.map((f) => (
                      <SortHeader
                        key={f}
                        label={humanize(f)}
                        sortKey={`spec:${f}`}
                        sort={sort}
                        dir={dir}
                        onSort={onSort}
                      />
                    ))}
                    <SortHeader
                      label="Compatibility"
                      sortKey="outcome"
                      sort={sort}
                      dir={dir}
                      onSort={onSort}
                    />
                    <SortHeader
                      label="Est. cost"
                      sortKey="cost"
                      sort={sort}
                      dir={dir}
                      onSort={onSort}
                      numeric
                    />
                    <th scope="col" className="num">
                      <span>Add</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 ? (
                    <tr>
                      <td colSpan={6 + specFields.length}>
                        <div className="pnotice" style={{ margin: 8 }}>
                          <Icon name="search" />
                          <span>
                            <strong>No components match.</strong> Adjust the search, the outcome
                            buckets or the open-source filter.
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sorted.map(({ item, verdict, price }) => {
                      const logo = itemLogo(item);
                      const picked = inStack(item);
                      const comparing = selectedIds.includes(item.id);
                      return (
                        <tr
                          key={item.id}
                          className={
                            picked
                              ? 'is-selected'
                              : verdict === 'incompatible'
                                ? 'is-blocked'
                                : undefined
                          }
                        >
                          <td data-label="Compare">
                            <input
                              type="checkbox"
                              aria-label={`Compare ${item.name}`}
                              checked={comparing}
                              onChange={() => toggleCompare(item.id)}
                              style={{ accentColor: 'var(--accent)' }}
                            />
                          </td>
                          <th scope="row" data-label="Component">
                            <div className="pt-name">
                              <span className={`component-logo ${logo.color}`} aria-hidden="true">
                                {logo.text}
                              </span>
                              <span style={{ minWidth: 0 }}>
                                <Link to={itemPath(item)}>{item.name}</Link>
                                <span className="pt-sub">
                                  {rowSubtitle(item)}
                                  {picked ? ' · in your stack' : ''}
                                </span>
                              </span>
                            </div>
                          </th>
                          {single ? null : (
                            <td data-label="Kind">
                              {KIND_LABELS[item.kind]}
                              <span className="pt-sub">
                                {layerOfRow(kindDef(item.kind).tier).short}
                                {requiredFor(item.kind) ? ' · required' : ''}
                              </span>
                            </td>
                          )}
                          {specFields.map((f) => {
                            const v = specValue(item, f);
                            return (
                              <td key={f} data-label={humanize(f)}>
                                {v === undefined || v === null ? (
                                  <span className="dim" title="Not recorded in the catalog">
                                    —
                                  </span>
                                ) : (
                                  formatValue(v, { key: f })
                                )}
                              </td>
                            );
                          })}
                          <td data-label="Compatibility">
                            <CompatChip verdict={verdict} />
                          </td>
                          <td className="num" data-label="Est. cost">
                            {price.amount === null ? (
                              <span className="pchip pchip-unknown">Unknown</span>
                            ) : Number(price.amount) === 0 ? (
                              <span className="dim">Included</span>
                            ) : (
                              <Money amount={price.amount} currency={price.currency} />
                            )}
                          </td>
                          <td data-label="Add">
                            <div className="pt-actions">
                              <button
                                type="button"
                                className={
                                  picked
                                    ? 'pbtn pbtn-selected'
                                    : verdict === 'incompatible'
                                      ? 'pbtn pbtn-blocked'
                                      : 'pbtn pbtn-add'
                                }
                                onClick={() => add(item)}
                              >
                                <Icon
                                  name={
                                    picked
                                      ? 'check'
                                      : verdict === 'incompatible'
                                        ? 'x-circle'
                                        : 'plus'
                                  }
                                />
                                {picked ? 'In stack' : 'Add'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pt-foot">
            <span className="pbar-meta">Estimates from synthetic demo data · not a quote</span>
            <button
              type="button"
              className="pbtn"
              onClick={() => void navigate('/builder')}
              disabled={!build.selections.length}
            >
              Go to builder <Icon name="arrow-right" />
            </button>
          </div>
        </div>
      </div>

      <CompareTray
        count={selectedIds.length}
        max={MAX_COMPARE}
        onClear={() => update({ ids: null })}
        onCompare={() => void navigate(`/compare?ids=${selectedIds.join(',')}`)}
      />
    </>
  );
}

/** Convenience wrapper for the /catalog index (all kinds, optional layer filter). */
export function CatalogList({ layer }: { layer?: Tier }) {
  return <PartList mode="all" layer={layer} />;
}

export function KindList({ kind }: { kind: ComponentKind }) {
  return <PartList mode="kind" kind={kind} />;
}

export { headlineKind };
