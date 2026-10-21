/*
 * Component comparison presentation (review 5591558191, findings 4, 5 and 6).
 *
 *  - the cost row keeps the pricing qualifiers (a partial estimate is a lower bound, `Included*`
 *    keeps its asterisk) instead of reducing the amount to a bare number;
 *  - selections the catalog's compare tray accepted across tiers are rendered, not silently dropped;
 *  - an explicitly cleared comparison stays empty (`ids=`), rather than being refilled with the
 *    tier's defaults as if it were a first visit.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import ComparePage from '../../src/pages/ComparePage';
import { BY_ID, NOW, apiChat } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

const { useBuilder } = await import('../../src/app/builder-context');

/** The URL is part of the contract here: `ids=` (cleared) must stay distinct from no `ids`. */
function UrlProbe() {
  const location = useLocation();
  return <output data-testid="url">{location.search}</output>;
}

function show(path: string) {
  vi.mocked(useBuilder).mockReturnValue({
    draft: createDraft(apiChat()),
    ready: true,
    catalogById: BY_ID,
    lastChange: null,
    saveState: { status: 'saved' },
    apply: vi.fn(),
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={createFixtureProviders({ now: () => NOW })}>
        <MemoryRouter initialEntries={[path]}>
          <ToastProvider>
            <ComparePage />
            <UrlProbe />
          </ToastProvider>
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
}

const costRow = async () => {
  const table = await screen.findByRole('table');
  return within(table).getByRole('row', { name: /Est\. cost/ });
};

describe('component comparison', () => {
  it('keeps the lower-bound marker and the unpriced caveat', async () => {
    // Aurora Mini's output-token rate is expired, so its support-chat price is a lower bound.
    show('/compare?ids=demo~model~aurora-mini,demo~model~aurora-large');
    const row = await costRow();
    expect(row).toHaveTextContent('≥ $14.40');
    expect(row).toHaveTextContent('partial');
    expect(row).toHaveTextContent('$324');
    // The explanation behind the marker is reachable, not lost.
    expect(
      within(row)
        .getByText(/≥\s*\$14\.40/)
        .closest('[title]')
        ?.getAttribute('title'),
    ).toMatch(/Lower bound/);
  });

  it('keeps the Included* qualifier instead of flattening it to a bare amount', async () => {
    show('/compare?ids=demo~guardrail~shield,demo~guardrail~pii-filter');
    const row = await costRow();
    expect(within(row).getAllByText('Included*')).toHaveLength(2);
    expect(row).not.toHaveTextContent(/^\$0/);
  });

  it('renders comparison selections from different tiers', async () => {
    // Both ids are accepted by the catalog's compare tray, which is not tier-scoped.
    show('/compare?ids=demo~model~aurora-mini,demo~accelerator~c24');
    expect(await screen.findByRole('link', { name: 'Demo Aurora Mini' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Demo C24 GPU' })).toBeInTheDocument();
    expect(screen.queryAllByText('Empty slot')).toHaveLength(1);
    // The out-of-layer product is labelled with its own layer in the slot picker.
    expect(
      screen.getAllByRole('option', { name: /Demo C24 GPU — .*\(T2 / }).length,
    ).toBeGreaterThan(0);
  });

  it('resolves every accelerator reference in hosting comparisons', async () => {
    show('/compare?ids=demo~hosting_platform~nimbus-cloud,demo~hosting_platform~onprem-rack');
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: /Accelerator/ });
    expect(row).toHaveTextContent('Demo C24 GPU');
    expect(row).toHaveTextContent('Demo C80 GPU');
    expect(row).toHaveTextContent('Demo R48 Accelerator');
    expect(row).not.toHaveTextContent('demo.accelerator.');
    expect(row.querySelector('.is-diff')).not.toBeNull();
  });

  it('resolves data-source reference arrays in knowledge-base comparisons', async () => {
    show('/compare?ids=demo~knowledge_base~policies,demo~knowledge_base~customers');
    const table = await screen.findByRole('table');
    const row = within(table).getByRole('row', { name: /Data source/ });
    expect(row).toHaveTextContent('Demo Policy File Share');
    expect(row).toHaveTextContent('Demo CRM Connector');
    expect(row).not.toHaveTextContent('demo.data_source.');
  });

  it('keeps an explicitly cleared comparison empty', async () => {
    // `ids=` is the explicit "cleared" form; a missing `ids` means "first visit" and seeds defaults.
    show('/compare?layer=T1&ids=');
    expect(await screen.findAllByText('Empty slot')).toHaveLength(3);
    expect(screen.queryByRole('link', { name: /Demo Aurora Large/ })).toBeNull();
    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toHaveValue('');
    }
  });

  it('does not refill the slots after the last one is cleared', async () => {
    show('/compare?ids=demo~model~aurora-large');
    expect(await screen.findByRole('link', { name: 'Demo Aurora Large' })).toBeInTheDocument();

    // "Choose a component…" is the empty option: clearing the last populated slot must persist.
    const selects = screen.getAllByRole('combobox');
    await userEvent.selectOptions(selects[0]!, '');

    expect(screen.getByTestId('url')).toHaveTextContent('ids=');
    expect(screen.getAllByText('Empty slot')).toHaveLength(3);
    // The old behaviour deleted `ids`, so the defaults were seeded again after the clear.
    expect(screen.queryByRole('link', { name: 'Demo Aurora Large' })).toBeNull();
  });
});
