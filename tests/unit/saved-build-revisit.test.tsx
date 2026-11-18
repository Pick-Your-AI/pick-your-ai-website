import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { ContractHttpClient, type FetchLike } from '../../src/data/http/client';
import { HttpBuildRepository } from '../../src/data/http/providers';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import { apiChat, NOW } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

const baseUrl = 'https://synthetic.invalid/v1';
const oldBuild: BuildSnapshot = {
  ...apiChat(),
  id: 'build.synthetic-revisited',
  revision: 1,
  name: 'Z Synthetic old browser name',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
};
const currentBuild: BuildSnapshot = {
  ...oldBuild,
  revision: 2,
  name: 'A Synthetic current remote name',
  updated_at: '2026-10-15T00:00:00Z',
};
const peerBuild: BuildSnapshot = {
  ...oldBuild,
  id: 'build.synthetic-peer',
  name: 'M Synthetic unchanged peer',
  updated_at: '2026-10-10T00:00:00Z',
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** All API responses, prices and browser records in these regressions are synthetic. */
async function harness(failure?: 'pricing' | 'evaluation' | 'get') {
  const rows = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
  };
  const local = new LocalBuildRepository(storage);
  await local.save(createDraft(oldBuild), null);
  await local.save(createDraft(peerBuild), null);
  let failGet = failure === 'get';
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    expect(init?.method).toBe('GET');
    if (url === `${baseUrl}/builds/${oldBuild.id}`) {
      if (failGet) return new Response('{}', { status: 503 });
      return json(currentBuild);
    }
    expect(url).toBe(`${baseUrl}/builds/${peerBuild.id}`);
    return json(peerBuild);
  });
  const repository = () =>
    new HttpBuildRepository(
      new ContractHttpClient({ baseUrl, fetch }),
      new LocalBuildRepository(storage),
    );
  const providers = createFixtureProviders({ now: () => NOW });
  providers.builds = repository();
  const pricing = vi.spyOn(providers.pricing, 'estimate');
  const evaluation = vi.spyOn(providers.compatibility, 'evaluate');
  if (failure === 'pricing') pricing.mockRejectedValue(new Error('Synthetic pricing unavailable'));
  if (failure === 'evaluation')
    evaluation.mockRejectedValue(new Error('Synthetic evaluation unavailable'));
  vi.mocked(useBuilder).mockReturnValue({
    draft: null,
    ready: true,
    catalogById: new Map(),
    lastChange: null,
    saveState: { status: 'idle' },
    apply: vi.fn(),
    startNew: vi.fn(),
    remove: (id: string) => providers.builds.remove(id),
    open: vi.fn(),
    restore: vi.fn(),
  } as unknown as ReturnType<typeof useBuilder>);
  const mount = async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter>
            <MyBuildsPage />
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findAllByRole('article');
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    return { ...view, client };
  };
  return {
    local,
    providers,
    repository,
    pricing,
    evaluation,
    fetch,
    mount,
    failGet: () => {
      failGet = true;
    },
  };
}

function assertCurrentCard() {
  const cards = screen.getAllByRole('article');
  expect(within(cards[0]!).getByRole('heading', { level: 3 })).toHaveTextContent(currentBuild.name);
  expect(cards[0]).toHaveTextContent(`Edited ${date(currentBuild.updated_at)}`);
  expect(cards[0]).not.toHaveTextContent(oldBuild.name);
  expect(cards[0]).not.toHaveTextContent(`Edited ${date(oldBuild.updated_at)}`);
  expect(within(cards[1]!).getByRole('heading', { level: 3 })).toHaveTextContent(peerBuild.name);
  return cards[0]!;
}

