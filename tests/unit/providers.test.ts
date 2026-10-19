/* Data providers: fixture ↔ HTTP interchangeability, malformed responses and failed requests. */
import { describe, expect, it, vi } from 'vitest';
import { BASELINE_GRAPH, BASELINE_RULESET, assertContract } from '../../src/contracts';
import { createDraft } from '../../src/domain/build';
import { createProviders, DataConfigError } from '../../src/data/config';
import { DataError } from '../../src/data/errors';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { createHttpProviders } from '../../src/data/http/providers';
import { LocalBuildRepository, type KeyValueStorage } from '../../src/data/local-builds';
import type { DataProviders } from '../../src/data/types';
import { CATALOG, NOW, apiChat, contradictory } from './scenarios';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A tiny in-memory implementation of the contract API, backed by the fixture providers. */
function fakeApi(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const fixture = createFixtureProviders({ now: () => NOW });
  const builds = new Map<string, unknown>();
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('https://api.test/v1', '');
    const key = `${init?.method ?? 'GET'} ${path.split('?')[0]}`;
    if (overrides[key]) return overrides[key]!();
    if (key === `GET /catalog/snapshots/${CATALOG.id}`) return json(CATALOG);
    if (key === `GET /dependencies/${BASELINE_GRAPH.id}`) return json(BASELINE_GRAPH);
    if (key === `GET /rulesets/${BASELINE_RULESET.id}`) return json(BASELINE_RULESET);
    if (key === `GET /pricebooks/${DEMO_PRICEBOOK.id}`) return json(DEMO_PRICEBOOK);
    const m = /^(POST|GET|PUT) \/builds(?:\/([^/]+))?(?:\/(evaluate|estimate-cost))?$/.exec(key);
    if (m) {
      const [, method, id, action] = m;
      if (method === 'POST' && !id) {
        const b = JSON.parse(String(init?.body));
        builds.set(b.id, b);
        return json(b, 201);
      }
      const b = builds.get(decodeURIComponent(id!)) as ReturnType<typeof apiChat> | undefined;
      if (!b) return json({ code: 'not_found', message: 'no build' }, 404);
      if (action === 'evaluate') return json(await fixture.compatibility.evaluate(b));
      if (action === 'estimate-cost') return json(await fixture.pricing.estimate(b));
      if (method === 'PUT') {
        const expected = String((init?.headers as Record<string, string>)['If-Match']).replace(
          /"/g,
          '',
        );
        if (Number(expected) !== b.revision)
          return json({ code: 'conflict', message: 'stale revision' }, 409);
        const next = JSON.parse(String(init?.body));
        builds.set(next.id, next);
        return json(next);
      }
      return json(b);
    }
    return json({ code: 'not_found', message: key }, 404);
  });
}

const httpProviders = (fetchImpl: ReturnType<typeof fakeApi>, remoteBuilds = false) =>
  createHttpProviders({
    baseUrl: 'https://api.test/v1',
    catalogSnapshotId: CATALOG.id,
    pricebookId: DEMO_PRICEBOOK.id,
    fetch: fetchImpl as unknown as typeof fetch,
    remoteBuilds,
  });

async function runAll(p: DataProviders, build: ReturnType<typeof apiChat>) {
  const snapshot = await p.catalog.getSnapshot();
  const models = await p.catalog.listItems('model');
  const graph = await p.catalog.getDependencyGraph();
  const rules = await p.catalog.getRuleset();
  const report = await p.compatibility.evaluate(build);
  const cost = await p.pricing.estimate(build);
  return {
    snapshot: snapshot.id,
    models: models.length,
    edges: graph.edges.length,
    rules: rules.rules.length,
    report,
    cost,
  };
}

describe('fixture and HTTP providers are interchangeable', () => {
  it('accepts a cost estimate for the requested build and revision', async () => {
    const build = apiChat();
    const fixture = createFixtureProviders({ now: () => NOW });
    const estimate = await fixture.pricing.estimate(build, 14);
    const api = fakeApi({ [`POST /builds/${build.id}/estimate-cost`]: () => json(estimate) });
    await expect(httpProviders(api).pricing.estimate(build, 14)).resolves.toEqual(estimate);
    expect(api).toHaveBeenCalledWith(
      `https://api.test/v1/builds/${build.id}/estimate-cost`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          build_revision: build.revision,
          pricebook_id: DEMO_PRICEBOOK.id,
          period_days: 14,
        }),
      }),
    );
  });

  it('return equivalent contract data for the same build', async () => {
    const build = contradictory();
    const fixture = createFixtureProviders({ now: () => NOW });
    const api = fakeApi();
    const http = httpProviders(api, true);
    await http.builds.save(createDraft(build), null); // POST /builds
    const a = await runAll(fixture, build);
    const b = await runAll(http, build);
    expect(b).toEqual(a);
    expect(a.report.result).toBe('invalid');
  });

  it('createProviders selects by VITE_DATA_MODE and rejects bad config', () => {
    expect(createProviders({}).mode).toBe('fixture');
    expect(createProviders({ VITE_DATA_MODE: 'fixture' }).mode).toBe('fixture');
    expect(
      createProviders({
        VITE_DATA_MODE: 'http',
        VITE_API_BASE_URL: 'https://api.test/v1',
        VITE_CATALOG_SNAPSHOT: 'catalog.x',
      }).mode,
    ).toBe('http');
    expect(() => createProviders({ VITE_DATA_MODE: 'live' })).toThrow(DataConfigError);
    expect(() => createProviders({ VITE_DATA_MODE: 'http' })).toThrow(/VITE_API_BASE_URL/);
  });
});

