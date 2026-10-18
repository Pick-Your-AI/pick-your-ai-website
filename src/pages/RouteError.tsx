import { Link, isRouteErrorResponse, useRouteError } from 'react-router';

/** Router-level error boundary: styled like the rest of the site, never a blank screen. */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unexpected error';
  return (
    <main id="main" className="app-page">
      <div className="container notfound-body">
        <div className="no-results" role="alert">
          <strong>Something went wrong</strong>
          <p className="notice-message">{message}</p>
          <p>If this followed a site update, reloading the page loads the latest version.</p>
          <div className="notfound-actions">
            <button className="btn btn-primary" type="button" onClick={() => location.reload()}>
              Reload
            </button>
            <Link to="/" className="btn btn-outline">
              Home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
