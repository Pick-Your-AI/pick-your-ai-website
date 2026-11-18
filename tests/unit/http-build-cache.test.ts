import { describe, expect, it, vi } from 'vitest';
import type { BuildSnapshot } from '../../src/contracts';
import { ContractHttpClient, type FetchLike } from '../../src/data/http/client';
import { HttpBuildRepository } from '../../src/data/http/providers';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import { createDraft } from '../../src/domain/build';
import { apiChat } from './scenarios';

const baseUrl = 'https://api.test/v1';
const id = 'build.cache-order';
const path = `${baseUrl}/builds/${id}`;
const build = (revision: number): BuildSnapshot => ({
  ...apiChat(),
  id,
  revision,
  name: `Synthetic revision ${revision}`,
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

function sharedStorage(): KeyValueStorage {
  const rows = new Map<string, string>();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
  };
}

/** Synthetic API and shared browser storage only; no live service or network. */
describe('HTTP save acknowledgment order', () => {
  it('preserves the newer cached head when another tab receives an older acknowledgment late', async () => {
    const storage = sharedStorage();
    const localA = new LocalBuildRepository(storage);
    const localB = new LocalBuildRepository(storage);
    await localA.save(createDraft(build(1)), null);
    let remoteHead = build(1);
    let releaseRevisionTwo!: () => void;
    let signalAccepted!: () => void;
    const acceptedRevisionTwo = new Promise<void>((resolve) => {
      signalAccepted = resolve;
    });
    const requestLog: { method: string | undefined; ifMatch: string | null; revision?: number }[] =
      [];
    const fetch: FetchLike = async (url, init) => {
      expect(url).toBe(path);
      if (init?.method === 'GET') {
        requestLog.push({ method: 'GET', ifMatch: null });
        return json(remoteHead);
      }
      expect(init?.method).toBe('PUT');
      const headers = new Headers(init?.headers);
      const candidate = JSON.parse(String(init?.body)) as BuildSnapshot;
      requestLog.push({
        method: init?.method,
        ifMatch: headers.get('If-Match'),
        revision: candidate.revision,
      });
      expect(headers.get('If-Match')).toBe(`"${remoteHead.revision}"`);
      expect(candidate.revision).toBe(remoteHead.revision + 1);
      remoteHead = candidate;
      const response = json(candidate);
      if (candidate.revision === 2) {
        const readBody = response.json.bind(response);
        response.json = async () => {
          signalAccepted();
          await new Promise<void>((resolve) => {
            releaseRevisionTwo = resolve;
          });
          return readBody();
        };
      }
      return response;
    };
    const tabA = new HttpBuildRepository(new ContractHttpClient({ baseUrl, fetch }), localA);
    const tabB = new HttpBuildRepository(new ContractHttpClient({ baseUrl, fetch }), localB);
    const revisionTwo = createDraft(build(2));
    const pendingA = tabA.save(revisionTwo, 1);
    await acceptedRevisionTwo;

    // The server accepted revision 2, so a second tab may read and update it before
    // the first tab has finished consuming its own successful response body.
    expect((await tabB.get(id)).build.revision).toBe(2);
    const revisionThree = createDraft(build(3));
    const savedB = await tabB.save(revisionThree, 2);
    expect(savedB).toEqual(revisionThree);
    expect((await localB.get(id)).build).toEqual(revisionThree.build);

    releaseRevisionTwo();
    const savedA = await pendingA;
    expect(savedA).toEqual(revisionTwo);
    expect(remoteHead).toEqual(revisionThree.build);
    expect(requestLog).toEqual([
      { method: 'PUT', ifMatch: '"1"', revision: 2 },
      { method: 'GET', ifMatch: null },
      { method: 'PUT', ifMatch: '"2"', revision: 3 },
    ]);
    expect((await localA.get(id)).build).toEqual(revisionThree.build);
    expect(await tabA.list()).toEqual([
      expect.objectContaining({ id, name: revisionThree.build.name, revision: 3 }),
    ]);
  });

  it('rechecks the cached head after a conflicting cache write', async () => {
    const storage = sharedStorage();
    const localA = new LocalBuildRepository(storage);
    const localB = new LocalBuildRepository(storage);
    await localA.save(createDraft(build(1)), null);
    let remoteHead = build(1);
    const fetch: FetchLike = async (url, init) => {
      expect(url).toBe(path);
      expect(init?.method).toBe('PUT');
      const candidate = JSON.parse(String(init?.body)) as BuildSnapshot;
      expect(new Headers(init?.headers).get('If-Match')).toBe(`"${remoteHead.revision}"`);
      expect(candidate.revision).toBe(remoteHead.revision + 1);
      remoteHead = candidate;
      return json(candidate);
    };
    const tabA = new HttpBuildRepository(new ContractHttpClient({ baseUrl, fetch }), localA);
    const tabB = new HttpBuildRepository(new ContractHttpClient({ baseUrl, fetch }), localB);
    const revisionTwo = createDraft(build(2));
    const revisionThree = createDraft(build(3));
    const originalSave = localA.save.bind(localA);
    const cacheWrite = vi.spyOn(localA, 'save').mockImplementationOnce(async (stored, expected) => {
      // Insert a newer valid acknowledgment after tab A reads the cached head,
      // before its compare-and-swap write. This exercises retry deterministically;
      // it does not establish multi-process localStorage atomicity.
      expect(expected).toBe(1);
      expect(await tabB.save(revisionThree, 2)).toEqual(revisionThree);
      return originalSave(stored, expected);
    });

    expect(await tabA.save(revisionTwo, 1)).toEqual(revisionTwo);
    expect(cacheWrite).toHaveBeenCalledTimes(1);
    expect(remoteHead).toEqual(revisionThree.build);
    expect((await localA.get(id)).build).toEqual(revisionThree.build);
    expect(await tabA.list()).toEqual([
      expect.objectContaining({ id, name: revisionThree.build.name, revision: 3 }),
    ]);
  });
});
