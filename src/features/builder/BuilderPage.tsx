/*
 * System builder.
 *
 * Follows the PCPartPicker builder pattern in docs/research/pcpartpicker-ux-notes.md §3: a fixed,
 * ordered row per component slot with a "Choose …" empty state, a toolbar above the table, a status
 * strip carrying the worst outcome plus live estimates, a running total under the table, lettered
 * findings with a severity word, and an explicit "what was not checked" note.
 *
 * Rows are contract component *kinds* grouped by tier, because a tier holds several decisions
 * (T1 has a model and its provider). Only required kinds get an empty row; optional kinds are
 * reachable from their group header, so the table stays as short as the build actually is.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { BuildSnapshot, CatalogItem, ComponentKind, Tier } from '../../contracts';
import { KIND_LABELS, kindsInTier } from '../../contracts';
import type { BuildContext } from '../../domain/activation';
import { KIND_NEED_LABEL, buildContext, coverage, kindNeed } from '../../domain/activation';
import { removeSelection, rename, updateObjectives, updateSettings } from '../../domain/build';
import { canExport, encodeShareFragment, exportBuild, exportFileName } from '../../domain/share';
import { useBuilder } from '../../app/builder-context';
import { useData } from '../../app/data-context';
import { useBuildAnalysis, useCatalog, usePricebook } from '../../app/queries';
import { ErrorState, Loading, Modal, useToast } from '../../components/feedback';
import { Icon } from '../../components/icon';
import { Findings, Money, NotEvaluated, PartsHead, StatusStrip } from '../../components/parts';
import { flaggedFindings, costHeadline } from './analysis';
import { itemPrice } from '../../lib/item-cost';
import { kindPath, rowSubtitle } from '../../lib/catalog-view';
import { settingsFields } from '../../lib/schema-fields';
import { LAYERS, itemLogo, layerOf } from '../../lib/layers';
import { download } from './BuildToolbar';
import { ObjectivesForm } from './ObjectivesForm';
import { SettingsForm } from './SettingsForm';

const VERIFICATION: Record<string, string> = {
  verified: 'Verified',
  user_supplied: 'User supplied',
  estimated: 'Estimated',
  unverified: 'Unverified',
};

/** Evidence line for one catalog item: how it was verified and when. */
function evidenceLine(item: CatalogItem): { label: string; stale: boolean } {
  const statuses = item.provenance.map((p) => p.verification_status);
  const best = ['verified', 'user_supplied', 'estimated', 'unverified'].find((s) =>
    statuses.includes(s as never),
  );
  const checked = item.provenance
    .map((p) => p.checked_at)
    .sort()
    .at(-1);
  const days = checked ? Math.floor((Date.now() - Date.parse(checked)) / 86_400_000) : undefined;
  return {
    label: `${VERIFICATION[best ?? 'unverified'] ?? 'Unverified'}${days === undefined ? '' : ` · ${days}d`}`,
    stale: days !== undefined && days > 30,
  };
}

function GroupRow({
  tier,
  ctx,
  build,
  onAdd,
}: {
  tier: Tier;
  ctx: BuildContext;
  build: BuildSnapshot;
  onAdd: () => void;
}) {
  const layer = layerOf(tier);
  const kinds = kindsInTier(tier).map((k) => k.kind);
  const required = kinds.filter((k) => kindNeed(k, ctx.mode) === 'needed');
  const done = required.filter((k) =>
    build.selections.some((s) => s.enabled && s.kind === k),
  ).length;
  const optional = kinds.filter((k) => kindNeed(k, ctx.mode) !== 'needed');
  const optionalDone = optional.filter((k) =>
    build.selections.some((s) => s.enabled && s.kind === k),
  ).length;
  const status = required.length
    ? `Required ${done}/${required.length}`
    : optional.length
      ? `Optional ${optionalDone}/${optional.length}`
      : KIND_NEED_LABEL.not_needed;
  const anySelected = kinds.some((k) => build.selections.some((s) => s.enabled && s.kind === k));
  return (
    <tr className="pt-group">
      <th colSpan={6} scope="colgroup">
        <div className="pt-group-inner">
          <span className={anySelected ? 'pt-tier on' : 'pt-tier'}>{tier}</span>
          <strong>{layer.name}</strong>
          <span className="grow" />
          <span className="pt-skip">{status}</span>
          <button type="button" className="pbtn" onClick={onAdd}>
            <Icon name="plus" /> Add component
          </button>
        </div>
      </th>
    </tr>
  );
}

