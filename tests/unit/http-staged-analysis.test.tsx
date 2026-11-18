import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { useBuildAnalysis, useCompatibleOptions } from '../../src/app/queries';
import {
  assertContract,
  validateContract,
  validatorsReady,
  type BuildSnapshot,
} from '../../src/contracts';
import { DataError } from '../../src/data/errors';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { ContractHttpClient, type FetchLike } from '../../src/data/http/client';
import {
  HttpBuildRepository,
  HttpCompatibilityEvaluator,
  HttpPricingProvider,
} from '../../src/data/http/providers';
import type { CompatibleOption, ResourceEstimateResult } from '../../src/data/types';
import { useCompatByKind } from '../../src/lib/compat';
import { apiChat, NOW, resourceEstimate } from './scenarios';

const baseUrl = 'https://staged-analysis.test/v1';
const disposers: (() => void)[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const marker = (build: BuildSnapshot) => build.objectives.monthly_budget_amount ?? '100';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function harness(remoteAnalysis: boolean, delayPreSaveCost = false) {
  await validatorsReady;
  const fixture = createFixtureProviders({ now: () => NOW });
  const heads = new Map<string, BuildSnapshot>();
  const writes: { build: BuildSnapshot; response: ReturnType<typeof deferred<Response>> }[] = [];
  const reads: { operation: string; build: BuildSnapshot }[] = [];
  const waiting: { finish: () => void; reject: (error: unknown) => void }[] = [];
  const capturedMissingCosts: {
    response: Response;
    pending: ReturnType<typeof deferred<Response>>;
  }[] = [];
  let costHasFailed = false;
  let holding = false;
  let failing = false;
  const read = <T,>(
    operation: string,
    build: BuildSnapshot,
    compute: (build: BuildSnapshot) => Promise<T>,
  ) => {
    const captured = structuredClone(build);
    reads.push({ operation, build: captured });
    const pending = deferred<T>();
    const finish = () => {
      if (failing) pending.reject(new DataError('network', 'Synthetic staged replacement failed'));
      else void compute(captured).then(pending.resolve, pending.reject);
    };
    if (holding) waiting.push({ finish, reject: pending.reject });
    else finish();
    return pending.promise;
  };
  const cost = async (build: BuildSnapshot) => {
    const estimate = await fixture.pricing.estimate(build);
    return assertContract('CostEstimate', {
      ...estimate,
      id: `cost.synthetic.${marker(build)}`,
      total: { ...estimate.total, amount: marker(build) },
    });
  };
  const report = async (build: BuildSnapshot) =>
    assertContract('EvaluationReport', {
      ...(await fixture.compatibility.evaluate(build)),
      id: `evaluation.synthetic.${marker(build)}`,
    });
  const options = async (build: BuildSnapshot): Promise<CompatibleOption[]> => [
    {
      catalog_item_id: `model.synthetic.${marker(build)}`,
      catalog_item_version: '1.0.0',
      verdict: 'unknown',
      rule_ids: [],
    },
  ];
  const resources = async (build: BuildSnapshot): Promise<ResourceEstimateResult> => ({
    status: 'available',
    estimate: assertContract('ResourceEstimate', {
      ...resourceEstimate(build, marker(build), 'calibrated'),
      id: `resources.synthetic.${marker(build)}`,
    }),
  });
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    const path = new URL(url).pathname;
    if ((init?.method === 'POST' && path === '/v1/builds') || init?.method === 'PUT') {
      const build = JSON.parse(String(init?.body)) as BuildSnapshot;
      const valid = validateContract('BuildSnapshot', build);
      if (!valid.ok) return json({ code: 'invalid', message: valid.summary }, 422);
      if (init?.method === 'POST' && build.revision !== 1)
        return json({ code: 'invalid', message: 'Synthetic create requires revision one' }, 422);
      const response = deferred<Response>();
      writes.push({ build, response });
      return response.promise;
    }
    const id = decodeURIComponent(path.split('/')[3] ?? '');
    const build = heads.get(id);
    const operation = path.endsWith('/estimate-cost')
      ? 'cost'
      : path.endsWith('/evaluate')
        ? 'evaluation'
        : 'options';
    if (!build) {
      reads.push({ operation, build: { ...apiChat(), id } });
      const response = json(
        { code: 'not_found', message: 'Synthetic create is not acknowledged' },
        404,
      );
      if (delayPreSaveCost && operation === 'cost') {
        if (costHasFailed) {
          const pending = deferred<Response>();
          capturedMissingCosts.push({ response, pending });
          // Deliberately permit this synthetic old response to finish after a
          // later request succeeds, even if its caller stops observing it.
          return pending.promise;
        }
        costHasFailed = true;
      }
      return response;
    }
    reads.push({ operation, build: structuredClone(build) });
    if (operation === 'cost') return json(await cost(build));
    if (operation === 'evaluation') return json(await report(build));
    if (path.endsWith('/compatible-options'))
      return json({
        build_id: build.id,
        build_revision: build.revision,
        kind: 'model',
        options: await options(build),
      });
    throw new Error(`Unexpected synthetic path ${path}`);
  });
  const http = new ContractHttpClient({ baseUrl, fetch });
  const providers = createFixtureProviders({ now: () => NOW });
  providers.builds = new HttpBuildRepository(http);
  if (remoteAnalysis) {
    providers.pricing = new HttpPricingProvider(http, {
      baseUrl,
      catalogSnapshotId: apiChat().locks.catalog_snapshot_id,
    });
    providers.compatibility = new HttpCompatibilityEvaluator(http);
    providers.resources = {
      estimate: async (build) => {
        reads.push({ operation: 'resources', build: structuredClone(build) });
        if (!heads.has(build.id)) throw new DataError('not_found', 'Synthetic pending create');
        return resources(build);
      },
    };
  } else {
    // Synthetic local analyses deliberately depend on staged content, including
    // incomplete builds that cannot yet be submitted to the HTTP repository.
    providers.pricing = {
      getPricebook: providers.pricing.getPricebook.bind(providers.pricing),
      estimate: (build) => read('cost', build, cost),
    };
    providers.resources = { estimate: (build) => read('resources', build, resources) };
    providers.compatibility = {
      evaluate: (build) => read('evaluation', build, report),
      compatibleOptions: (build) => read('options', build, options),
    };
  }
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0, refetchOnWindowFocus: false },
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <BuilderProvider>{children}</BuilderProvider>
      </DataContext.Provider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    () => {
      const builder = useBuilder();
      const [observing, observe] = useState(false);
      const build = observing ? builder.draft?.build : null;
      const analysis = useBuildAnalysis(build);
      const compatibleOptions = useCompatibleOptions(build, 'model');
      const catalogOptions = useCompatByKind(build, ['model']);
      return { builder, analysis, compatibleOptions, catalogOptions, observe };
    },
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.builder.ready).toBe(true));
  const start = async (build: BuildSnapshot) => {
    await act(async () => hook.result.current.builder.startNew(build));
    act(() => hook.result.current.observe(true));
  };
  const edit = (budget: string, valid = false) =>
    act(() =>
      hook.result.current.builder.apply(
        (build) => ({
          ...build,
          objectives: { ...build.objectives, monthly_budget_amount: budget },
          selections: valid ? apiChat().selections : build.selections,
        }),
        'Synthetic staged content correction',
        [],
      ),
    );
  const acknowledge = async () => {
    const write = writes.at(-1)!;
    heads.set(write.build.id, structuredClone(write.build));
    await act(async () =>
      write.response.resolve(json(write.build, write.build.revision === 1 ? 201 : 200)),
    );
  };
  const release = async (fail = false) => {
    holding = false;
    failing = fail;
    await act(async () => {
      for (const request of waiting.splice(0)) request.finish();
    });
  };
  disposers.push(() => {
    client.clear();
    for (const request of waiting.splice(0)) request.reject(new Error('Synthetic test ended'));
    for (const write of writes)
      write.response.resolve(json({ code: 'unavailable', message: 'Synthetic test ended' }, 503));
    for (const request of capturedMissingCosts) request.pending.resolve(request.response);
  });
  return {
    ...hook,
    start,
    edit,
    writes,
    reads,
    acknowledge,
    release,
    capturedMissingCosts,
    releaseMissingCosts: async () => {
      await act(async () => {
        for (const request of capturedMissingCosts) request.pending.resolve(request.response);
      });
    },
    hold: () => {
      holding = true;
    },
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;
async function expectCurrent(h: Harness, value: string) {
  await waitFor(() => {
    const { analysis, compatibleOptions, catalogOptions } = h.result.current;
    expect(analysis.costIsCurrent).toBe(true);
    expect(analysis.cost?.total.amount).toBe(value);
    expect(analysis.reportIsCurrent).toBe(true);
    expect(analysis.report?.id).toBe(`evaluation.synthetic.${value}`);
    expect(analysis.resources?.status).toBe('available');
    if (analysis.resources?.status === 'available')
      expect(analysis.resources.estimate.id).toBe(`resources.synthetic.${value}`);
    expect(compatibleOptions.isPlaceholderData).toBe(false);
    expect(compatibleOptions.data?.[0]?.catalog_item_id).toBe(`model.synthetic.${value}`);
    expect(catalogOptions.isSuccess).toBe(true);
    expect([...catalogOptions.data.values()]).toMatchObject([
      { catalog_item_id: `model.synthetic.${value}` },
    ]);
  });
}

function expectWithheld(h: Harness) {
  const { analysis, compatibleOptions, catalogOptions } = h.result.current;
  expect(analysis.costIsCurrent).toBe(false);
  expect(analysis.reportIsCurrent).toBe(false);
  expect(analysis.resources).toBeUndefined();
  expect(compatibleOptions.data === undefined || compatibleOptions.isPlaceholderData).toBe(true);
  expect(catalogOptions.isSuccess).toBe(false);
  expect(catalogOptions.data.size).toBe(0);
}

beforeEach(() => localStorage.clear());
afterEach(async () => {
  cleanup();
  await act(async () => {
    for (const dispose of disposers.splice(0)) dispose();
  });
});

describe('analysis follows staged content and remote creation acknowledgements', () => {
  it('recovers exhausted pre-create HTTP analysis and options after POST succeeds without another edit', async () => {
    const h = await harness(true);
    await h.start(apiChat());
    await waitFor(() => expect(h.writes).toHaveLength(1));
    const before = structuredClone(h.result.current.builder.draft!.build);
    await waitFor(
      () => {
        expect(h.result.current.analysis.costQuery.isError).toBe(true);
        expect(h.result.current.analysis.resourcesQuery.isError).toBe(true);
        expect(h.result.current.compatibleOptions.isError).toBe(true);
        expect(h.result.current.catalogOptions.isError).toBe(true);
        expect(h.result.current.analysis.costQuery.fetchStatus).toBe('idle');
      },
      { timeout: 5000 },
    );
    const attempts = h.reads.length;
    expect(attempts).toBeGreaterThanOrEqual(4);
    expect(attempts).toBeLessThan(30);
    expectWithheld(h);
    await h.acknowledge();
    await waitFor(() => expect(h.result.current.builder.saveState.status).toBe('saved'));
    await expectCurrent(h, '100');
    expect(h.result.current.builder.draft!.build).toEqual(before);
    expect(h.reads.length).toBeGreaterThan(attempts);
    expect(h.writes).toHaveLength(1);
  });

  it('recovers after the final pre-save cost failure finishes after POST acknowledgement', async () => {
    const h = await harness(true, true);
    await h.start(apiChat());
    await waitFor(() => expect(h.writes).toHaveLength(1));
    const before = structuredClone(h.result.current.builder.draft!.build);
    await waitFor(() => {
      expect(h.capturedMissingCosts.length).toBeGreaterThan(0);
      expect(h.result.current.analysis.costQuery.fetchStatus).toBe('fetching');
    });
    expect(h.reads.filter((read) => read.operation === 'cost').length).toBeLessThan(10);
    await h.acknowledge();
    await waitFor(() => expect(h.result.current.builder.saveState.status).toBe('saved'));
    await h.releaseMissingCosts();
    await expectCurrent(h, '100');
    await waitFor(() => expect(h.result.current.analysis.costQuery.fetchStatus).toBe('idle'));
    await act(async () => {});
    await expectCurrent(h, '100');
    expect(h.result.current.analysis.costQuery.isError).toBe(false);
    expect(h.result.current.builder.draft!.build).toEqual(before);
    expect(h.writes).toHaveLength(1);
  });

  it('withholds previous same-number staged analyses while corrected content is pending', async () => {
    const h = await harness(false);
    await h.start({
      ...apiChat(),
      selections: [],
      objectives: { ...apiChat().objectives, monthly_budget_amount: '100' },
    });
    await expectCurrent(h, '100');
    const before = h.result.current.builder.draft!.build;
    h.hold();
    h.edit('200', true);
    expect.soft(h.result.current.builder.draft!.build.revision).toBe(before.revision);
    expect(h.result.current.builder.draft!.build.id).toBe(before.id);
    await act(async () => {});
    expectWithheld(h);
    await waitFor(() =>
      expect(
        h.reads.some((read) => read.operation === 'cost' && marker(read.build) === '200'),
      ).toBe(true),
    );
    await h.release();
    await expectCurrent(h, '200');
    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0]!.build.revision).toBe(1);
    await h.acknowledge();
    await expectCurrent(h, '200');
  });

  it('keeps failed same-number replacements non-current and recovers the corrected staged content', async () => {
    const h = await harness(false);
    await h.start({
      ...apiChat(),
      selections: [],
      objectives: { ...apiChat().objectives, monthly_budget_amount: '100' },
    });
    await expectCurrent(h, '100');
    const before = h.result.current.builder.draft!.build;
    h.hold();
    h.edit('200');
    expect.soft(h.result.current.builder.draft!.build.revision).toBe(before.revision);
    await act(async () => {});
    expectWithheld(h);
    await h.release(true);
    await waitFor(() => {
      expect(h.result.current.analysis.costQuery.isError).toBe(true);
      expect(h.result.current.analysis.resourcesQuery.isError).toBe(true);
      expect(h.result.current.analysis.evaluation.isError).toBe(true);
      expect(h.result.current.compatibleOptions.isError).toBe(true);
      expect(h.result.current.catalogOptions.isError).toBe(true);
    });
    expectWithheld(h);
    await h.release();
    h.edit('300', true);
    expect.soft(h.result.current.builder.draft!.build.revision).toBe(before.revision);
    await expectCurrent(h, '300');
    expect(h.result.current.builder.draft!.build.id).toBe(before.id);
    await waitFor(() => expect(h.writes).toHaveLength(1));
    expect(h.writes[0]!.build.revision).toBe(1);
    await h.acknowledge();
    await waitFor(() => expect(h.result.current.builder.saveState.status).toBe('saved'));
    await expectCurrent(h, '300');
  });
});
