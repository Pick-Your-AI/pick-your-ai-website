/*
 * Component detail (mock `#detailScreen` + `renderDetail()`).
 *
 * The mock shows a "provider / developer". The contract has no such field, so the at-a-glance table
 * reports what the record actually carries: kind, tier, licence, billing class, status, version,
 * provenance freshness and the illustrative price. Nothing is invented and every price comes from
 * the preview estimator.
 */
import { Fragment, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  KIND_LABELS,
  TIER_LABELS,
  isComponentKind,
  kindDef,
  kindFromSlug,
  labelInSentence,
} from '../../contracts';
import type { CatalogItem } from '../../contracts';
import { addOrReplace } from '../../domain/build';
import { evidenceDateLabel, itemFreshness } from '../../domain/freshness';
import { useBuilder } from '../../app/builder-context';
import { useCatalog, useCompatibleOptions, usePricebook } from '../../app/queries';
import { ErrorState, Loading, useToast } from '../../components/feedback';
import { Icon } from '../../components/icon';
import { BILLING_LABELS, idToSlug, itemPath, slugToId } from '../../lib/catalog-view';
import { itemPrice } from '../../lib/item-cost';
import { itemLogo } from '../../lib/layers';
import { type FieldDef, formatValue, specFields } from '../../lib/schema-fields';
import NotFoundPage from '../../pages/NotFoundPage';
import { accessSummary, licenseLine, strongestVerification, verificationLabel } from './shared';

