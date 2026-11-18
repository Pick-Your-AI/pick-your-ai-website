import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import { DATA_ERROR_TITLES, DataError, type DataErrorKind } from '../../src/data/errors';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import type { StoredBuild } from '../../src/data/types';
import { createDraft } from '../../src/domain/build';
import ComparePage from '../../src/pages/ComparePage';
import { apiChat, NOW } from './scenarios';

const currentKey = 'pyai.currentBuildId';
const first = { ...apiChat(), id: 'build.synthetic-remembered', revision: 1 };
const second = { ...first, revision: 2, name: 'Synthetic recovered build' };
const recovered: StoredBuild = { ...createDraft(second), revisions: [first, second] };
const saved = ['a', 'b'].map((suffix) =>
  createDraft({ ...first, id: `build.synthetic-${suffix}`, name: `Synthetic saved ${suffix}` }),
);
type Failure = Extract<DataErrorKind, 'network' | 'http' | 'malformed'>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

/** Synthetic provider failures exercise the real page and BuilderProvider without network I/O. */
function show(path: string, kind: Failure | 'pending' = 'network') {
  localStorage.setItem(currentKey, first.id);
  const providers = createFixtureProviders({ now: () => NOW });
  const pending = deferred<StoredBuild>();
  let rememberedCalls = 0;
  const get = vi.spyOn(providers.builds, 'get').mockImplementation(async (id) => {
    const match = saved.find((entry) => entry.build.id === id);
    if (match) return match;
    expect(id).toBe(first.id);
    rememberedCalls += 1;
    if (kind === 'pending' || rememberedCalls > 1) return pending.promise;
    throw new DataError(kind, `Synthetic ${kind} remembered-build failure`);
  });
  const list = vi.spyOn(providers.builds, 'list').mockResolvedValue(
    saved.map(({ build }) => ({
      id: build.id,
      name: build.name,
      revision: build.revision,
      updatedAt: build.updated_at,
      selectionCount: build.selections.length,
    })),
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
        <MemoryRouter initialEntries={[path]}>
          <BuilderProvider>
            <ToastProvider>
              <ObserveBuilder />
              <ComparePage />
            </ToastProvider>
          </BuilderProvider>
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  return {
    get current() {
      return current;
    },
    get,
    list,
    save,
    resolve: () => pending.resolve(recovered),
  };
}

const surfaces = [
  { path: '/compare?revisions=1,2', chooser: false },
  { path: '/compare?mode=builds', chooser: true },
];

async function expectRecovered(chooser: boolean) {
  if (chooser) {
    const revisions = screen.getByRole('region', { name: 'Revisions of your current build' });
    expect(within(revisions).getByRole('checkbox', { name: 'Revision 1' })).toBeInTheDocument();
    expect(
      within(revisions).getByRole('checkbox', { name: /Revision 2 \(current\)/ }),
    ).toBeInTheDocument();
  } else {
    expect(
      await screen.findByRole('table', { name: 'Selections compared between A and B' }),
    ).toBeInTheDocument();
    expect(screen.getByText('A: Revision 1 → B: Revision 2')).toBeInTheDocument();
  }
  expect(screen.queryByText('Loading your current build…')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
}

beforeEach(() => localStorage.clear());

describe.each(surfaces)('remembered-build recovery at $path', ({ path, chooser }) => {
  it.each(['network', 'http', 'malformed'] as const)(
    'shows the typed %s error, retries the same build, and restores revision content',
    async (kind) => {
      const h = show(path, kind);
      await waitFor(() => expect(h.current.ready).toBe(true));
      expect(h.current.draft).toBeNull();
      expect(h.current.loadError).toMatchObject({ kind });
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(DATA_ERROR_TITLES[kind]);
      expect(alert).toHaveTextContent(`Synthetic ${kind} remembered-build failure`);
      expect(screen.queryByText('Loading your current build…')).not.toBeInTheDocument();
      if (chooser) {
        const savedBuilds = screen.getByRole('region', { name: 'Saved builds' });
        expect(
          await within(savedBuilds).findByRole('checkbox', { name: /Synthetic saved a/ }),
        ).toBeEnabled();
        expect(
          within(savedBuilds).getByRole('checkbox', { name: /Synthetic saved b/ }),
        ).toBeEnabled();
      }
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
      expect(h.current.ready).toBe(false);
      expect(screen.getByText('Loading your current build…')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await act(async () => h.resolve());
      await waitFor(() => expect(h.current.draft).toEqual(recovered));
      await expectRecovered(chooser);
      expect(h.get.mock.calls).toEqual([[first.id], [first.id]]);
      expect(h.save).not.toHaveBeenCalled();
      expect(localStorage.getItem(currentKey)).toBe(first.id);
    },
  );

  it('keeps the loading state while the initial remembered-build read is pending', async () => {
    const h = show(path, 'pending');
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(first.id));
    expect(h.current.ready).toBe(false);
    expect(screen.getByText('Loading your current build…')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await act(async () => h.resolve());
    await waitFor(() => expect(h.current.draft).toEqual(recovered));
    await expectRecovered(chooser);
  });
});

describe('comparison independent of the current build', () => {
  it('can select and compare saved builds while the current-build load has failed', async () => {
    const h = show('/compare?mode=builds');
    await waitFor(() => expect(h.current.loadError).toMatchObject({ kind: 'network' }));
    const savedBuilds = screen.getByRole('region', { name: 'Saved builds' });
    fireEvent.click(
      await within(savedBuilds).findByRole('checkbox', { name: /Synthetic saved a/ }),
    );
    fireEvent.click(within(savedBuilds).getByRole('checkbox', { name: /Synthetic saved b/ }));
    fireEvent.click(within(savedBuilds).getByRole('button', { name: 'Compare these two' }));
    expect(
      await screen.findByRole('table', { name: 'Selections compared between A and B' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A: Synthetic saved a (r1) → B: Synthetic saved b (r1)'),
    ).toBeInTheDocument();
    expect(h.current.loadError).toMatchObject({ kind: 'network' });
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('keeps the component table available after a current-build load failure', async () => {
    const h = show('/compare?ids=demo~model~aurora-mini,demo~model~aurora-large');
    await waitFor(() => expect(h.current.loadError).toMatchObject({ kind: 'network' }));
    expect(await screen.findByRole('link', { name: 'Demo Aurora Mini' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Demo Aurora Large' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByText('Loading your current build…')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
  });
});
