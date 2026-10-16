import { Link, useLocation } from 'react-router';
import { PageHeader } from '../components/layout';

export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <>
      <PageHeader eyebrow="Error 404" title="Page not found">
        There is no page at <code className="font-mono break-all">{pathname}</code>. It may have
        moved, or the link may be mistyped.
      </PageHeader>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <h2 className="text-lg font-semibold">Where to next?</h2>
        <ul className="mt-4 flex flex-wrap gap-3">
          <li>
            <Link to="/" className="btn-secondary">
              Go to the home page
            </Link>
          </li>
          <li>
            <Link to="/builder" className="btn-primary">
              Open the builder
            </Link>
          </li>
          <li>
            <Link to="/catalog" className="btn-secondary">
              Browse the catalog
            </Link>
          </li>
        </ul>
      </div>
    </>
  );
}
