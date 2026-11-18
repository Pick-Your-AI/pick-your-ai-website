import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot } from '../../src/contracts';
import { DATA_ERROR_TITLES, DataError, type DataErrorKind } from '../../src/data/errors';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { ContractHttpClient, type FetchLike } from '../../src/data/http/client';
import { HttpBuildRepository } from '../../src/data/http/providers';
import { LocalBuildRepository } from '../../src/data/local-builds';
import BuilderPage from '../../src/features/builder/BuilderPage';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import { apiChat, NOW } from './scenarios';

const key = 'pyai.currentBuildId';
const baseUrl = 'https://synthetic.invalid/v1';
const remembered: BuildSnapshot = {
  ...apiChat(),
  id: 'build.synthetic-remembered',
  revision: 7,
  name: 'Synthetic recovered saved build',
  locks: {
    ...apiChat().locks,
    catalog_snapshot_id: 'catalog.synthetic-remembered',
    dependency_graph_revision: 37,
  },
};
const other: BuildSnapshot = {
  ...apiChat(),
  id: 'build.synthetic-other',
  revision: 3,
  name: 'Synthetic newer opened build',
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

/** Injected HTTP and synthetic browser storage; these tests never contact a service. */
function harness(
  kind: Extract<DataErrorKind, 'network' | 'http' | 'malformed'> = 'network',
  hasId = true,
  surface: 'builder' | 'builds' = 'builder',
) {
  if (hasId) localStorage.setItem(key, remembered.id);
  let recover = false;
  let delayed: ReturnType<typeof deferred<Response>> | null = null;
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    if (init?.method === 'POST') return json(JSON.parse(String(init.body)));
    expect(init?.method).toBe('GET');
    if (url === `${baseUrl}/builds/${other.id}`) return json(other);
    expect(url).toBe(`${baseUrl}/builds/${remembered.id}`);
    if (delayed) return delayed.promise;
    if (recover) return json(remembered);
    if (kind === 'network') throw new Error('Synthetic offline failure');
    if (kind === 'http') return new Response('{}', { status: 503 });
    return json({ schema_version: '1.0.0', id: remembered.id, malformed: true });
  });
  const rows = new Map<string, string>();
  const providers = createFixtureProviders({ now: () => NOW });
  providers.builds = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl, fetch }),
    new LocalBuildRepository({
      getItem: (name) => rows.get(name) ?? null,
      setItem: (name, value) => void rows.set(name, value),
      removeItem: (name) => void rows.delete(name),
    }),
  );
  const save = vi.spyOn(providers.builds, 'save');
  let current!: ReturnType<typeof useBuilder>;
  function ObserveBuilder() {
    current = useBuilder();
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter>
          <BuilderProvider>
            <ObserveBuilder />
            {surface === 'builder' ? <BuilderPage /> : <MyBuildsPage />}
          </BuilderProvider>
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  return {
    get current() {
      return current;
    },
    get loadError() {
      // The announced recovery API can be inspected while this suite still typechecks at its original base.
      return (current as typeof current & { loadError: unknown | null }).loadError;
    },
    fetch,
    save,
    recover: () => {
      recover = true;
    },
    delayRetry: () => {
      delayed = deferred<Response>();
      return delayed;
    },
  };
}

beforeEach(() => localStorage.clear());

describe('remembered current-build recovery', () => {
  it.each(['network', 'http', 'malformed'] as const)(
    'keeps the remembered identity recoverable after a typed %s failure in the actual editor',
    async (kind) => {
      const h = harness(kind);
      await waitFor(() => expect(h.current.ready).toBe(true));
      expect(h.current.draft).toBeNull();
      expect(h.loadError).toBeInstanceOf(DataError);
      expect(h.loadError).toMatchObject({ kind });
      if (kind === 'malformed')
        expect(h.loadError).toMatchObject({
          contract: 'BuildSnapshot',
          validationErrors: expect.arrayContaining([
            expect.objectContaining({ keyword: expect.any(String) }),
          ]),
        });
      expect(localStorage.getItem(key)).toBe(remembered.id);
      expect(h.save).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox', { name: 'Build name' })).not.toBeInTheDocument();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(DATA_ERROR_TITLES[kind]);
      h.recover();
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
      await waitFor(() =>
        expect(screen.getByRole('textbox', { name: 'Build name' })).toHaveValue(remembered.name),
      );
      expect(h.current.draft?.build).toEqual(remembered);
      expect(h.current.draft?.build.locks).toEqual(remembered.locks);
      expect(h.loadError).toBeNull();
      expect(localStorage.getItem(key)).toBe(remembered.id);
      expect(h.save).not.toHaveBeenCalled();
      expect(h.fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
        [`${baseUrl}/builds/${remembered.id}`, 'GET'],
        [`${baseUrl}/builds/${remembered.id}`, 'GET'],
      ]);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('exposes and recovers the remembered-load failure in the actual My Builds working section', async () => {
    const h = harness('network', true, 'builds');
    await waitFor(() => expect(h.current.ready).toBe(true));
    expect(h.current.draft).toBeNull();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(DATA_ERROR_TITLES.network);
    expect(localStorage.getItem(key)).toBe(remembered.id);
    expect(h.save).not.toHaveBeenCalled();
    h.recover();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(h.current.draft?.build).toEqual(remembered));
    expect(await screen.findByRole('button', { name: /Continue editing/ })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: remembered.name }).length).toBeGreaterThan(0);
    expect(localStorage.getItem(key)).toBe(remembered.id);
    expect(h.save).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens a blank unsaved canvas when there is no remembered ID', async () => {
    const h = harness('network', false);
    await waitFor(() => expect(h.current.ready).toBe(true));
    expect(h.current.draft?.build.selections).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Build name' })).toBeInTheDocument();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['startNew', 'open'] as const)(
    'does not let a delayed recovery overwrite a newer successful %s action',
    async (action) => {
      const h = harness();
      await waitFor(() => expect(h.current.ready).toBe(true));
      const alert = await screen.findByRole('alert');
      const pending = h.delayRetry();
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
      if (action === 'startNew') {
        act(() => h.current.startNew(other, 'Synthetic newer explicit start'));
        await waitFor(() =>
          expect(h.current.draft?.build.name).toBe('Synthetic newer explicit start'),
        );
        await waitFor(() => expect(h.current.saveState.status).toBe('saved'));
      } else {
        await act(async () => h.current.open(other.id));
      }
      const winner = h.current.draft!.build;
      expect(winner.id).not.toBe(remembered.id);
      await act(async () => {
        pending.resolve(json(remembered));
      });
      expect(h.current.draft?.build).toEqual(winner);
      expect(localStorage.getItem(key)).toBe(winner.id);
      expect(screen.getByRole('textbox', { name: 'Build name' })).toHaveValue(winner.name);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
});