export default function ComponentDetailPage() {
  const { kindSlug = '', itemSlug = '' } = useParams();
  const rawKind = kindFromSlug(kindSlug);
  const kind = isComponentKind(rawKind) ? rawKind : null;
  const itemId = slugToId(itemSlug);

  const catalog = useCatalog();
  const pricebook = usePricebook();
  const { draft, apply } = useBuilder();
  const toast = useToast();
  const navigate = useNavigate();
  const build = draft?.build ?? null;
  const options = useCompatibleOptions(kind ? build : null, kind ?? 'workload');

  if (catalog.isPending)
    return (
      <div className="app-page">
        <div className="container detail-container">
          <Loading label="Loading component…" />
        </div>
      </div>
    );

  if (catalog.isError)
    return (
      <div className="app-page">
        <div className="container detail-container">
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        </div>
      </div>
    );

  const item = catalog.byId.get(itemId);
  if (!kind || !item || item.kind !== kind) return <NotFoundPage />;

  const label = KIND_LABELS[item.kind];
  const def = kindDef(item.kind);
  const logo = itemLogo(item);
  const spec = item.spec as Record<string, unknown>;
  const fields = specFields(item.kind);
  const price = itemPrice(item, build, catalog.byId, pricebook.data);
  const freshness = itemFreshness(item);
  const verification = strongestVerification(item);
  const inStack = Boolean(build?.selections.some((s) => s.catalog_item_id === item.id));

  const verdict = options.data?.find((option) => option.catalog_item_id === item.id);
  const conflicts = verdict?.verdict === 'incompatible' ? Math.max(verdict.rule_ids.length, 1) : 0;
  const unknown = !verdict || verdict.verdict === 'unknown';

  const siblings = (catalog.data?.items ?? []).filter(
    (other) => other.kind === item.kind && other.id !== item.id,
  );
  const related = siblings.slice(0, 3);
  const compareHref = `/compare?ids=${[item, ...siblings.slice(0, 2)]
    .map((entry) => idToSlug(entry.id))
    .join(',')}`;

  const add = () => {
    if (!build) {
      toast('Your stack is still loading.');
      return;
    }
    apply((b) => addOrReplace(b, item, catalog.byId), `Added ${label}: ${item.name}`, [item.kind]);
    toast(`${item.name} added to your stack.`);
  };

  const renderSpecValue = (field: FieldDef, value: unknown): ReactNode => {
    if (field.isRef) {
      const refIds = Array.isArray(value)
        ? value.map(String)
        : typeof value === 'string'
          ? [value]
          : [];
      if (refIds.length)
        return refIds.map((refId, index) => {
          const ref: CatalogItem | undefined = catalog.byId.get(refId);
          return (
            <Fragment key={refId}>
              {index > 0 ? ', ' : ''}
              {ref ? (
                <Link className="text-link" to={itemPath(ref)}>
                  {ref.name}
                </Link>
              ) : (
                `${refId} (not in catalog)`
              )}
            </Fragment>
          );
        });
    }
    return formatValue(value, field);
  };

  const glance: { label: string; value: ReactNode }[] = [
    { label: 'Component kind', value: label },
    { label: 'Layer', value: `${def.tier} · ${TIER_LABELS[def.tier]}` },
    { label: 'License / access', value: licenseLine(item) },
    { label: 'Billing class', value: BILLING_LABELS[item.billing_class] },
    { label: 'Record status', value: item.status },
    { label: 'Catalog version', value: item.version },
    {
      label: 'Provenance',
      value: `${verificationLabel(verification)} · ${evidenceDateLabel(freshness)}`,
    },
    {
      label: 'Illustrative baseline',
      value: price.amount ? `${price.label} / month` : `${price.label} — ${price.note}`,
    },
    {
      label: 'Demo compatibility',
      value:
        conflicts > 0
          ? `${conflicts} detected conflict${conflicts === 1 ? '' : 's'} in current demo choices`
          : unknown
            ? 'Unknown — the demo rules cannot decide this item yet'
            : 'No detected conflicts in current demo choices',
    },
  ];

  return (
    <div className="app-page">
      <div className="container detail-container">
        <div className="breadcrumb">
          <Link to="/catalog">COMPONENT CATALOG</Link>
          <span>/</span>
          <span>{item.name.toUpperCase()}</span>
        </div>
        <div className="detail-layout">
          <div>
            <div className="detail-hero">
              <div className="detail-identity">
                <span className={`component-logo ${logo.color}`} aria-hidden="true">
                  {logo.text}
                </span>
                <div>
                  <div className="eyebrow">
                    {def.tier} / {label.toUpperCase()} / COMPONENT PROFILE
                  </div>
                  <h1>{item.name}</h1>
                </div>
              </div>
              <p className="detail-lead">{item.description}</p>
              <div className="detail-tags">
                {(item.tags ?? []).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
                <span>{accessSummary(item)}</span>
              </div>
            </div>
            <h2 className="detail-subhead">At a glance</h2>
            <div className="detail-table">
              {glance.map((row) => (
                <div key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
            <div className="detail-note">
              <Icon name="info" />
              <div>
                <strong>Preview data only.</strong> This component description, compatibility
                coverage and estimated costs are illustrative. The production catalog needs sourced
                product specifications, verified versions and source freshness metadata.
              </div>
            </div>
            <h2 className="detail-subhead">Specification</h2>
            <div className="detail-table">
              {fields.map((field) => (
                <div key={field.key}>
                  <span>{field.label}</span>
                  <strong>{renderSpecValue(field, spec[field.key])}</strong>
                </div>
              ))}
            </div>

            <h2 className="detail-subhead">Evidence &amp; provenance</h2>
            <p className="detail-provenance-status">
              Recorded provenance status: <strong>{verificationLabel(verification)}</strong>
            </p>
            <div className="detail-note">
              <Icon name="info" />
              <div>
                This date does not establish currentness or independent verification. Historical
                verified labels may record source checks only. Independent verification requires
                linked reproduction or corroboration; the recorded status alone is not proof.
              </div>
            </div>
            <ul className="detail-provenance">
              {item.provenance.length ? (
                item.provenance.map((entry, index) => (
                  <li key={`${entry.checked_at}-${index}`}>
                    {entry.source_uri ? (
                      <a className="text-link" href={entry.source_uri} rel="noopener noreferrer">
                        Source
                      </a>
                    ) : (
                      <span className="dim">No source URL recorded</span>
                    )}{' '}
                    · {entry.verification_status} · checked {entry.checked_at.slice(0, 10)}
                    {entry.notes ? <span className="pt-sub">{entry.notes}</span> : null}
                  </li>
                ))
              ) : (
                <li className="dim">No provenance records in this demo item.</li>
              )}
            </ul>
          </div>
          <aside className="detail-aside">
            <div className="detail-buy">
              <div className="eyebrow">EXAMPLE MONTHLY BASELINE</div>
              <div className="big-price">
                {price.amount ? price.label : 'Unknown'}{' '}
                <span>{price.amount ? '/ month*' : 'no demo rate'}</span>
              </div>
              <p>
                Not a vendor quote. Runtime, traffic, usage, and region can change the real cost
                significantly.
              </p>
              <button className="btn btn-primary" type="button" onClick={add} disabled={!build}>
                {inStack ? '✓ In your build' : 'Add to my stack →'}
              </button>
              <Link className="btn btn-outline" to={compareHref}>
                Compare alternatives ↗
              </Link>
              <div className={conflicts ? 'status-bar issue' : 'status-bar'}>
                <Icon name={conflicts ? 'x-circle' : unknown ? 'alert' : 'check-circle'} />
                {conflicts
                  ? `${conflicts} demo conflict${conflicts === 1 ? '' : 's'} to review`
                  : unknown
                    ? 'Unknown in demo rules — not treated as compatible'
                    : 'No conflicts in demo rules'}
              </div>
            </div>
            <div className="detail-related">
              <h3>Other {labelInSentence(label)}</h3>
              {related.length ? (
                related.map((other) => (
                  <button
                    key={other.id}
                    type="button"
                    onClick={() => void navigate(itemPath(other))}
                  >
                    {other.name} <Icon name="arrow-right" />
                  </button>
                ))
              ) : (
                <p>No other {labelInSentence(label)} records in this demo catalog.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
