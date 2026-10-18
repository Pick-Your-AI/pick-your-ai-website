/*
 * Discover (home). Structure, copy and class names are ported from the approved design mock
 * (`docs/design/pickyourai-complete.html`, `#homeScreen`); the numbers and component names come from the
 * contract-driven demo catalog and the real preview estimator, never from the mock's placeholder
 * dataset. Everything shown is synthetic demo data and is labelled as such.
 */
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { BASELINE_RULESET, KIND_LABELS, kindDef, kindsInTier } from '../contracts';
import { useBuildAnalysis, useCatalog, usePricebook } from '../app/queries';
import { useBuilder } from '../app/builder-context';
import { STARTERS, type Starter } from '../data/fixture/starters';
import { itemPrice, totalLabel } from '../lib/item-cost';
import { LAYERS } from '../lib/layers';
import { Icon, type IconName } from '../components/icon';

const STARTER_STYLE: Record<string, { icon: IconName; tone: string }> = {
  'api-support-chat': { icon: 'message', tone: '' },
  'self-hosted-one-gpu': { icon: 'cpu', tone: 'gold' },
  'document-qa-rag': { icon: 'database', tone: 'blue' },
  'ticket-triage-agent': { icon: 'workflow', tone: 'purple' },
};

const TIER_ICON: Record<string, IconName> = {
  T0: 'list',
  T1: 'brain',
  T2: 'server',
  T3: 'database',
  T4: 'workflow',
  T5: 'wand',
  T6: 'chart',
};

function Hero() {
  const navigate = useNavigate();
  const { startNew } = useBuilder();
  const catalog = useCatalog();
  const pricebook = usePricebook();
  const starter = STARTERS[0]!;
  const build = useMemo(() => starter.build(), [starter]);
  const analysis = useBuildAnalysis(build);

  const rows = build.selections.map((sel) => {
    const item = catalog.byId.get(sel.catalog_item_id);
    const tier = kindDef(sel.kind).tier;
    return {
      id: sel.id,
      tier,
      icon: TIER_ICON[tier] ?? 'layers',
      name: item?.name ?? sel.catalog_item_id,
      kind: KIND_LABELS[sel.kind],
      price: item ? itemPrice(item, build, catalog.byId, pricebook.data).label : 'Unknown',
    };
  });
  const total = analysis.costIsCurrent ? analysis.cost : undefined;
  const conflicts = analysis.report?.summary.failed ?? 0;

  return (
    <section className="hero" id="home">
      <div className="container hero-inner">
        <div className="hero-copy">
          <div className="hero-pill">
            <span className="live-dot" /> THE COMPATIBILITY-AWARE AI STACK BUILDER
          </div>
          <h1>
            Great AI starts
            <br />
            with the <em>right stack.</em>
          </h1>
          <p className="hero-desc">
            Stop piecing together tools from a dozen tabs. Choose your models, infrastructure,
            retrieval and operations components in one place, with rule-based compatibility checks
            as you build.
          </p>
          <div className="hero-ctas">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                startNew(starter.build(), starter.title);
                void navigate('/builder');
              }}
            >
              Build your AI stack <Icon name="arrow-right" />
            </button>
            <Link className="btn btn-outline" to="/templates">
              Explore starter builds <Icon name="arrow-up-right" />
            </Link>
          </div>
          <div className="hero-trust">
            <span>
              <Icon name="check-circle" /> Rule-based compatibility
            </span>
            <i />
            <span>
              <Icon name="check-circle" /> Side-by-side comparison
            </span>
            <i />
            <span>
              <Icon name="check-circle" /> Transparent cost coverage
            </span>
          </div>
        </div>

        <div aria-label="Example of a complete AI stack" className="hero-art" role="img">
          <div className="orbit" />
          <div className="orbit two" />
          <span className="decor-plus p1">+</span>
          <span className="decor-plus p2">+</span>
          <div className="float-chip left">
            <Icon name="shield" /> Dependency checks, built in
          </div>
          <div className="preview-panel">
            <div className="preview-top">
              <div>
                <div className="preview-kicker">STACK PREVIEW / DEMO</div>
                <div className="preview-title">{starter.title.replace(/\s*\(demo\)$/i, '')}</div>
              </div>
              <span className="preview-tag">
                <span className="live-dot" /> DEMO STACK
              </span>
            </div>
            <div className="preview-body">
              {rows.map((row) => (
                <div className="preview-row" key={row.id}>
                  <span className="preview-line">
                    <span className="preview-node" />
                  </span>
                  <span className="preview-icon">
                    <Icon name={row.icon} />
                  </span>
                  <div className="preview-info">
                    <strong>{row.name}</strong>
                    <small>
                      {row.tier} · {row.kind.toUpperCase()}
                    </small>
                  </div>
                  <span className="preview-price">{row.price}</span>
                </div>
              ))}
            </div>
            <div className="preview-footer">
              <div>
                <strong>
                  {total ? totalLabel(total.total.amount, total.currency) : '—'}
                  <small>/mo*</small>
                </strong>
                <small> Illustrative baseline</small>
              </div>
              <div className="preview-stamp">
                <Icon name={conflicts ? 'alert' : 'check-circle'} /> {conflicts} detected conflict
                {conflicts === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <div className="float-chip right">
            <Icon name="check-circle" /> Checked against the ruleset
          </div>
        </div>
      </div>
    </section>
  );
}

