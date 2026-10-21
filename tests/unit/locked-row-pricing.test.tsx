import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { createDraft } from '../../src/domain/build';
import BuilderPage from '../../src/features/builder/BuilderPage';
import ComponentDetailPage from '../../src/features/catalog/ComponentDetailPage';
import { PartList } from '../../src/features/catalog/PartList';
import ComparePage from '../../src/pages/ComparePage';
import { BY_ID, NOW, apiChat } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

describe('locked pricebook on component surfaces', () => {
  it.each([
    '/builder',
    '/catalog/model?show=all',
    '/catalog/model/demo~model~aurora-large',
    '/compare?ids=demo~model~aurora-large',
  ])('fetches the build lock on %s and withholds unavailable rates', async (path) => {
    const original = apiChat();
    const build = { ...original, locks: { ...original.locks, pricebook_id: 'pricebook.custom' } };
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
    const providers = createFixtureProviders({ now: () => NOW });
    const getPricebook = vi.spyOn(providers.pricing, 'getPricebook');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter initialEntries={[path]}>
            <ToastProvider>
              <Routes>
                <Route path="/builder" element={<BuilderPage />} />
                <Route path="/catalog/model" element={<PartList mode="kind" kind="model" />} />
                <Route path="/catalog/:kindSlug/:itemSlug" element={<ComponentDetailPage />} />
                <Route path="/compare" element={<ComparePage />} />
              </Routes>
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findAllByText('Demo Aurora Large');
    await waitFor(() => expect(getPricebook).toHaveBeenCalledWith(build.locks.pricebook_id));
    expect(getPricebook.mock.calls.every(([id]) => id === build.locks.pricebook_id)).toBe(true);
    expect(screen.queryByText('$324')).not.toBeInTheDocument();

    // When the locked book arrives, the same screen must use its rates rather than the default.
    const custom = {
      ...DEMO_PRICEBOOK,
      id: build.locks.pricebook_id,
      rates: DEMO_PRICEBOOK.rates.map((rate) => ({
        ...rate,
        unit_price: { ...rate.unit_price, amount: String(Number(rate.unit_price.amount) * 2) },
      })),
    };
    client.setQueryData(['pricebook', build.locks.pricebook_id], custom);
    await screen.findAllByText('$648');
  });
});
