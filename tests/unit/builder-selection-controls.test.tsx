/*
 * Builder row controls and share validation (review 5591558191, findings 3 and 8).
 *
 * A disabled selection is still part of the saved build: it must render with its configure, enable
 * and remove controls rather than disappearing from the table. And "Copy share link" must validate
 * the draft before encoding it, because `encodeShareFragment` throws on a build the contract
 * rejects (fewer than two selections) — outside the previous try block.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { ToastProvider } from '../../src/components/feedback';
import { createBuild, createDraft, setEnabled } from '../../src/domain/build';
import BuilderPage from '../../src/features/builder/BuilderPage';
import { BY_ID, NOW, apiChat } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

function show(build: BuildSnapshot) {
  const apply = vi.fn();
  vi.mocked(useBuilder).mockReturnValue({
    draft: createDraft(build),
    ready: true,
    catalogById: BY_ID,
    lastChange: null,
    saveState: { status: 'saved' },
    apply,
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={createFixtureProviders({ now: () => NOW })}>
        <MemoryRouter>
          <ToastProvider>
            <BuilderPage />
          </ToastProvider>
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, apply };
}

describe('builder selection controls', () => {
  it('keeps a disabled selection visible and re-enableable', async () => {
    const build = setEnabled(apiChat(), 'sel_model', false);
    const { apply } = show(build);

    const row = await screen.findByRole('row', { name: /Demo Aurora Large/ });
    expect(row).toHaveClass('is-disabled');
    expect(row).toHaveTextContent('Disabled — excluded from checks');

    // Configure and Remove stay reachable, and the toggle offers Enable rather than Disable.
    expect(within(row).getByRole('button', { name: /Configure Demo Aurora Large/ })).toBeEnabled();
    expect(
      within(row).getByRole('button', { name: /Remove Demo Aurora Large from the stack/ }),
    ).toBeEnabled();

    await userEvent.click(within(row).getByRole('button', { name: /Enable Demo Aurora Large/ }));
    expect(apply).toHaveBeenCalledTimes(1);
    const [change, summary] = apply.mock.calls[0] as [(b: BuildSnapshot) => BuildSnapshot, string];
    expect(summary).toMatch(/Enabled/);
    const next = change(build);
    expect(next.selections.find((s) => s.id === 'sel_model')?.enabled).toBe(true);
  });

  it('reports why a draft cannot be shared instead of throwing', async () => {
    // One selection: a schema-valid BuildSnapshot needs two, so export (and therefore the share
    // fragment) is rejected.
    const build = createBuild({
      id: 'build.test.one',
      catalogSnapshotId: 'catalog.demo.1',
      now: NOW,
    });
    const { apply } = show(build);

    await userEvent.click(await screen.findByRole('button', { name: /Copy share link/ }));

    expect(apply).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Add at least 2 components before exporting/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Share link copied/)).toBeNull();
  });
});
