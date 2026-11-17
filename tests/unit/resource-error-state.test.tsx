import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { DataError } from '../../src/data/errors';
import type { ResourceEstimateResult } from '../../src/data/types';
import { createDraft } from '../../src/domain/build';
import BuildSummaryPage from '../../src/pages/BuildSummaryPage';
import { BY_ID, NOW, resourceEstimate, selfHosted } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

function Summary({ build }: { build: BuildSnapshot }) {
  vi.mocked(useBuilder).mockReturnValue({
    draft: createDraft(build),
    ready: true,
    catalogById: BY_ID,
    startNew: vi.fn(),
  } as unknown as ReturnType<typeof useBuilder>);
  return <BuildSummaryPage />;
}

function showSummary(
  build: BuildSnapshot,
  estimate: (build: BuildSnapshot) => Promise<ResourceEstimateResult>,
) {
  const providers = createFixtureProviders({ now: () => NOW });
  vi.spyOn(providers.resources, 'estimate').mockImplementation(estimate);
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter>
          <Summary build={build} />
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  return {
    ...view,
    rerenderBuild: (next: BuildSnapshot) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <DataContext.Provider value={providers}>
            <MemoryRouter>
              <Summary build={next} />
            </MemoryRouter>
          </DataContext.Provider>
        </QueryClientProvider>,
      ),
  };
}

describe('capacity evidence request failures', () => {
  it('shows an explicit failure and retries into current admitted evidence', async () => {
    const build = selfHosted();
    const estimate = vi
      .fn<(build: BuildSnapshot) => Promise<ResourceEstimateResult>>()
      .mockRejectedValue(new DataError('network', 'Synthetic capacity request failed.'));
    showSummary(build, estimate);
    const panel = await screen.findByRole('region', { name: 'Capacity evidence' });
    await waitFor(() =>
      expect(within(panel).getByRole('alert')).toHaveTextContent('Capacity evidence unavailable'),
    );
    expect(panel).toHaveTextContent('Synthetic capacity request failed.');
    expect(panel).not.toHaveTextContent('Checking capacity evidence');
    expect(panel).not.toHaveTextContent('Estimator evidence for revision');
    await waitFor(() => expect(screen.getByTestId('overall-status')).toHaveTextContent(/unknown/i));
    const recovered = resourceEstimate(build, '19', 'estimated');
    recovered.estimates[0]!.assumptions = ['Synthetic current revision assumption.'];
    estimate.mockResolvedValue({ status: 'available', estimate: recovered });
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(panel).toHaveTextContent('19 gb'));
    expect(panel).toHaveTextContent('Synthetic current revision assumption.');
    expect(panel).toHaveTextContent(`Estimator evidence for revision ${build.revision}`);
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('overall-status')).toHaveTextContent(/unknown/i));
  });

  it('does not retain the previous revision metric when the current request fails', async () => {
    const build = selfHosted();
    const previous = resourceEstimate(build, '8', 'calibrated');
    previous.estimates[0]!.assumptions = ['Synthetic previous revision assumption.'];
    const view = showSummary(build, async (requested) => {
      if (requested.revision === build.revision) return { status: 'available', estimate: previous };
      throw new DataError('network', 'Synthetic newer revision request failed.');
    });
    const panel = await screen.findByRole('region', { name: 'Capacity evidence' });
    await waitFor(() => expect(panel).toHaveTextContent('8 gb'));
    view.rerenderBuild({ ...build, revision: build.revision + 1 });
    await waitFor(() => expect(within(panel).getByRole('alert')).toBeInTheDocument());
    expect(panel).toHaveTextContent('Synthetic newer revision request failed.');
    expect(panel).not.toHaveTextContent('8 gb');
    expect(panel).not.toHaveTextContent('Synthetic previous revision assumption.');
    expect(panel).not.toHaveTextContent('Checking capacity evidence');
  });
});
