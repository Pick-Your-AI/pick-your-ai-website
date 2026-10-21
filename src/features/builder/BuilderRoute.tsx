import '../../styles/dense.css';
import { lazy, Suspense } from 'react';
import { BuilderLoading } from './BuilderLoading';

const BuilderPage = lazy(() => import('./BuilderPage'));

/** Paint the heading without waiting for the editor, forms, and schema metadata. */
export default function BuilderRoute() {
  return (
    <Suspense fallback={<BuilderLoading />}>
      <BuilderPage />
    </Suspense>
  );
}
