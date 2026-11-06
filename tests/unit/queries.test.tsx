import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { useBuildAnalysis } from '../../src/app/queries';
import { useBuilder } from '../../src/app/builder-context';
import type {
  BuildSnapshot,
  CostEstimate,
  EvaluationReport,
  ResourceEstimate,
} from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import type { ResourceEstimateResult } from '../../src/data/types';
import { createDraft } from '../../src/domain/build';
import BuildSummaryPage from '../../src/pages/BuildSummaryPage';
import { BY_ID, NOW, apiChat, resourceEstimate } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

function wrapperFor(providers: ReturnType<typeof createFixtureProviders>, client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter>{children}</MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>
    );
  };
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

async function analysisHarness(
  resourceFor: (build: BuildSnapshot) => ResourceEstimate = (build) =>
    resourceEstimate(build, '8', 'calibrated'),
) {
  const build = apiChat();
  const providers = createFixtureProviders({ now: () => NOW });
  const cost = await providers.pricing.estimate(build);
  const resources: ResourceEstimateResult = {
    status: 'available',
    estimate: resourceFor(build),
  };
  const report = await providers.compatibility.evaluate(build, {
    costEstimate: cost,
    resourceEstimate: resources.estimate,
  });
  const nextCost = deferred<CostEstimate>();
  const nextResources = deferred<ResourceEstimateResult>();
  const nextReport = deferred<EvaluationReport>();
  const estimate = vi
    .spyOn(providers.pricing, 'estimate')
    .mockImplementation((b) => (b === build ? Promise.resolve(cost) : nextCost.promise));
  const estimateResources = vi
    .spyOn(providers.resources, 'estimate')
    .mockImplementation((b) => (b === build ? Promise.resolve(resources) : nextResources.promise));
  const evaluate = vi
    .spyOn(providers.compatibility, 'evaluate')
    .mockImplementation((b) => (b === build ? Promise.resolve(report) : nextReport.promise));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = wrapperFor(providers, client);
  const initialProps: { current: BuildSnapshot | null } = { current: build };
  const hook = renderHook(
    ({ current }: { current: BuildSnapshot | null }) => useBuildAnalysis(current),
    {
      initialProps,
      wrapper,
    },
  );
  await waitFor(() => expect(hook.result.current.reportIsCurrent).toBe(true));
  expect(hook.result.current.costIsCurrent).toBe(true);
  return {
    ...hook,
    wrapper,
    build,
    cost,
    resources,
    report,
    nextCost,
    nextResources,
    nextReport,
    estimate,
    estimateResources,
    evaluate,
  };
}

