import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot, EvaluationReport } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft, replaceSelection } from '../../src/domain/build';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import { ToastProvider } from '../../src/components/feedback';
import { BY_ID, NOW, contradictory, item } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

function apiFor(build: BuildSnapshot) {
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
}

describe('working build summary', () => {
  it('withholds a previous revision’s verdict and counts while the new revision is evaluated', async () => {
    const providers = createFixtureProviders({ now: () => NOW });
    const price = providers.pricing.estimate.bind(providers.pricing);
    const evaluate = providers.compatibility.evaluate.bind(providers.compatibility);

    const previous = contradictory();
    const previousReport = await evaluate(previous, {
      costEstimate: await price(previous),
    });
    expect(previousReport.summary.failed).toBeGreaterThan(0);

    // Hold the next revision's evaluation so the placeholder report is all there is to show.
    let holding = false;
    const pending = new Promise<EvaluationReport>(() => {});
    vi.spyOn(providers.compatibility, 'evaluate').mockImplementation((build, evidence) =>
      holding ? pending : evaluate(build, evidence),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const tree = () => (
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter initialEntries={['/catalog/model?show=all']}>
            <ToastProvider>
              <MyBuildsPage />
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>
    );
    const conflicts = () => screen.getByText('IN PROGRESS').parentElement!;

    apiFor(previous);
    const view = render(tree());
    expect(conflicts()).toHaveTextContent('Not checked');
    await waitFor(() =>
      expect(conflicts()).toHaveTextContent(`${previousReport.summary.failed} conflict`),
    );

    // Replace the conflicting model: a new revision, evaluated asynchronously.
    const next: BuildSnapshot = {
      ...replaceSelection(previous, 'sel_model', item('model', 'aurora-large'), BY_ID),
      revision: previous.revision + 1,
    };
    holding = true;
    apiFor(next);
    view.rerender(tree());

    await waitFor(() => expect(conflicts()).toHaveTextContent('Not checked'));
    expect(conflicts()).not.toHaveTextContent(/\d+ conflicts?/);
    expect(conflicts()).not.toHaveTextContent('No demo conflicts');
  });
});