function ComponentRow({
  kind,
  selectionId,
  item,
  price,
  onConfigure,
  onRemove,
}: {
  kind: ComponentKind;
  selectionId: string;
  item: CatalogItem | undefined;
  price: ReturnType<typeof itemPrice> | undefined;
  onConfigure: () => void;
  onRemove: () => void;
}) {
  const evidence = item ? evidenceLine(item) : undefined;
  const logo = item ? itemLogo(item) : undefined;
  return (
    <tr>
      <th scope="row" data-label="Component">
        <span className="pt-name">
          <span className="dim" style={{ fontSize: 11 }}>
            {KIND_LABELS[kind]}
          </span>
        </span>
      </th>
      <td data-label="Selection">
        <div className="pt-name">
          {logo ? (
            <span className={`component-logo ${logo.color}`} aria-hidden="true">
              {logo.text}
            </span>
          ) : null}
          {item ? (
            <span>
              <Link to={`${kindPath(kind)}/${item.id.replace(/\./g, '~')}`}>{item.name}</Link>
              {rowSubtitle(item) ? <span className="pt-sub">{rowSubtitle(item)}</span> : null}
            </span>
          ) : (
            <span className="dim">{selectionId}</span>
          )}
        </div>
      </td>
      <td data-label="Cost basis">
        {item ? (
          <span className={item.billing_class === 'unknown' ? 'pchip pchip-unknown' : 'pchip'}>
            {item.billing_class}
          </span>
        ) : (
          <span className="dim">—</span>
        )}
      </td>
      <td data-label="Evidence">
        {evidence ? (
          <span className={evidence.stale ? 'pchip pchip-unknown' : 'pchip'}>{evidence.label}</span>
        ) : (
          <span className="dim">—</span>
        )}
      </td>
      <td className="num" data-label="Est. cost">
        <CostCell price={price} />
      </td>
      <td data-label="Actions">
        <div className="pt-actions">
          <Link
            className="pbtn pbtn-icon"
            to={`${kindPath(kind)}?replace=${encodeURIComponent(selectionId)}`}
            aria-label={`Change ${KIND_LABELS[kind]}`}
            title="Choose a different component"
          >
            <Icon name="arrow-right" />
          </Link>
          {settingsFields(kind).length ? (
            <button
              type="button"
              className="pbtn pbtn-icon"
              aria-label={`Configure ${item?.name ?? KIND_LABELS[kind]}`}
              onClick={onConfigure}
            >
              <Icon name="wand" />
            </button>
          ) : null}
          <button
            type="button"
            className="pbtn pbtn-icon"
            aria-label={`Remove ${item?.name ?? KIND_LABELS[kind]} from the stack`}
            onClick={onRemove}
          >
            <Icon name="x" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Price cell. `Included` and `Free` are words, not "$0": a zero would read as a measured charge.
 * A metered component with no applicable rate is `Unknown`, never zero.
 */
function CostCell({ price }: { price: ReturnType<typeof itemPrice> | undefined }) {
  if (!price) return <span className="dim">—</span>;
  if (price.amount === null) return <span className="pchip pchip-unknown">Unknown</span>;
  if (Number(price.amount) === 0) return <span className="dim">Included</span>;
  return <Money amount={price.amount} currency={price.currency} />;
}

function EmptyRow({ kind, onChoose }: { kind: ComponentKind; onChoose: () => void }) {
  return (
    <tr>
      <th scope="row" data-label="Component">
        <span className="dim" style={{ fontSize: 11 }}>
          {KIND_LABELS[kind]}
        </span>
      </th>
      <td colSpan={4} data-label="Selection">
        <button type="button" className="pt-choose" onClick={onChoose}>
          <Icon name="plus" /> Choose {KIND_LABELS[kind].toLowerCase()}
        </button>
      </td>
      <td data-label="Actions">
        <span className="pt-skip">Required</span>
      </td>
    </tr>
  );
}

export default function BuilderPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { draft, ready, apply, startNew, saveState } = useBuilder();
  const { mode } = useData();
  const catalog = useCatalog();
  const pricebook = usePricebook();
  const build = draft?.build;
  const analysis = useBuildAnalysis(build);

  const [name, setName] = useState<string | null>(null);
  const [configure, setConfigure] = useState<string | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);

  const byId = catalog.byId;
  const ctx = useMemo(() => (build ? buildContext(build, byId) : undefined), [build, byId]);
  const cov = useMemo(() => (build && ctx ? coverage(build, ctx) : undefined), [build, ctx]);

  const jsonPreview = useMemo(() => {
    if (!jsonOpen || !build) return '';
    try {
      return JSON.stringify(exportBuild(build, mode), null, 2);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [jsonOpen, build, mode]);

  if (catalog.isError)
    return (
      <div className="app-page parts-page">
        <div className="container">
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        </div>
      </div>
    );
  if (!ready || !build || !catalog.data || !ctx || !cov)
    return (
      <div className="app-page parts-page">
        <div className="container">
          <Loading label="Loading builder…" />
        </div>
      </div>
    );

  const report = analysis.reportIsCurrent ? analysis.report : undefined;
  const failed = report?.summary.failed ?? 0;
  const unknown = report?.summary.unknown ?? 0;
  const flagged = flaggedFindings(report);
  const total = analysis.costIsCurrent ? analysis.cost : undefined;
  const headline = costHeadline(total);
  const selectedCount = build.selections.filter((s) => s.enabled).length;
  const requiredDone = cov.needed.length - cov.missing.length;
  const outcome: 'pass' | 'fail' | 'unknown' | 'none' = failed
    ? 'fail'
    : unknown
      ? 'unknown'
      : report
        ? cov.missing.length
          ? 'unknown'
          : 'pass'
        : 'none';

  const commitName = () => {
    const next = (name ?? build.name).trim();
    setName(null);
    if (next && next !== build.name)
      apply((b) => rename(b, next), `Renamed build to "${next}"`, []);
  };

  const remove = (selectionId: string, kind: ComponentKind, itemName: string) => {
    apply((b) => removeSelection(b, selectionId), `Removed ${KIND_LABELS[kind]}: ${itemName}`, [
      kind,
    ]);
    toast(`${itemName} removed from your stack.`);
  };

  const exportJson = () => {
    const problem = canExport(build);
    if (problem) {
      toast(problem);
      return;
    }
    download(exportFileName(build), JSON.stringify(exportBuild(build, mode), null, 2) + '\n');
    toast('Configuration exported as JSON.');
  };

  const share = async () => {
    const url = `${location.origin}/shared#${encodeShareFragment(build, mode)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Share link copied. The build travels in the link itself (after #).');
    } catch {
      toast('Could not copy the link. Use Export instead.');
    }
  };

  const configureSelection = configure
    ? build.selections.find((s) => s.id === configure)
    : undefined;
  const configureItem = configureSelection
    ? byId.get(configureSelection.catalog_item_id)
    : undefined;

  /** Rows for one tier: every selected component, plus an empty row for each required gap. */
  const rowsFor = (tier: Tier) => {
    const kinds = kindsInTier(tier).map((k) => k.kind);
    const rows: React.ReactNode[] = [];
    for (const kind of kinds) {
      const selections = build.selections.filter((s) => s.enabled && s.kind === kind);
      if (selections.length === 0) {
        if (kindNeed(kind, ctx.mode) === 'needed')
          rows.push(
            <EmptyRow key={kind} kind={kind} onChoose={() => void navigate(kindPath(kind))} />,
          );
        continue;
      }
      for (const selection of selections) {
        const item = byId.get(selection.catalog_item_id);
        rows.push(
          <ComponentRow
            key={selection.id}
            kind={kind}
            selectionId={selection.id}
            item={item}
            price={item ? itemPrice(item, build, byId, pricebook.data) : undefined}
            onConfigure={() => setConfigure(selection.id)}
            onRemove={() => remove(selection.id, kind, item?.name ?? selection.catalog_item_id)}
          />,
        );
      }
    }
    return rows;
  };

  return (
    <div className="app-page parts-page">
      <div className="container">
        <PartsHead
          crumbs={
            <>
              <Link to="/">PickYour.AI</Link> <span>/</span> Builder
            </>
          }
          title="Choose your parts"
          description="One row per component slot, in dependency order. Prices and compatibility come from synthetic demo data; nothing here is a quote or a vendor specification."
          actions={
            <>
              <button type="button" className="pbtn" onClick={() => setJsonOpen(true)}>
                <Icon name="code" /> View JSON
              </button>
              <button type="button" className="pbtn" onClick={() => void share()}>
                <Icon name="copy" /> Share
              </button>
              <button type="button" className="pbtn pbtn-primary" onClick={exportJson}>
                <Icon name="download" /> Export
              </button>
            </>
          }
        />

        {/* Toolbar: name, state, local-first actions (research §3.9). */}
        <div className="pbar">
          <div className="pbar-field">
            <Icon name="layers" />
            <input
              aria-label="Build name"
              className="pbar-input"
              maxLength={160}
              type="text"
              value={name ?? build.name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
              }}
            />
            <span className="pbar-meta">
              {saveState?.status === 'error' ? 'Not saved' : 'Draft'} · rev {build.revision}
            </span>
          </div>
          <div className="pbar-actions">
            <button
              type="button"
              className="pbtn"
              onClick={() => {
                startNew();
                toast('New blank build created.');
              }}
            >
              <Icon name="plus" /> New
            </button>
            <Link className="pbtn" to="/builds">
              <Icon name="download" /> Save / history
            </Link>
            <Link className="pbtn" to="/summary">
              <Icon name="list" /> Summary
            </Link>
          </div>
        </div>

        <StatusStrip
          outcome={outcome}
          headline={
            failed
              ? `${failed} compatibility error${failed === 1 ? '' : 's'}`
              : unknown
                ? `${unknown} check${unknown === 1 ? '' : 's'} unknown`
                : cov.missing.length
                  ? `${cov.missing.length} required component${cov.missing.length === 1 ? '' : 's'} missing`
                  : report
                    ? 'No compatibility errors'
                    : 'Not evaluated yet'
          }
          detail={
            failed
              ? 'See the compatibility notes below.'
              : unknown
                ? 'Unknown is not a pass.'
                : cov.missing.length
                  ? 'The rows marked Required are still empty.'
                  : undefined
          }
          stats={[
            { label: 'Required', value: `${requiredDone}/${cov.needed.length}` },
            { label: 'Selected', value: String(selectedCount) },
            {
              label: 'Est. monthly',
              value: total ? headline.text.split(' /')[0]! : '—',
              unknown: !total || total.coverage !== 'complete',
            },
            { label: 'Unknown checks', value: String(unknown), unknown: unknown > 0 },
          ]}
        />

        <div className="pt-wrap">
          <div className="pt-scroll" tabIndex={0} role="region" aria-label="Scrollable parts table">
            <table className="pt">
              <caption>Stack components by layer · T0 to T6 · {selectedCount} selected</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span>Component</span>
                  </th>
                  <th scope="col">
                    <span>Selection</span>
                  </th>
                  <th scope="col">
                    <span>Cost basis</span>
                  </th>
                  <th scope="col">
                    <span>Evidence</span>
                  </th>
                  <th scope="col" className="num">
                    <span>Est. cost</span>
                  </th>
                  <th scope="col" className="num">
                    <span>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {LAYERS.map((layer) => {
                  return [
                    <GroupRow
                      key={`${layer.tier}-group`}
                      tier={layer.tier}
                      ctx={ctx}
                      build={build}
                      onAdd={() => void navigate(`/catalog?layer=${layer.tier}`)}
                    />,
                    ...rowsFor(layer.tier),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="pt-foot">
          <div className="total">
            <span>Estimated total</span>
            <strong>{total ? headline.text.split(' /')[0] : '—'}</strong>
            <small>
              {total
                ? total.coverage === 'complete'
                  ? `/${total.period_days} days · synthetic estimate`
                  : `/${total.period_days} days · lower bound, ${total.unpriced_selection_ids.length} unpriced`
                : 'nothing priced yet'}
            </small>
          </div>
          <span className="pbar-meta">Not a quote · synthetic demo pricebook</span>
        </div>

        <div className="parts-sections">
          <section aria-labelledby="notes-heading">
            <h2 id="notes-heading" className="parts-h2">
              Compatibility notes
            </h2>
            <Findings
              report={report}
              lettered={flagged.map((f) => ({ rule_id: f.rule_id, letter: f.letter }))}
            />
            <div style={{ marginTop: 8 }}>
              <NotEvaluated report={report} />
            </div>
          </section>

          <details className="pdetails">
            <summary>
              <Icon name="chart" /> Cost breakdown ({total?.line_items.length ?? 0} line items)
            </summary>
            <div className="pdetails-body">
              {total ? (
                <>
                  <div className="pt-scroll" tabIndex={0} role="region" aria-label="Cost lines">
                    <table className="pt">
                      <thead>
                        <tr>
                          <th scope="col">
                            <span>Selection</span>
                          </th>
                          <th scope="col">
                            <span>Meter</span>
                          </th>
                          <th scope="col" className="num">
                            <span>Qty</span>
                          </th>
                          <th scope="col" className="num">
                            <span>Unit</span>
                          </th>
                          <th scope="col" className="num">
                            <span>Amount</span>
                          </th>
                          <th scope="col">
                            <span>Confidence</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {total.line_items.map((li) => {
                          const sel = build.selections.find((s) => s.id === li.selection_id);
                          const item = sel ? byId.get(sel.catalog_item_id) : undefined;
                          return (
                            <tr key={li.id}>
                              <th scope="row">{item?.name ?? li.selection_id}</th>
                              <td>{li.meter.replace(/_/g, ' ')}</td>
                              <td className="num">{li.quantity}</td>
                              <td className="num">
                                <Money
                                  amount={li.unit_price.amount}
                                  currency={li.unit_price.currency}
                                />
                              </td>
                              <td className="num">
                                <Money amount={li.amount.amount} currency={li.amount.currency} />
                              </td>
                              <td>{li.confidence}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="pbox-note" style={{ padding: '8px 0 0' }}>
                    {headline.detail} Unpriced components are never counted as zero.
                  </p>
                </>
              ) : (
                <p className="pbox-note">Nothing has been priced for this revision yet.</p>
              )}
            </div>
          </details>

          <details className="pdetails">
            <summary>
              <Icon name="list" /> Objectives and policy
            </summary>
            <div className="pdetails-body">
              <ObjectivesForm
                key={`${build.id}-${build.revision}`}
                build={build}
                onApply={(objectives, policy) =>
                  apply(
                    (b) => ({ ...updateObjectives(b, objectives), policy }),
                    'Updated build objectives',
                    ['workload', 'cost_policy', 'hosting_platform', 'deployment_target'],
                  )
                }
              />
            </div>
          </details>

          <details className="pdetails">
            <summary>
              <Icon name="workflow" /> Revision history ({draft.changes.length})
            </summary>
            <div className="pdetails-body">
              <ol className="summary-history">
                {[...draft.changes].reverse().map((c) => (
                  <li key={c.revision}>
                    <span className="mono">r{c.revision}</span>
                    <span>{c.summary}</span>
                    <time className="dim" dateTime={c.at}>
                      {new Date(c.at).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
            </div>
          </details>
        </div>
      </div>

      <Modal
        open={jsonOpen}
        title="Your build configuration"
        subtitle="Portable JSON manifest · contract BuildSnapshot"
        onClose={() => setJsonOpen(false)}
        primaryLabel="Copy JSON"
        onPrimary={() => {
          void navigator.clipboard
            .writeText(jsonPreview)
            .then(() => toast('Configuration JSON copied'))
            .catch(() => toast('Copy was blocked by this browser.'));
        }}
      >
        <pre id="jsonPreview">{jsonPreview}</pre>
      </Modal>

      <Modal
        open={Boolean(configureSelection && configureItem)}
        title={configureItem ? `Configure ${configureItem.name}` : 'Configure component'}
        subtitle="Contract settings for this selection"
        onClose={() => setConfigure(null)}
      >
        {configureSelection && configureItem ? (
          <SettingsForm
            kind={configureSelection.kind as ComponentKind}
            values={configureSelection.settings as Record<string, unknown>}
            onCancel={() => setConfigure(null)}
            onApply={(patch) => {
              apply(
                (b) => updateSettings(b, configureSelection.id, patch),
                `Changed ${KIND_LABELS[configureSelection.kind]} settings`,
                [configureSelection.kind],
              );
              setConfigure(null);
              toast('Settings updated. Rules were re-evaluated.');
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
