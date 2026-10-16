import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { CONTRACT_PROVENANCE } from '../contracts';
import { buildVersion, shortSha } from '../lib/version';
import { useData } from '../app/data-context';
import { useBuilder } from '../app/builder-context';
import { IconMenu, IconMoon, IconSun, IconX } from './icons';

const NAV = [
  { to: '/builder', label: 'Builder' },
  { to: '/catalog', label: 'Catalog' },
  { to: '/compare', label: 'Compare' },
  { to: '/builds', label: 'My Builds' },
  { to: '/methodology', label: 'Methodology' },
  { to: '/about', label: 'About' },
];

function Logo() {
  return (
    <Link
      to="/"
      className="flex items-center gap-2 rounded font-semibold tracking-tight"
      aria-label="PickYour.AI home"
    >
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <rect width="32" height="32" rx="7" className="fill-brand-700 dark:fill-brand-500" />
        <path
          d="M9 23V9h7a5 5 0 0 1 0 10h-3v4z"
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <circle cx="23" cy="22" r="2.5" fill="#fbbf24" />
      </svg>
      <span className="text-lg">
        PickYour<span className="text-brand-700 dark:text-brand-400">.AI</span>
      </span>
    </Link>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    try {
      localStorage.setItem('pyai.theme', next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? <IconSun /> : <IconMoon />}
      <span className="sr-only sm:not-sr-only">{dark ? 'Light' : 'Dark'}</span>
    </button>
  );
}

export function DemoBanner() {
  const { mode } = useData();
  if (mode !== 'fixture') return null;
  return (
    <div
      role="note"
      aria-label="Demo mode"
      className="border-b border-violet-300 bg-violet-50 px-4 py-2 text-center text-sm text-violet-950 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100"
    >
      <strong className="font-semibold">Demo mode:</strong> every component, price and compatibility
      result on this site is <strong>synthetic demonstration data</strong> — not real products,
      quotes or measurements.{' '}
      <Link to="/methodology#data" className="underline underline-offset-2">
        Why?
      </Link>
    </div>
  );
}

function BuilderNavCount() {
  const { draft } = useBuilder();
  const n = draft?.build.selections.length ?? 0;
  if (!n) return null;
  return (
    <span className="ml-1 rounded-full bg-brand-100 px-1.5 text-xs font-semibold text-brand-900 dark:bg-brand-900 dark:text-brand-100">
      {n}
      <span className="sr-only"> components selected</span>
    </span>
  );
}

function Header() {
  const location = useLocation();
  // The menu is open only for the path it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === location.pathname;
  const setOpen = (fn: (o: boolean) => boolean) => setOpenOn(fn(open) ? location.pathname : null);
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm font-medium ${
      isActive
        ? 'bg-brand-50 text-brand-900 dark:bg-brand-950 dark:text-brand-100'
        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
    }`;
  return (
    <header className="no-print border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2">
        <Logo />
        <nav aria-label="Primary" className="ml-4 hidden flex-1 items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={linkClass}>
              {n.label}
              {n.to === '/builder' ? <BuilderNavCount /> : null}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Link to="/builder" className="btn-primary hidden sm:inline-flex lg:hidden">
            Builder
            <BuilderNavCount />
          </Link>
          <ThemeToggle />
          <button
            type="button"
            className="btn-ghost lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <IconX /> : <IconMenu />}
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
      </div>
      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Primary"
          className="border-t border-slate-200 px-4 py-2 lg:hidden dark:border-slate-800"
        >
          <ul className="grid gap-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} className={({ isActive }) => `block ${linkClass({ isActive })}`}>
                  {n.label}
                  {n.to === '/builder' ? <BuilderNavCount /> : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}

function Footer() {
  return (
    <footer className="no-print mt-16 border-t border-slate-200 bg-white px-4 py-8 text-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-3">
        <div>
          <p className="font-semibold">PickYour.AI</p>
          <p className="muted mt-1">
            Build a compatible AI stack, part by part. Preview — not a source of real prices or
            measurements.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-1">
            <li>
              <Link className="link" to="/methodology">
                Methodology
              </Link>
            </li>
            <li>
              <Link className="link" to="/about">
                About
              </Link>
            </li>
            <li>
              <Link className="link" to="/legal">
                Privacy &amp; terms
              </Link>
            </li>
            <li>
              <Link className="link" to="/catalog">
                Catalog
              </Link>
            </li>
            <li>
              <a className="link" href="https://github.com/Pick-Your-AI/pickyour.ai">
                Source on GitHub
              </a>
            </li>
            <li>
              <a className="link" href="https://github.com/Pick-Your-AI/pick-your-ai-research">
                Research repository
              </a>
            </li>
          </ul>
        </nav>
        <dl className="muted grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular">
          <dt>Build</dt>
          <dd>
            <span data-testid="build-sha" className="font-mono">
              {shortSha(buildVersion.commit)}
            </span>
          </dd>
          <dt>Data mode</dt>
          <dd data-testid="data-mode">{buildVersion.dataMode}</dd>
          <dt>Contract</dt>
          <dd>
            v{CONTRACT_PROVENANCE.contractVersion} @{' '}
            <a
              className="link font-mono"
              href={`https://github.com/Pick-Your-AI/pick-your-ai-research/tree/${CONTRACT_PROVENANCE.sourceSha}/contracts/v1`}
            >
              {shortSha(CONTRACT_PROVENANCE.sourceSha)}
            </a>
          </dd>
        </dl>
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
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow dark:focus:bg-slate-900"
      >
        Skip to content
      </a>
      <DemoBanner />
      <Header />
      <main id="main" className="min-h-screen w-full flex-1">
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
      <RouteFocus />
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {children ? <div className="muted mt-2 max-w-3xl">{children}</div> : null}
      </div>
    </div>
  );
}
