import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { addOrReplace, createDraft } from '../../src/domain/build';
import ComponentDetailPage from '../../src/features/catalog/ComponentDetailPage';
import ComparePage from '../../src/pages/ComparePage';
import { apiChat, BY_ID, item, NOW } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));
const { useBuilder } = await import('../../src/app/builder-context');

afterEach(cleanup);

for (const detail of [false, true]) {
  it(`withholds stale compatibility while ${detail ? 'detail' : 'compare'} evaluates a new revision`, async () => {
    const build = apiChat();
    let current = createDraft(build);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const providers = createFixtureProviders({ now: () => NOW });
    const original = providers.compatibility.compatibleOptions.bind(providers.compatibility);
    const compatibleOptions = vi
      .spyOn(providers.compatibility, 'compatibleOptions')
      .mockImplementation(async (next, kind, role) => {
        if (next.revision !== build.revision) await pending;
        return original(next, kind, role);
      });
    vi.mocked(useBuilder).mockImplementation(() => ({
      draft: current,
      ready: true,
      catalogById: BY_ID,
      lastChange: null,
      saveState: { status: 'saved' },
      apply: vi.fn(),
      startNew: vi.fn(),
      open: vi.fn(),
      restore: vi.fn(),
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const tree = () => (
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter
            initialEntries={[
              detail
                ? '/catalog/model/demo~model~aurora-large'
                : '/compare?ids=demo~model~aurora-large',
            ]}
          >
            <Routes>
              <Route path="/compare" element={<ComparePage />} />
              <Route path="/catalog/:kindSlug/:itemSlug" element={<ComponentDetailPage />} />
            </Routes>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>
    );
    const view = render(tree());
    const success = detail ? 'No conflicts in demo rules' : 'Compatible';
    expect(await screen.findByText(success)).toBeInTheDocument();

    current = createDraft({
      ...addOrReplace(build, item('deployment_mode', 'self-hosted'), BY_ID),
      revision: build.revision + 1,
    });
    view.rerender(tree());
    await waitFor(() =>
      expect(compatibleOptions).toHaveBeenCalledWith(current.build, 'model', 'primary'),
    );
    expect(screen.queryByText(success)).not.toBeInTheDocument();
    expect(
      screen.getByText(detail ? 'Unknown in demo rules — not treated as compatible' : 'Checking…'),
    ).toBeInTheDocument();

    await act(async () => release());
    expect(
      await screen.findByText(detail ? '1 demo conflict to review' : 'Incompatible'),
    ).toBeInTheDocument();
  });
}
