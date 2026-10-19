import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '../../src/data/errors';
import { ContractHttpClient, type FetchLike } from '../../src/data/http/client';
import { HttpCatalogRepository } from '../../src/data/http/providers';
import { CATALOG } from './scenarios';

const BASE_URL = 'https://api.test/v1';
const TIMEOUT = 50;
const cleanup: (() => void)[] = [];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
  vi.useRealTimers();
});

/** Real Response body consumption, with the transport abort connected to its stream. */
function streamedFetch(status = 200, headersAfter = 0) {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let signal: AbortSignal | null | undefined;
  let ended = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(stream) {
        controller = stream;
        stream.enqueue(new TextEncoder().encode('{"message":'));
      },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
  const abort = () => {
    if (!ended) {
      ended = true;
      controller.error(signal?.reason);
    }
  };
  const close = () => {
    signal?.removeEventListener('abort', abort);
    if (!ended) {
      ended = true;
      controller.close();
    }
  };
  cleanup.push(close);
  const fetch: FetchLike = vi.fn(async (_url, init) => {
    signal = init?.signal;
    signal?.addEventListener('abort', abort, { once: true });
    if (headersAfter > 0) await new Promise((resolve) => setTimeout(resolve, headersAfter));
    return response;
  });
  return {
    fetch,
    response,
    get signal() {
      return signal;
    },
    finish(suffix = '"complete"}') {
      controller.enqueue(new TextEncoder().encode(suffix));
      close();
    },
  };
}

function client(fetch: FetchLike) {
  return new ContractHttpClient({ baseUrl: BASE_URL, fetch, timeoutMs: TIMEOUT });
}

type Outcome =
  | { state: 'pending' }
  | { state: 'fulfilled'; value: unknown }
  | { state: 'rejected'; error: unknown };

/** Assert settlement at the deadline without leaving a deliberately stalled test awaiting forever. */
function observe(promise: Promise<unknown>) {
  const result: { current: Outcome } = { current: { state: 'pending' } };
  void promise.then(
    (value) => {
      result.current = { state: 'fulfilled', value };
    },
    (error: unknown) => {
      result.current = { state: 'rejected', error };
    },
  );
  return result;
}

function expectFailure(result: { current: Outcome }, kind: DataError['kind'], status?: number) {
  expect(result.current).toMatchObject({
    state: 'rejected',
    error: { name: 'DataError', kind, status },
  });
  if (result.current.state === 'rejected') expect(result.current.error).toBeInstanceOf(DataError);
}

