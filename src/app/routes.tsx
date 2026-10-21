/* Page content is lazy-loaded; the small builder loading shell is available immediately. */
import { createBrowserRouter, type RouteObject } from 'react-router';
import { Layout } from '../components/layout';
import { RouteError } from '../pages/RouteError';
import BuilderRoute from '../features/builder/BuilderRoute';

const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await load()).default,
});

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: page(() => import('../pages/HomePage')) },
      { path: 'builder', Component: BuilderRoute },
      { path: 'catalog', lazy: page(() => import('../features/catalog/CatalogIndexPage')) },
      { path: 'catalog/:kindSlug', lazy: page(() => import('../features/catalog/SelectionPage')) },
      {
        path: 'catalog/:kindSlug/:itemSlug',
        lazy: page(() => import('../features/catalog/ComponentDetailPage')),
      },
      { path: 'compare', lazy: page(() => import('../pages/ComparePage')) },
      { path: 'templates', lazy: page(() => import('../pages/TemplatesPage')) },
      { path: 'summary', lazy: page(() => import('../pages/BuildSummaryPage')) },
      { path: 'builds', lazy: page(() => import('../pages/MyBuildsPage')) },
      { path: 'shared', lazy: page(() => import('../pages/SharedBuildPage')) },
      { path: 'methodology', lazy: page(() => import('../pages/MethodologyPage')) },
      { path: 'about', lazy: page(() => import('../pages/AboutPage')) },
      { path: 'legal', lazy: page(() => import('../pages/LegalPage')) },
      { path: '*', lazy: page(() => import('../pages/NotFoundPage')) },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