function StatsBand() {
  return (
    <section className="stats-band">
      <div className="container stats-inner">
        <div className="stat-intro">
          <strong>Every layer of your AI system.</strong>
          <br />
          One builder. One source of clarity.
        </div>
        <div className="stat">
          <b>{LAYERS.length} layers</b>
          <span>ACROSS THE WHOLE STACK</span>
        </div>
        <div className="stat">
          <b>Live checks</b>
          <span>AS YOUR CHOICES CHANGE</span>
        </div>
        <div className="stat">
          <b>No guessing</b>
          <span>VISIBLE GAPS &amp; CONFLICTS</span>
        </div>
      </div>
    </section>
  );
}

function StarterCard({ starter, index }: { starter: Starter; index: number }) {
  const navigate = useNavigate();
  const { startNew } = useBuilder();
  const style = STARTER_STYLE[starter.id] ?? { icon: 'layers' as IconName, tone: '' };
  const layers = new Set(starter.build().selections.map((s) => kindDef(s.kind).tier)).size;
  return (
    <button
      className="template-card"
      type="button"
      onClick={() => {
        startNew(starter.build(), starter.title);
        void navigate('/builder');
      }}
    >
      <div className="template-top">
        <span className={style.tone ? `template-icon ${style.tone}` : 'template-icon'}>
          <Icon name={style.icon} />
        </span>
        <span className="template-type">STARTER / {String(index + 1).padStart(2, '0')}</span>
      </div>
      <h3>{starter.title.replace(/\s*\(demo\)$/i, '')}</h3>
      <p>{starter.summary}</p>
      <div className="template-bottom">
        <span>
          {layers} of {LAYERS.length} layers prefilled
        </span>
        <Icon name="arrow-up-right" />
      </div>
    </button>
  );
}

