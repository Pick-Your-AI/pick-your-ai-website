import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { useBuilder } from '../../src/app/builder-context';
import { validatorsReady } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import { encodeShareFragment } from '../../src/domain/share';
import BuildSummaryPage from '../../src/pages/BuildSummaryPage';
import SharedBuildPage from '../../src/pages/SharedBuildPage';
import { apiChat, BY_ID, NOW } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

describe.each(['summary', 'shared'] as const)('%s evaluation presentation', (page) => {
  it.each(['pending', 'unavailable'] as const)('stays neutral when %s', async (state) => {
    await validatorsReady;
    const build = apiChat();
    const providers = createFixtureProviders({ now: () => NOW });
    vi.spyOn(providers.compatibility, 'evaluate').mockImplementation(() =>
      state === 'pending'
        ? new Promise(() => {})
        : Promise.reject(new Error('Evaluation unavailable')),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
    });
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
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter initialEntries={[`/shared#${encodeShareFragment(build, 'fixture')}`]}>
            {page === 'summary' ? <BuildSummaryPage /> : <SharedBuildPage />}
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    const panel = await screen.findByTestId('overall-status');
    await waitFor(() => expect(providers.compatibility.evaluate).toHaveBeenCalled());
    if (state === 'unavailable') await screen.findByText('Evaluation unavailable');
    expect(panel).toHaveClass('neutral');
    expect(panel).not.toHaveClass('warning', 'danger');
    expect(panel.querySelector('use')).toHaveAttribute('href', '#i-info');
    expect(panel).toHaveTextContent(
      page === 'summary' ? 'Not evaluated yet' : 'Evaluating this build',
    );
    view.unmount();
    client.clear();
  });
});
