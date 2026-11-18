import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { useBuildAnalysis, useCompatibleOptions } from '../../src/app/queries';
import type { BuildSnapshot } from '../../src/contracts';
import { validatorsReady } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { importBuild } from '../../src/domain/share';
import { useCompatByKind } from '../../src/lib/compat';
import { apiChat, contradictory, NOW, resourceEstimate } from './scenarios';

async function harness() {
  await validatorsReady;
  const original = apiChat();
  const replacement = contradictory();
  expect(replacement.id).toBe(original.id);
  expect(replacement.revision).toBe(original.revision);
  expect(replacement.selections).not.toEqual(original.selections);
  // The real importer accepts both synthetic snapshots without assigning new identities.
  expect(importBuild(JSON.stringify(original), 'fixture').ok).toBe(true);
  expect(importBuild(JSON.stringify(replacement), 'fixture').ok).toBe(true);

  const providers = createFixtureProviders({ now: () => NOW });
  const cost = await providers.pricing.estimate(original);
  const resources = {
    status: 'available' as const,
    estimate: resourceEstimate(original, '8', 'calibrated'),
  };
  // Deliberately keep evidence identical: evaluation must track the snapshot itself,
  // even when fresh providers return the same evidence contents for both snapshots.
  const estimateCost = vi.spyOn(providers.pricing, 'estimate').mockResolvedValue(cost);
  const estimateResources = vi.spyOn(providers.resources, 'estimate').mockResolvedValue(resources);
  const evaluate = vi.spyOn(providers.compatibility, 'evaluate');
  const options = vi.spyOn(providers.compatibility, 'compatibleOptions');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>{children}</DataContext.Provider>
      </QueryClientProvider>
    );
  }
  const hook = renderHook(
    ({ build }: { build: BuildSnapshot }) => ({
      analysis: useBuildAnalysis(build),
      options: useCompatibleOptions(build, 'model'),
      byKind: useCompatByKind(build, ['model_provider']),
    }),
    { initialProps: { build: original }, wrapper: Wrapper },
  );
  await waitFor(() => {
    expect(hook.result.current.analysis.reportIsCurrent).toBe(true);
    expect(hook.result.current.options.isSuccess).toBe(true);
    expect(hook.result.current.byKind.isSuccess).toBe(true);
  });
  expect(hook.result.current.analysis.report?.summary.failed).toBe(0);
  return {
    ...hook,
    original,
    replacement,
    client,
    estimateCost,
    estimateResources,
    evaluate,
    options,
  };
}

describe('synthetic imported snapshot query identity', () => {
  it.each(['cost', 'resources', 'evaluation', 'options', 'catalog options'] as const)(
    'recomputes %s when content changes under the same declared ID and revision',
    async (query) => {
      const h = await harness();
      try {
        h.rerender({ build: h.replacement });
        await waitFor(() => {
          if (query === 'cost') expect(h.estimateCost).toHaveBeenCalledWith(h.replacement);
          if (query === 'resources')
            expect(h.estimateResources).toHaveBeenCalledWith(h.replacement);
          if (query === 'evaluation')
            expect(h.evaluate).toHaveBeenCalledWith(h.replacement, expect.anything());
          if (query === 'options')
            expect(h.options).toHaveBeenCalledWith(h.replacement, 'model', 'primary');
          if (query === 'catalog options')
            expect(h.options).toHaveBeenCalledWith(h.replacement, 'model_provider', 'primary');
        });
        await waitFor(() => {
          expect(h.result.current.analysis.reportIsCurrent).toBe(true);
          expect(h.result.current.analysis.report?.summary.failed).toBeGreaterThan(0);
        });
      } finally {
        h.unmount();
        h.client.clear();
      }
    },
  );

  it('withholds prior evidence and verdicts while a changed snapshot is pending', async () => {
    const h = await harness();
    try {
      h.estimateCost.mockImplementation(() => new Promise(() => {}));
      h.estimateResources.mockImplementation(() => new Promise(() => {}));
      h.evaluate.mockImplementation(() => new Promise(() => {}));
      h.options.mockImplementation(() => new Promise(() => {}));
      h.rerender({ build: h.replacement });
      expect(h.result.current.analysis.costIsCurrent).toBe(false);
      expect(h.result.current.analysis.reportIsCurrent).toBe(false);
      expect(h.result.current.analysis.resources).toBeUndefined();
      expect(h.result.current.options.isPlaceholderData).toBe(true);
      expect(h.result.current.byKind.isSuccess).toBe(false);
      expect(h.result.current.byKind.data.size).toBe(0);
    } finally {
      h.unmount();
      h.client.clear();
    }
  });

  it('reuses results for an equal JSON reparse with reordered object properties', async () => {
    const h = await harness();
    try {
      const calls = [
        h.estimateCost.mock.calls.length,
        h.estimateResources.mock.calls.length,
        h.evaluate.mock.calls.length,
        h.options.mock.calls.length,
      ];
      const reparsed = JSON.parse(
        JSON.stringify(Object.fromEntries(Object.entries(h.original).reverse())),
      ) as BuildSnapshot;
      expect(reparsed).toEqual(h.original);
      expect(reparsed).not.toBe(h.original);
      h.rerender({ build: reparsed });
      await act(async () => {});
      expect(h.result.current.analysis.reportIsCurrent).toBe(true);
      expect(h.result.current.options.isSuccess).toBe(true);
      expect(h.result.current.byKind.isSuccess).toBe(true);
      expect([
        h.estimateCost.mock.calls.length,
        h.estimateResources.mock.calls.length,
        h.evaluate.mock.calls.length,
        h.options.mock.calls.length,
      ]).toEqual(calls);
    } finally {
      h.unmount();
      h.client.clear();
    }
  });
});
