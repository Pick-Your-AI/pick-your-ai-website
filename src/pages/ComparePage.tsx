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
 */
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { CatalogItem, Tier } from '../contracts';
import { KIND_LABELS, kindsInTier, labelInSentence } from '../contracts';
import { addOrReplace } from '../domain/build';
import { useBuilder } from '../app/builder-context';
import { useCatalog, useCompatibleOptions, usePricebook } from '../app/queries';
import { BILLING_LABELS, idToSlug, slugToId } from '../lib/catalog-view';
import { itemPrice } from '../lib/item-cost';
import { LAYERS, headlineKind, itemLogo, layerOf } from '../lib/layers';
import { formatValue, humanize, specFields } from '../lib/schema-fields';
import { ErrorState, Loading, useToast } from '../components/feedback';
import { Icon } from '../components/icon';
import { CompatChip, Money, PartsHead, type Verdict } from '../components/parts';

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

export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const catalog = useCatalog();
  const pricebook = usePricebook();
  const { draft, apply, catalogById } = useBuilder();

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
    const id = requestedIds ? requestedIds[index] : layerItems[index]?.id;
    if (!id) return undefined;
    const item = catalog.byId.get(id);
    return item && item.tier === tier ? item : undefined;
  };
  const slots = Array.from({ length: SLOTS }, (_, index) => slotItem(index));
  const filled = slots.filter(Boolean) as CatalogItem[];

  const updateIds = (next: (string | undefined)[]) => {
    const trimmed = [...next];
    while (trimmed.length && !trimmed[trimmed.length - 1]) trimmed.pop();
    const search = new URLSearchParams(params);
    search.set('layer', tier);
    if (trimmed.some(Boolean))
      search.set('ids', trimmed.map((id) => (id ? idToSlug(id) : '')).join(','));
    else search.delete('ids');
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

  const applyItem = (item: CatalogItem) => {
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

  /** Resolve a `*_ref` value to the referenced catalog item's display name. */
  const refName = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    return catalog.byId.get(value)?.name;
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
      render: (item) => {
        const price = itemPrice(item, draft?.build, catalog.byId, pricebook.data);
        if (price.amount === null) return <span className="pchip pchip-unknown">Unknown</span>;
        if (Number(price.amount) === 0) return <span className="dim">Included</span>;
        return <Money amount={price.amount} currency={price.currency} />;
      },
      compare: (item) =>
        itemPrice(item, draft?.build, catalog.byId, pricebook.data).amount ?? 'unknown',
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
        const checked = item.provenance
          .map((p) => p.checked_at)
          .sort()
          .at(-1);
        return (
          <>
            {humanize(best ?? 'unverified')}
            {checked ? (
              <span className="pt-sub">
                checked {new Date(checked).toLocaleDateString()} · v{item.version}
              </span>
            ) : null}
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
          disabled={!draft}
          title={draft ? undefined : 'Open a build before adding components'}
          onClick={() => applyItem(item)}
        >
          <Icon name="plus" /> Use this part
        </button>
      ),
      compare: () => '',
    },
  ];

  const differs = (row: Row): boolean => {
    if (!row.compare(filled[0]!) || row.key === 'fits' || row.key === 'add') return false;
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
                  {layer.name} · {labelInSentence(KIND_LABELS[preferred])} · {filled.length} of{' '}
                  {SLOTS} slots filled
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
                    {tierItems.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name} — {KIND_LABELS[option.kind]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="pt-wrap">
              <div className="pt-scroll" tabIndex={0} role="region" aria-label="Comparison table">
                <table className="pcmp">
                  <caption className="sr-only">
                    Side-by-side comparison of {filled.length} {layer.name} components
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
                              {tierItems.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name} — {KIND_LABELS[option.kind]}
                                </option>
                              ))}
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
                  product lacks the capability.
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
  if (!options.data) return <span className="cmp-empty">Checking…</span>;
  const verdict = (options.data.find((o) => o.catalog_item_id === item.id)?.verdict ??
    'unknown') as Verdict;
  return <CompatChip verdict={verdict} />;
}
