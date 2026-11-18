import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { validateContract, validatorsReady, type BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { ContractHttpClient, type FetchLike } from '../../src/data/http/client';
import { HttpBuildRepository } from '../../src/data/http/providers';
import { LocalBuildRepository } from '../../src/data/local-builds';
import { apiChat, NOW } from './scenarios';

const CURRENT_KEY = 'pyai.currentBuildId';
const baseUrl = 'https://builds.test/v1';
const disposers: (() => void)[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

interface Write {
  method: string;
  url: string;
  body: string;
  snapshot: BuildSnapshot;
  headers: Headers;
  response: ReturnType<typeof deferred<Response>>;
}

// All HTTP calls terminate here. The synthetic service validates the frozen
// BuildSnapshot schema, POST revision 1 and PUT's acknowledged If-Match step.
// Writes stay pending until the test explicitly acknowledges or fails them.
function service() {
  const heads = new Map<string, BuildSnapshot>();
  const writes: Write[] = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      const id = decodeURIComponent(url.slice(`${baseUrl}/builds/`.length));
      return heads.has(id)
        ? json(heads.get(id))
        : json({ code: 'not_found', message: 'Synthetic missing build' }, 404);
    }
    const body = String(init?.body);
    const snapshot = JSON.parse(body) as BuildSnapshot;
    const headers = new Headers(init?.headers);
    const response = deferred<Response>();
    writes.push({ method, url, body, snapshot, headers, response });
    const valid = validateContract('BuildSnapshot', snapshot);
    if (!valid.ok) return json({ code: 'invalid', message: valid.summary }, 422);
    if (!headers.get('Idempotency-Key'))
      return json({ code: 'invalid', message: 'Missing idempotency key' }, 422);
    if (method === 'POST') {
      if (url !== `${baseUrl}/builds` || snapshot.revision !== 1)
        return json({ code: 'invalid', message: 'Create requires revision 1' }, 422);
    } else if (method === 'PUT') {
      const head = heads.get(snapshot.id);
      if (
        url !== `${baseUrl}/builds/${encodeURIComponent(snapshot.id)}` ||
        !head ||
        headers.get('If-Match') !== `"${head.revision}"` ||
        snapshot.revision !== head.revision + 1
      )
        return json({ code: 'conflict', message: 'Synthetic stale writer' }, 409);
    } else throw new Error(`Unexpected synthetic method ${method}`);
    return response.promise;
  });
  const acknowledge = async (index: number) => {
    const write = writes[index]!;
    expect(validateContract('BuildSnapshot', write.snapshot).ok).toBe(true);
    heads.set(write.snapshot.id, structuredClone(write.snapshot));
    await act(async () =>
      write.response.resolve(json(write.snapshot, write.method === 'POST' ? 201 : 200)),
    );
  };
  const fail = async (index: number) => {
    await act(async () =>
      writes[index]!.response.resolve(
        json({ code: 'unavailable', message: 'Synthetic outage' }, 503),
      ),
    );
  };
  disposers.push(() => {
    for (const write of writes)
      write.response.resolve(json({ code: 'unavailable', message: 'Synthetic test ended' }, 503));
  });
  return { heads, writes, fetch, acknowledge, fail };
}

