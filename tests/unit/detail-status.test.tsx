import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import ComponentDetailPage from '../../src/features/catalog/ComponentDetailPage';
import { BY_ID, NOW, apiChat, item } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

describe('component detail compatibility presentation', () => {
  it.each([
    'pending',
    'missing',
    'unknown',
    'compatible',
    'incompatible',
    'foreign-compatible',
    'foreign-incompatible',
  ] as const)('distinguishes %s from other outcomes', async (state) => {
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
    const providers = createFixtureProviders({ now: () => NOW });
    const options = vi.spyOn(providers.compatibility, 'compatibleOptions').mockImplementation(() =>
      state === 'pending'
        ? new Promise(() => {})
        : Promise.resolve(
            state === 'missing'
              ? []
              : [
                  {
                    catalog_item_id: 'demo.model.aurora-mini',
                    catalog_item_version: state.startsWith('foreign-')
                      ? '0.9.0'
                      : item('model', 'aurora-mini').version,
                    verdict:
                      state === 'foreign-compatible'
                        ? 'compatible'
                        : state === 'foreign-incompatible'
                          ? 'incompatible'
                          : state,
                    rule_ids: [],
                  },
                ],
          ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter initialEntries={['/catalog/model/demo~model~aurora-mini']}>
            <ToastProvider>
              <Routes>
                <Route path="/catalog/:kindSlug/:itemSlug" element={<ComponentDetailPage />} />
              </Routes>
            </ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    const text =
      state === 'compatible'
        ? 'No conflicts in demo rules'
        : state === 'incompatible'
          ? '1 demo conflict to review'
          : 'Unknown in demo rules — not treated as compatible';
    await waitFor(() => expect(options).toHaveBeenCalled());
    if (state !== 'pending') {
      await act(async () => {
        await options.mock.results[0]!.value;
      });
    }
    const status = await screen.findByText(text);
    expect(status.className).toBe(
      state === 'compatible'
        ? 'status-bar'
        : state === 'incompatible'
          ? 'status-bar issue'
          : 'status-bar neutral',
    );
    expect(status.querySelector('use')).toHaveAttribute(
      'href',
      state === 'compatible'
        ? '#i-check-circle'
        : state === 'incompatible'
          ? '#i-x-circle'
          : '#i-alert',
    );
    view.unmount();
    client.clear();
  });
});
