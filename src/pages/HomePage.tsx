import { Link, useNavigate } from 'react-router';
import { KIND_LABELS, TIER_LABELS, TIER_SUMMARIES, TIERS, kindsInTier } from '../contracts';
import { useBuilder } from '../app/builder-context';
import { useData } from '../app/data-context';
import { STARTERS, type Starter } from '../data/fixture/starters';
import { SyntheticBadge } from '../components/status';
import { IconCheck, IconInfo, IconLayers, IconQuestion } from '../components/icons';
import heroAvif640 from '../assets/images/hero-stack-640.avif';
import heroWebp640 from '../assets/images/hero-stack-640.webp';
import heroWebp400 from '../assets/images/hero-stack-400.webp';

const STATES = [
  { term: 'Selected', desc: 'what is in your stack, tier by tier' },
  { term: 'Missing', desc: 'what the stack still needs for the choices you made' },
  { term: 'Incompatible', desc: 'which published rule fails, and why' },
  { term: 'Unknown', desc: 'what cannot be checked yet — never shown as compatible' },
  { term: 'Estimated cost', desc: 'only where prices are evidenced, with coverage shown' },
];

function Hero() {
  return (
    <section
      aria-labelledby="home-title"
      className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-10 md:grid-cols-[1fr_auto] md:py-14">
        <div className="max-w-2xl">
          <p className="eyebrow">AI stack builder · preview</p>
          <h1 id="home-title" className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Pick your AI stack. Check it fits. See what is missing.
          </h1>
          <p className="muted mt-4 text-lg">
            PickYour.AI is a parts list for AI systems. Choose compatible components across seven
            tiers, T0 to T6, and see at a glance:
          </p>
          <ul className="mt-4 grid gap-2">
            {STATES.map((s) => (
              <li key={s.term} className="flex items-start gap-2">
                <IconCheck className="mt-1 shrink-0 text-brand-700 dark:text-brand-400" />
                <span>
                  <strong className="font-semibold">{s.term}</strong> — {s.desc}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link to="/builder" className="btn-primary px-5 text-base">
              Start a stack
            </Link>
            <Link to="/catalog" className="btn-secondary">
              Browse the catalog
            </Link>
            <Link to="/methodology" className="link text-sm">
              How compatibility is checked
            </Link>
          </div>
        </div>
        <picture className="mx-auto block w-full max-w-[320px] md:max-w-[360px]">
          <source
            type="image/avif"
            srcSet={`${heroAvif640} 640w`}
            sizes="(min-width: 768px) 360px, 320px"
          />
          <source
            type="image/webp"
            srcSet={`${heroWebp400} 400w, ${heroWebp640} 640w`}
            sizes="(min-width: 768px) 360px, 320px"
          />
          <img
            src={heroWebp640}
            width={640}
            height={734}
            alt="Illustration: seven stacked layers of modular AI components connected by dependency lines"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="h-auto w-full"
          />
        </picture>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="mx-auto max-w-7xl px-4 py-10">
      <h2 id="how-title" className="text-2xl font-semibold tracking-tight">
        How it works
      </h2>
      <p className="muted mt-2 max-w-3xl">
        Every stack is organised into the same seven tiers. Only the tiers your choices activate are
        required — an API-only chat assistant does not need GPUs. Changing one tier re-checks the
        tiers that depend on it, in both directions.
      </p>
      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {TIERS.map((tier) => {
          const kinds = kindsInTier(tier);
          return (
            <li key={tier} className="card flex flex-col p-4">
              <p className="font-mono text-sm font-semibold text-brand-800 dark:text-brand-300">
                {tier}
              </p>
              <h3 className="mt-1 font-semibold">{TIER_LABELS[tier]}</h3>
              <p className="muted mt-1 flex-1 text-sm">{TIER_SUMMARIES[tier]}</p>
              <p className="mt-3 text-xs">
                <span className="tabular font-semibold">{kinds.length}</span> component kinds
                <span className="sr-only">
                  : {kinds.map((k) => KIND_LABELS[k.kind]).join(', ')}
                </span>
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StarterCard({ starter }: { starter: Starter }) {
  const { startNew } = useBuilder();
  const navigate = useNavigate();
  const titleId = `starter-${starter.id}`;
  return (
    <li className="card flex flex-col p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="font-semibold">
          {starter.title}
        </h3>
        <SyntheticBadge />
      </div>
      <p className="muted mt-2 text-sm">{starter.summary}</p>
      <dl className="mt-4 grid flex-1 gap-2 text-sm">
        {starter.rationale.map((r) => (
          <div key={r.kind}>
            <dt className="font-medium">{KIND_LABELS[r.kind]}</dt>
            <dd className="muted">{r.why}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="btn-primary mt-4 self-start"
        onClick={() => {
          startNew(starter.build(), starter.title);
          void navigate('/builder');
        }}
      >
        Open in builder
        <span className="sr-only">: {starter.title}</span>
      </button>
    </li>
  );
}

function Starters() {
  const { mode } = useData();
  if (mode !== 'fixture') return null;
  return (
    <section
      aria-labelledby="starters-title"
      className="border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mx-auto max-w-7xl px-4 py-10">
        <h2 id="starters-title" className="text-2xl font-semibold tracking-tight">
          Starter stacks (demo)
        </h2>
        <p className="muted mt-2 max-w-3xl">
          Four example shapes built from synthetic demo components. Open one to see how the builder
          reports selections, gaps and rule results. They are illustrations, not recommendations.
          Opening a starter creates a new build; your other builds are kept.
        </p>
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {STARTERS.map((s) => (
            <StarterCard key={s.id} starter={s} />
          ))}
        </ul>
      </div>
    </section>
  );
}

const PRINCIPLES = [
  {
    Icon: IconQuestion,
    title: 'Unknown is never compatible',
    body: 'If a rule cannot be checked because evidence is missing, the result is Unknown — shown with its own icon and word, never as a pass.',
  },
  {
    Icon: IconInfo,
    title: 'Synthetic data is labelled',
    body: 'While the real catalog is being researched, every demo component, price and result is marked as synthetic.',
  },
  {
    Icon: IconLayers,
    title: 'Prices are estimates with coverage',
    body: 'Costs are shown only where a price is evidenced, with coverage stated as complete, partial or unknown. Unknown billing is never counted as zero.',
  },
  {
    Icon: IconCheck,
    title: 'Rules come from the research contract',
    body: 'Compatibility rules and dependencies are published by the research project. The website interprets them; it does not invent its own.',
  },
];

function HonestByDesign() {
  return (
    <section aria-labelledby="honest-title" className="mx-auto max-w-7xl px-4 py-10">
      <h2 id="honest-title" className="text-2xl font-semibold tracking-tight">
        Honest by design
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PRINCIPLES.map((p) => (
          <li key={p.title} className="card p-5">
            <p.Icon className="text-brand-700 dark:text-brand-400" />
            <h3 className="mt-2 font-semibold">{p.title}</h3>
            <p className="muted mt-1 text-sm">{p.body}</p>
          </li>
        ))}
      </ul>
      <p className="mt-6">
        <Link to="/methodology" className="link">
          Read the methodology: outcomes, invalidation, pricing and evidence
        </Link>
      </p>
    </section>
  );
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Starters />
      <HonestByDesign />
    </>
  );
}
