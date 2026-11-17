/* Synthetic UI combinations exercise independent catalog and pricebook provenance. */
import { readFileSync } from 'node:fs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { assertContract, type CatalogSnapshot, type Pricebook } from '../../src/contracts';
import { DEMO_CATALOG } from '../../src/data/fixture/catalog';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import { PartList } from '../../src/features/catalog/PartList';
import BuildSummaryPage from '../../src/pages/BuildSummaryPage';
import { apiChat, NOW } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

const pilot = assertContract(
  'CatalogSnapshot',
  JSON.parse(
    readFileSync('tests/fixtures/static-mirror/v1/catalog/snapshots/catalog.pilot.open-1', 'utf8'),
  ),
);
const mixed: CatalogSnapshot = {
  ...DEMO_CATALOG,
  items: [...DEMO_CATALOG.items, ...pilot.items],
};
const configured: Pricebook = { ...DEMO_PRICEBOOK, id: 'prices.configured.test' };

function show(path: string, book = DEMO_PRICEBOOK, summary = false) {
  const build = apiChat();
  build.locks.pricebook_id = book.id;
  vi.mocked(useBuilder).mockReturnValue({
    draft: createDraft(build),
    ready: true,
    catalogById: new Map(mixed.items.map((item) => [item.id, item])),
    lastChange: null,
    saveState: { status: 'saved' },
    apply: vi.fn(),
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
  const providers = createFixtureProviders({ catalog: mixed, pricebook: book, now: () => NOW });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter initialEntries={[path]}>
          {summary ? <BuildSummaryPage /> : <PartList mode="kind" kind="model" />}
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
}

describe('displayed catalog records and locked prices have separate labels', () => {
  it('does not call filtered sourced rows synthetic because hidden fixture rows exist', async () => {
    const view = show('/catalog/model?show=all&q=Qwen');
    await screen.findByRole('row', { name: /Qwen2.5-0.5B-Instruct/ });
    const caption = view.container.querySelector('caption')!;
    expect(caption).toHaveTextContent('configured catalog');
    expect(caption).not.toHaveTextContent('synthetic');
    // This same view still uses the independent fixture pricebook.
    await waitFor(() =>
      expect(screen.getByText(/Estimates are synthetic demo data/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Synthetic demo estimates/)).toBeInTheDocument();
  });

  it('identifies mixed displayed records without labelling the entire set synthetic', async () => {
    const view = show('/catalog/model?show=all', configured);
    await screen.findByRole('row', { name: /Qwen2.5-0.5B-Instruct/ });
    expect(view.container.querySelector('caption')).toHaveTextContent(
      'mixed catalog; synthetic records are labelled',
    );
    expect(
      within(screen.getByRole('row', { name: /Demo Aurora Large/ })).getByText('Synthetic'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Qwen2.5-0.5B-Instruct/ })).queryByText('Synthetic'),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/Estimates use the configured pricebook/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Synthetic demo estimates/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTitle(/configured pricebook estimate, not a quote/)).toBeInTheDocument(),
    );
    expect(screen.queryByTitle(/synthetic estimate, not a quote/)).not.toBeInTheDocument();
  });

  it.each([
    [DEMO_PRICEBOOK, 'Synthetic demo prices — not a quote'],
    [configured, 'Estimated prices from the locked pricebook — not a quote'],
  ])('describes the summary pricebook independently of catalog tags', async (book, caption) => {
    show('/builder/summary', book, true);
    await screen.findByRole('table', { name: caption });
    const other =
      book === DEMO_PRICEBOOK
        ? 'Estimated prices from the locked pricebook — not a quote'
        : 'Synthetic demo prices — not a quote';
    expect(screen.queryByRole('table', { name: other })).not.toBeInTheDocument();
  });
});
