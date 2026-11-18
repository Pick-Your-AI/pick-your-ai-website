/* Synthetic, offline receiving tests; no remote evaluator or production evidence. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { useBuildAnalysis } from '../../src/app/queries';
import { assertContract, type CostEstimate } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { ContractHttpClient } from '../../src/data/http/client';
import {
  HttpPricingProvider,
  StaticMirrorCompatibilityEvaluator,
} from '../../src/data/http/providers';
import { hasConsistentCostCurrency } from '../../src/domain/cost-evidence';
import { apiChat, buildWith, CATALOG, NOW } from './scenarios';

type Money = CostEstimate['total'];
const locations: { name: string; money: (quote: CostEstimate) => Money }[] = [
  { name: 'total', money: (quote) => quote.total },
  { name: 'subtotal', money: (quote) => quote.subtotal },
  { name: 'tax', money: (quote) => quote.tax },
  { name: 'line amount', money: (quote) => quote.line_items.at(-1)!.amount },
  { name: 'unit price', money: (quote) => quote.line_items.at(-1)!.unit_price },
];

async function scenario() {
  const build = buildWith([['cost_policy', 'hard-cap']], apiChat());
  build.objectives.monthly_budget_amount = '400.00';
  const providers = createFixtureProviders({ now: () => NOW });
  const quote = structuredClone(await providers.pricing.estimate(build));
  return { build, providers, quote };
}

function receivingPricing(quote: CostEstimate) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(quote), { headers: { 'Content-Type': 'application/json' } }),
  );
  const cfg = {
    baseUrl: 'https://offline.invalid/v1',
    catalogSnapshotId: CATALOG.id,
    pricebookId: quote.pricebook_id,
    fetch,
  };
  return { pricing: new HttpPricingProvider(new ContractHttpClient(cfg), cfg), fetch };
}

describe('cost money currency admission', () => {
  it.each(locations)(
    'rejects schema-valid mixed $name currency at HTTP receipt',
    async ({ money }) => {
      const { build, quote } = await scenario();
      money(quote).currency = 'EUR';
      assertContract('CostEstimate', quote);
      const before = structuredClone(quote);
      const { pricing, fetch } = receivingPricing(quote);
      await expect(pricing.estimate(build)).rejects.toMatchObject({
        kind: 'malformed',
        contract: 'CostEstimate',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(quote).toEqual(before);
    },
  );

  it.each(locations)(
    'withholds mixed $name currency from common query evidence',
    async ({ money }) => {
      const { build, quote, providers } = await scenario();
      money(quote).currency = 'EUR';
      assertContract('CostEstimate', quote);
      vi.spyOn(providers.pricing, 'estimate').mockResolvedValue(quote);
      const evaluate = vi.spyOn(providers.compatibility, 'evaluate');
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <DataContext.Provider value={providers}>{children}</DataContext.Provider>
        </QueryClientProvider>
      );
      const hook = renderHook(() => useBuildAnalysis(build), { wrapper });
      try {
        await waitFor(() => expect(hook.result.current.reportIsCurrent).toBe(true));
        expect(hook.result.current.costIsCurrent).toBe(false);
        expect(evaluate).toHaveBeenCalledWith(build, {
          costEstimate: null,
          resourceEstimate: null,
        });
        expect(
          hook.result.current.report?.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')
            ?.outcome,
        ).toBe('unknown');
      } finally {
        hook.unmount();
        client.clear();
      }
    },
  );

  it.each(locations)(
    'withholds injected mixed $name currency in local adapters',
    async ({ money }) => {
      const { build, quote, providers } = await scenario();
      money(quote).currency = 'EUR';
      assertContract('CostEstimate', quote);
      const before = structuredClone(quote);
      const staticEvaluator = new StaticMirrorCompatibilityEvaluator(providers.catalog, () => NOW);
      for (const evaluator of [providers.compatibility, staticEvaluator]) {
        const report = await evaluator.evaluate(build, { costEstimate: quote });
        expect(report.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')?.outcome).toBe(
          'unknown',
        );
      }
      expect(quote).toEqual(before);
    },
  );

  it.each(['USD', 'EUR'])('preserves a coherent %s quote without conversion', async (currency) => {
    const { build, quote, providers } = await scenario();
    quote.currency = currency;
    for (const value of [quote.total, quote.subtotal, quote.tax]) value.currency = currency;
    for (const line of quote.line_items) {
      line.amount.currency = currency;
      line.unit_price.currency = currency;
    }
    assertContract('CostEstimate', quote);
    const before = structuredClone(quote);
    expect(hasConsistentCostCurrency(quote)).toBe(true);
    const { pricing } = receivingPricing(quote);
    await expect(pricing.estimate(build)).resolves.toEqual(before);
    for (const evaluator of [
      providers.compatibility,
      new StaticMirrorCompatibilityEvaluator(providers.catalog, () => NOW),
    ]) {
      const report = await evaluator.evaluate(build, { costEstimate: quote });
      expect(report.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')?.outcome).toBe(
        currency === build.objectives.currency ? 'pass' : 'unknown',
      );
    }
    vi.spyOn(providers.pricing, 'estimate').mockResolvedValue(quote);
    const evaluate = vi.spyOn(providers.compatibility, 'evaluate');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>{children}</DataContext.Provider>
      </QueryClientProvider>
    );
    const hook = renderHook(() => useBuildAnalysis(build), { wrapper });
    try {
      await waitFor(() => expect(hook.result.current.reportIsCurrent).toBe(true));
      expect(hook.result.current.costIsCurrent).toBe(true);
      expect(hook.result.current.cost).toEqual(before);
      expect(evaluate).toHaveBeenCalledWith(build, {
        costEstimate: before,
        resourceEstimate: null,
      });
      expect(
        hook.result.current.report?.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')
          ?.outcome,
      ).toBe(currency === build.objectives.currency ? 'pass' : 'unknown');
    } finally {
      hook.unmount();
      client.clear();
    }
    expect(quote).toEqual(before);
  });
});