describe('malformed API responses', () => {
  const expectDataError = async (p: Promise<unknown>, kind: DataError['kind']) => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DataError);
    expect((err as DataError).kind).toBe(kind);
    return err as DataError;
  };

  it('schema-invalid catalog → malformed with validation errors', async () => {
    const bad = { ...CATALOG, items: [{ ...CATALOG.items[0], kind: 'gpu' }] };
    const p = httpProviders(fakeApi({ [`GET /catalog/snapshots/${CATALOG.id}`]: () => json(bad) }));
    const err = await expectDataError(p.catalog.getSnapshot(), 'malformed');
    expect(err.contract).toBe('CatalogSnapshot');
    expect(err.validationErrors?.length).toBeGreaterThan(0);
  });

  it('non-JSON body → malformed', async () => {
    const p = httpProviders(
      fakeApi({
        [`GET /catalog/snapshots/${CATALOG.id}`]: () =>
          new Response('<html>oops</html>', { status: 200 }),
      }),
    );
    await expectDataError(p.catalog.getSnapshot(), 'malformed');
  });

  it('evaluation for a different revision → malformed', async () => {
    const build = apiChat();
    const fixture = createFixtureProviders({ now: () => NOW });
    const stale = {
      ...(await fixture.compatibility.evaluate(build)),
      build_revision: build.revision + 5,
    };
    const p = httpProviders(fakeApi({ [`POST /builds/${build.id}/evaluate`]: () => json(stale) }));
    await expectDataError(p.compatibility.evaluate(build), 'malformed');
  });

  it.each(['build_id', 'build_revision'] as const)(
    'schema-valid cost estimate with a different %s → malformed',
    async (field) => {
      const build = apiChat();
      const fixture = createFixtureProviders({ now: () => NOW });
      const mismatched = assertContract('CostEstimate', {
        ...(await fixture.pricing.estimate(build)),
        [field]: field === 'build_id' ? 'build.other' : build.revision + 1,
      });
      const p = httpProviders(
        fakeApi({ [`POST /builds/${build.id}/estimate-cost`]: () => json(mismatched) }),
      );
      const err = await expectDataError(p.pricing.estimate(build), 'malformed');
      expect(err.contract).toBe('CostEstimate');
      expect(err.validationErrors).toBeUndefined();
    },
  );

  it('malformed compatible-options → malformed', async () => {
    const build = apiChat();
    const p = httpProviders(
      fakeApi({
        [`GET /builds/${build.id}/compatible-options`]: () =>
          json({ build_id: build.id, options: 'nope' }),
      }),
    );
    await expectDataError(p.compatibility.compatibleOptions(build, 'model'), 'malformed');
  });
});

describe('failed network requests', () => {
  it('network failure → network error, and the catalog can be retried', async () => {
    let fail = true;
    const api = fakeApi();
    const flaky = vi.fn(async (url: string, init?: RequestInit) => {
      if (fail) throw new TypeError('Failed to fetch');
      return api(url, init);
    });
    const p = httpProviders(flaky as unknown as ReturnType<typeof fakeApi>);
    await expect(p.catalog.getSnapshot()).rejects.toMatchObject({ kind: 'network' });
    fail = false;
    await expect(p.catalog.getSnapshot()).resolves.toMatchObject({ id: CATALOG.id });
  });

  it('HTTP 500 → http error with status; 404 → not_found', async () => {
    const p = httpProviders(
      fakeApi({
        [`GET /pricebooks/${DEMO_PRICEBOOK.id}`]: () =>
          json({ code: 'boom', message: 'internal' }, 500),
      }),
    );
    await expect(p.pricing.getPricebook()).rejects.toMatchObject({ kind: 'http', status: 500 });
    await expect(p.catalog.getSnapshot('catalog.missing')).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('stale revision on PUT → conflict, nothing overwritten', async () => {
    const api = fakeApi();
    const p = httpProviders(api, true);
    const draft = createDraft(apiChat());
    await p.builds.save(draft, null);
    const next = { ...draft, build: { ...draft.build, revision: 3 } };
    await expect(p.builds.save(next, 2)).rejects.toMatchObject({ kind: 'conflict' });
    expect((await p.builds.get(draft.build.id)).build.revision).toBe(1);
  });
});

describe('local build repository', () => {
  const memory = (): KeyValueStorage => {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  };

  it('saves, lists and reloads drafts; rejects stale writers', async () => {
    const repo = new LocalBuildRepository(memory());
    const d = createDraft(apiChat());
    await repo.save(d, null);
    expect((await repo.list()).map((s) => s.id)).toEqual([d.build.id]);
    expect((await repo.get(d.build.id)).build).toEqual(d.build);
    await expect(repo.save({ ...d, build: { ...d.build, revision: 2 } }, 5)).rejects.toMatchObject({
      kind: 'conflict',
    });
    await repo.remove(d.build.id);
    expect(await repo.list()).toEqual([]);
  });

  it('reports corrupt stored builds instead of silently dropping them', async () => {
    const storage = memory();
    storage.setItem('pyai.builds.index', JSON.stringify(['build.bad']));
    storage.setItem('pyai.build.build.bad', '{"build":{"id":1}}');
    const repo = new LocalBuildRepository(storage);
    expect((await repo.list())[0]?.name).toMatch(/unreadable/);
    await expect(repo.get('build.bad')).rejects.toMatchObject({ kind: 'malformed' });
  });

  it('accepts drafts with fewer than two selections', async () => {
    const repo = new LocalBuildRepository(memory());
    const d = createDraft({ ...apiChat(), selections: apiChat().selections.slice(0, 1) });
    await expect(repo.save(d, null)).resolves.toBeTruthy();
  });
});
