import { describe, expect, it, vi } from 'vitest';
import { assertContract, type BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import type { FetchLike } from '../../src/data/http/client';
import { createHttpProviders } from '../../src/data/http/providers';
import { CATALOG, NOW, apiChat, resourceEstimate } from './scenarios';

const fixture = createFixtureProviders({ now: () => NOW });
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const responseApi = (value: unknown, duringRequest?: () => void) =>
  vi.fn<FetchLike>(async () => {
    duringRequest?.();
    return json(value);
  });
const providers = (fetch: FetchLike, pricebookId: string | undefined = DEMO_PRICEBOOK.id) =>
  createHttpProviders({
    baseUrl: 'https://api.test/v1',
    catalogSnapshotId: CATALOG.id,
    pricebookId,
    fetch,
  });
function pinnedBuild() {
  const build = apiChat();
  build.locks.pricebook_id = DEMO_PRICEBOOK.id;
  return assertContract('BuildSnapshot', build);
}

describe('HTTP evaluation response context', () => {
  const foreignLocks = {
    catalog_snapshot_id: 'catalog.foreign',
    ruleset_id: 'ruleset.foreign',
    ruleset_version: '9.0.0',
    dependency_graph_id: 'graph.foreign',
    dependency_graph_revision: 91,
  };

  it.each(Object.entries(foreignLocks))('rejects a schema-valid foreign %s', async (key, value) => {
    const build = pinnedBuild();
    const report = assertContract('EvaluationReport', {
      ...(await fixture.compatibility.evaluate(build)),
      [key]: value,
    });
    const api = responseApi(report);
    await expect(providers(api).compatibility.evaluate(build)).rejects.toMatchObject({
      kind: 'malformed',
      contract: 'EvaluationReport',
    });
    expect(api).toHaveBeenCalledExactlyOnceWith(
      `https://api.test/v1/builds/${build.id}/evaluate`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ build_revision: build.revision }),
      }),
    );
  });

  it('accepts exact pinned context and sends the selected evidence IDs', async () => {
    const build = pinnedBuild();
    const cost = await fixture.pricing.estimate(build);
    const resources = assertContract(
      'ResourceEstimate',
      resourceEstimate(build, '24', 'calibrated'),
    );
    const report = await fixture.compatibility.evaluate(build, {
      costEstimate: cost,
      resourceEstimate: resources,
    });
    const api = responseApi(report);
    await expect(
      providers(api).compatibility.evaluate(build, {
        costEstimate: cost,
        resourceEstimate: resources,
      }),
    ).resolves.toEqual(report);
    expect(api).toHaveBeenCalledExactlyOnceWith(
      `https://api.test/v1/builds/${build.id}/evaluate`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          build_revision: build.revision,
          resource_estimate_id: resources.id,
          cost_estimate_id: cost.id,
        }),
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
  });

  it('accepts exact pinned context when optional evidence is omitted or null', async () => {
    const build = pinnedBuild();
    const report = await fixture.compatibility.evaluate(build);
    for (const evidence of [undefined, { costEstimate: null, resourceEstimate: null }]) {
      const api = responseApi(report);
      await expect(providers(api).compatibility.evaluate(build, evidence)).resolves.toEqual(report);
      expect(api).toHaveBeenCalledExactlyOnceWith(
        `https://api.test/v1/builds/${build.id}/evaluate`,
        expect.objectContaining({ body: JSON.stringify({ build_revision: build.revision }) }),
      );
    }
  });

  it.each(['build_id', 'build_revision'] as const)(
    'continues rejecting foreign %s',
    async (field) => {
      const build = pinnedBuild();
      const report = assertContract('EvaluationReport', {
        ...(await fixture.compatibility.evaluate(build)),
        [field]: field === 'build_id' ? 'build.foreign' : build.revision + 1,
      });
      await expect(
        providers(responseApi(report)).compatibility.evaluate(build),
      ).rejects.toMatchObject({
        kind: 'malformed',
        contract: 'EvaluationReport',
      });
    },
  );

  it.each([false, true])(
    'binds evaluation to dispatch context when caller changes (foreign response: %s)',
    async (foreign) => {
      const build = pinnedBuild();
      const original = structuredClone(build);
      const report = await fixture.compatibility.evaluate(build);
      const changed = {
        build_id: 'build.changed',
        build_revision: build.revision + 1,
        ...foreignLocks,
      };
      const response = assertContract(
        'EvaluationReport',
        foreign ? { ...report, ...changed } : report,
      );
      const api = responseApi(response, () => {
        build.id = changed.build_id;
        build.revision = changed.build_revision;
        Object.assign(build.locks, foreignLocks);
      });
      const pending = providers(api).compatibility.evaluate(build);
      if (foreign) {
        await expect(pending).rejects.toMatchObject({
          kind: 'malformed',
          contract: 'EvaluationReport',
        });
      } else {
        await expect(pending).resolves.toEqual(report);
      }
      expect(api).toHaveBeenCalledExactlyOnceWith(
        `https://api.test/v1/builds/${original.id}/evaluate`,
        expect.objectContaining({ body: JSON.stringify({ build_revision: original.revision }) }),
      );
    },
  );
});