async function harness(options: { local?: boolean; remembered?: BuildSnapshot } = {}) {
  await validatorsReady;
  const remote = service();
  if (options.remembered) {
    remote.heads.set(options.remembered.id, options.remembered);
    localStorage.setItem(CURRENT_KEY, options.remembered.id);
  }
  const local = new LocalBuildRepository();
  const providers = createFixtureProviders({ now: () => NOW });
  providers.builds = options.local
    ? local
    : new HttpBuildRepository(new ContractHttpClient({ baseUrl, fetch: remote.fetch }), local);
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
  expect(hook.result.current.draft).not.toBeNull();
  const edit = (change: (build: BuildSnapshot) => BuildSnapshot, summary = 'Synthetic edit') =>
    act(() => hook.result.current.apply(change, summary, []));
  const start = async (template?: BuildSnapshot, name?: string) => {
    await act(async () => hook.result.current.startNew(template, name));
  };
  return { ...hook, ...remote, local, edit, start };
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function settle() {
  await act(async () => {});
}

function expectUnacknowledged(h: Harness) {
  expect(h.result.current.saveState.status).not.toBe('saved');
  expect(localStorage.getItem(CURRENT_KEY)).toBeNull();
}

async function expectDraftOnly(h: Harness) {
  await settle();
  expect(h.writes).toHaveLength(0);
  expect(h.result.current.saveState.status).not.toBe('saving');
  expectUnacknowledged(h);
  expect(await h.local.list()).toEqual([]);
}

beforeEach(() => localStorage.clear());
afterEach(async () => {
  cleanup();
  await act(async () => {
    for (const dispose of disposers.splice(0)) dispose();
  });
});

describe('remote draft creation through the real builder and HTTP repository', () => {
  it.each(['first visit', 'explicit new build'] as const)(
    'keeps %s edits in memory until a valid revision-one snapshot can be created',
    async (entry) => {
      const h = await harness();
      if (entry === 'explicit new build') await h.start(undefined, 'Synthetic chosen name');
      const id = h.result.current.draft!.build.id;
      const locks = {
        ...h.result.current.draft!.build.locks,
        pricebook_id: 'prices.synthetic.chosen',
      };
      expect(h.result.current.draft!.build.selections).toEqual([]);
      expect(validateContract('BuildSnapshot', h.result.current.draft!.build).ok).toBe(false);
      await expectDraftOnly(h);

      h.edit((build) => ({
        ...build,
        name: 'Synthetic chosen name',
        objectives: {
          ...build.objectives,
          region: 'synthetic-region',
          monthly_budget_amount: '123.45',
        },
        locks,
      }));
      await expectDraftOnly(h);
      h.edit((build) => ({ ...build, selections: apiChat().selections.slice(0, 1) }));
      expect(h.result.current.draft!.build.selections).toHaveLength(1);
      expect(validateContract('BuildSnapshot', h.result.current.draft!.build).ok).toBe(false);
      await expectDraftOnly(h);

      h.edit((build) => ({ ...build, selections: apiChat().selections.slice(0, 2) }));
      await waitFor(() => expect(h.writes).toHaveLength(1));
      const request = h.writes[0]!;
      expect(request.method).toBe('POST');
      expect(request.snapshot).toMatchObject({
        id,
        revision: 1,
        name: 'Synthetic chosen name',
        locks,
        objectives: { region: 'synthetic-region', monthly_budget_amount: '123.45' },
        selections: apiChat().selections.slice(0, 2),
      });
      expect(request.headers.get('If-Match')).toBeNull();
      expect(validateContract('BuildSnapshot', request.snapshot).ok).toBe(true);
      expectUnacknowledged(h);
      expect(await h.local.list()).toEqual([]);
      await h.acknowledge(0);
      await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
      expect(localStorage.getItem(CURRENT_KEY)).toBe(id);
      expect((await h.local.get(id)).build).toEqual(request.snapshot);
      expect(h.result.current.draft!.build).toEqual(request.snapshot);
    },
  );

  it('requires the whole snapshot to validate even when two selections are present', async () => {
    const h = await harness();
    h.edit((build) => ({
      ...build,
      objectives: { ...build.objectives, region: '' },
      selections: apiChat().selections.slice(0, 2),
    }));
    expect(h.result.current.draft!.build.selections).toHaveLength(2);
    expect(validateContract('BuildSnapshot', h.result.current.draft!.build).ok).toBe(false);
    await expectDraftOnly(h);
    h.edit((build) => ({
      ...build,
      objectives: { ...build.objectives, region: 'synthetic-fixed' },
    }));
    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0]!.snapshot.revision).toBe(1);
    expect(h.writes[0]!.snapshot.objectives.region).toBe('synthetic-fixed');
    await h.acknowledge(0);
    await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
  });

  it('creates a valid template immediately at revision one with its chosen locks and content', async () => {
    const h = await harness();
    const template: BuildSnapshot = {
      ...apiChat(),
      revision: 9,
      locks: { ...apiChat().locks, pricebook_id: 'prices.synthetic.template' },
    };
    const before = structuredClone(template);
    await h.start(template, 'Synthetic template copy');
    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0]!.snapshot).toMatchObject({
      revision: 1,
      name: 'Synthetic template copy',
      selections: template.selections,
      objectives: template.objectives,
      locks: template.locks,
    });
    expect(h.writes[0]!.snapshot.id).not.toBe(template.id);
    expectUnacknowledged(h);
    expect(await h.local.list()).toEqual([]);
    await h.acknowledge(0);
    await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
    expect(template).toEqual(before);
    expect(localStorage.getItem(CURRENT_KEY)).toBe(h.writes[0]!.snapshot.id);
  });

  it('preserves dispatched revision one and rapid subsequent revisions behind each acknowledgement', async () => {
    const h = await harness();
    await h.start(apiChat(), 'Synthetic original');
    await waitFor(() => expect(h.writes).toHaveLength(1));
    const first = structuredClone(h.result.current.draft!);
    const body = h.writes[0]!.body;
    h.edit((build) => ({ ...build, name: 'Synthetic second' }), 'Second revision');
    const second = structuredClone(h.result.current.draft!);
    h.edit(
      (build) => ({
        ...build,
        name: 'Synthetic third',
        objectives: { ...build.objectives, monthly_budget_amount: '333.00' },
      }),
      'Third revision',
    );
    const third = structuredClone(h.result.current.draft!);
    await settle();
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]!.body).toBe(body);
    expect(h.writes[0]!.snapshot).toEqual(first.build);
    expect(third.build.revision).toBe(3);
    expect(third.revisions).toEqual([first.build, second.build, third.build]);
    expectUnacknowledged(h);
    await h.acknowledge(0);
    await waitFor(() => expect(h.writes).toHaveLength(2));
    expect(h.result.current.draft!.build).toEqual(third.build);
    expect(h.result.current.saveState.status).toBe('saving');
    expect(h.writes[1]!.snapshot).toEqual(second.build);
    expect(h.writes[1]!.method).toBe('PUT');
    expect(h.writes[1]!.headers.get('If-Match')).toBe('"1"');
    await h.acknowledge(1);
    await waitFor(() => expect(h.writes).toHaveLength(3));
    expect(h.writes[2]!.snapshot).toEqual(third.build);
    expect(h.writes[2]!.method).toBe('PUT');
    expect(h.writes[2]!.headers.get('If-Match')).toBe('"2"');
    await h.acknowledge(2);
    await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
    const stored = await h.local.get(first.build.id);
    expect(stored).toEqual(third);
    expect(stored.changes.map((change) => change.revision)).toEqual([1, 2, 3]);
    expect(h.result.current.draft).toEqual(third);
  });

  it('retries a transient POST with the exact same body before queued updates', async () => {
    const h = await harness();
    await h.start(apiChat(), 'Synthetic retry original');
    await waitFor(() => expect(h.writes).toHaveLength(1));
    const firstBody = h.writes[0]!.body;
    h.edit((build) => ({ ...build, name: 'Synthetic queued second' }));
    const second = structuredClone(h.result.current.draft!.build);
    await h.fail(0);
    await waitFor(() => expect(h.result.current.saveState.status).toBe('error'));
    expect(h.writes).toHaveLength(1);
    expectUnacknowledged(h);
    expect(await h.local.list()).toEqual([]);
    h.edit((build) => ({ ...build, name: 'Synthetic queued third' }));
    const third = structuredClone(h.result.current.draft!);
    await waitFor(() => expect(h.writes).toHaveLength(2));
    expect(h.writes[1]!.method).toBe('POST');
    expect(h.writes[1]!.body).toBe(firstBody);
    expect(h.writes[1]!.headers.get('If-Match')).toBeNull();
    await h.acknowledge(1);
    await waitFor(() => expect(h.writes).toHaveLength(3));
    expect(h.writes[2]!.snapshot).toEqual(second);
    expect(h.writes[2]!.headers.get('If-Match')).toBe('"1"');
    await h.acknowledge(2);
    await waitFor(() => expect(h.writes).toHaveLength(4));
    expect(h.writes[3]!.snapshot).toEqual(third.build);
    expect(h.writes[3]!.headers.get('If-Match')).toBe('"2"');
    await h.acknowledge(3);
    await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
    expect(await h.local.get(third.build.id)).toEqual(third);
  });

  it('keeps incomplete edits after a successful create unsaved until the next valid CAS snapshot', async () => {
    const h = await harness();
    await h.start(apiChat(), 'Synthetic saved original');
    await waitFor(() => expect(h.writes).toHaveLength(1));
    await h.acknowledge(0);
    await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
    const acknowledged = structuredClone(h.result.current.draft!);
    h.edit((build) => ({ ...build, selections: build.selections.slice(0, 1) }), 'Incomplete edit');
    await settle();
    expect(validateContract('BuildSnapshot', h.result.current.draft!.build).ok).toBe(false);
    expect(h.writes).toHaveLength(1);
    expect(h.result.current.saveState.status).not.toBe('saved');
    expect(h.result.current.saveState.status).not.toBe('saving');
    expect(await h.local.get(acknowledged.build.id)).toEqual(acknowledged);
    expect(h.result.current.draft!.revisions).toContainEqual(acknowledged.build);
    act(() => h.result.current.restore(1));
    await waitFor(() => expect(h.writes).toHaveLength(2));
    expect(h.writes[1]!.method).toBe('PUT');
    expect(h.writes[1]!.headers.get('If-Match')).toBe('"1"');
    expect(h.writes[1]!.snapshot).toMatchObject({
      id: acknowledged.build.id,
      revision: 2,
      selections: acknowledged.build.selections,
    });
    await h.acknowledge(1);
    await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
    const stored = await h.local.get(acknowledged.build.id);
    expect(stored.revisions).toContainEqual(acknowledged.build);
    expect(stored.build).toEqual(h.writes[1]!.snapshot);
    expect(h.result.current.draft).toEqual(stored);
  });

  it('corrects an incomplete successor behind a pending create without changing the frozen request', async () => {
    const h = await harness();
    await h.start(apiChat(), 'Synthetic pending original');
    await waitFor(() => expect(h.writes).toHaveLength(1));
    const frozen = structuredClone(h.result.current.draft!);
    const firstBody = h.writes[0]!.body;
    h.edit(
      (build) => ({ ...build, selections: build.selections.slice(0, 1) }),
      'Incomplete successor',
    );
    await settle();
    expect(h.writes).toHaveLength(1);
    expectUnacknowledged(h);
    await h.acknowledge(0);
    await settle();
    expect(h.writes).toHaveLength(1);
    expect(h.result.current.saveState.status).not.toBe('saved');
    expect(h.result.current.draft!.build.selections).toHaveLength(1);
    expect((await h.local.get(frozen.build.id)).build).toEqual(frozen.build);
    h.edit(
      (build) => ({
        ...build,
        name: 'Synthetic corrected successor',
        selections: apiChat().selections.slice(0, 2),
      }),
      'Corrected successor',
    );
    await waitFor(() => expect(h.writes).toHaveLength(2));
    expect(h.writes[0]!.body).toBe(firstBody);
    expect(h.writes[0]!.snapshot).toEqual(frozen.build);
    expect(h.writes[1]!.headers.get('If-Match')).toBe('"1"');
    expect(h.writes[1]!.snapshot).toMatchObject({
      revision: 2,
      name: 'Synthetic corrected successor',
      selections: apiChat().selections.slice(0, 2),
    });
    await h.acknowledge(1);
    await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
    const stored = await h.local.get(frozen.build.id);
    expect(stored.revisions).toContainEqual(frozen.build);
    expect(stored.build).toEqual(h.writes[1]!.snapshot);
  });

  it.each(['success', 'failure'] as const)(
    'an old POST %s cannot replace a newly started unsaved empty draft',
    async (outcome) => {
      const h = await harness();
      await h.start(apiChat(), 'Synthetic old pending');
      await waitFor(() => expect(h.writes).toHaveLength(1));
      await h.start(undefined, 'Synthetic new empty');
      const current = structuredClone(h.result.current.draft!);
      if (outcome === 'success') await h.acknowledge(0);
      else await h.fail(0);
      await settle();
      expect(h.result.current.draft).toEqual(current);
      expect(h.result.current.saveState.status).not.toBe('saved');
      expect(localStorage.getItem(CURRENT_KEY)).not.toBe(h.writes[0]!.snapshot.id);
      expect(h.writes).toHaveLength(1);
    },
  );

  it.each(['success', 'failure'] as const)(
    'an old POST %s cannot replace a newly opened build or its acknowledged CAS revision',
    async (outcome) => {
      const h = await harness();
      await h.start(apiChat(), 'Synthetic old pending');
      await waitFor(() => expect(h.writes).toHaveLength(1));
      const other: BuildSnapshot = { ...apiChat(), id: 'build.synthetic.other', revision: 7 };
      h.heads.set(other.id, other);
      await act(async () => h.result.current.open(other.id));
      if (outcome === 'success') await h.acknowledge(0);
      else await h.fail(0);
      expect(h.result.current.draft!.build).toEqual(other);
      expect(h.result.current.saveState.status).toBe('saved');
      expect(localStorage.getItem(CURRENT_KEY)).toBe(other.id);
      h.edit((build) => ({ ...build, name: 'Synthetic opened edit' }));
      await waitFor(() => expect(h.writes).toHaveLength(2));
      expect(h.writes[1]!.snapshot.revision).toBe(8);
      expect(h.writes[1]!.snapshot.id).toBe(other.id);
      expect(h.writes[1]!.headers.get('If-Match')).toBe('"7"');
      await h.acknowledge(1);
      await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
    },
  );

  it('keeps local empty-draft editing, revision history and restoration unchanged', async () => {
    const h = await harness({ local: true });
    await h.start(undefined, 'Synthetic local original');
    await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
    const first = structuredClone(h.result.current.draft!.build);
    h.edit((build) => ({ ...build, name: 'Synthetic local renamed' }), 'Local rename');
    await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
    const second = structuredClone(h.result.current.draft!.build);
    h.edit(
      (build) => ({ ...build, selections: apiChat().selections.slice(0, 1) }),
      'Local selection',
    );
    await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
    const third = structuredClone(h.result.current.draft!.build);
    expect(h.result.current.draft!.revisions).toEqual([first, second, third]);
    expect(third.revision).toBe(3);
    expect(third.selections).toHaveLength(1);
    expect(await h.local.get(first.id)).toEqual(h.result.current.draft);
    act(() => h.result.current.restore(1));
    await waitFor(() => expect(h.result.current.saveState.status).toBe('saved'));
    expect(h.result.current.draft!.build).toMatchObject({
      revision: 4,
      name: first.name,
      selections: [],
    });
    expect(h.result.current.draft!.revisions.slice(0, 3)).toEqual([first, second, third]);
    expect(await h.local.get(first.id)).toEqual(h.result.current.draft);
    expect(localStorage.getItem(CURRENT_KEY)).toBe(first.id);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
