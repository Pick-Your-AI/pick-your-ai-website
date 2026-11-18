// Independent review regressions and related evidence-admission cases use synthetic offline inputs.
import { expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { BuildSnapshot } from '../../src/contracts';
import { BASELINE_GRAPH, BASELINE_RULESET, validateContract } from '../../src/contracts';
import { createHttpProviders, StaticMirrorPricingProvider } from '../../src/data/http/providers';
import { ContractHttpClient } from '../../src/data/http/client';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import type { DataProviders } from '../../src/data/types';
import { estimateCost } from '../../src/domain/cost';
import { DataContext } from '../../src/app/data-context';
import { useBuildAnalysis } from '../../src/app/queries';
import { apiChat, buildWith, BY_ID, CATALOG, NOW, resourceEstimate, selfHosted } from './scenarios';
function setup() {
  const build = buildWith([['cost_policy', 'hard-cap']], apiChat());
  build.objectives.monthly_budget_amount = '1000.00';
  const book = structuredClone(DEMO_PRICEBOOK);
  book.rates = book.rates.filter((r) => r.catalog_item_id.includes('aurora-large'));
  for (const r of book.rates) r.valid_until = '2026-10-17T00:00:00Z';
  const fetch = async (url: string) =>
    new Response(
      JSON.stringify(
        url.includes('/pricebooks/')
          ? book
          : url.includes('/catalog/')
            ? CATALOG
            : url.includes('/rulesets/')
              ? BASELINE_RULESET
              : BASELINE_GRAPH,
      ),
    );
  const cfg = {
    baseUrl: '/v1',
    catalogSnapshotId: CATALOG.id,
    pricebookId: book.id,
    staticMirror: true,
    fetch,
  };
  return { build, book, cfg, providers: createHttpProviders(cfg) };
}
it('excludes a foreign-pricebook quote from static budget evaluation', async () => {
  const { build, book, providers } = setup();
  const foreign = { ...book, id: 'prices.synthetic.foreign' };
  const cost = estimateCost(build, BY_ID, foreign, { now: NOW });
  expect(validateContract('CostEstimate', cost).ok).toBe(true);
  expect(cost.pricebook_id).not.toBe(build.locks.pricebook_id);
  const report = await providers.compatibility.evaluate(build, { costEstimate: cost });
  expect(report.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')?.outcome).toBe(
    'unknown',
  );
});
it('reevaluates expired cost evidence even when its estimate ID is unchanged', async () => {
  const { build, providers, cfg } = setup();
  let now = NOW;
  providers.pricing = new StaticMirrorPricingProvider(
    new ContractHttpClient(cfg),
    cfg,
    providers.catalog,
    () => now,
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={providers}>{children}</DataContext.Provider>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => useBuildAnalysis(build), { wrapper });
  await waitFor(() =>
    expect(
      result.current.report?.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')?.outcome,
    ).toBe('pass'),
  );
  const oldId = result.current.cost!.id;
  now = '2026-10-18T00:00:00Z';
  await act(async () => {
    await result.current.costQuery.refetch();
  });
  await waitFor(() => expect(result.current.cost!.coverage).toBe('unknown'));
  expect(result.current.cost!.id).toBe(oldId);
  expect(result.current.reportIsCurrent).toBe(true);
  expect(
    result.current.report?.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')?.outcome,
  ).toBe('unknown');
  queryClient.clear();
});

function analysis(build: BuildSnapshot, providers: DataProviders) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, gcTime: 0 },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>{children}</DataContext.Provider>
    </QueryClientProvider>
  );
  return renderHook(() => useBuildAnalysis(build), { wrapper });
}

it('admits the actual configured fixture pricebook when the optional build lock is absent', async () => {
  const build = buildWith([['cost_policy', 'hard-cap']], apiChat());
  build.objectives.monthly_budget_amount = '1000.00';
  delete build.locks.pricebook_id;
  const pricebook = { ...DEMO_PRICEBOOK, id: 'prices.configured.synthetic-test' };
  const providers = createFixtureProviders({ pricebook, now: () => NOW });
  const h = analysis(build, providers);
  await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
  expect(providers.catalog.defaultPricebookId).toBe(pricebook.id);
  expect(h.result.current.cost?.pricebook_id).toBe(pricebook.id);
  expect(h.result.current.costIsCurrent).toBe(true);
  expect(
    h.result.current.report?.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')?.outcome,
  ).toBe('pass');
  h.unmount();
});

it('admits a matching quote and the configured fallback when the optional lock is absent', async () => {
  const { build, book, providers } = setup();
  const quote = estimateCost(build, BY_ID, book, { now: NOW });
  for (const snapshot of [
    build,
    { ...build, locks: { ...build.locks, pricebook_id: undefined } },
  ]) {
    expect(validateContract('BuildSnapshot', snapshot).ok).toBe(true);
    const report = await providers.compatibility.evaluate(snapshot, { costEstimate: quote });
    expect(report.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')?.outcome).toBe(
      'pass',
    );
  }
});