function SummaryView({ build }: { build: BuildSnapshot }) {
  vi.mocked(useBuilder).mockReturnValue({
    draft: createDraft(build),
    ready: true,
    catalogById: BY_ID,
    lastChange: null,
    saveState: { status: 'saved' },
    apply: vi.fn(),
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
  return <BuildSummaryPage />;
}

describe('capacity evidence presentation', () => {
  it('discloses each estimate’s assumptions as text associated with its metric', async () => {
    const literalMarkup = '<img src="x" onerror="alert(1)">';
    const h = await analysisHarness((build) => {
      const estimate = resourceEstimate(build, '8', 'calibrated');
      estimate.estimates[0] = {
        ...estimate.estimates[0]!,
        estimator_id: 'synthetic.weights',
        estimator_version: '1.2-test',
        assumptions: ['Synthetic required VRAM at a 4k context.', literalMarkup],
      };
      estimate.estimates[1] = {
        ...estimate.estimates[1]!,
        estimator_id: 'synthetic.peak',
        estimator_version: '2.0-test',
        assumptions: ['Synthetic peak VRAM with two workers.'],
      };
      return estimate;
    });
    const view = render(<SummaryView build={h.build} />, { wrapper: h.wrapper });
    const capacity = await screen.findByRole('region', { name: 'Capacity evidence' });
    const required = within(capacity).getByRole('list', {
      name: 'Assumptions for Estimated required vram gb',
    });
    const peak = within(capacity).getByRole('list', {
      name: 'Assumptions for Estimated peak per device vram gb',
    });
    expect(required).toHaveTextContent('Synthetic required VRAM at a 4k context.');
    expect(required).not.toHaveTextContent('Synthetic peak VRAM with two workers.');
    expect(peak).toHaveTextContent('Synthetic peak VRAM with two workers.');
    expect(peak).not.toHaveTextContent('Synthetic required VRAM at a 4k context.');
    expect(required.closest('li')).toHaveTextContent('Calibrated, synthetic.weights@1.2-test');
    expect(peak.closest('li')).toHaveTextContent('Calibrated, synthetic.peak@2.0-test');
    expect(within(required).getByText(literalMarkup)).toBeInTheDocument();
    expect(capacity.querySelector('img')).toBeNull();
    view.unmount();
    h.unmount();
  });

  it('reports an empty supplied assumptions array without inventing an assumption', async () => {
    const h = await analysisHarness((build) => {
      const estimate = resourceEstimate(build, '8', 'calibrated');
      estimate.estimates[0]!.assumptions = [];
      return estimate;
    });
    const view = render(<SummaryView build={h.build} />, { wrapper: h.wrapper });
    const capacity = await screen.findByRole('region', { name: 'Capacity evidence' });
    const required = within(capacity).getByText('Estimated required vram gb:').closest('li');
    expect(required).toHaveTextContent('No assumptions provided.');
    expect(
      within(capacity).queryByRole('list', { name: 'Assumptions for Estimated required vram gb' }),
    ).not.toBeInTheDocument();
    expect(
      within(capacity).getByRole('list', {
        name: 'Assumptions for Estimated peak per device vram gb',
      }),
    ).toHaveTextContent('Synthetic test value.');
    view.unmount();
    h.unmount();
  });
});

describe('build analysis identity', () => {
  it.each(['another build at the same revision', 'a new revision of the same build'])(
    'keeps placeholders stale and excludes their evidence for %s',
    async (change) => {
      const h = await analysisHarness();
      const nextBuild = {
        ...h.build,
        ...(change === 'another build at the same revision'
          ? { id: 'build.other' }
          : { revision: h.build.revision + 1 }),
      };
      h.rerender({ current: nextBuild });
      expect(h.result.current.costQuery.isPlaceholderData).toBe(true);
      expect(h.result.current.evaluation.isPlaceholderData).toBe(true);
      expect(h.result.current.cost).toEqual(h.cost);
      expect(h.result.current.report).toEqual(h.report);
      expect(h.result.current.costIsCurrent).toBe(false);
      expect(h.result.current.reportIsCurrent).toBe(false);
      expect(h.result.current.resourcesQuery.isPlaceholderData).toBe(true);
      expect(h.result.current.resources).toBeUndefined();
      await waitFor(() =>
        expect(h.evaluate).toHaveBeenCalledWith(nextBuild, {
          costEstimate: null,
          resourceEstimate: null,
        }),
      );

      const currentResources: ResourceEstimateResult = {
        status: 'available',
        estimate: resourceEstimate(nextBuild, '8', 'calibrated'),
      };
      await act(async () => h.nextResources.resolve(currentResources));
      await waitFor(() => expect(h.result.current.resources).toEqual(currentResources));
      const currentCost = { ...h.cost, build_id: nextBuild.id, build_revision: nextBuild.revision };
      await act(async () => h.nextCost.resolve(currentCost));
      await waitFor(() =>
        expect(h.evaluate).toHaveBeenCalledWith(nextBuild, {
          costEstimate: currentCost,
          resourceEstimate: currentResources.estimate,
        }),
      );
      expect(h.result.current.costIsCurrent).toBe(true);
      expect(h.result.current.reportIsCurrent).toBe(false);
      const currentReport = {
        ...h.report,
        build_id: nextBuild.id,
        build_revision: nextBuild.revision,
      };
      await act(async () => h.nextReport.resolve(currentReport));
      await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
      expect(h.result.current.report).toEqual(currentReport);
      expect(h.result.current.cost).toEqual(currentCost);
      for (const [build, evidence] of h.evaluate.mock.calls.filter(([b]) => b === nextBuild)) {
        for (const estimate of [evidence?.costEstimate, evidence?.resourceEstimate]) {
          if (estimate) {
            expect(estimate.build_id).toBe(build.id);
            expect(estimate.build_revision).toBe(build.revision);
          }
        }
      }
      h.unmount();
    },
  );

  it('does not mark placeholders current or request analysis without a build', async () => {
    const h = await analysisHarness();
    h.estimate.mockClear();
    h.estimateResources.mockClear();
    h.evaluate.mockClear();
    h.rerender({ current: null });
    expect(h.result.current.cost).toEqual(h.cost);
    expect(h.result.current.report).toEqual(h.report);
    expect(h.result.current.costIsCurrent).toBe(false);
    expect(h.result.current.reportIsCurrent).toBe(false);
    expect(h.result.current.resources).toBeUndefined();
    expect(h.estimate).not.toHaveBeenCalled();
    expect(h.estimateResources).not.toHaveBeenCalled();
    expect(h.evaluate).not.toHaveBeenCalled();
    h.unmount();
  });

  it('hides a previous build’s unavailable reason until the current resource request resolves', async () => {
    const build = apiChat();
    const providers = createFixtureProviders({ now: () => NOW });
    const pending = deferred<ResourceEstimateResult>();
    const previous: ResourceEstimateResult = {
      status: 'unavailable',
      reason: 'Previous build reason.',
    };
    vi.spyOn(providers.resources, 'estimate')
      .mockResolvedValueOnce(previous)
      .mockReturnValue(pending.promise);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const h = renderHook(({ current }) => useBuildAnalysis(current), {
      initialProps: { current: build },
      wrapper: wrapperFor(providers, client),
    });
    await waitFor(() => expect(h.result.current.resources).toEqual(previous));
    h.rerender({ current: { ...build, id: 'build.other' } });
    expect(h.result.current.resourcesQuery.isPlaceholderData).toBe(true);
    expect(h.result.current.resourcesQuery.data).toEqual(previous);
    expect(h.result.current.resources).toBeUndefined();
    const current: ResourceEstimateResult = {
      status: 'unavailable',
      reason: 'Current build reason.',
    };
    await act(async () => pending.resolve(current));
    await waitFor(() => expect(h.result.current.resources).toEqual(current));
    expect(h.result.current.resourcesQuery.isPlaceholderData).toBe(false);
    h.unmount();
  });

  it('reevaluates when resources arrive after cost and when either estimate identity changes', async () => {
    const build = apiChat();
    const providers = createFixtureProviders({ now: () => NOW });
    const report = await providers.compatibility.evaluate(build);
    const resources = deferred<ResourceEstimateResult>();
    vi.spyOn(providers.resources, 'estimate').mockReturnValue(resources.promise);
    const withoutResources = deferred<EvaluationReport>();
    const withResources = deferred<EvaluationReport>();
    const withUpdatedResources = deferred<EvaluationReport>();
    const withUpdatedCost = deferred<EvaluationReport>();
    const evaluate = vi
      .spyOn(providers.compatibility, 'evaluate')
      .mockReturnValueOnce(withoutResources.promise)
      .mockReturnValueOnce(withResources.promise)
      .mockReturnValueOnce(withUpdatedResources.promise)
      .mockReturnValueOnce(withUpdatedCost.promise);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const h = renderHook(() => useBuildAnalysis(build), { wrapper: wrapperFor(providers, client) });
    await waitFor(() => expect(evaluate).toHaveBeenCalledTimes(1));
    expect(evaluate).toHaveBeenLastCalledWith(build, {
      costEstimate: expect.objectContaining({ build_id: build.id, build_revision: build.revision }),
      resourceEstimate: null,
    });
    await act(async () => withoutResources.resolve(report));
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));

    const estimate = resourceEstimate(build, '8', 'calibrated');
    await act(async () => resources.resolve({ status: 'available', estimate }));
    await waitFor(() => expect(evaluate).toHaveBeenCalledTimes(2));
    expect(evaluate).toHaveBeenLastCalledWith(build, {
      costEstimate: h.result.current.cost,
      resourceEstimate: estimate,
    });
    expect(h.result.current.report).toEqual(report);
    expect(h.result.current.reportIsCurrent).toBe(false);
    const updatedReport = { ...report, id: 'eval.with-resources' };
    await act(async () => withResources.resolve(updatedReport));
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
    expect(h.result.current.report).toEqual(updatedReport);

    const updatedEstimate = { ...estimate, id: 'resources.updated' };
    act(() =>
      client.setQueryData(['resources', build.id, build.revision], {
        status: 'available',
        estimate: updatedEstimate,
      }),
    );
    await waitFor(() => expect(evaluate).toHaveBeenCalledTimes(3));
    expect(evaluate).toHaveBeenLastCalledWith(build, {
      costEstimate: h.result.current.cost,
      resourceEstimate: updatedEstimate,
    });
    expect(h.result.current.reportIsCurrent).toBe(false);
    await act(async () =>
      withUpdatedResources.resolve({ ...report, id: 'eval.updated-resources' }),
    );
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));

    const updatedCost = { ...h.result.current.cost!, id: 'cost.updated' };
    act(() => client.setQueryData(['cost', build.id, build.revision], updatedCost));
    await waitFor(() => expect(evaluate).toHaveBeenCalledTimes(4));
    expect(evaluate).toHaveBeenLastCalledWith(build, {
      costEstimate: updatedCost,
      resourceEstimate: updatedEstimate,
    });
    expect(h.result.current.reportIsCurrent).toBe(false);
    await act(async () => withUpdatedCost.resolve({ ...report, id: 'eval.updated-cost' }));
    await waitFor(() => expect(h.result.current.reportIsCurrent).toBe(true));
    expect(h.result.current.report?.id).toBe('eval.updated-cost');
    h.unmount();
  });

  it.each(['another build', 'a new revision'])(
    'hides capacity values and assumptions for %s until current resources arrive',
    async (change) => {
      const h = await analysisHarness();
      // The builder summary is the only summary view after the redesign, so this exercises it directly.
      const view = render(<SummaryView build={h.build} />, { wrapper: h.wrapper });
      await waitFor(() =>
        expect(screen.getByRole('region', { name: 'Capacity evidence' })).toHaveTextContent('8 gb'),
      );
      expect(screen.getByRole('region', { name: 'Capacity evidence' })).toHaveTextContent(
        'Synthetic test value.',
      );

      const nextBuild = {
        ...h.build,
        ...(change === 'another build'
          ? { id: 'build.other' }
          : { revision: h.build.revision + 1 }),
      };
      view.rerender(<SummaryView build={nextBuild} />);
      const capacity = screen.getByRole('region', { name: 'Capacity evidence' });
      await waitFor(() => expect(capacity).toHaveTextContent('Checking capacity evidence…'));
      expect(capacity).not.toHaveTextContent('8 gb');
      expect(capacity).not.toHaveTextContent('Synthetic test value.');

      const current = resourceEstimate(nextBuild, '16', 'calibrated');
      current.estimates.forEach((estimate) => {
        estimate.assumptions = ['Synthetic current-build assumption.'];
      });
      await act(async () =>
        h.nextResources.resolve({
          status: 'available',
          estimate: current,
        }),
      );
      await waitFor(() => expect(capacity).toHaveTextContent('16 gb'));
      expect(capacity).toHaveTextContent('Synthetic current-build assumption.');
      expect(capacity).not.toHaveTextContent('8 gb');
      expect(capacity).not.toHaveTextContent('Synthetic test value.');
      view.unmount();
      h.unmount();
    },
  );
});
