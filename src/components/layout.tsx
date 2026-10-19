import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { CONTRACT_PROVENANCE, kindsInTier } from '../contracts';
import { buildVersion, shortSha } from '../lib/version';
import { useData } from '../app/data-context';
import { useBuilder } from '../app/builder-context';
import { LAYERS } from '../lib/layers';
import { Icon } from './icon';
import { ToastProvider } from './feedback';

const NAV = [
  { to: '/', label: 'Discover', end: true },
  { to: '/builder', label: 'Builder' },
  { to: '/catalog', label: 'Catalog' },
  { to: '/compare', label: 'Compare' },
  { to: '/builds', label: 'My Builds' },
  { to: '/methodology', label: 'Methodology' },
  { to: '/about', label: 'About' },
];

const SITE_REPO = 'https://github.com/Pick-Your-AI/pickyour.ai';
const RESEARCH_REPO = 'https://github.com/Pick-Your-AI/pick-your-ai-research';

export function Brand({ className = 'brand' }: { className?: string }) {
  return (
    <Link to="/" className={className}>
      <span className="brand-mark" aria-hidden="true">
        P
      </span>
      <span className="brand-name">
        PickYour<span>AI</span>
      </span>
    </Link>
  );
}

/** "INTERACTIVE DESIGN PREVIEW" strip: the site's standing synthetic-data disclosure. */
export function DemoBanner() {
  const { mode } = useData();
  return (
    <div className="demo-banner" role="note" aria-label="Demo mode">
      <strong>INTERACTIVE DESIGN PREVIEW</strong>{' '}
      <span>
        · Components, costs and compatibility checks use synthetic illustrative demo data, not
        verified vendor information.
        {mode === 'http' ? ' This deployment reads a configured API.' : ''}{' '}
        <Link to="/methodology#data" className="underline underline-offset-2">
          Why?
        </Link>
      </span>
    </div>
  );
}

function ThemeToggle() {
  const [light, setLight] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('light'),
  );
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', light);
    root.classList.toggle('dark', !light);
    root.style.colorScheme = light ? 'light' : 'dark';
    try {
      localStorage.setItem('pyai.theme', light ? 'light' : 'dark');
    } catch {
      /* storage unavailable: theme is session-only */
    }
  }, [light]);
  return (
    <button
      aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
      className="icon-button"
      type="button"
      title="Toggle light and dark theme"
      onClick={() => setLight((v) => !v)}
    >
      <Icon name={light ? 'moon' : 'sun'} />
    </button>
  );
}

function Header() {
  const location = useLocation();
  // The menu is open only for the path it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const menuOpen = openOn === location.pathname;
  const { draft } = useBuilder();

  const selectedKinds = new Set(
    (draft?.build.selections ?? []).filter((s) => s.enabled).map((s) => s.kind),
  );
  // A layer is a tier; it counts as filled when any of its kinds has an enabled selection.
  const filledLayers = LAYERS.filter((layer) =>
    kindsInTier(layer.tier).some((k) => selectedKinds.has(k.kind)),
  ).length;

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-link active' : 'nav-link';

  return (
    <header className="site-header no-print">
      <div className="container header-inner">
        <Brand />
        <nav aria-label="Main navigation" className={menuOpen ? 'main-nav open' : 'main-nav'}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={linkClass}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          <Link className="header-build" to="/builder">
            <Icon name="layers" />
            Your stack
            <span className="tiny-counter">
              {filledLayers}
              <span className="sr-only"> of {LAYERS.length} layers selected</span>
            </span>
          </Link>
          <button
            aria-expanded={menuOpen}
            aria-controls="mainNav"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            className="icon-button hamburger"
            type="button"
            title="Toggle menu"
            onClick={() => setOpenOn(menuOpen ? null : location.pathname)}
          >
            <Icon name={menuOpen ? 'x' : 'menu'} />
          </button>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="no-print">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Brand />
            <p className="footer-description">
              A better way to plan your AI architecture. Compare parts, check dependencies, and make
              informed choices, one layer at a time.
            </p>
          </div>
          <div className="footer-column">
            <h2>Explore</h2>
            <Link to="/builder">Stack builder</Link>
            <Link to="/catalog">Component catalog</Link>
            <Link to="/templates">Starter stacks</Link>
          </div>
          <div className="footer-column">
            <h2>Learn</h2>
            <Link to="/methodology#compatibility">Compatibility rules</Link>
            <Link to="/methodology">How it works</Link>
            <Link to="/about">About the concept</Link>
            <Link to="/legal">Privacy &amp; terms</Link>
          </div>
          <div className="footer-column">
            <h2>Demo controls</h2>
            <Link to="/builds">Saved builds</Link>
            <Link to="/compare">Comparison lab</Link>
            <a href={RESEARCH_REPO}>Research repository</a>
            <a href={SITE_REPO}>Source on GitHub</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 PickYourAI · Interactive website design concept</span>
          <span>
            BUILD <span data-testid="build-sha">{shortSha(buildVersion.commit)}</span> · DATA{' '}
            <span data-testid="data-mode">{buildVersion.dataMode}</span> · CONTRACT v
            {CONTRACT_PROVENANCE.contractVersion} @{shortSha(CONTRACT_PROVENANCE.sourceSha)}
          </span>
          <span>DEMONSTRATION ONLY. NO LIVE CATALOG, BENCHMARKS OR PRICES.</span>
        </div>
      </div>
    </footer>
  );
}

/** Moves focus to the main heading after client-side navigation (screen-reader friendly). */
function RouteFocus() {
  const location = useLocation();
  useEffect(() => {
    const h1 = document.querySelector<HTMLElement>('main h1');
    if (h1) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
  }, [location.pathname]);
  return null;
}

export function Layout() {
  return (
    <ToastProvider>
      <a href="#main" className="sr-only sr-only-focusable">
        Skip to content
      </a>
      <DemoBanner />
      <Header />
      <main id="main">
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
      <RouteFocus />
    </ToastProvider>
  );
}

/** Page masthead used by secondary pages (mock: `.page-masthead`). */
export function PageHeader({
  eyebrow,
  title,
  children,
  compact = false,
  aside,
  breadcrumb,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  compact?: boolean;
  aside?: React.ReactNode;
  breadcrumb?: string;
}) {
  return (
    <div className={compact ? 'page-masthead compact' : 'page-masthead'}>
      <div className="container">
        {breadcrumb ? (
          <div className="breadcrumb">
            <Link to="/">PICKYOUR.AI</Link>
            <span>/</span> {breadcrumb}
          </div>
        ) : null}
        <div className={aside ? 'masthead-layout' : undefined}>
          <div>
            {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
            <h1>{title}</h1>
            {children ? <p>{children}</p> : null}
          </div>
          {aside}
        </div>
      </div>
    </div>
  );
}