describe('HTTP request deadline', () => {
  it('aborts a request that never receives headers', async () => {
    let signal: AbortSignal | null | undefined;
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init?.signal;
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
      });
    const result = observe(client(fetch).request('GET', '/pending'));

    await vi.advanceTimersByTimeAsync(TIMEOUT);

    expectFailure(result, 'network');
    expect(signal?.aborted).toBe(true);
  });

  it('aborts a successful response whose JSON body never completes', async () => {
    const stream = streamedFetch();
    const result = observe(client(stream.fetch).request('GET', '/pending'));

    await vi.advanceTimersByTimeAsync(TIMEOUT);

    expectFailure(result, 'network', 200);
    expect(stream.signal?.aborted).toBe(true);
  });

  it.each([
    [404, 'not_found'],
    [409, 'conflict'],
    [500, 'http'],
  ] as const)(
    'bounds a stalled HTTP %i error body while retaining the known %s status',
    async (status, kind) => {
      const stream = streamedFetch(status);
      const result = observe(client(stream.fetch).request('GET', '/pending'));

      await vi.advanceTimersByTimeAsync(TIMEOUT);

      expectFailure(result, kind, status);
      expect(stream.signal?.aborted).toBe(true);
    },
  );

  it('uses one deadline from dispatch rather than starting a new body timeout at headers', async () => {
    const stream = streamedFetch(200, 40);
    const result = observe(client(stream.fetch).request('GET', '/pending'));

    await vi.advanceTimersByTimeAsync(TIMEOUT - 1);
    expect(result.current.state).toBe('pending');
    expect(stream.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expectFailure(result, 'network', 200);
    expect(stream.signal?.aborted).toBe(true);
  });

  it('returns complete JSON and the original response without aborting after completion', async () => {
    const stream = streamedFetch();
    const request = client(stream.fetch).request('GET', '/ready');
    await vi.advanceTimersByTimeAsync(TIMEOUT - 1);
    stream.finish();

    const result = await request;
    expect(result.data).toEqual({ message: 'complete' });
    expect(result.response).toBe(stream.response);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(stream.signal?.aborted).toBe(false);
  });

  it('keeps a complete invalid JSON body malformed and clears its deadline', async () => {
    const stream = streamedFetch();
    const result = observe(client(stream.fetch).request('GET', '/invalid'));
    stream.finish('not JSON');
    await vi.advanceTimersByTimeAsync(0);

    expectFailure(result, 'malformed', 200);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(stream.signal?.aborted).toBe(false);
  });

  it('retains HTTP error classification when its completed error body is not JSON', async () => {
    const stream = streamedFetch(404);
    const result = observe(client(stream.fetch).request('GET', '/missing'));
    stream.finish('not JSON');
    await vi.advanceTimersByTimeAsync(0);

    expectFailure(result, 'not_found', 404);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(stream.signal?.aborted).toBe(false);
  });

  it('retains the bounded JSON error detail and clears its deadline', async () => {
    const stream = streamedFetch(409);
    const result = observe(client(stream.fetch).request('PUT', '/conflict', {}));
    stream.finish(`${JSON.stringify('x'.repeat(350))}}`);
    await vi.advanceTimersByTimeAsync(0);

    expectFailure(result, 'conflict', 409);
    if (result.current.state === 'rejected') {
      expect((result.current.error as DataError).message).toBe(
        `PUT /conflict returned 409: ${'x'.repeat(300)}`,
      );
    }
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(stream.signal?.aborted).toBe(false);
  });

  it('preserves a pre-header network failure and clears its deadline', async () => {
    const cause = new TypeError('connection failed');
    let signal: AbortSignal | null | undefined;
    const fetch: FetchLike = async (_url, init) => {
      signal = init?.signal;
      throw cause;
    };
    const result = observe(client(fetch).request('GET', '/offline'));
    await vi.advanceTimersByTimeAsync(0);

    expectFailure(result, 'network');
    if (result.current.state === 'rejected')
      expect((result.current.error as Error).cause).toBe(cause);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(signal?.aborted).toBe(false);
  });

  it('does not let a completed concurrent request cancel another request deadline', async () => {
    const healthy = streamedFetch();
    const stalled = streamedFetch();
    const fetch: FetchLike = (url, init) =>
      (url.endsWith('/healthy') ? healthy : stalled).fetch(url, init);
    const http = client(fetch);
    const healthyRequest = http.request('GET', '/healthy');
    const result = observe(http.request('GET', '/pending'));
    healthy.finish();
    await expect(healthyRequest).resolves.toMatchObject({ data: { message: 'complete' } });

    await vi.advanceTimersByTimeAsync(TIMEOUT);

    expectFailure(result, 'network', 200);
    expect(healthy.signal?.aborted).toBe(false);
    expect(stalled.signal?.aborted).toBe(true);
  });

  it('allows a cached catalog request to retry after its body times out', async () => {
    const stalled = streamedFetch();
    let calls = 0;
    const fetch: FetchLike = (url, init) => {
      calls += 1;
      return calls === 1
        ? stalled.fetch(url, init)
        : Promise.resolve(new Response(JSON.stringify(CATALOG)));
    };
    const repository = new HttpCatalogRepository(client(fetch), {
      baseUrl: BASE_URL,
      catalogSnapshotId: CATALOG.id,
    });
    const result = observe(repository.getSnapshot());
    await vi.advanceTimersByTimeAsync(TIMEOUT);

    expectFailure(result, 'network', 200);
    await expect(repository.getSnapshot()).resolves.toEqual(CATALOG);
    expect(calls).toBe(2);
  });
});
