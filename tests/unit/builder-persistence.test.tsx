import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { DataError } from '../../src/data/errors';
import type { StoredBuild } from '../../src/data/types';
import { createDraft } from '../../src/domain/build';
import { apiChat, NOW } from './scenarios';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function harness(strict = false, initialLoad?: ReturnType<typeof deferred<StoredBuild>>) {
  const first = createDraft({ ...apiChat(), id: 'build.first', revision: 4 });
  const second = createDraft({ ...apiChat(), id: 'build.second', revision: 12 });
  localStorage.setItem('pyai.currentBuildId', first.build.id);
  const providers = createFixtureProviders({ now: () => NOW });
  providers.builds.get = vi.fn(async (id) => (id === first.build.id ? first : second));
  if (initialLoad)
    vi.mocked(providers.builds.get).mockImplementationOnce(() => initialLoad.promise);
  const pending: ReturnType<typeof deferred<StoredBuild>>[] = [];
  const save = vi.fn((_stored: StoredBuild, _expectedRevision: number | null) => {
    const request = deferred<StoredBuild>();
    pending.push(request);
    return request.promise;
  });
  providers.builds.save = save;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: PropsWithChildren) => {
    const tree = (
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <BuilderProvider>{children}</BuilderProvider>
        </DataContext.Provider>
      </QueryClientProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  const hook = renderHook(() => useBuilder(), { wrapper });
  if (!initialLoad) {
    await waitFor(() => expect(hook.result.current.draft?.build.id).toBe(first.build.id));
  }
  const edit = (name: string) => {
    act(() => hook.result.current.apply((build) => ({ ...build, name }), 'Renamed', []));
  };
  const finish = async (index: number) => {
    await act(async () => pending[index]!.resolve(save.mock.calls[index]![0]));
  };
  return { ...hook, edit, finish, save, pending, first, second, providers };
}

beforeEach(() => localStorage.clear());

describe('builder persistence ordering', () => {
  it('saves rapid edits in order using each acknowledged revision', async () => {
    const h = await harness();
    h.edit('First edit');
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    h.edit('Second edit');
    expect(h.result.current.draft?.build.revision).toBe(6);
    expect(h.save).toHaveBeenCalledTimes(1);
    await h.finish(0);
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    expect(
      h.save.mock.calls.map(([stored, expected]) => [stored.build.revision, expected]),
    ).toEqual([
      [5, 4],
      [6, 5],
    ]);
    expect(h.result.current.saveState.status).toBe('saving');
    await h.finish(1);
    expect(h.result.current.saveState.status).toBe('saved');
  });

  it('does not let an old successful save change the opened build or its CAS revision', async () => {
    const h = await harness();
    h.edit('Pending edit');
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    await act(async () => h.result.current.open(h.second.build.id));
    await h.finish(0);
    expect(localStorage.getItem('pyai.currentBuildId')).toBe(h.second.build.id);
    h.edit('Other build edit');
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    expect(h.save.mock.calls[1]![1]).toBe(12);
    await h.finish(1);
  });

  it('does not let an old failure replace the newly opened build save state', async () => {
    const h = await harness();
    h.edit('Pending edit');
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    await act(async () => h.result.current.open(h.second.build.id));
    await act(async () => h.pending[0]!.reject(new DataError('conflict', 'Old build conflict')));
    expect(h.result.current.saveState.status).toBe('saved');
    expect(h.result.current.draft?.build.id).toBe(h.second.build.id);
  });

  it('keeps a failed predecessor visible and does not submit dependent revisions', async () => {
    const h = await harness();
    h.edit('First edit');
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    h.edit('Second edit');
    await act(async () => h.pending[0]!.reject(new DataError('conflict', 'Reload this build')));
    h.edit('Third edit');
    await act(async () => {});
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.result.current.saveState).toEqual({ status: 'error', message: 'Reload this build' });
  });

  it('dispatches one save per edit under StrictMode', async () => {
    const h = await harness(true);
    h.edit('One edit');
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.result.current.draft?.build.revision).toBe(5);
    await h.finish(0);
  });

  it('starts a separate save queue for a new build while the old save is pending', async () => {
    const h = await harness();
    h.edit('Pending old edit');
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    act(() => h.result.current.startNew());
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    const newId = h.result.current.draft!.build.id;
    expect(h.save.mock.calls[1]![1]).toBeNull();
    expect(h.save.mock.calls[1]![0].build.revision).toBe(1);
    await h.finish(0);
    expect(h.result.current.saveState.status).toBe('saving');
    await h.finish(1);
    expect(localStorage.getItem('pyai.currentBuildId')).toBe(newId);
    expect(h.result.current.saveState.status).toBe('saved');
  });

  it('ignores a slower open after a newer navigation has completed', async () => {
    const h = await harness();
    const slow = deferred<StoredBuild>();
    vi.mocked(h.providers.builds.get).mockImplementationOnce(() => slow.promise);
    let firstOpen!: Promise<void>;
    act(() => {
      firstOpen = h.result.current.open(h.first.build.id);
    });
    await act(async () => h.result.current.open(h.second.build.id));
    await act(async () => {
      slow.resolve(h.first);
      await firstOpen;
    });
    expect(h.result.current.draft?.build.id).toBe(h.second.build.id);
    expect(localStorage.getItem('pyai.currentBuildId')).toBe(h.second.build.id);
  });

  it('retains initial hydration when a requested open fails', async () => {
    const initialLoad = deferred<StoredBuild>();
    const h = await harness(false, initialLoad);
    await waitFor(() => expect(h.providers.builds.get).toHaveBeenCalledTimes(1));
    vi.mocked(h.providers.builds.get).mockRejectedValueOnce(new Error('Missing build'));
    await act(async () => {
      await expect(h.result.current.open('build.unavailable')).rejects.toThrow('Missing build');
    });
    await act(async () => initialLoad.resolve(h.first));
    expect(h.result.current.draft?.build.id).toBe(h.first.build.id);
    expect(h.result.current.ready).toBe(true);
  });

  it('retries a transiently failed revision before later edits', async () => {
    const h = await harness();
    h.edit('First edit');
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    h.edit('Second edit');
    await act(async () => h.pending[0]!.reject(new DataError('unsupported', 'Storage full')));
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.result.current.saveState.status).toBe('error');
    h.edit('Third edit after freeing storage');
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    expect(h.save.mock.calls[1]).toEqual(h.save.mock.calls[0]);
    await h.finish(1);
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(3));
    expect(h.save.mock.calls[2]![0].build.revision).toBe(6);
    expect(h.save.mock.calls[2]![1]).toBe(5);
    await h.finish(2);
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(4));
    expect(h.save.mock.calls[3]![0].build.revision).toBe(7);
    expect(h.save.mock.calls[3]![1]).toBe(6);
    await h.finish(3);
    expect(h.result.current.saveState.status).toBe('saved');
  });
});
