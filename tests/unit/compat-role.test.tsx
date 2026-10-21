import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { addOrReplace } from '../../src/domain/build';
import { useCompatByKind, verdictFor } from '../../src/lib/compat';
import { apiChat, BY_ID, item, NOW } from './scenarios';

it('reevaluates the same revision for additional and replacement roles', async () => {
  const providers = createFixtureProviders({ now: () => NOW });
  const spy = vi.spyOn(providers.compatibility, 'compatibleOptions');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>{children}</DataContext.Provider>
    </QueryClientProvider>
  );
  const build = apiChat();
  const openlab = item('model_provider', 'openlab');
  const { result, rerender } = renderHook(
    ({ options }) => useCompatByKind(build, ['model_provider'], options),
    { wrapper, initialProps: { options: {} as { role?: string; additional?: boolean } } },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(verdictFor(result.current.data, 'model_provider', openlab.id)).toBe('incompatible');
  rerender({ options: { additional: true } });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(verdictFor(result.current.data, 'model_provider', openlab.id)).toBe('compatible');
  expect(spy).toHaveBeenLastCalledWith(build, 'model_provider', 'secondary');
  rerender({ options: { role: 'secondary' } });
  expect(verdictFor(result.current.data, 'model_provider', openlab.id)).toBe('compatible');
});

it('uses the next free role when adding a third selection', async () => {
  const providers = createFixtureProviders({ now: () => NOW });
  const spy = vi.spyOn(providers.compatibility, 'compatibleOptions');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const build = addOrReplace(apiChat(), item('model_provider', 'openlab'), BY_ID, {
    additional: true,
  });
  const { result } = renderHook(
    () => useCompatByKind(build, ['model_provider'], { additional: true }),
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>
          <DataContext.Provider value={providers}>{children}</DataContext.Provider>
        </QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(spy).toHaveBeenCalledWith(build, 'model_provider', 'tertiary');
});
