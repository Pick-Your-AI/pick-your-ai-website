import { buildVersion, shortSha } from '../lib/version';

export function App() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
        <h1 className="text-3xl font-bold">PickYour.AI</h1>
        <p className="mt-4 text-lg">
          The AI stack builder is under construction. Preview data is synthetic.
        </p>
      </main>
      <footer className="border-t border-slate-200 px-4 py-4 text-sm dark:border-slate-800">
        <span data-testid="build-sha">Build {shortSha(buildVersion.commit)}</span> · Data mode:{' '}
        <span data-testid="data-mode">{buildVersion.dataMode}</span>
      </footer>
    </div>
  );
}
