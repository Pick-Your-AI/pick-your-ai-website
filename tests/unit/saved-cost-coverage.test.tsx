/*
 * Saved-build and starter-build totals (review 5591558191, findings 7 and 9).
 *
 * Both screens previously formatted `total.amount` alone, which lost the estimator's coverage and
 * period: a build whose components are all unpriced showed `$0`, and a partial total showed a
 * complete monthly figure. They now use the same coverage-aware presentation as the builder.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import TemplatesPage from '../../src/pages/TemplatesPage';
import { NOW, apiChat, buildWith } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

const { useBuilder } = await import('../../src/app/builder-context');

function mockBuilder(draft: BuildSnapshot | null) {
  vi.mocked(useBuilder).mockReturnValue({
    draft: draft ? createDraft(draft) : null,
    ready: true,
    catalogById: new Map(),
    lastChange: null,
    saveState: { status: 'saved' },
    apply: vi.fn(),
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
}

/** A stack whose every priced meter is missing: the estimator reports `coverage: unknown`. */
const unpricedStack = () =>
  buildWith([
    ['workload', 'support-chat'],
    ['deployment_mode', 'self-hosted'],
    ['model_provider', 'openlab'],
    ['model', 'open-8b'],
    ['context_policy', 'standard-8k'],
    ['hosting_platform', 'onprem-rack'],
    ['compute_profile', 'rack-2x-r48'],
    ['data_source', 'crm'],
  ]);

describe('saved build cost coverage', () => {
  it('does not present an unpriced build as $0/mo', async () => {
    mockBuilder(null);
    const providers = createFixtureProviders({ now: () => NOW });
    const build = unpricedStack();
    await providers.builds.save(createDraft(build), null);
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

    const heading = await screen.findByRole('heading', { name: /Untitled AI stack/ });
    const card = heading.closest('article')!;
    const metric = within(card).getByText('ESTIMATED BASELINE*').parentElement!;
    await waitFor(() => expect(metric).toHaveTextContent('Unknown'));
    expect(metric).not.toHaveTextContent(/\$0/);
  });

  it('marks a partial saved total as a lower bound', async () => {
    mockBuilder(null);
    const providers = createFixtureProviders({ now: () => NOW });
    const build = buildWith([
      ['workload', 'support-chat'],
      ['deployment_mode', 'api'],
      ['model_provider', 'aurora'],
      ['model', 'aurora-mini'],
      ['context_policy', 'standard-8k'],
    ]);
    await providers.builds.save(createDraft(build), null);
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

    const heading = await screen.findByRole('heading', { name: /Untitled AI stack/ });
    const card = heading.closest('article')!;
    const metric = within(card).getByText('ESTIMATED BASELINE*').parentElement!;
    await waitFor(() => expect(metric).toHaveTextContent('≥ $14.40'));
    expect(metric).toHaveTextContent('lower bound');
  });
});

describe('starter build cost coverage', () => {
  it('labels an incomplete starter estimate as a lower bound', async () => {
    mockBuilder(apiChat());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={createFixtureProviders({ now: () => NOW })}>
          <MemoryRouter>
            <ToastProvider>
              <TemplatesPage />
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );

    // The Document Q&A starter leaves its vector database unpriced, so its total is a lower bound.
    const heading = await screen.findByRole('heading', { name: /Document Q&A/ });
    const card = heading.closest('article')!;
    await waitFor(() => expect(card).toHaveTextContent('≥ $188.25'));
    expect(card).toHaveTextContent('lower bound');
    expect(card).not.toHaveTextContent(/\$188\.25\s*per 30 days/);
  });
});
