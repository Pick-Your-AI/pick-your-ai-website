/*
 * Compare.
 *
 * Follows the PCPartPicker comparison pattern in docs/research/pcpartpicker-ux-notes.md §6: pick a
 * category, choose up to three products, then read one aligned table where every row is a property
 * and every column is a product. Rows that differ are marked, rows where a product records nothing
 * say so explicitly instead of showing a blank, and the compatibility row states a verdict with an
 * icon and a word.
 *
 * Only facts the contract actually carries are compared. There is no vendor/author field in the
 * catalog schema, so the table reports licence, billing class and catalog status instead.
 *
 * Two build modes share this route: `?revisions=3,7` diffs two kept revisions of the current draft,
 * and `?builds=a,b` diffs two saved builds. They render one `BuildDiff` so selections, objectives,
 * compatibility outcomes and estimated cost are always read the same way.
 */
import '../styles/dense.css';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type {
  BuildSnapshot,
  CatalogItem,
  ComponentKind,
  CostEstimate,
  EvaluationReport,
  Selection,
  Tier,
} from '../contracts';
import { KIND_LABELS, TIERS, TIER_LABELS, kindsInTier, labelInSentence } from '../contracts';
import { addOrReplace } from '../domain/build';
import { evidenceDateLabel, itemFreshness } from '../domain/freshness';
import { useBuilder } from '../app/builder-context';
import { useData } from '../app/data-context';
import { useCatalog, useCompatibleOptions, usePricebook } from '../app/queries';
import { BILLING_LABELS, idToSlug, slugToId } from '../lib/catalog-view';
import { itemPrice } from '../lib/item-cost';
import { LAYERS, headlineKind, itemLogo, layerOf } from '../lib/layers';
import { formatValue, humanize, specFields } from '../lib/schema-fields';
import { EmptyState, ErrorState, Loading, useToast } from '../components/feedback';
import { Icon } from '../components/icon';
import { CompatChip, Money, PartsHead, type Verdict } from '../components/parts';
import { OutcomeBadge, type Outcome } from '../components/status';
import { costHeadline, formatMoney } from '../features/builder/analysis';

const SLOTS = 3;
const DEFAULT_TIER: Tier = 'T1';

const tierFromParam = (value: string | null): Tier | null =>
  LAYERS.find((layer) => layer.tier === value)?.tier ?? null;

/** Position-preserving parse: empty entries stay empty so a cleared slot keeps its column. */
const parseIds = (value: string | null): string[] =>
  (value ?? '').split(',').map((part) => (part.trim() ? slugToId(part.trim()) : ''));

function deploymentPath(item: CatalogItem): string {
  const spec = item.spec as Record<string, unknown>;
  if (Array.isArray(spec.access_modes)) {
    const modes = spec.access_modes as string[];
    // Contract semantics (research issue #297): `api` is a provider API on shared capacity;
    // `managed` means dedicated/reserved capacity. They are not interchangeable.
    if (modes.includes('api') && modes.includes('weights')) return 'Provider API or self-hosted';
    if (modes.includes('api')) return 'Provider API (shared capacity)';
    if (modes.includes('weights')) return 'Self-hosted weights';
  }
  if (typeof spec.mode === 'string') return formatValue(spec.mode);
  if (typeof spec.hosting_type === 'string') return formatValue(spec.hosting_type);
  if (typeof spec.target_type === 'string') return formatValue(spec.target_type);
  return 'Not recorded';
}

function licenceLine(item: CatalogItem): string {
  if (!item.license) return 'No licence recorded';
  const spdx = item.license.spdx_id?.replace('LicenseRef-', '') ?? 'Licensed';
  const parts = [spdx];
  if (item.license.self_hosting_allowed === false) parts.push('no self-hosting');
  if (item.license.commercial_use_allowed === false) parts.push('no commercial use');
  return parts.join(' · ');
}

/** Cell renderer + a comparable text form used to decide whether a row differs. */
interface Row {
  key: string;
  label: string;
  render: (item: CatalogItem) => ReactNode;
  compare: (item: CatalogItem) => string;
}

const list = (value: string | null) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Route entry: `?ids` compares components, `?builds` / `?revisions` diff whole builds. */
export default function ComparePage() {
  const [params] = useSearchParams();
  const builds = list(params.get('builds'));
  const revisions = list(params.get('revisions'))
    .map((r) => Number(r))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (builds.length)
    return (
      <BuildComparePage>
        <SavedBuildsCompare ids={builds} />
      </BuildComparePage>
    );
  if (revisions.length)
    return (
      <BuildComparePage>
        <RevisionCompare revisions={revisions} />
      </BuildComparePage>
    );
  if (params.get('mode') === 'builds') return <CompareStart />;
  return <ComponentCompare />;
}

function BuildComparePage({ children }: { children: ReactNode }) {
  return (
    <div className="app-page parts-page">
      <div className="container">
        <PartsHead
          crumbs={
            <>
              <Link to="/">PickYour.AI</Link> <span>/</span> <Link to="/compare">Compare</Link>{' '}
              <span>/</span> Builds
            </>
          }
          title="Compare builds"
          description="Compare selections, objectives, compatibility outcomes and estimated cost across two builds or revisions."
          actions={
            <Link className="pbtn" to="/compare?mode=builds">
              Choose what to compare
            </Link>
          }
        />
        {children}
      </div>
    </div>
  );
}

