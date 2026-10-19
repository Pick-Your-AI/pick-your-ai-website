import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import BuildSummaryPage from '../../src/pages/BuildSummaryPage';
import { buildWith, BY_ID, contradictory, NOW } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

const { useBuilder } = await import('../../src/app/builder-context');

function show(build = buildWith([])) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  return render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={createFixtureProviders({ now: () => NOW })}>
        <MemoryRouter>
          <BuildSummaryPage />
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
}

describe('incomplete build wording', () => {
  it('shows provisional completion guidance while retaining the raw failure', async () => {
    show();
    const panel = await screen.findByTestId('overall-status');
    await waitFor(() => expect(panel).toHaveTextContent('Incomplete'));
    expect(panel).toHaveTextContent('0 of 4 required choices made');
    expect(panel).toHaveTextContent('Provisional inference');
    expect(panel).toHaveTextContent('Choose workload');
    // The frozen presence rule still fails; incompleteness is presentation only.
    expect(await screen.findAllByText('Fail')).not.toHaveLength(0);
  });

  it('retains Incompatible for real conflicts', async () => {
    show(contradictory());
    const panel = await screen.findByTestId('overall-status');
    await waitFor(() => expect(panel).toHaveTextContent('Incompatible'));
    expect(panel).not.toHaveTextContent('Incomplete');
  });
});
