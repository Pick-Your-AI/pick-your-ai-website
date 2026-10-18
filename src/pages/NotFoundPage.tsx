import { Link, useLocation } from 'react-router';
import { PageHeader } from '../components/layout';
import { Icon } from '../components/icon';

export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <div className="app-page">
      <PageHeader compact breadcrumb="404" eyebrow="ERROR 404" title="Page not found">
        There is no page at <code className="mono">{pathname}</code>. It may have moved, or the link
        may be mistyped.
      </PageHeader>
      <div className="container notfound-body">
        <div className="no-results">
          <Icon name="search" />
          <strong>Where to next?</strong>
          <p>Every layer of the stack is still one click away.</p>
          <div className="notfound-actions">
            <Link to="/" className="btn btn-primary">
              Go to the home page
            </Link>
            <Link to="/builder" className="btn btn-outline">
              Open the builder
            </Link>
            <Link to="/catalog" className="btn btn-outline">
              Browse the catalog
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
