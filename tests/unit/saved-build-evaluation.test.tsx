import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft, updateObjectives } from '../../src/domain/build';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import { NOW, apiChat, buildWith, contradictory, selfHosted } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

async function showBuild(build: BuildSnapshot, current = false) {
  vi.mocked(useBuilder).mockReturnValue({
    draft: current ? createDraft(build) : null,
    ready: true,
    catalogById: new Map(),
    lastChange: null,
    saveState: { status: 'saved' },
    apply: vi.fn(),
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
  const providers = createFixtureProviders({ now: () => NOW });
  await providers.builds.save(createDraft(build), null);
  const estimate = await providers.pricing.estimate(build);
  const report = await providers.compatibility.evaluate(build, { costEstimate: estimate });
  const evaluate = vi.spyOn(providers.compatibility, 'evaluate');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter>
          <ToastProvider>
            <MyBuildsPage />
          </ToastProvider>
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  const card = await screen.findByRole('article');
  const status = within(card).getByText('DEMO VALIDATION').parentElement!;
  return { estimate, report, evaluate, status };
}

describe('saved-build evaluation', () => {
  it('passes pricing evidence to evaluation and exposes a hard-cap violation', async () => {
    const build = updateObjectives(buildWith([['cost_policy', 'hard-cap']], apiChat()), {
      monthly_budget_amount: '1.00',
    });
    const { estimate, report, evaluate, status } = await showBuild(build);
    expect(Number(estimate.total.amount)).toBeGreaterThan(1);
    expect(
      report.findings.find((finding) => finding.rule_id === 'rule.budget.monthly.cap')?.outcome,
    ).toBe('fail');
    await waitFor(() => expect(status).toHaveTextContent(`${report.summary.failed} conflict`));
    expect(evaluate).toHaveBeenCalledWith(build, { costEstimate: estimate });
  });

  it.each([
    ['unknown checks without conflicts', selfHosted],
    [
      'unknown checks alongside conflicts',
      () => buildWith([['cost_policy', 'hard-cap']], contradictory()),
    ],
  ] as const)('shows %s in saved and current cards', async (_name, scenario) => {
    const { report, status } = await showBuild(scenario(), true);
    expect(report.summary.unknown).toBeGreaterThan(0);
    if (_name === 'unknown checks without conflicts') expect(report.summary.failed).toBe(0);
    else expect(report.summary.failed).toBeGreaterThan(0);
    await waitFor(() => expect(status).toHaveTextContent(`${report.summary.unknown} unknown`));
    const working = screen.getByText('IN PROGRESS').parentElement!;
    await waitFor(() => expect(working).toHaveTextContent(`${report.summary.unknown} unknown`));
    if (report.summary.failed) {
      expect(status).toHaveTextContent(`${report.summary.failed} conflict`);
      expect(working).toHaveTextContent(`${report.summary.failed} conflict`);
    } else {
      expect(status).not.toHaveTextContent('No conflicts');
      expect(working).not.toHaveTextContent('No demo conflicts');
    }
  });

  it('shows a clean status only when no checks failed or remain unknown', async () => {
    const { report, status } = await showBuild(apiChat(), true);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.unknown).toBe(0);
    await waitFor(() => expect(status).toHaveTextContent('No conflicts'));
    await waitFor(() =>
      expect(screen.getByText('IN PROGRESS').parentElement!).toHaveTextContent('No conflicts'),
    );
  });
});