function Templates() {
  return (
    <section className="section templates" id="templates">
      <div className="container">
        <div className="section-head">
          <div>
            <div className="eyebrow">A BETTER STARTING POINT</div>
            <h2>What are you building?</h2>
            <p className="section-subtitle">
              Skip the blank canvas. Open a preconfigured stack, then swap components to match your
              needs. These are synthetic demonstration templates, not endorsements.
            </p>
          </div>
          <Link className="subtle-link" to="/builder">
            Or start from scratch <Icon name="arrow-right" />
          </Link>
        </div>
        <div className="template-grid">
          {STARTERS.map((s, i) => (
            <StarterCard key={s.id} starter={s} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CatalogRows() {
  const catalog = useCatalog();
  return (
    <section className="section catalog-section" id="catalog">
      <div className="container">
        <div className="catalog-header">
          <div>
            <div className="eyebrow">EXPLORE THE ECOSYSTEM</div>
            <h2>Everything has a place.</h2>
            <p className="section-subtitle">
              Browse by the role each component plays, rather than scrolling an endless directory of
              AI tools.
            </p>
          </div>
          <span className="mono dim" style={{ fontSize: 10 }}>
            07 LAYERS / DEMO CATALOG
          </span>
        </div>
        <div className="catalog-rows">
          {LAYERS.map((layer) => {
            const kinds = kindsInTier(layer.tier).map((k) => k.kind);
            const count = (catalog.data?.items ?? []).filter((i) => kinds.includes(i.kind)).length;
            return (
              <div className="catalog-row" key={layer.tier}>
                <span className="catalog-ico">
                  <Icon name={layer.ico} />
                </span>
                <div className="catalog-info">
                  <h3>{layer.name}</h3>
                  <p>{layer.catalog}</p>
                </div>
                <div className="catalog-metric">
                  DEMO CATALOG
                  <strong>
                    {count} item{count === 1 ? '' : 's'}
                  </strong>
                </div>
                <div className="catalog-metric second">
                  ROLE
                  <strong>{layer.depend}</strong>
                </div>
                <div className="catalog-link">
                  <Link to={`/catalog?layer=${layer.tier}`} aria-label={`Browse ${layer.name}`}>
                    Browse <Icon name="arrow-right" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** A real published rule, presented with the mock's "compatibility explainer" board. */
function RuleBoard() {
  const navigate = useNavigate();
  const rule =
    BASELINE_RULESET.rules.find((r) => r.id === 'rule.api.model.access') ??
    BASELINE_RULESET.rules[0]!;
  const [firstKind, secondKind] = rule.affected_kinds;
  const tiles = [firstKind, secondKind].filter(Boolean) as (typeof rule.affected_kinds)[number][];
  return (
    <div className="rule-board">
      <div className="rule-head">
        <strong>Compatibility explainer</strong>
        <span>PUBLISHED RULE</span>
      </div>
      <div className="rule-main">
        <div className="rule-case">
          {tiles.map((kind, i) => (
            <div key={kind} style={{ display: 'contents' }}>
              {i === 1 ? <div className="rule-cross">×</div> : null}
              <div className="rule-product">
                <span className={`component-logo ${i === 0 ? 'mint' : 'purple'}`}>
                  {KIND_LABELS[kind]
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 3)
                    .toUpperCase()}
                </span>
                <div>
                  <strong>{KIND_LABELS[kind]}</strong>
                  <small>{kindDef(kind).tier} · COMPONENT KIND</small>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="rule-alert">
          <strong>
            <Icon name="alert" /> {rule.message}
          </strong>
          <p>
            {rule.on_unknown === 'block'
              ? 'When this rule cannot be decided, the build is blocked rather than assumed compatible.'
              : 'When this rule cannot be decided, the result is Unknown — never a pass.'}
          </p>
        </div>
        <div className="rule-fix">
          <span>
            Suggested fix: <strong>{rule.remediation}</strong>
          </span>
          <button
            className="btn btn-small btn-outline"
            type="button"
            onClick={() => void navigate('/builder')}
          >
            Try it in the builder <Icon name="arrow-right" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Confidence() {
  return (
    <section className="section confidence-section" id="compatibility">
      <div className="container confidence-layout">
        <div className="confidence-copy">
          <div className="eyebrow">MORE THAN A CHECKMARK</div>
          <h2>
            Know what works. <span className="text-accent">Know what doesn&apos;t.</span>
          </h2>
          <p>
            A stack that looks good on paper can fall apart at deployment. PickYour.AI is designed
            to surface dependencies, contradictions and unknowns before you commit.
          </p>
          <div className="confidence-points">
            <div className="confidence-point">
              <Icon name="check-circle" /> Understand why a combination is supported.
            </div>
            <div className="confidence-point">
              <Icon name="alert" /> See missing requirements, not just red warning lights.
            </div>
            <div className="confidence-point">
              <Icon name="info" /> Unverified isn&apos;t quietly treated as compatible.
            </div>
          </div>
        </div>
        <RuleBoard />
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section className="section steps-section" id="how-it-works">
      <div className="container">
        <div className="eyebrow">BUILT FOR DECISION-MAKING</div>
        <h2>From idea to architecture in minutes.</h2>
        <div className="how-grid">
          <div className="how-item">
            <span className="how-number">01 / DEFINE</span>
            <span className="how-icon">
              <Icon name="list" />
            </span>
            <h3>Pick a starting point</h3>
            <p>
              Start fresh or load a reference stack for a support assistant, document search, agent
              workflow, or self-hosted model.
            </p>
          </div>
          <div className="how-item">
            <span className="how-number">02 / CONFIGURE</span>
            <span className="how-icon">
              <Icon name="layers" />
            </span>
            <h3>Swap and compare</h3>
            <p>
              Choose tools for each layer. Filter choices, compare their properties, and watch
              compatibility feedback update.
            </p>
          </div>
          <div className="how-item">
            <span className="how-number">03 / EXPORT</span>
            <span className="how-icon">
              <Icon name="code" />
            </span>
            <h3>Leave with a real plan</h3>
            <p>
              Export your component choices as contract-shaped JSON or share a link to the exact
              demonstration build you configured.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function EndCta() {
  const navigate = useNavigate();
  return (
    <section className="end-cta">
      <div className="container">
        <div className="cta-box">
          <div>
            <h2>Your next great build starts here.</h2>
            <p>Less tab-hopping. More building with confidence.</p>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void navigate('/builder')}
          >
            Open the stack builder <Icon name="arrow-right" />
          </button>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <div className="app-page">
      <Hero />
      <StatsBand />
      <Templates />
      <CatalogRows />
      <Confidence />
      <Steps />
      <EndCta />
    </div>
  );
}