describe('HTTP cost response context', () => {
  it.each(['locked', 'configured'] as const)(
    'rejects a schema-valid foreign %s pricebook',
    async (source) => {
      const build = pinnedBuild();
      const estimate = await fixture.pricing.estimate(build);
      if (source === 'configured') delete build.locks.pricebook_id;
      assertContract('BuildSnapshot', build);
      const response = assertContract('CostEstimate', {
        ...estimate,
        pricebook_id: 'pricebook.foreign',
      });
      const api = responseApi(response);
      await expect(providers(api).pricing.estimate(build)).rejects.toMatchObject({
        kind: 'malformed',
        contract: 'CostEstimate',
      });
      expect(api).toHaveBeenCalledExactlyOnceWith(
        `https://api.test/v1/builds/${build.id}/estimate-cost`,
        expect.objectContaining({
          body: JSON.stringify({
            build_revision: build.revision,
            pricebook_id: DEMO_PRICEBOOK.id,
            period_days: 30,
          }),
        }),
      );
    },
  );

  it('rejects a schema-valid estimate for a different requested period', async () => {
    const build = pinnedBuild();
    const response = await fixture.pricing.estimate(build, 30);
    assertContract('CostEstimate', response);
    await expect(
      providers(responseApi(response)).pricing.estimate(build, 14),
    ).rejects.toMatchObject({
      kind: 'malformed',
      contract: 'CostEstimate',
    });
  });

  it.each([undefined, 14])('accepts the requested period (default if %s)', async (periodDays) => {
    const build = pinnedBuild();
    const response = await fixture.pricing.estimate(build, periodDays);
    const api = responseApi(response);
    await expect(providers(api).pricing.estimate(build, periodDays)).resolves.toEqual(response);
    expect(api).toHaveBeenCalledExactlyOnceWith(
      `https://api.test/v1/builds/${build.id}/estimate-cost`,
      expect.objectContaining({
        body: JSON.stringify({
          build_revision: build.revision,
          pricebook_id: DEMO_PRICEBOOK.id,
          period_days: periodDays ?? 30,
        }),
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
  });

  it('prefers the explicit build pricebook over the configured default', async () => {
    const build = pinnedBuild();
    const response = await fixture.pricing.estimate(build);
    const api = responseApi(response);
    await expect(providers(api, 'pricebook.default').pricing.estimate(build)).resolves.toEqual(
      response,
    );
    expect(JSON.parse(String(api.mock.calls[0]?.[1]?.body)).pricebook_id).toBe(DEMO_PRICEBOOK.id);
  });

  it('accepts the configured pricebook when the optional build lock is absent', async () => {
    const build = pinnedBuild();
    const response = await fixture.pricing.estimate(build);
    delete build.locks.pricebook_id;
    assertContract('BuildSnapshot', build);
    await expect(providers(responseApi(response)).pricing.estimate(build)).resolves.toEqual(
      response,
    );
  });

  it('keeps missing pricebook configuration unsupported without dispatching', async () => {
    const build = pinnedBuild();
    delete build.locks.pricebook_id;
    assertContract('BuildSnapshot', build);
    const api = responseApi({});
    const http = createHttpProviders({
      baseUrl: 'https://api.test/v1',
      catalogSnapshotId: CATALOG.id,
      fetch: api,
    });
    await expect(http.pricing.estimate(build)).rejects.toMatchObject({ kind: 'unsupported' });
    expect(api).not.toHaveBeenCalled();
  });

  it.each(['build_id', 'build_revision'] as const)(
    'continues rejecting foreign %s',
    async (field) => {
      const build = pinnedBuild();
      const response = assertContract('CostEstimate', {
        ...(await fixture.pricing.estimate(build)),
        [field]: field === 'build_id' ? 'build.foreign' : build.revision + 1,
      });
      await expect(providers(responseApi(response)).pricing.estimate(build)).rejects.toMatchObject({
        kind: 'malformed',
        contract: 'CostEstimate',
      });
    },
  );

  it.each([false, true])(
    'binds cost to dispatch context when caller changes (foreign response: %s)',
    async (foreign) => {
      const build: BuildSnapshot = pinnedBuild();
      const original = structuredClone(build);
      const estimate = await fixture.pricing.estimate(build, 14);
      const changed = { build_id: 'build.changed', build_revision: build.revision + 1 };
      const response = assertContract(
        'CostEstimate',
        foreign ? { ...estimate, ...changed } : estimate,
      );
      const api = responseApi(response, () => {
        build.id = changed.build_id;
        build.revision = changed.build_revision;
        build.locks.pricebook_id = 'pricebook.changed';
      });
      const pending = providers(api).pricing.estimate(build, 14);
      if (foreign) {
        await expect(pending).rejects.toMatchObject({
          kind: 'malformed',
          contract: 'CostEstimate',
        });
      } else {
        await expect(pending).resolves.toEqual(estimate);
      }
      expect(api).toHaveBeenCalledExactlyOnceWith(
        `https://api.test/v1/builds/${original.id}/estimate-cost`,
        expect.objectContaining({
          body: JSON.stringify({
            build_revision: original.revision,
            pricebook_id: DEMO_PRICEBOOK.id,
            period_days: 14,
          }),
        }),
      );
    },
  );
});