it('does not mark a foreign-pricebook quote current in the analysis hook', async () => {
  const { build, book, providers } = setup();
  const quote = estimateCost(
    build,
    BY_ID,
    { ...book, id: 'prices.synthetic.foreign' },
    { now: NOW },
  );
  vi.spyOn(providers.pricing, 'estimate').mockResolvedValue(quote);
  const h = analysis(build, providers);
  await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
  expect(h.result.current.costQuery.data).toEqual(quote);
  expect(h.result.current.costIsCurrent).toBe(false);
  expect(
    h.result.current.report?.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')?.outcome,
  ).toBe('unknown');
  h.unmount();
});

it('excludes retained cost data after a failed refresh instead of retaining budget pass', async () => {
  const { build, providers, cfg } = setup();
  providers.pricing = new StaticMirrorPricingProvider(
    new ContractHttpClient(cfg),
    cfg,
    providers.catalog,
    () => NOW,
  );
  const request = vi.spyOn(providers.pricing, 'estimate');
  const h = analysis(build, providers);
  await waitFor(() =>
    expect(
      h.result.current.report?.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')
        ?.outcome,
    ).toBe('pass'),
  );
  request.mockRejectedValue(new Error('Synthetic pricebook refresh failure.'));
  await act(async () => {
    await h.result.current.costQuery.refetch();
  });
  await waitFor(() =>
    expect(
      h.result.current.report?.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')
        ?.outcome,
    ).toBe('unknown'),
  );
  expect(h.result.current.costQuery.isError).toBe(true);
  expect(h.result.current.costQuery.data?.coverage).toBe('complete');
  expect(h.result.current.costIsCurrent).toBe(false);
  expect(h.result.current.reportIsCurrent).toBe(true);
  h.unmount();
});

it('reevaluates replaced capacity contents even when their ID and timestamp are unchanged', async () => {
  const build = selfHosted();
  const providers = createFixtureProviders({ now: () => NOW });
  const first = resourceEstimate(build, '20', 'calibrated');
  const next = resourceEstimate(build, '30', 'calibrated');
  const request = vi
    .spyOn(providers.resources, 'estimate')
    .mockResolvedValue({ status: 'available', estimate: first });
  const h = analysis(build, providers);
  await waitFor(() =>
    expect(
      h.result.current.report?.findings.find((f) => f.rule_id === 'rule.vram.estimate.fit')
        ?.outcome,
    ).toBe('pass'),
  );
  expect(next.id).toBe(first.id);
  expect(next.generated_at).toBe(first.generated_at);
  request.mockResolvedValue({ status: 'available', estimate: next });
  await act(async () => {
    await h.result.current.resourcesQuery.refetch();
  });
  await waitFor(() =>
    expect(
      h.result.current.report?.findings.find((f) => f.rule_id === 'rule.vram.estimate.fit')
        ?.outcome,
    ).toBe('fail'),
  );
  expect(h.result.current.reportIsCurrent).toBe(true);
  h.unmount();
});

it('hides retained capacity data and reevaluates Unknown after a failed refresh', async () => {
  const build = selfHosted();
  const providers = createFixtureProviders({ now: () => NOW });
  const request = vi.spyOn(providers.resources, 'estimate').mockResolvedValue({
    status: 'available',
    estimate: resourceEstimate(build, '20', 'calibrated'),
  });
  const h = analysis(build, providers);
  await waitFor(() =>
    expect(
      h.result.current.report?.findings.find((f) => f.rule_id === 'rule.vram.estimate.fit')
        ?.outcome,
    ).toBe('pass'),
  );
  request.mockRejectedValue(new Error('Synthetic capacity refresh failure.'));
  await act(async () => {
    await h.result.current.resourcesQuery.refetch();
  });
  await waitFor(() =>
    expect(
      h.result.current.report?.findings.find((f) => f.rule_id === 'rule.vram.estimate.fit')
        ?.outcome,
    ).toBe('unknown'),
  );
  expect(h.result.current.resourcesQuery.isError).toBe(true);
  expect(h.result.current.resourcesQuery.data?.status).toBe('available');
  expect(h.result.current.resources).toBeUndefined();
  expect(h.result.current.reportIsCurrent).toBe(true);
  h.unmount();
});

it('does not mark a retained report current after its evaluation refresh fails', async () => {
  const { build, providers, cfg } = setup();
  providers.pricing = new StaticMirrorPricingProvider(
    new ContractHttpClient(cfg),
    cfg,
    providers.catalog,
    () => NOW,
  );
  const request = vi.spyOn(providers.compatibility, 'evaluate');
  const h = analysis(build, providers);
  await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
  request.mockRejectedValue(new Error('Synthetic evaluation refresh failure.'));
  await act(async () => {
    await h.result.current.evaluation.refetch();
  });
  await waitFor(() => expect(h.result.current.evaluation.isError).toBe(true));
  expect(h.result.current.report).toBeDefined();
  expect(h.result.current.reportIsCurrent).toBe(false);
  h.unmount();
});
