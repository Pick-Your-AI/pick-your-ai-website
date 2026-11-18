import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import type { CompatibleOption } from '../../src/data/types';
import { createDraft } from '../../src/domain/build';
import ComponentDetailPage from '../../src/features/catalog/ComponentDetailPage';
import { useCompatByKind, verdictFor } from '../../src/lib/compat';
import { apiChat, BY_ID, item, NOW } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

afterEach(cleanup);

const model = item('model', 'aurora-mini');
const provider = item('model_provider', 'openlab');
const refreshError = new Error('Synthetic compatibility refresh unavailable');
const option = (entry: typeof model, verdict: CompatibleOption['verdict']): CompatibleOption => ({
  catalog_item_id: entry.id,
  catalog_item_version: entry.version,
  verdict,
  rule_ids: verdict === 'incompatible' ? ['rule.synthetic.refresh'] : [],
});

// Discover the query that actually received these options rather than duplicating its key policy.
function optionsQuery(client: QueryClient, options: CompatibleOption[]) {
  const query = client
    .getQueryCache()
    .getAll()
    .find((entry) => entry.state.data === options);
  expect(query).toBeDefined();
  return query!;
}

for (const verdict of ['compatible', 'incompatible'] as const) {
  it(`withholds a failed kind's retained ${verdict} decision while preserving other kinds`, async () => {
    const build = apiChat();
    const models = [option(model, verdict)];
    const providers = createFixtureProviders({ now: () => NOW });
    let fails = false;
    const compatibleOptions = vi
      .spyOn(providers.compatibility, 'compatibleOptions')
      .mockImplementation(async (_build, kind) => {
        if (kind === 'model') {
          if (fails) throw refreshError;
          return models;
        }
        return [option(provider, 'compatible')];
      });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>{children}</DataContext.Provider>
      </QueryClientProvider>
    );
    const { result, unmount } = renderHook(
      () => useCompatByKind(build, ['model', 'model_provider']),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(verdictFor(result.current.data, 'model', model.id, model.version)).toBe(verdict);
    const query = optionsQuery(client, models);
    const successfulCalls = compatibleOptions.mock.calls.filter(
      (call) => call[1] === 'model_provider',
    ).length;

    fails = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: query.queryKey, exact: true });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    // The cache may retain an immutable result; the current presentation must distinguish failure.
    expect(query.state.data).toEqual(models);
    expect(result.current.error).toBe(refreshError);
    expect(verdictFor(result.current.data, 'model', model.id, model.version)).toBe('unknown');
    expect(verdictFor(result.current.data, 'model_provider', provider.id, provider.version)).toBe(
      'compatible',
    );

    fails = false;
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(verdictFor(result.current.data, 'model', model.id, model.version)).toBe(verdict);
    expect(result.current.isError).toBe(false);
    expect(
      compatibleOptions.mock.calls.filter((call) => call[1] === 'model_provider'),
    ).toHaveLength(successfulCalls);
    unmount();
    client.clear();
  });

  it(`shows detail refresh failure and retry instead of its retained ${verdict} claim`, async () => {
    vi.mocked(useBuilder).mockReturnValue({
      draft: createDraft(apiChat()),
      ready: true,
      catalogById: BY_ID,
      lastChange: null,
      saveState: { status: 'saved' },
      apply: vi.fn(),
      startNew: vi.fn(),
      open: vi.fn(),
      restore: vi.fn(),
    });
    const models = [option(model, verdict)];
    const providers = createFixtureProviders({ now: () => NOW });
    let fails = false;
    const compatibleOptions = vi
      .spyOn(providers.compatibility, 'compatibleOptions')
      .mockImplementation(async () => {
        if (fails) throw refreshError;
        return models;
      });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter initialEntries={['/catalog/model/demo~model~aurora-mini']}>
            <Routes>
              <Route path="/catalog/:kindSlug/:itemSlug" element={<ComponentDetailPage />} />
            </Routes>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    const status =
      verdict === 'compatible' ? 'No conflicts in demo rules' : '1 demo conflict to review';
    const currentClaim =
      verdict === 'compatible'
        ? 'No detected conflicts in current demo choices'
        : '1 detected conflict in current demo choices';
    expect(await screen.findByText(status)).toBeInTheDocument();
    expect(screen.getByText(currentClaim)).toBeInTheDocument();
    const query = optionsQuery(client, models);

    fails = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: query.queryKey, exact: true });
    });
    await waitFor(() => expect(query.state.status).toBe('error'));
    expect(query.state.data).toEqual(models);
    expect(screen.queryByText(status)).not.toBeInTheDocument();
    expect(screen.queryByText(currentClaim)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(refreshError.message);
    expect(screen.getByText('Compatibility unavailable — retry the check')).toBeInTheDocument();
    expect(
      screen.getByText('Unavailable — compatibility could not be refreshed'),
    ).toBeInTheDocument();

    fails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(status)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(compatibleOptions).toHaveBeenCalledTimes(3);
    view.unmount();
    client.clear();
  });
}