function ComponentCompare() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const catalog = useCatalog();
  const { draft, apply, catalogById } = useBuilder();
  const pricebook = usePricebook(draft?.build.locks.pricebook_id);

  const explicitTier = tierFromParam(params.get('layer'));
  const requestedIds = params.has('ids') ? parseIds(params.get('ids')).slice(0, SLOTS) : null;

  // Without ?layer=, infer it from the first id that resolves; otherwise start at T1.
  let tier: Tier = explicitTier ?? DEFAULT_TIER;
  if (!explicitTier && requestedIds) {
    for (const id of requestedIds) {
      const item = id ? catalog.byId.get(id) : undefined;
      if (item) {
        tier = item.tier;
        break;
      }
    }
  }
  const layer = layerOf(tier);
  const tierItems = (catalog.data?.items ?? []).filter((item) => item.tier === tier);
  // Slots seed from the tier's headline kind so the columns are alternatives for one decision.
  const preferred = headlineKind(tier);
  const layerItems = preferred ? tierItems.filter((i) => i.kind === preferred) : tierItems;

  const slotItem = (index: number): CatalogItem | undefined => {
    // An explicit `?ids=` may name products from different tiers (the catalog's compare tray is not
    // tier-scoped), so a requested id is resolved as-is instead of being dropped for its tier.
    const id = requestedIds ? requestedIds[index] : layerItems[index]?.id;
    return id ? catalog.byId.get(id) : undefined;
  };
  const slots = Array.from({ length: SLOTS }, (_, index) => slotItem(index));
  const filled = slots.filter(Boolean) as CatalogItem[];
  const mixedTiers = new Set(filled.map((item) => item.tier)).size > 1;

  /** A slot lists this tier's products, plus a selected product that came from another tier. */
  const optionsFor = (item: CatalogItem | undefined): CatalogItem[] =>
    !item || tierItems.some((option) => option.id === item.id) ? tierItems : [...tierItems, item];
  const slotOptions = (item: CatalogItem | undefined) =>
    optionsFor(item).map((option) => (
      <option key={option.id} value={option.id}>
        {option.name} — {KIND_LABELS[option.kind]}
        {option.tier === tier ? '' : ` (${option.tier} ${TIER_LABELS[option.tier]})`}
      </option>
    ));

  const updateIds = (next: (string | undefined)[]) => {
    const trimmed = [...next];
    while (trimmed.length && !trimmed[trimmed.length - 1]) trimmed.pop();
    const search = new URLSearchParams(params);
    search.set('layer', tier);
    /*
     * `ids` is always written, even when it is empty. A missing `ids` means "first visit" and seeds
     * the tier's default products; `ids=` says the slots were cleared on purpose and must stay
     * empty.
     */
    search.set('ids', trimmed.map((id) => (id ? idToSlug(id) : '')).join(','));
    setParams(search, { replace: true });
  };

  const setSlot = (index: number, value: string) => {
    updateIds(Array.from({ length: SLOTS }, (_, i) => (i === index ? value : slots[i]?.id)));
  };

  const selectTier = (next: Tier) => {
    const kind = headlineKind(next);
    const first = (catalog.data?.items ?? [])
      .filter((item) => item.tier === next && (!kind || item.kind === kind))
      .slice(0, SLOTS)
      .map((item) => item.id);
    const search = new URLSearchParams();
    search.set('layer', next);
    if (first.length) search.set('ids', first.map(idToSlug).join(','));
    setParams(search, { replace: true });
  };

  const isSelected = (item: CatalogItem) =>
    Boolean(draft?.build.selections.some((selection) => selection.catalog_item_id === item.id));

  const applyItem = (item: CatalogItem) => {
    if (!draft || isSelected(item)) return;
    apply((build) => addOrReplace(build, item, catalogById), `Added ${item.name} from compare`, [
      item.kind,
    ]);
    toast(`${item.name} applied to your stack.`);
  };

  /*
   * Spec rows: the union of the contract's spec fields for the kinds on screen, minus `*_ref`
   * fields. A ref is an internal catalog id (e.g. `demo.model_provider.aurora`); printing it raw
   * leaks identifiers, so it is resolved to the referenced item's name instead, and dropped when
   * it cannot be resolved.
   */
  const specKeys: string[] = [];
  const specSignatures = new Set<string>();
  for (const item of filled) {
    for (const f of specFields(item.kind)) {
      if (f.isRef || specKeys.includes(f.key)) continue;
      const signature = `${f.label}|${filled
        .map((i) => formatValue((i.spec as Record<string, unknown>)[f.key], { key: f.key }))
        .join('|')}`;
      if (specSignatures.has(signature)) continue;
      specSignatures.add(signature);
      specKeys.push(f.key);
    }
  }

  /** Resolve scalar and array references without displaying raw catalog identifiers. */
  const refName = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      if (!value.length) return 'None recorded';
      return value
        .map((id) =>
          typeof id === 'string' ? (catalog.byId.get(id)?.name ?? 'Not recorded') : 'Not recorded',
        )
        .join(', ');
    }
    if (typeof value !== 'string') return undefined;
    return catalog.byId.get(value)?.name ?? 'Not recorded';
  };

  /*
   * Several ref fields can point at the same referenced item (a model records its provider twice),
   * which would print the same value in two identically-labelled rows. Keep one row per
   * (label, values) signature.
   */
  const refFields: string[] = [];
  const refSignatures = new Set<string>();
  for (const key of new Set(filled.flatMap((i) => specFields(i.kind).filter((f) => f.isRef)))) {
    const label = humanize(key.key).replace(/ refs?$/i, '');
    const signature = `${label}|${filled
      .map((i) => refName((i.spec as Record<string, unknown>)[key.key]) ?? '\u0000')
      .join('|')}`;
    if (!filled.some((i) => refName((i.spec as Record<string, unknown>)[key.key]))) continue;
    if (refSignatures.has(signature)) continue;
    refSignatures.add(signature);
    refFields.push(key.key);
  }

  const rows: Row[] = [
    {
      key: 'cost',
      label: 'Est. cost',
      /*
       * The catalog and the builder both mark a component with an unpriced meter as a lower bound
       * (`≥ … partial`) and keep the `Included*` asterisk. Comparing the bare amount would present a
       * partial figure as a complete one — e.g. an expired output-token rate makes Aurora Mini's
       * support-chat price ≥ $14.40, not $14.40.
       */
      render: (item) => {
        const price = itemPrice(item, draft?.build, catalog.byId, pricebook.data);
        if (price.amount === null)
          return (
            <span className="pchip pchip-unknown" title={price.note}>
              Unknown
            </span>
          );
        if (price.included)
          return (
            <span className={price.label.endsWith('*') ? 'pchip' : 'dim'} title={price.note}>
              {price.label}
            </span>
          );
        if (price.partial)
          return (
            <span className="pchip pchip-unknown" title={price.note}>
              <Money amount={price.amount} currency={price.currency} approximate /> partial
            </span>
          );
        return (
          <span title={price.note}>
            <Money amount={price.amount} currency={price.currency} />
          </span>
        );
      },
      compare: (item) => {
        const price = itemPrice(item, draft?.build, catalog.byId, pricebook.data);
        if (price.amount === null) return 'unknown';
        // A lower bound and a complete price of the same amount are not the same fact.
        return price.partial ? `${price.amount} (lower bound)` : price.amount;
      },
    },
    {
      key: 'licence',
      label: 'Licence',
      render: (item) => (
        <>
          {licenceLine(item)}
          <span className="pt-sub">{BILLING_LABELS[item.billing_class]}</span>
        </>
      ),
      compare: (item) => `${licenceLine(item)}|${item.billing_class}`,
    },
    {
      key: 'deployment',
      label: 'Deployment',
      render: (item) => deploymentPath(item),
      compare: deploymentPath,
    },
    {
      key: 'kind',
      label: 'Component kind',
      render: (item) => KIND_LABELS[item.kind],
      compare: (item) => item.kind,
    },
    {
      key: 'status',
      label: 'Catalog status',
      render: (item) => formatValue(item.status),
      compare: (item) => item.status,
    },
    {
      key: 'fits',
      label: 'Fits your stack',
      render: (item) => <FitCell item={item} />,
      compare: () => '', // a verdict, not a spec: never counted as a difference
    },
    {
      key: 'about',
      label: 'What it is',
      render: (item) =>
        item.description ?? <span className="cmp-empty">No description recorded</span>,
      compare: (item) => item.description ?? '',
    },
    ...refFields.map<Row>((key) => ({
      key,
      label: humanize(key).replace(/ refs?$/i, ''),
      render: (item) => {
        const name = refName((item.spec as Record<string, unknown>)[key]);
        return name ?? <span className="cmp-empty">—</span>;
      },
      compare: (item) => refName((item.spec as Record<string, unknown>)[key]) ?? '\u0000missing',
    })),
    ...specKeys.map<Row>((key) => ({
      key,
      label: humanize(key),
      render: (item) => {
        const spec = item.spec as Record<string, unknown>;
        const value = spec[key];
        if (value === undefined || value === null)
          return (
            <span className="cmp-empty" title="Not recorded in the catalog">
              —
            </span>
          );
        return formatValue(value, { key });
      },
      compare: (item) => {
        const value = (item.spec as Record<string, unknown>)[key];
        return value === undefined || value === null
          ? '\u0000missing'
          : formatValue(value, { key });
      },
    })),
    {
      key: 'evidence',
      label: 'Evidence',
      render: (item) => {
        const statuses = item.provenance.map((p) => p.verification_status);
        const best = ['verified', 'user_supplied', 'estimated', 'unverified'].find((s) =>
          statuses.includes(s as never),
        );
        const date = itemFreshness(item);
        return (
          <>
            {humanize(best ?? 'unverified')}
            <span className="pt-sub" title={evidenceDateLabel(date)}>
              {date.checkedAt.slice(0, 10)} · v{item.version}
            </span>
          </>
        );
      },
      compare: (item) =>
        item.provenance
          .map((p) => p.verification_status)
          .sort()
          .join(','),
    },
    {
      key: 'add',
      label: '',
      render: (item) => (
        <button
          className="pbtn pbtn-add"
          type="button"
          disabled={!draft || isSelected(item)}
          title={
            isSelected(item)
              ? 'This component is already selected'
              : draft
                ? undefined
                : 'Open a build before adding components'
          }
          onClick={() => applyItem(item)}
        >
          <Icon name="plus" /> Use this part
        </button>
      ),
      compare: () => '',
    },
  ];

  const differs = (row: Row): boolean => {
    if (row.key === 'fits' || row.key === 'add') return false;
    return new Set(filled.map(row.compare)).size > 1;
  };

  return (
    <div className="app-page parts-page">
      <div className="container">
        <PartsHead
          crumbs={
            <>
              <Link to="/">PickYour.AI</Link> <span>/</span> Compare
            </>
          }
          title="Compare components"
          description="Pick a layer, choose up to three products, and read one aligned table. Rows that differ are marked; a value the catalog does not record says so rather than showing a blank."
          actions={
            <>
              <Link className="pbtn" to="/catalog">
                <Icon name="search" /> Browse catalog
              </Link>
              <Link className="pbtn" to="/compare?mode=builds">
                <Icon name="workflow" /> Compare builds
              </Link>
              <Link className="pbtn pbtn-primary" to="/builder">
                <Icon name="layers" /> Builder
              </Link>
            </>
          }
          tabs={LAYERS.map((entry) => (
            <button
              key={entry.tier}
              type="button"
              aria-pressed={entry.tier === tier}
              className={entry.tier === tier ? 'parts-tab on' : 'parts-tab'}
              onClick={() => selectTier(entry.tier)}
            >
              <span className="dim">{entry.tier}</span> {entry.short}
            </button>
          ))}
        />

        {catalog.isError ? (
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        ) : !catalog.data ? (
          <Loading label="Loading the demo catalog…" />
        ) : (
          <>
            <div className="pbar">
              <div className="pbar-field">
                <Icon name="compare" />
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  {mixedTiers
                    ? 'Comparing products across layers'
                    : `${layer.name} · ${labelInSentence(KIND_LABELS[preferred])}`}{' '}
                  · {filled.length} of {SLOTS} slots filled
                </span>
              </div>
              <div className="pbar-actions">
                <span className="pbar-meta">
                  {kindsInTier(tier)
                    .map((k) => KIND_LABELS[k.kind])
                    .join(' · ')}
                </span>
              </div>
            </div>

            {/* The table head is hidden on small screens, so the slot pickers get their own block. */}
            <div className="pcmp-slots">
              {slots.map((item, index) => (
                <div key={index}>
                  <label className="field-label" htmlFor={`mslot-${index}`}>
                    Slot {index + 1}
                  </label>
                  <select
                    id={`mslot-${index}`}
                    className="pbar-input"
                    value={item?.id ?? ''}
                    onChange={(e) => setSlot(index, e.target.value)}
                  >
                    <option value="">Choose a component…</option>
                    {slotOptions(item)}
                  </select>
                </div>
              ))}
            </div>

            <div className="pt-wrap">
              <div className="pt-scroll" tabIndex={0} role="region" aria-label="Comparison table">
                <table className="pcmp">
                  <caption className="sr-only">
                    Side-by-side comparison of {filled.length} component
                    {filled.length === 1 ? '' : 's'}
                    {mixedTiers ? ' from different layers' : ` in the ${layer.name} layer`}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="rowkey">
                        Property
                      </th>
                      {slots.map((item, index) => (
                        <th scope="col" className="cmpcol" key={index}>
                          <div className="cmpcol-head">
                            <label className="sr-only" htmlFor={`slot-${index}`}>
                              Compare slot {index + 1}
                            </label>
                            <select
                              id={`slot-${index}`}
                              className="pbar-input"
                              style={{ fontWeight: 400 }}
                              value={item?.id ?? ''}
                              onChange={(e) => setSlot(index, e.target.value)}
                            >
                              <option value="">Choose a component…</option>
                              {slotOptions(item)}
                            </select>
                            {item ? (
                              <div className="pt-name">
                                <span
                                  className={`component-logo ${itemLogo(item).color}`}
                                  aria-hidden="true"
                                >
                                  {itemLogo(item).text}
                                </span>
                                <span>
                                  <Link to={`/catalog/${item.kind}/${idToSlug(item.id)}`}>
                                    {item.name}
                                  </Link>
                                  <span className="pt-sub">{KIND_LABELS[item.kind]}</span>
                                </span>
                              </div>
                            ) : (
                              <span className="cmp-empty">Empty slot</span>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const rowDiffers = filled.length > 1 && differs(row);
                      return (
                        <tr key={row.key}>
                          <th scope="row" className="rowkey">
                            {row.label || <span className="sr-only">Action</span>}
                            {rowDiffers ? (
                              <span className="diffmark" title="Values differ">
                                ≠
                              </span>
                            ) : null}
                          </th>
                          {slots.map((item, index) => (
                            <td
                              key={`${row.key}-${index}`}
                              data-col={item ? item.name : `Slot ${index + 1}`}
                              className={rowDiffers ? 'is-diff' : undefined}
                            >
                              {item ? row.render(item) : <span className="cmp-empty">—</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-foot">
              <span className="pbar-meta">
                Rows marked ≠ differ between the selected parts · synthetic demo data · not a quote
              </span>
              <Link className="pbtn" to={`/catalog?layer=${tier}`}>
                Choose other parts <Icon name="arrow-right" />
              </Link>
            </div>

            <div className="parts-sections">
              <div className="pnotice">
                <Icon name="info" />
                <span>
                  <strong>What this table does not say.</strong> It compares recorded catalog fields
                  only. It does not measure answer quality, throughput, latency under load or vendor
                  support, and an empty cell means the catalog records nothing — not that the
                  product lacks the capability. Recorded provenance statuses do not establish
                  independent verification, and an evidence date does not establish currentness.
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FitCell({ item }: { item: CatalogItem }) {
  const { draft } = useBuilder();
  const options = useCompatibleOptions(draft?.build ?? null, item.kind);
  if (!draft) return <span className="cmp-empty">No build to check</span>;
  if (options.isError) return <span className="pchip pchip-unknown">Could not check</span>;
  if (!options.data || options.isPlaceholderData)
    return <span className="cmp-empty">Checking…</span>;
  const verdict = (options.data.find((o) => o.catalog_item_id === item.id)?.verdict ??
    'unknown') as Verdict;
  return <CompatChip verdict={verdict} />;
}

// ---- build compare -----------------------------------------------------------------------
//
// Two modes share this route with the component table: `?revisions=3,7` diffs two kept revisions
// of the current draft, and `?builds=a,b` diffs two saved builds. Both render one `BuildDiff`, so
// selections, objectives, compatibility outcomes and estimated cost are always read the same way.

interface Side {
  label: string;
  build: BuildSnapshot;
}

function SavedBuildsCompare({ ids }: { ids: string[] }) {
  const { builds } = useData();
  const [idA, idB] = ids;
  const a = useQuery({
    queryKey: ['builds', 'get', idA],
    queryFn: () => builds.get(idA!),
    enabled: Boolean(idA),
  });
  const b = useQuery({
    queryKey: ['builds', 'get', idB],
    queryFn: () => builds.get(idB!),
    enabled: Boolean(idB),
  });
  if (ids.length !== 2 || !idA || !idB) {
    return <BadParams>Build comparison needs exactly two saved build ids.</BadParams>;
  }
  if (a.isError || b.isError) {
    const failed = a.isError ? a : b;
    return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
  }
  if (!a.data || !b.data) return <Loading label="Loading saved builds…" />;
  return (
    <BuildDiff
      a={{ label: `${a.data.build.name} (r${a.data.build.revision})`, build: a.data.build }}
      b={{ label: `${b.data.build.name} (r${b.data.build.revision})`, build: b.data.build }}
    />
  );
}

function RevisionCompare({ revisions }: { revisions: number[] }) {
  const { draft, ready } = useBuilder();
  if (!ready || !draft) return <Loading label="Loading your current build…" />;
  if (revisions.length !== 2)
    return <BadParams>Revision comparison needs exactly two revision numbers.</BadParams>;
  const [ra, rb] = revisions as [number, number];
  const a = draft.revisions.find((r) => r.revision === ra);
  const b = draft.revisions.find((r) => r.revision === rb);
  if (!a || !b) {
    return (
      <BadParams>
        Revision {!a ? ra : rb} is not kept for &ldquo;{draft.build.name}&rdquo;. Kept revisions:{' '}
        {draft.revisions.map((r) => r.revision).join(', ')}.
      </BadParams>
    );
  }
  return (
    <BuildDiff
      a={{ label: `Revision ${ra}`, build: a }}
      b={{ label: `Revision ${rb}`, build: b }}
    />
  );
}

function BadParams({ children }: { children: ReactNode }) {
  return (
    <EmptyState
      title="This comparison link is incomplete"
      action={
        <Link className="btn btn-outline btn-small" to="/compare?mode=builds">
          Choose what to compare
        </Link>
      }
    >
      {children}
    </EmptyState>
  );
}

/** Evaluation and cost for one exact build revision (no evidence passed: like-for-like on both sides). */
function useSideAnalysis(build: BuildSnapshot) {
  const { compatibility, pricing } = useData();
  const evaluation = useQuery({
    queryKey: ['compare', 'evaluation', build.id, build.revision],
    queryFn: () => compatibility.evaluate(build),
  });
  const cost = useQuery({
    queryKey: ['compare', 'cost', build.id, build.revision],
    queryFn: () => pricing.estimate(build),
  });
  return { evaluation, cost };
}

type ChangeKind = 'added' | 'removed' | 'changed' | 'settings' | 'unchanged';

const CHANGE_LABELS: Record<ChangeKind, string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  settings: 'Settings changed',
  unchanged: 'Unchanged',
};

const CHANGE_CHIP: Record<ChangeKind, string> = {
  added: 'pchip pchip-pass',
  removed: 'pchip pchip-fail',
  changed: 'pchip pchip-unknown',
  settings: 'pchip pchip-unknown',
  unchanged: 'pchip',
};

const CHANGE_MARK: Record<ChangeKind, string> = {
  added: '+',
  removed: '−',
  changed: '~',
  settings: '~',
  unchanged: '=',
};

function ChangeLabel({ change }: { change: ChangeKind }) {
  return (
    <span className={CHANGE_CHIP[change]}>
      <span aria-hidden="true">{CHANGE_MARK[change]}</span> {CHANGE_LABELS[change]}
    </span>
  );
}

interface SelectionDiff {
  key: string;
  kind: ComponentKind;
  role: string;
  a?: Selection;
  b?: Selection;
  change: ChangeKind;
}

function diffSelections(a: BuildSnapshot, b: BuildSnapshot): SelectionDiff[] {
  const key = (s: Selection) => `${s.kind}|${s.role}`;
  const mapA = new Map(a.selections.map((s) => [key(s), s]));
  const mapB = new Map(b.selections.map((s) => [key(s), s]));
  const out: SelectionDiff[] = [];
  for (const k of new Set([...mapA.keys(), ...mapB.keys()])) {
    const sa = mapA.get(k);
    const sb = mapB.get(k);
    const ref = (sa ?? sb)!;
    let change: ChangeKind = 'unchanged';
    if (!sa) change = 'added';
    else if (!sb) change = 'removed';
    else if (
      sa.catalog_item_id !== sb.catalog_item_id ||
      sa.catalog_item_version !== sb.catalog_item_version
    )
      change = 'changed';
    else if (
      sa.enabled !== sb.enabled ||
      JSON.stringify(sa.settings) !== JSON.stringify(sb.settings)
    )
      change = 'settings';
    out.push({ key: k, kind: ref.kind, role: ref.role, a: sa, b: sb, change });
  }
  return out;
}

function formatEntry(value: unknown): string {
  return formatValue(value);
}

function BuildDiff({ a, b }: { a: Side; b: Side }) {
  const catalog = useCatalog();
  const left = useSideAnalysis(a.build);
  const right = useSideAnalysis(b.build);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const byId = catalog.byId;
  const itemName = (s: Selection | undefined) => {
    if (!s) return '—';
    const item = byId.get(s.catalog_item_id);
    return `${item?.name ?? `${s.catalog_item_id} (not in this catalog)`}${s.enabled ? '' : ' (disabled)'}`;
  };

  const diffs = diffSelections(a.build, b.build);
  const counts = diffs.reduce<Record<ChangeKind, number>>(
    (acc, d) => ({ ...acc, [d.change]: acc[d.change] + 1 }),
    { added: 0, removed: 0, changed: 0, settings: 0, unchanged: 0 },
  );

  const objectiveRows = [
    ...new Set([...Object.keys(a.build.objectives), ...Object.keys(b.build.objectives)]),
  ].map((k) => ({
    key: `objectives.${k}`,
    label: humanize(k),
    va: formatEntry((a.build.objectives as Record<string, unknown>)[k]),
    vb: formatEntry((b.build.objectives as Record<string, unknown>)[k]),
  }));
  const policyRows = [
    ...new Set([...Object.keys(a.build.policy ?? {}), ...Object.keys(b.build.policy ?? {})]),
  ].map((k) => ({
    key: `policy.${k}`,
    label: `Policy: ${humanize(k).toLowerCase()}`,
    va: formatEntry((a.build.policy as Record<string, unknown> | undefined)?.[k]),
    vb: formatEntry((b.build.policy as Record<string, unknown> | undefined)?.[k]),
  }));
  const settingRows = [
    { key: 'name', label: 'Build name', va: a.build.name, vb: b.build.name },
    ...objectiveRows,
    ...policyRows,
    {
      key: 'catalog',
      label: 'Catalog snapshot',
      va: a.build.locks.catalog_snapshot_id,
      vb: b.build.locks.catalog_snapshot_id,
    },
    {
      key: 'ruleset',
      label: 'Ruleset',
      va: `${a.build.locks.ruleset_id}@${a.build.locks.ruleset_version}`,
      vb: `${b.build.locks.ruleset_id}@${b.build.locks.ruleset_version}`,
    },
  ];

  return (
    <div className="parts-sections">
      <div className="pbar">
        <div className="pbar-field">
          <Icon name="compare" />
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            A: {a.label} → B: {b.label}
          </span>
        </div>
        <div className="pbar-actions">
          <Link className="pbtn" to="/compare?mode=builds">
            Compare something else
          </Link>
        </div>
      </div>
      <p className="pbox-note">
        Changes are described going from A to B: &ldquo;Added&rdquo; means only B has the selection.
      </p>

      <section aria-labelledby="sel-diff-heading">
        <div className="plist-head">
          <h2 id="sel-diff-heading">Selections by tier</h2>
          <label className="popt" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
            />
            Show unchanged selections
          </label>
        </div>
        <p className="pbox-note">
          {counts.added} added, {counts.removed} removed, {counts.changed} changed,{' '}
          {counts.settings} with changed settings, {counts.unchanged} unchanged.
        </p>
        <div className="pt-wrap">
          <div className="pt-scroll" tabIndex={0} role="region" aria-label="Selection differences">
            <table className="pt">
              <caption>Selections compared between A and B</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span>Component</span>
                  </th>
                  <th scope="col">
                    <span>A</span>
                  </th>
                  <th scope="col">
                    <span>B</span>
                  </th>
                  <th scope="col">
                    <span>Change</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map((tier) => {
                  const kinds = kindsInTier(tier).map((k) => k.kind);
                  const rows = diffs
                    .filter((d) => kinds.includes(d.kind))
                    .sort((x, y) => kinds.indexOf(x.kind) - kinds.indexOf(y.kind))
                    .filter((d) => showUnchanged || d.change !== 'unchanged');
                  if (!rows.length) return null;
                  return [
                    <tr className="pt-group" key={`${tier}-group`}>
                      <th colSpan={4} scope="colgroup">
                        <div className="pt-group-inner">
                          <span className="pt-tier">{tier}</span>
                          <strong>{TIER_LABELS[tier]}</strong>
                        </div>
                      </th>
                    </tr>,
                    ...rows.map((d) => (
                      <tr key={d.key}>
                        <th scope="row">
                          <span className="pt-name">
                            {KIND_LABELS[d.kind]}
                            {d.role !== 'primary' ? <span className="pt-sub">{d.role}</span> : null}
                          </span>
                        </th>
                        <td data-label="A">{itemName(d.a)}</td>
                        <td data-label="B">{itemName(d.b)}</td>
                        <td data-label="Change">
                          <ChangeLabel change={d.change} />
                        </td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
        {diffs.length === 0 ? <p className="pbox-note">Neither build has any selections.</p> : null}
        {diffs.length > 0 && !showUnchanged && counts.unchanged === diffs.length ? (
          <p className="pbox-note">The selections are identical.</p>
        ) : null}
      </section>

      <section aria-labelledby="obj-diff-heading">
        <h2 id="obj-diff-heading" className="parts-h2">
          Objectives, policy and locks
        </h2>
        <div className="pt-wrap">
          <div className="pt-scroll" tabIndex={0} role="region" aria-label="Setting differences">
            <table className="pt">
              <caption>Objectives, policy and locks of A and B</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span>Setting</span>
                  </th>
                  <th scope="col">
                    <span>A</span>
                  </th>
                  <th scope="col">
                    <span>B</span>
                  </th>
                  <th scope="col">
                    <span>Change</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {settingRows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row">{r.label}</th>
                    <td data-label="A">{r.va}</td>
                    <td data-label="B">{r.vb}</td>
                    <td data-label="Change">
                      {r.va === r.vb ? (
                        <span className="dim">Same</span>
                      ) : (
                        <ChangeLabel change="changed" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <OutcomeDiff a={a} b={b} left={left.evaluation} right={right.evaluation} />
      <CostDiff a={a} b={b} left={left.cost} right={right.cost} />
    </div>
  );
}

interface QueryLike<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

function OutcomeDiff({
  a,
  b,
  left,
  right,
}: {
  a: Side;
  b: Side;
  left: QueryLike<EvaluationReport>;
  right: QueryLike<EvaluationReport>;
}) {
  const ra = left.data;
  const rb = right.data;
  let body;
  if (left.isError || right.isError) {
    const failed = left.isError ? left : right;
    body = <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
  } else if (!ra || !rb) {
    body = <Loading label="Evaluating both builds…" />;
  } else {
    const oa = new Map(ra.findings.map((f) => [f.rule_id, f.outcome]));
    const ob = new Map(rb.findings.map((f) => [f.rule_id, f.outcome]));
    const changed = [...new Set([...oa.keys(), ...ob.keys()])].filter(
      (id) => oa.get(id) !== ob.get(id),
    );
    const summaryRows: {
      label: string;
      outcome: Outcome;
      key: keyof EvaluationReport['summary'];
    }[] = [
      { label: 'Failing', outcome: 'fail', key: 'failed' },
      { label: 'Unknown', outcome: 'unknown', key: 'unknown' },
      { label: 'Passing', outcome: 'pass', key: 'passed' },
      { label: 'Skipped', outcome: 'skipped', key: 'skipped' },
    ];
    body = (
      <>
        <div className="pt-wrap">
          <div className="pt-scroll" tabIndex={0} role="region" aria-label="Outcome counts">
            <table className="pt">
              <caption>Number of checks per outcome for A and B</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span>Outcome</span>
                  </th>
                  <th scope="col" className="num">
                    <span>A</span>
                  </th>
                  <th scope="col" className="num">
                    <span>B</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row">
                      <OutcomeBadge outcome={r.outcome} label={r.label} />
                    </th>
                    <td className="num" data-label="A">
                      {ra.summary[r.key]}
                    </td>
                    <td className="num" data-label="B">
                      {rb.summary[r.key]}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Deployment readiness</th>
                  <td data-label="A">{humanize(ra.deployment_readiness)}</td>
                  <td data-label="B">{humanize(rb.deployment_readiness)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <h3 className="parts-h2">Rules whose outcome changed ({changed.length})</h3>
        {changed.length === 0 ? (
          <p className="pbox-note">Every rule has the same outcome for A and B.</p>
        ) : (
          <div className="pfindings">
            {changed.map((id) => {
              const before = oa.get(id);
              const after = ob.get(id);
              return (
                <div className="pfinding pfinding-unknown" key={id}>
                  <div className="pfinding-body">
                    <strong className="mono" style={{ fontSize: 11 }}>
                      {id}
                    </strong>
                  </div>
                  <div className="pfinding-meta">
                    {before ? (
                      <OutcomeBadge outcome={before} />
                    ) : (
                      <span className="dim">Not reported</span>
                    )}
                    <span aria-hidden="true">→</span>
                    <span className="sr-only">changed to</span>
                    {after ? (
                      <OutcomeBadge outcome={after} />
                    ) : (
                      <span className="dim">Not reported</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="pbox-note">
          A: ruleset {ra.ruleset_id}@{ra.ruleset_version}, revision {ra.build_revision}. B: ruleset{' '}
          {rb.ruleset_id}@{rb.ruleset_version}, revision {rb.build_revision}. Both are evaluated
          without capacity or cost evidence so they are compared like for like; the builder may show
          more results for the current revision. Unknown is never counted as compatible.
        </p>
      </>
    );
  }
  return (
    <section aria-labelledby="outcome-diff-heading" aria-busy={!ra || !rb}>
      <h2 id="outcome-diff-heading" className="parts-h2">
        Compatibility outcomes
      </h2>
      <p className="pbox-note">
        {a.label} vs {b.label}
      </p>
      {body}
    </section>
  );
}

function CostDiff({
  a,
  b,
  left,
  right,
}: {
  a: Side;
  b: Side;
  left: QueryLike<CostEstimate>;
  right: QueryLike<CostEstimate>;
}) {
  const ca = left.data;
  const cb = right.data;
  let body;
  if (left.isError || right.isError) {
    const failed = left.isError ? left : right;
    body = <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
  } else if (!ca || !cb) {
    body = <Loading label="Estimating cost for both builds…" />;
  } else {
    const ha = costHeadline(ca);
    const hb = costHeadline(cb);
    const comparable =
      ca.coverage === 'complete' &&
      cb.coverage === 'complete' &&
      ca.currency === cb.currency &&
      ca.period_days === cb.period_days;
    const delta = comparable ? Number(cb.total.amount) - Number(ca.total.amount) : null;
    body = (
      <>
        <div className="pt-wrap">
          <div className="pt-scroll" tabIndex={0} role="region" aria-label="Cost comparison">
            <table className="pt">
              <caption>Estimated cost of A and B</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span>Measure</span>
                  </th>
                  <th scope="col">
                    <span>A</span>
                  </th>
                  <th scope="col">
                    <span>B</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Estimate', va: ha.text, vb: hb.text },
                  { label: 'Coverage', va: humanize(ca.coverage), vb: humanize(cb.coverage) },
                  {
                    label: 'Unpriced components',
                    va: String(ca.unpriced_selection_ids.length),
                    vb: String(cb.unpriced_selection_ids.length),
                  },
                  { label: 'Period', va: `${ca.period_days} days`, vb: `${cb.period_days} days` },
                  { label: 'Pricebook', va: ca.pricebook_id, vb: cb.pricebook_id },
                ].map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td data-label="A">{r.va}</td>
                    <td data-label="B">{r.vb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="pbox-note">
          {delta !== null ? (
            <>
              <strong>Difference (B − A):</strong>{' '}
              {delta === 0
                ? 'no change'
                : `${delta > 0 ? '+' : '−'}${formatMoney(String(Math.abs(delta)), ca.currency)} per ${ca.period_days} days`}
              .
            </>
          ) : (
            <>
              <strong>Difference not computed:</strong> at least one estimate is incomplete or uses
              a different currency or period, so subtracting the totals would be misleading.
            </>
          )}
        </p>
        <p className="pbox-note">
          {ha.detail} {hb.detail !== ha.detail ? hb.detail : ''} Synthetic demo prices — not a
          quote.
        </p>
      </>
    );
  }
  return (
    <section aria-labelledby="cost-diff-heading" aria-busy={!ca || !cb}>
      <h2 id="cost-diff-heading" className="parts-h2">
        Estimated cost
      </h2>
      <p className="pbox-note">
        {a.label} vs {b.label}
      </p>
      {body}
    </section>
  );
}

// ---- start state -------------------------------------------------------------------------

interface PickOption {
  value: string;
  label: string;
  detail?: string;
}

function PickTwo({
  id,
  legend,
  options,
  onCompare,
}: {
  id: string;
  legend: string;
  options: PickOption[];
  onCompare: (values: [string, string]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (value: string, on: boolean) =>
    setPicked((p) =>
      on ? [...p.filter((v) => v !== value), value].slice(-2) : p.filter((v) => v !== value),
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (picked.length === 2) onCompare([picked[0]!, picked[1]!]);
      }}
    >
      <fieldset className="pbox-body" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 12, fontWeight: 600 }}>{legend}</legend>
        <p className="pbox-note" id={`${id}-hint`}>
          Choose exactly two. Choosing a third replaces the earliest choice.
        </p>
        <ul className="popt-list" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
          {options.map((o) => (
            <li key={o.value}>
              <label className="popt">
                <input
                  type="checkbox"
                  checked={picked.includes(o.value)}
                  onChange={(e) => toggle(o.value, e.target.checked)}
                  aria-describedby={`${id}-hint`}
                />
                <span>
                  {o.label}
                  {o.detail ? <span className="pt-sub">{o.detail}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <button type="submit" className="pbtn pbtn-primary" disabled={picked.length !== 2}>
        Compare {picked.length === 2 ? 'these two' : `(${picked.length} of 2 chosen)`}
      </button>
    </form>
  );
}

function CompareStart() {
  const navigate = useNavigate();
  const { draft } = useBuilder();
  const { builds } = useData();
  const saved = useQuery({ queryKey: ['builds', 'list'], queryFn: () => builds.list() });
  const readable = (saved.data ?? []).filter((s) => s.revision > 0);
  const changes = new Map(draft?.changes.map((c) => [c.revision, c]) ?? []);
  const revisionOptions: PickOption[] = [...(draft?.revisions ?? [])].reverse().map((r) => ({
    value: String(r.revision),
    label: `Revision ${r.revision}${r.revision === draft?.build.revision ? ' (current)' : ''}`,
    detail: changes.get(r.revision)?.summary,
  }));

  return (
    <div className="app-page parts-page">
      <div className="container">
        {/* Every route needs exactly one h1; this chooser previously rendered none. */}
        <PartsHead
          crumbs={
            <>
              <Link to="/">PickYour.AI</Link> <span>/</span>
              <Link to="/compare">Compare</Link> <span>/</span> Builds
            </>
          }
          title="Compare builds"
          description="Diff two revisions of your current build, or two saved builds: selections per tier, objectives, compatibility outcomes and estimated cost."
          actions={
            <Link className="pbtn" to="/compare">
              <Icon name="search" /> Compare components
            </Link>
          }
        />
        <div className="parts-sections">
          <section aria-labelledby="modes-heading">
            <h2 id="modes-heading" className="parts-h2">
              Two ways to compare
            </h2>
            <div className="parts-cols">
              <div className="pbox">
                <div className="pbox-head">Components</div>
                <div className="pbox-body">
                  <p className="pbox-note">
                    Pick 2–{SLOTS} catalog components with the compare checkboxes on a selection
                    page. They line up field by field with differences marked, and each column can
                    be added to your stack.
                  </p>
                  <Link className="pbtn" to="/catalog">
                    Browse the catalog
                  </Link>
                </div>
              </div>
              <div className="pbox">
                <div className="pbox-head">Builds</div>
                <div className="pbox-body">
                  <p className="pbox-note">
                    Diff two revisions of your current build, or two saved builds: selections per
                    tier, objectives, compatibility outcomes and estimated cost.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section aria-labelledby="rev-heading">
            <h2 id="rev-heading" className="parts-h2">
              Revisions of your current build
            </h2>
            {!draft ? (
              <Loading label="Loading your current build…" />
            ) : draft.revisions.length < 2 ? (
              <p className="pbox-note">
                &ldquo;{draft.build.name}&rdquo; has only one kept revision. Every change in the{' '}
                <Link to="/builder">builder</Link> creates a new one.
              </p>
            ) : (
              <PickTwo
                id="pick-revisions"
                legend={`Revisions of “${draft.build.name}”`}
                options={revisionOptions}
                onCompare={([x, y]) => {
                  const [lo, hi] = [Number(x), Number(y)].sort((m, n) => m - n);
                  void navigate(`/compare?revisions=${lo},${hi}`);
                }}
              />
            )}
          </section>

          <section aria-labelledby="saved-heading">
            <h2 id="saved-heading" className="parts-h2">
              Saved builds
            </h2>
            {saved.isError ? (
              <ErrorState error={saved.error} onRetry={() => void saved.refetch()} />
            ) : !saved.data ? (
              <Loading label="Loading saved builds…" />
            ) : readable.length < 2 ? (
              <p className="pbox-note">
                You need at least two saved builds in this browser. See{' '}
                <Link to="/builds">My Builds</Link>.
              </p>
            ) : (
              <PickTwo
                id="pick-builds"
                legend="Saved builds in this browser"
                options={readable.map((s) => ({
                  value: s.id,
                  label: s.name,
                  detail: `Revision ${s.revision} · ${s.selectionCount} selection${s.selectionCount === 1 ? '' : 's'}`,
                }))}
                onCompare={([x, y]) =>
                  void navigate(`/compare?builds=${encodeURIComponent(x)},${encodeURIComponent(y)}`)
                }
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
