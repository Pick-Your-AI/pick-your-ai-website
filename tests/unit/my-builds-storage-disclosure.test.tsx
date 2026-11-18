import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { createHttpProviders } from '../../src/data/http/providers';
import type { DataProviders } from '../../src/data/types';
import { createDraft } from '../../src/domain/build';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import { CATALOG, NOW, apiChat } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

const API_BASE = 'https://api.test/v1';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Synthetic in-memory API only; no network or deployed-service evidence. */
function httpProviders(remoteBuilds: boolean) {
  const fixture = createFixtureProviders({ now: () => NOW });
  const saved = new Map<string, BuildSnapshot>();
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.slice(API_BASE.length);
    if (init?.method === 'POST' && path === '/builds') {
      const build = JSON.parse(String(init.body)) as BuildSnapshot;
      saved.set(build.id, build);
      return json(build, 201);
    }
    const id = path.split('/')[2]!;
    if (init?.method === 'GET' && path === `/builds/${id}`)
      return saved.has(id) ? json(saved.get(id)) : json({}, 404);
    if (init?.method === 'POST' && path === `/builds/${id}/estimate-cost`)
      return json(await fixture.pricing.estimate(apiChat()));
    if (init?.method === 'POST' && path === `/builds/${id}/evaluate`)
      return json(await fixture.compatibility.evaluate(apiChat()));
    throw new Error(`Unexpected synthetic API request: ${init?.method} ${path}`);
  });
  return {
    saved,
    fetch,
    providers: createHttpProviders({
      baseUrl: API_BASE,
      catalogSnapshotId: CATALOG.id,
      pricebookId: DEMO_PRICEBOOK.id,
      remoteBuilds,
      fetch,
    }),
  };
}

function showBuilds(providers: DataProviders) {
  vi.mocked(useBuilder).mockReturnValue({
    draft: null,
    open: vi.fn(),
    startNew: vi.fn(),
    remove: (id: string) => providers.builds.remove(id),
  } as unknown as ReturnType<typeof useBuilder>);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter>
          <ToastProvider>
            <MyBuildsPage />
          </ToastProvider>
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('My Builds storage disclosure and removal', () => {
  it('forgets only the browser copy of an HTTP build and discloses the retained API record', async () => {
    const build = apiChat();
    const api = httpProviders(true);
    await api.providers.builds.save(createDraft(build), null);
    expect(api.saved.get(build.id)).toEqual(build);
    showBuilds(api.providers);
    const card = await screen.findByRole('article');
    expect(screen.getByText('API-backed workspace.').parentElement).toHaveTextContent(
      'Complete build snapshots are sent to the configured API',
    );
    expect(screen.queryByText('Local workspace.')).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: `Forget ${build.name}` }));
    const confirmation = within(card).getByRole('group', { name: 'Confirm forget' });
    expect(confirmation).toHaveTextContent('The API-stored build will not be deleted.');
    expect(within(confirmation).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Yes, forget' }));
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument());
    expect(
      screen.getByText('Build forgotten in this browser. The API-stored build was not deleted.'),
    ).toHaveAttribute('role', 'status');
    expect(await api.providers.builds.list()).toEqual([]);
    expect(localStorage.getItem(`pyai.build.${build.id}`)).toBeNull();
    expect((await api.providers.builds.get(build.id)).build).toEqual(build);
    expect(api.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it.each(['fixture', 'http-local'] as const)(
    'retains accurate browser-local copy and deletion for %s storage',
    async (configuration) => {
      const build = apiChat();
      const providers =
        configuration === 'fixture'
          ? createFixtureProviders({ now: () => NOW })
          : httpProviders(false).providers;
      await providers.builds.save(createDraft(build), null);
      showBuilds(providers);
      const card = await screen.findByRole('article');
      expect(screen.getByText('Local workspace.').parentElement).toHaveTextContent(
        'They are not synchronized or backed up.',
      );
      expect(screen.queryByText('API-backed workspace.')).not.toBeInTheDocument();
      fireEvent.click(within(card).getByRole('button', { name: `Delete ${build.name}` }));
      const confirmation = within(card).getByRole('group', { name: 'Confirm delete' });
      expect(confirmation).toHaveTextContent('from this browser');
      fireEvent.click(within(confirmation).getByRole('button', { name: 'Yes, delete' }));
      await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument());
      expect(screen.getByText('Saved build deleted from this browser.')).toHaveAttribute(
        'role',
        'status',
      );
      await expect(providers.builds.get(build.id)).rejects.toMatchObject({ kind: 'not_found' });
    },
  );

  it('keeps cancellation, focus restoration and failure feedback for HTTP forgetting', async () => {
    const build = apiChat();
    const api = httpProviders(true);
    await api.providers.builds.save(createDraft(build), null);
    showBuilds(api.providers);
    const card = await screen.findByRole('article');
    const forget = within(card).getByRole('button', { name: `Forget ${build.name}` });
    fireEvent.click(forget);
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(forget).toHaveFocus());
    expect(await api.providers.builds.list()).toHaveLength(1);
    vi.spyOn(api.providers.builds, 'remove').mockRejectedValue(
      new Error('Synthetic storage failure.'),
    );
    fireEvent.click(forget);
    fireEvent.click(within(card).getByRole('button', { name: 'Yes, forget' }));
    await waitFor(() =>
      expect(within(card).getByRole('alert')).toHaveTextContent('Synthetic storage failure.'),
    );
    for (const status of screen.getAllByRole('status'))
      expect(status).not.toHaveTextContent('Build forgotten');
    expect(await api.providers.builds.list()).toHaveLength(1);
    expect((await api.providers.builds.get(build.id)).build).toEqual(build);
  });

  it('uses neutral wording for a custom repository without a storage declaration', async () => {
    const providers = createFixtureProviders({ now: () => NOW });
    const local = providers.builds;
    const build = apiChat();
    await local.save(createDraft(build), null);
    providers.builds = {
      list: () => local.list(),
      get: (id) => local.get(id),
      save: (stored, revision) => local.save(stored, revision),
      remove: (id) => local.remove(id),
    };
    const { container } = showBuilds(providers);
    const card = await screen.findByRole('article');
    expect(screen.getByText('Configured workspace.')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('Stored in your browser for this preview.');
    expect(container).not.toHaveTextContent('They are not synchronized or backed up.');
    fireEvent.click(within(card).getByRole('button', { name: `Remove ${build.name}` }));
    expect(within(card).getByRole('group', { name: 'Confirm remove' })).toHaveTextContent(
      'using the configured storage provider',
    );
  });
});
