import '../styles/art-direction.css';
import { Link, useNavigate } from 'react-router';
import { KIND_LABELS, TIER_LABELS, TIER_SUMMARIES, TIERS, kindsInTier } from '../contracts';
import { useBuilder } from '../app/builder-context';
import { useData } from '../app/data-context';
import { STARTERS, type Starter } from '../data/fixture/starters';
import { SyntheticBadge } from '../components/status';
import { AsciiStack } from '../components/AsciiStack';

function Hero() {
  const { startNew } = useBuilder();
  const navigate = useNavigate();
  return (
    <section aria-labelledby="home-title" className="home-hero">
      <div className="hero-copy">
        <p className="editorial-label">
          <span className="signal-dot" /> THE AI SYSTEM BUILDER / PREVIEW
        </p>
        <h1 id="home-title">
          <span>Pick your </span>
          <span>
            AI stack<span className="hero-period">.</span>
          </span>
        </h1>
        <p className="hero-subtitle">Make the pieces fit.</p>
        <p className="hero-intro">
          Models, infrastructure, knowledge, agents.
          <br />
          Build your system part by part. See what works together, what is missing, and what is
          still unknown.
        </p>
        <div className="hero-actions">
          <button
            type="button"
            className="btn-primary hero-start"
            onClick={() => {
              startNew();
              void navigate('/builder');
            }}
          >
            Start a stack <span aria-hidden="true">↗</span>
          </button>
          <Link to="/catalog" className="hero-browse">
            Explore the catalog <span aria-hidden="true">→</span>
          </Link>
        </div>
        <p className="hero-footnote">Synthetic preview.</p>
      </div>
      <AsciiStack />
      <div className="hero-strip">
        <span>
          <span className="signal-dot" /> BUILT FROM PARTS. CHECKED AS A SYSTEM.
        </span>
        <Link to="/ascii-study#how-it-works">
          Meet the seven tiers <span aria-hidden="true">v</span>
        </Link>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="home-section architecture-section"
    >
      <div className="section-intro">
        <p className="editorial-label">01 / THE ARCHITECTURE</p>
        <h2 id="how-title">
          Every part has
          <br />a part to play.
        </h2>
        <p>
          Start with what you need your system to do. Add the parts it needs. Every change re-checks
          the connections in both directions.
        </p>
        <Link to="/methodology" className="editorial-link">
          How compatibility is checked <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <ol className="tier-index">
        {TIERS.map((tier) => (
          <li key={tier}>
            <Link to={`/catalog?layer=${tier}`}>
              <span className="tier-code">{tier}</span>
              <span className="tier-copy">
                <strong>{TIER_LABELS[tier]}</strong>
                <span>{TIER_SUMMARIES[tier]}</span>
              </span>
              <span className="tier-meta">
                {kindsInTier(tier).every((kind) => kind.activation === 'optional')
                  ? 'OPTIONAL / '
                  : ''}
                {kindsInTier(tier).length} KINDS
              </span>
              <span className="tier-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StarterCard({ starter, index }: { starter: Starter; index: number }) {
  const { startNew } = useBuilder();
  const navigate = useNavigate();
  return (
    <li className="starter-card">
      <div className="starter-meta">
        <span>BUILD / 0{index + 1}</span>
        <SyntheticBadge />
      </div>
      <h3>{starter.title}</h3>
      <p className="starter-summary">{starter.summary}</p>
      <details className="starter-rationale">
        <summary>Why these parts?</summary>
        <dl>
          {starter.rationale.map((reason) => (
            <div key={reason.kind}>
              <dt>{KIND_LABELS[reason.kind]}</dt>
              <dd>{reason.why}</dd>
            </div>
          ))}
        </dl>
      </details>
      <button
        type="button"
        className="starter-open"
        onClick={() => {
          startNew(starter.build(), starter.title);
          void navigate('/builder');
        }}
      >
        Open in builder <span aria-hidden="true">↗</span>
        <span className="sr-only">: {starter.title}</span>
      </button>
    </li>
  );
}

function Starters() {
  const { mode } = useData();
  if (mode !== 'fixture') return null;
  return (
    <section aria-labelledby="starters-title" className="home-section starters-section">
      <div className="section-heading-row">
        <div>
          <p className="editorial-label">02 / START SOMEWHERE</p>
          <h2 id="starters-title">A head start.</h2>
        </div>
        <p>
          Four demo stacks to take apart and make your own.
          <br />
          Synthetic examples, not recommendations. Opening one keeps your other builds.
        </p>
      </div>
      <ul className="starter-grid">
        {STARTERS.map((starter, index) => (
          <StarterCard key={starter.id} starter={starter} index={index} />
        ))}
      </ul>
    </section>
  );
}

const PRINCIPLES = [
  {
    symbol: '[ ? ]',
    title: 'Unknown stays unknown.',
    body: 'Missing evidence gets a question mark. It is never quietly counted as compatible.',
  },
  {
    symbol: '[ ~ ]',
    title: 'See the whole estimate.',
    body: 'Costs show their coverage. A missing price is an unknown, not a zero.',
  },
  {
    symbol: '[ ↗ ]',
    title: 'Follow the evidence.',
    body: 'Published research rules explain each result, so you can see what was checked and why.',
  },
];

export default function AsciiStudyPage() {
  return (
    <div className="ascii-study editorial-home">
      <Hero />
      <HowItWorks />
      <Starters />
      <section aria-labelledby="honest-title" className="home-section honest-section">
        <div className="section-heading-row">
          <div>
            <p className="editorial-label">03 / NO GUESSWORK DISGUISED AS CERTAINTY</p>
            <h2 id="honest-title">Know where you stand.</h2>
          </div>
          <Link to="/methodology" className="editorial-link">
            Read the methodology <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <ul className="principles-grid">
          {PRINCIPLES.map((principle) => (
            <li key={principle.title}>
              <span className="principle-symbol" aria-hidden="true">
                {principle.symbol}
              </span>
              <h3>{principle.title}</h3>
              <p>{principle.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
