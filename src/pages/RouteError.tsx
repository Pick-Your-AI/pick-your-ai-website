import { Link, isRouteErrorResponse, useRouteError } from 'react-router';

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unexpected error';
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-slate-700 dark:text-slate-300">{message}</p>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        If this followed a site update, reloading the page loads the latest version.
      </p>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-primary" onClick={() => location.reload()}>
          Reload
        </button>
        <Link to="/" className="btn-secondary">
          Home
        </Link>
      </div>
    </main>
  );
}
