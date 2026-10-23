/*
 * Starter builds (mock: `#templatesScreen` + `renderFullTemplates()` in the mock script).
 * Four complete demo configurations, each shown as the mock's seven-node diagram: one node per
 * layer with the chosen component's name as the node tooltip and the real estimator's monthly
 * total in the footer. Everything is synthetic demo data; the footer labels it illustrative.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { BuildSnapshot, CatalogItem } from '../contracts';
import { kindDef } from '../contracts';
import { useBuilder } from '../app/builder-context';
import { useData } from '../app/data-context';
import { useCatalog } from '../app/queries';
import { STARTERS, type Starter } from '../data/fixture/starters';
import { costShort } from '../features/builder/analysis';
import { LAYERS } from '../lib/layers';
import { Icon } from '../components/icon';
import { Loading, useToast } from '../components/feedback';
import { PageHeader } from '../components/layout';

/**
 * Kicker copy for the four demo starters, mirroring the mock's per-template labels. Keyed by the
 * starter id from the fixture; unknown ids fall back to a numbered label.
 */
const KICKERS: Record<string, string> = {
  'api-support-chat': '01 / BUSINESS WORKFLOWS',
  'self-hosted-one-gpu': '02 / SELF HOSTED',
  'document-qa-rag': '03 / KNOWLEDGE SYSTEMS',
  'ticket-triage-agent': '04 / AGENTS & AUTOMATION',
};

const displayTitle = (starter: Starter) => starter.title.replace(/\s*\(demo\)$/i, '');

/** One node per layer: the icon always identifies the layer, the tooltip names the component. */
function layerNodes(build: BuildSnapshot, byId: ReadonlyMap<string, CatalogItem>) {
  return LAYERS.map((layer) => {
    const selection = build.selections.find(
      (s) => s.enabled && kindDef(s.kind).tier === layer.tier,
    );
    const item = selection ? byId.get(selection.catalog_item_id) : undefined;
    return { layer, name: item?.name };
  });
}

function TemplateCard({ starter, index }: { starter: Starter; index: number }) {
  const navigate = useNavigate();
  const { startNew } = useBuilder();
  const { pricing } = useData();
  const toast = useToast();
  const catalog = useCatalog();
  const build = useMemo(() => starter.build(), [starter]);
  // The real preview estimator, not a hand-summed list of card prices.
  const cost = useQuery({
    queryKey: ['cost', build.id, build.revision],
    queryFn: () => pricing.estimate(build),
    staleTime: Infinity,
  });
  const nodes = layerNodes(build, catalog.byId);
  /*
   * Coverage-aware, like the builder: a starter with an unpriced component (the Document Q&A
   * starter leaves its vector database unpriced) is a lower bound, and an estimate that priced
   * nothing is Unknown — neither may read as a complete monthly total.
   */
  const total = costShort(cost.data);
  const kicker = KICKERS[starter.id] ?? `${String(index + 1).padStart(2, '0')} / STARTER BUILD`;

  return (
    <article className="template-showcase">
      <div className="template-showcase-head">
        <div className="mini-kicker">{kicker}</div>
        <h3>{displayTitle(starter)}</h3>
        <p>{starter.summary}</p>
      </div>
      <div className="template-showcase-diagram">
        {nodes.map(({ layer, name }) => (
          <div
            className={name ? 'template-node' : 'template-node empty'}
            key={layer.tier}
            title={name ? `${layer.short}: ${name}` : `${layer.short}: not included`}
          >
            <div className="node-box">
              <Icon name={layer.ico} />
            </div>
            <small>{layer.short}</small>
            <span className="sr-only">{name ? ` — ${name}` : ' — not included'}</span>
          </div>
        ))}
      </div>
      <div className="template-showcase-foot">
        <span title={total.note}>
          <strong>{total.text}</strong>
          {total.qualifier ? ` ${total.qualifier}` : ''} · illustrative
        </span>
        <button
          className="btn btn-primary btn-small"
          type="button"
          onClick={() => {
            startNew(starter.build(), starter.title);
            void navigate('/builder');
            toast(`${displayTitle(starter)} loaded. Swap any component to customize.`);
          }}
        >
          Use this build <Icon name="arrow-right" />
        </button>
      </div>
    </article>
  );
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { startNew } = useBuilder();
  const toast = useToast();
  const catalog = useCatalog();
  const { mode } = useData();

  return (
    <div className="app-page">
      <PageHeader
        compact
        breadcrumb="STARTER BUILDS"
        eyebrow="CURATED STARTING POINTS"
        title={
          <>
            A head start, <span>not a black box.</span>
          </>
        }
      >
        Complete example configurations with every component visible. Choose one, swap what you
        don&apos;t need, and see how the dependencies change.
      </PageHeader>

      <div className="container template-page">
        <div className="template-selector-header">
          <div>
            <h2>Find a starting point</h2>
            <p>
              {mode === 'fixture'
                ? `${STARTERS.length} example architectures · all products and costs are illustrative.`
                : 'No starter builds are available for this catalog.'}
            </p>
          </div>
          <span className="tiny mono">FULLY EDITABLE CONFIGURATIONS</span>
        </div>

        {mode !== 'fixture' ? (
          <p>Start a blank build to choose components from the active catalog.</p>
        ) : catalog.isError ? (
          <div className="notice-error" role="alert">
            <p>
              <strong>Could not load the demo catalog.</strong>
            </p>
            <p>{catalog.error instanceof Error ? catalog.error.message : 'Unknown error'}</p>
            <button
              className="btn btn-outline btn-small"
              type="button"
              onClick={() => void catalog.refetch()}
            >
              Try again
            </button>
          </div>
        ) : !catalog.data ? (
          <Loading label="Loading starter builds…" />
        ) : (
          <div className="full-templates-grid">
            {STARTERS.map((starter, index) => (
              <TemplateCard key={starter.id} starter={starter} index={index} />
            ))}
          </div>
        )}

        <div className="template-bottom-cta">
          <div>
            <strong>Prefer a clean slate?</strong>
            <span>Build your own system from the first decision.</span>
          </div>
          <button
            className="btn btn-outline"
            type="button"
            onClick={() => {
              startNew();
              void navigate('/builder');
              toast('New blank build created.');
            }}
          >
            Start without a template →
          </button>
        </div>
      </div>
    </div>
  );
}
