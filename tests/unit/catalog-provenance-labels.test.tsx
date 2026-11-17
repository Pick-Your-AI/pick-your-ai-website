/* The table caption labels homogeneous results; mixed results also identify synthetic rows. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { DEMO_CATALOG } from '../../src/data/fixture/catalog';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import { PartList } from '../../src/features/catalog/PartList';
import { BY_ID, NOW, buildWith, item } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

function show(mixed = false) {
  const build = buildWith([]);
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
  // This untagged record is only a synthetic test scenario, not a sourced product claim.
  const configuredId = item('model', 'aurora-large').id;
  const catalog = {
    ...DEMO_CATALOG,
    items: DEMO_CATALOG.items.map((record) =>
      mixed && record.id === configuredId
        ? { ...record, tags: record.tags?.filter((tag) => tag !== 'synthetic') }
        : record,
    ),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const providers = createFixtureProviders({ catalog, now: () => NOW });
  return render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter initialEntries={['/catalog/model?show=all']}>
          <PartList mode="kind" kind="model" />
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
}

describe('catalog result provenance labels', () => {
  it('labels all-synthetic results in the caption without redundant row badges', async () => {
    show();
    const table = await screen.findByRole('table', {
      name: '4 components · AI Model · synthetic demo catalog',
    });
    expect(within(table).getAllByRole('rowheader')).toHaveLength(4);
    expect(within(table).queryByText('Synthetic', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(/Synthetic demo estimates/)).toBeInTheDocument();
  });

  it('labels synthetic rows in mixed results and scopes the caption after filtering', async () => {
    show(true);
    const table = await screen.findByRole('table', {
      name: '4 components · AI Model · mixed catalog; synthetic records are labelled',
    });
    expect(within(table).getAllByText('Synthetic', { exact: true })).toHaveLength(3);
    const configured = within(table).getByRole('row', { name: /Demo Aurora Large/ });
    expect(within(configured).queryByText('Synthetic', { exact: true })).not.toBeInTheDocument();
    const synthetic = within(table).getByRole('row', { name: /Demo Aurora Mini/ });
    expect(within(synthetic).getByText('Synthetic', { exact: true })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Aurora Large' } });
    await waitFor(() =>
      expect(table).toHaveAccessibleName('1 component · AI Model · configured catalog'),
    );
    expect(within(table).queryByText('Synthetic', { exact: true })).not.toBeInTheDocument();
    // Filtering the catalog never changes the independently locked synthetic pricebook label.
    expect(screen.getByText(/Synthetic demo estimates/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Aurora Mini' } });
    await waitFor(() =>
      expect(table).toHaveAccessibleName('1 component · AI Model · synthetic demo catalog'),
    );
    expect(within(table).queryByText('Synthetic', { exact: true })).not.toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Demo Aurora Mini/ })).toBeInTheDocument();
  });
});
