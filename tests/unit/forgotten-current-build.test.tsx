import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { ContractHttpClient, type FetchLike } from '../../src/data/http/client';
import { HttpBuildRepository } from '../../src/data/http/providers';
import { LocalBuildRepository } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import { apiChat, NOW } from './scenarios';

const CURRENT_KEY = 'pyai.currentBuildId';
const API_BASE = 'https://synthetic.invalid/v1';
const FORGOTTEN = { ...apiChat(), id: 'build.synthetic.forget', name: 'Synthetic forgotten build' };
const OTHER = { ...apiChat(), id: 'build.synthetic.other', name: 'Synthetic other build' };
const successMessage = 'Build forgotten in this browser. The API-stored build was not deleted.';
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Real client paths, synthetic browser storage and injected transport only; no live service. */
async function harness(options: { current?: BuildSnapshot; unavailable?: boolean } = {}) {
  const current = options.current ?? FORGOTTEN;
  const local = new LocalBuildRepository();
  for (const build of [FORGOTTEN, OTHER]) await local.save(createDraft(build), null);
  localStorage.setItem(CURRENT_KEY, current.id);
  const remote = new Map([FORGOTTEN, OTHER].map((build) => [build.id, structuredClone(build)]));
  let unavailable = options.unavailable ?? false;
  let writeGate: ReturnType<typeof deferred<void>> | undefined;
  const readGates = new Map<string, ReturnType<typeof deferred<Response>>>();
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    const method = init?.method ?? 'GET';
    const id = decodeURIComponent(url.slice(`${API_BASE}/builds/`.length));
    if (method === 'GET') {
      const gate = readGates.get(id);
      if (gate) return gate.promise;
      if (unavailable && id === FORGOTTEN.id) throw new Error('Synthetic read unavailable');
      return remote.has(id) ? json(remote.get(id)) : new Response('{}', { status: 404 });
    }
    if (method === 'PUT' || method === 'POST') {
      const build = JSON.parse(String(init?.body)) as BuildSnapshot;
      if (writeGate) await writeGate.promise;
      remote.set(build.id, structuredClone(build));
      return json(build);
    }
    throw new Error(`Unexpected synthetic method ${method}`);
  });
  const providers = createFixtureProviders({ now: () => NOW });
  const builds = new HttpBuildRepository(
    new ContractHttpClient({ baseUrl: API_BASE, fetch }),
    local,
  );
  providers.builds = builds;
  const save = vi.spyOn(builds, 'save');
  let observed!: ReturnType<typeof useBuilder>;
  function Observe() {
    observed = useBuilder();
    return null;
  }
  function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter>
            <ToastProvider>
              <BuilderProvider>
                <Observe />
                <MyBuildsPage />
              </BuilderProvider>
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
  }
  const view = mount();
  await waitFor(() => expect(observed.ready).toBe(true));
  return {
    get current() {
      return observed;
    },
    builds,
    local,
    remote,
    fetch,
    save,
    view,
    mount,
    recover: () => {
      unavailable = false;
    },
    delayRead: (id: string) => {
      const gate = deferred<Response>();
      readGates.set(id, gate);
      return gate;
    },
    delayWrite: () => {
      writeGate = deferred<void>();
      return writeGate;
    },
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function cardFor(build: BuildSnapshot) {
  const button = await screen.findByRole('button', { name: `Forget ${build.name}` });
  const card = button.closest('article');
  if (!card) throw new Error('Synthetic build card is missing');
  return { button, card };
}

async function confirmForget(build: BuildSnapshot = FORGOTTEN) {
  const { button, card } = await cardFor(build);
  fireEvent.click(button);
  fireEvent.click(within(card).getByRole('button', { name: 'Yes, forget' }));
}

async function expectForgotten(h: Harness) {
  await waitFor(() => expect(screen.getByText(successMessage)).toBeInTheDocument());
  expect((await h.builds.list()).some((entry) => entry.id === FORGOTTEN.id)).toBe(false);
  expect(localStorage.getItem(`pyai.build.${FORGOTTEN.id}`)).toBeNull();
  expect(h.remote.has(FORGOTTEN.id)).toBe(true);
  expect(h.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('forgetting HTTP builds through the real saved-build UI', () => {
  it('clears the current browser selection and copy while preserving the remote record', async () => {
    const h = await harness();
    await confirmForget();
    await expectForgotten(h);
    expect(localStorage.getItem(CURRENT_KEY)).not.toBe(FORGOTTEN.id);
    expect(h.current.draft?.build.id).not.toBe(FORGOTTEN.id);
    expect(h.remote.get(FORGOTTEN.id)).toEqual(FORGOTTEN);
  });

  it('does not GET or reopen the forgotten current identity on a fresh mount', async () => {
    const h = await harness();
    await confirmForget();
    await expectForgotten(h);
    h.view.unmount();
    h.fetch.mockClear();
    h.mount();
    await waitFor(() => expect(h.current.ready).toBe(true));
    expect(h.current.draft).not.toBeNull();
    expect(h.current.draft?.build.id).not.toBe(FORGOTTEN.id);
    expect(
      h.fetch.mock.calls.filter(
        ([url, init]) => init?.method === 'GET' && url === `${API_BASE}/builds/${FORGOTTEN.id}`,
      ),
    ).toEqual([]);
  });

  it('preserves another current build when forgetting a non-current build', async () => {
    const h = await harness({ current: OTHER });
    await confirmForget();
    await expectForgotten(h);
    expect(h.current.draft?.build).toEqual(OTHER);
    expect(localStorage.getItem(CURRENT_KEY)).toBe(OTHER.id);
    expect((await h.local.get(OTHER.id)).build).toEqual(OTHER);
  });

  it('preserves the current selection and saved copy when cancellation is chosen', async () => {
    const h = await harness();
    const remove = vi.spyOn(h.builds, 'remove');
    const { button, card } = await cardFor(FORGOTTEN);
    fireEvent.click(button);
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    expect(h.current.draft?.build).toEqual(FORGOTTEN);
    expect(localStorage.getItem(CURRENT_KEY)).toBe(FORGOTTEN.id);
    expect((await h.local.get(FORGOTTEN.id)).build).toEqual(FORGOTTEN);
    expect(screen.queryByText(successMessage)).not.toBeInTheDocument();
  });

  it('reports removal failure without changing the selection or claiming success', async () => {
    const h = await harness();
    vi.spyOn(h.builds, 'remove').mockRejectedValue(new Error('Synthetic forget failed'));
    await confirmForget();
    expect(await screen.findByText('Synthetic forget failed')).toHaveAttribute('role', 'alert');
    expect(h.current.draft?.build).toEqual(FORGOTTEN);
    expect(localStorage.getItem(CURRENT_KEY)).toBe(FORGOTTEN.id);
    expect((await h.local.get(FORGOTTEN.id)).build).toEqual(FORGOTTEN);
    expect(screen.queryByText(successMessage)).not.toBeInTheDocument();
  });

  it('does not recreate a forgotten browser record when a prior save is acknowledged late', async () => {
    const h = await harness();
    const gate = h.delayWrite();
    act(() =>
      h.current.apply(
        (build) => ({ ...build, name: 'Synthetic pending edit' }),
        'Synthetic edit',
        [],
      ),
    );
    await waitFor(() =>
      expect(h.fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    const pendingSave = h.save.mock.results[0]!.value as Promise<unknown>;
    await confirmForget();
    await expectForgotten(h);
    await act(async () => {
      gate.resolve();
      await pendingSave;
    });
    expect((await h.builds.list()).some((entry) => entry.id === FORGOTTEN.id)).toBe(false);
    expect(localStorage.getItem(`pyai.build.${FORGOTTEN.id}`)).toBeNull();
    expect(localStorage.getItem(CURRENT_KEY)).not.toBe(FORGOTTEN.id);
    expect(h.current.draft?.build.id).not.toBe(FORGOTTEN.id);
    expect(h.remote.get(FORGOTTEN.id)?.name).toBe('Synthetic pending edit');
    expect(h.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it.each(['opened', 'started'] as const)(
    'does not replace a newer %s draft when an older removal resolves',
    async (action) => {
      const h = await harness();
      const gate = deferred<void>();
      const originalRemove = h.builds.remove.bind(h.builds);
      const remove = vi.spyOn(h.builds, 'remove').mockImplementation(async (id) => {
        await gate.promise;
        await originalRemove(id);
      });
      await confirmForget();
      await waitFor(() => expect(remove).toHaveBeenCalledWith(FORGOTTEN.id));
      if (action === 'opened') await act(async () => h.current.open(OTHER.id));
      else {
        await act(async () => h.current.startNew(OTHER, 'Synthetic newer copy'));
        await waitFor(() => expect(h.current.saveState.status).toBe('saved'));
      }
      const newer = structuredClone(h.current.draft!.build);
      expect(newer.id).not.toBe(FORGOTTEN.id);
      await act(async () => gate.resolve());
      await expectForgotten(h);
      expect(h.current.draft?.build).toEqual(newer);
      expect(localStorage.getItem(CURRENT_KEY)).toBe(newer.id);
    },
  );

  it.each(['succeeds', 'fails'] as const)(
    'keeps forgotten A retired when an overlapping newer open of B later %s',
    async (outcome) => {
      const h = await harness();
      const removalGate = deferred<void>();
      const originalRemove = h.builds.remove.bind(h.builds);
      const remove = vi.spyOn(h.builds, 'remove').mockImplementation(async (id) => {
        await removalGate.promise;
        await originalRemove(id);
      });
      await confirmForget();
      await waitFor(() => expect(remove).toHaveBeenCalledWith(FORGOTTEN.id));
      const readGate = h.delayRead(OTHER.id);
      const get = vi.spyOn(h.builds, 'get');
      let opening!: Promise<unknown>;
      act(() => {
        // Observe the rejected open without creating an unhandled rejection; the real
        // provider still owns all selection, navigation and persistence behavior.
        opening = h.current.open(OTHER.id).catch((error: unknown) => error);
      });
      await waitFor(() => expect(get).toHaveBeenCalledWith(OTHER.id));
      await act(async () => removalGate.resolve());
      // The toast awaits query invalidation, which may itself wait for B's read.
      // Establish successful storage removal without blocking that pending read.
      await waitFor(async () => {
        expect((await h.builds.list()).some((entry) => entry.id === FORGOTTEN.id)).toBe(false);
      });
      let openResult: unknown;
      await act(async () => {
        readGate.resolve(
          outcome === 'succeeds' ? json(OTHER) : new Response('{}', { status: 503 }),
        );
        openResult = await opening;
      });
      await expectForgotten(h);
      if (outcome === 'succeeds') {
        expect(openResult).toBeUndefined();
        expect(h.current.draft?.build).toEqual(OTHER);
        expect(localStorage.getItem(CURRENT_KEY)).toBe(OTHER.id);
      } else {
        expect(openResult).toBeInstanceOf(Error);
        // A failed newer navigation cannot strand the forgotten build as an editable
        // draft whose save session has already been retired by successful forgetting.
        expect(h.current.draft?.build.id).not.toBe(FORGOTTEN.id);
        expect(localStorage.getItem(CURRENT_KEY)).not.toBe(FORGOTTEN.id);
      }
      expect((await h.builds.list()).some((entry) => entry.id === FORGOTTEN.id)).toBe(false);
      expect(h.remote.get(FORGOTTEN.id)).toEqual(FORGOTTEN);
      h.view.unmount();
      h.fetch.mockClear();
      h.mount();
      await waitFor(() => expect(h.current.ready).toBe(true));
      expect(h.current.draft?.build.id).not.toBe(FORGOTTEN.id);
      expect(
        h.fetch.mock.calls.filter(
          ([url, init]) => init?.method === 'GET' && url === `${API_BASE}/builds/${FORGOTTEN.id}`,
        ),
      ).toEqual([]);
      expect(h.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    },
  );

  it('keeps forgotten A absent after a delayed acknowledgement and a second queued valid edit', async () => {
    const h = await harness();
    const gate = h.delayWrite();
    act(() =>
      h.current.apply(
        (build) => ({ ...build, name: 'Synthetic first queued edit' }),
        'First edit',
        [],
      ),
    );
    await waitFor(() =>
      expect(h.fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    act(() =>
      h.current.apply(
        (build) => ({ ...build, name: 'Synthetic second queued edit' }),
        'Second edit',
        [],
      ),
    );
    expect(h.current.draft?.build.revision).toBe(FORGOTTEN.revision + 2);
    expect(h.save).toHaveBeenCalledTimes(1);
    const pendingSave = h.save.mock.results[0]!.value as Promise<unknown>;
    await confirmForget();
    await expectForgotten(h);
    await act(async () => {
      gate.resolve();
      await pendingSave;
    });
    // Implementations may discard queued work or finish already-dispatched writes.
    // Await every observed write before asserting the browser remains forgotten.
    await act(async () => {
      for (let pass = 0; pass < 3; pass++) {
        await Promise.all(h.save.mock.results.map((result) => result.value as Promise<unknown>));
      }
    });
    expect((await h.builds.list()).some((entry) => entry.id === FORGOTTEN.id)).toBe(false);
    expect(localStorage.getItem(`pyai.build.${FORGOTTEN.id}`)).toBeNull();
    expect(localStorage.getItem(CURRENT_KEY)).not.toBe(FORGOTTEN.id);
    expect(h.current.draft?.build.id).not.toBe(FORGOTTEN.id);
    expect(h.remote.has(FORGOTTEN.id)).toBe(true);
    expect(h.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('forgets an unavailable remembered identity and clears recovery state across retry and remount', async () => {
    const h = await harness({ unavailable: true });
    expect(h.current.draft).toBeNull();
    expect(h.current.loadError).not.toBeNull();
    await confirmForget();
    await expectForgotten(h);
    expect(localStorage.getItem(CURRENT_KEY)).not.toBe(FORGOTTEN.id);
    expect(h.current.loadError).toBeNull();
    h.recover();
    h.fetch.mockClear();
    await act(async () => h.current.retryLoad());
    h.view.unmount();
    h.mount();
    await waitFor(() => expect(h.current.ready).toBe(true));
    expect(h.current.loadError).toBeNull();
    expect(h.current.draft?.build.id).not.toBe(FORGOTTEN.id);
    expect(
      h.fetch.mock.calls.filter(
        ([url, init]) => init?.method === 'GET' && url === `${API_BASE}/builds/${FORGOTTEN.id}`,
      ),
    ).toEqual([]);
  });
});

it('adversarial: older pending open cannot resurrect a subsequently forgotten identity', async () => {
  const h = await harness({ current: OTHER });
  const gate = deferred<void>();
  const originalGet = h.builds.get.bind(h.builds);
  const get = vi.spyOn(h.builds, 'get').mockImplementation(async (id) => {
    if (id === FORGOTTEN.id) await gate.promise;
    return originalGet(id);
  });
  let pending!: Promise<void>;
  act(() => {
    pending = h.current.open(FORGOTTEN.id);
  });
  await waitFor(() => expect(get).toHaveBeenCalledWith(FORGOTTEN.id));
  await act(async () => {
    await h.current.remove(FORGOTTEN.id);
  });
  expect(localStorage.getItem(CURRENT_KEY)).toBe(OTHER.id);
  await act(async () => {
    gate.resolve();
    await pending;
  });
  expect(h.current.draft?.build.id).toBe(OTHER.id);
  expect(localStorage.getItem(CURRENT_KEY)).toBe(OTHER.id);
});

it('adversarial: newer explicit open of removal target remains saveable', async () => {
  const h = await harness({ current: OTHER });
  const gate = deferred<void>();
  const originalRemove = h.builds.remove.bind(h.builds);
  vi.spyOn(h.builds, 'remove').mockImplementation(async (id) => {
    await gate.promise;
    await originalRemove(id);
  });
  let pending!: Promise<void>;
  act(() => {
    pending = h.current.remove(FORGOTTEN.id);
  });
  await act(async () => {
    await h.current.open(FORGOTTEN.id);
  });
  await act(async () => {
    gate.resolve();
    await pending;
  });
  expect(h.current.draft?.build.id).toBe(FORGOTTEN.id);
  act(() => h.current.apply((b) => ({ ...b, name: 'Newer explicit edit' }), 'Edit', []));
  await waitFor(() => expect(h.save).toHaveBeenCalled());
});
