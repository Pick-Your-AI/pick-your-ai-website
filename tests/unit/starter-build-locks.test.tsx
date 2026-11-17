import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { assertContract } from '../../src/contracts';
import { DEMO_CATALOG } from '../../src/data/fixture/catalog';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { apiChat, NOW } from './scenarios';

beforeEach(() => localStorage.clear());

it('rebases only an explicitly requested starter and retains only exact catalog identities', async () => {
  const starter = apiChat();
  starter.links = [
    {
      id: 'link.model-provider',
      from_selection_id: 'sel_model',
      to_selection_id: 'sel_model_provider',
      relation: 'provided_by',
    },
    {
      id: 'link.workload-context',
      from_selection_id: 'sel_workload',
      to_selection_id: 'sel_context_policy',
      relation: 'uses',
    },
  ];
  assertContract('BuildSnapshot', starter);
  const before = structuredClone(starter);
  const model = starter.selections.find((selection) => selection.kind === 'model')!;
  const provider = starter.selections.find((selection) => selection.kind === 'model_provider')!;
  const snapshot = {
    ...DEMO_CATALOG,
    id: 'catalog.starter-test.2',
    items: DEMO_CATALOG.items
      .filter((item) => item.id !== provider.catalog_item_id)
      .map((item) => (item.id === model.catalog_item_id ? { ...item, version: '2.0.0' } : item)),
  };
  const providers = createFixtureProviders({
    catalog: snapshot,
    pricebook: { ...DEMO_PRICEBOOK, id: 'prices.starter-test.2' },
    now: () => NOW,
  });
  providers.catalog.defaultPricebookId = 'prices.starter-test.2';
  const save = vi.spyOn(providers.builds, 'save');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <BuilderProvider>{children}</BuilderProvider>
      </DataContext.Provider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useBuilder(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  act(() => hook.result.current.startNew(starter, 'Explicit starter', { rebaseStarter: true }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const saved = save.mock.calls[0]![0].build;
  expect(saved.locks.catalog_snapshot_id).toBe(snapshot.id);
  expect(saved.locks.pricebook_id).toBe('prices.starter-test.2');
  expect(saved.selections.map((selection) => selection.id)).toEqual([
    'sel_workload',
    'sel_deployment_mode',
    'sel_context_policy',
  ]);
  expect(saved.links).toEqual([before.links[1]]);
  expect(starter).toEqual(before);
  expect(saved.id).not.toBe(starter.id);
  expect(saved.name).toBe('Explicit starter');
  assertContract('BuildSnapshot', saved);
});