describe('revisited HTTP builds in My Builds', () => {
  it('uses the fetched revision name/date for cards, recent ordering and name ordering', async () => {
    const h = await harness();
    await h.mount();
    expect(h.pricing).toHaveBeenCalledWith(currentBuild);
    assertCurrentCard();
    fireEvent.change(screen.getByRole('combobox', { name: 'SORT BY' }), {
      target: { value: 'name' },
    });
    assertCurrentCard();
  });

  it('shows the fetched current head on first load and a fresh-client revisit without rewriting local history', async () => {
    const h = await harness();
    const localBefore = await h.local.get(oldBuild.id);
    const assertVisibleCurrentHead = () => {
      const cards = screen.getAllByRole('article');
      // Soft assertions allow the independent remount check to execute even on the old UI.
      expect
        .soft(within(cards[0]!).getByRole('heading', { level: 3 }))
        .toHaveTextContent(currentBuild.name);
      expect.soft(cards[0]).toHaveTextContent(`Edited ${date(currentBuild.updated_at)}`);
      expect.soft(screen.queryByRole('heading', { name: oldBuild.name })).not.toBeInTheDocument();
      expect
        .soft(within(cards[1]!).getByRole('heading', { level: 3 }))
        .toHaveTextContent(peerBuild.name);
    };
    const currentRequests = () =>
      h.fetch.mock.calls.filter(([url]) => url === `${baseUrl}/builds/${oldBuild.id}`);
    const analysedRevisions = () =>
      h.pricing.mock.calls
        .filter(([build]) => build.id === currentBuild.id)
        .map(([build]) => build.revision);

    const first = await h.mount();
    expect(currentRequests()).toHaveLength(1);
    expect(analysedRevisions()).toEqual([2]);
    assertVisibleCurrentHead();
    first.unmount();
    first.client.clear();
    // Existing HTTP identity tests establish GET as a read without a local cache write.
    // A revisit must display the fetched head even when the saved browser record is older.
    expect(await h.local.get(oldBuild.id)).toEqual(localBefore);

    h.providers.builds = h.repository();
    const revisited = await h.mount();
    expect(revisited.client).not.toBe(first.client);
    expect(currentRequests()).toHaveLength(2);
    expect(currentRequests().every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(analysedRevisions()).toEqual([2, 2]);
    expect(
      h.evaluation.mock.calls
        .filter(([build]) => build.id === currentBuild.id)
        .map(([build]) => build.revision),
    ).toEqual([2, 2]);
    assertVisibleCurrentHead();
    expect(await h.local.get(oldBuild.id)).toEqual(localBefore);
  });

  it.each(['pricing', 'evaluation'] as const)(
    'keeps current fetched metadata when subsequent %s fails and leaves validation unavailable',
    async (failure) => {
      const h = await harness(failure);
      await h.mount();
      expect(h.pricing).toHaveBeenCalledWith(currentBuild);
      if (failure === 'evaluation') expect(h.evaluation).toHaveBeenCalled();
      const card = assertCurrentCard();
      const validation = within(card).getByText('DEMO VALIDATION').parentElement!;
      expect(validation).toHaveTextContent('Not checked');
      expect(validation).not.toHaveTextContent('No conflicts');
      if (failure === 'pricing') {
        const cost = within(card).getByText('ESTIMATED BASELINE*').parentElement!;
        expect(cost).not.toHaveTextContent(/\$\d/);
        expect(h.evaluation).not.toHaveBeenCalled();
      }
    },
  );

  it('withholds a prior successful verdict after a later saved-head refresh fails', async () => {
    const h = await harness();
    const view = await h.mount();
    const initial = screen
      .getAllByRole('article')
      .find(
        (card) =>
          card.textContent?.includes(currentBuild.name) ||
          card.textContent?.includes(oldBuild.name),
      )!;
    expect(within(initial).getByText('DEMO VALIDATION').parentElement).toHaveTextContent(
      'No conflicts',
    );
    h.failGet();
    const before = h.fetch.mock.calls.length;
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: ['builds'] });
    });
    await waitFor(() => expect(h.fetch.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    const fallback = screen
      .getAllByRole('article')
      .find(
        (card) =>
          card.textContent?.includes(currentBuild.name) ||
          card.textContent?.includes(oldBuild.name),
      )!;
    expect(within(fallback).getByText('DEMO VALIDATION').parentElement).toHaveTextContent(
      'Not checked',
    );
    expect(within(fallback).getByText('DEMO VALIDATION').parentElement).not.toHaveTextContent(
      'No conflicts',
    );
    expect(within(fallback).getByRole('button', { name: /^Forget / })).toBeEnabled();
  });

  it('keeps a failed-GET fallback visible and lets the visitor forget its browser entry', async () => {
    const h = await harness('get');
    await h.mount();
    const card = screen
      .getAllByRole('article')
      .find((entry) => entry.textContent?.includes(oldBuild.name))!;
    expect(card).toHaveTextContent(`Edited ${date(oldBuild.updated_at)}`);
    expect(within(card).getByText('DEMO VALIDATION').parentElement).toHaveTextContent(
      'Not checked',
    );
    fireEvent.click(within(card).getByRole('button', { name: `Forget ${oldBuild.name}` }));
    fireEvent.click(within(card).getByRole('button', { name: 'Yes, forget' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: oldBuild.name })).not.toBeInTheDocument(),
    );
    expect(await h.local.list()).not.toContainEqual(expect.objectContaining({ id: oldBuild.id }));
    expect(h.fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
});
