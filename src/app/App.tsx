import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { createProviders, DataConfigError } from '../data/config';
import type { DataProviders } from '../data/types';
import { BuilderProvider } from './builder-context';
import { DataContext } from './data-context';
import { createRouter } from './routes';

function ConfigError({ message }: { message: string }) {
  return (
    <main id="main" className="app-page">
      <div className="container config-error">
        <h1>Site configuration error</h1>
        <p>{message}</p>
        <p className="hint-text">
          See docs/DATA_INTEGRATION.md for the supported data-provider settings.
        </p>
      </div>
    </main>
  );
}

export function App({ providers }: { providers?: DataProviders }) {
  const [state] = useState(() => {
    try {
      return { providers: providers ?? createProviders(import.meta.env), error: null };
    } catch (e) {
      return { providers: null, error: e instanceof DataConfigError ? e.message : String(e) };
    }
  });
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } }),
  );
  const [router] = useState(createRouter);
  if (!state.providers) return <ConfigError message={state.error ?? 'Unknown error'} />;
  return (
    <DataContext.Provider value={state.providers}>
      <QueryClientProvider client={queryClient}>
        <BuilderProvider>
          <RouterProvider router={router} />
        </BuilderProvider>
      </QueryClientProvider>
    </DataContext.Provider>
  );
}
