/*
 * Builder row controls and share validation (review 5591558191, findings 3 and 8).
 *
 * A disabled selection is still part of the saved build: it must render with its configure, enable
 * and remove controls rather than disappearing from the table. And "Copy share link" must validate
 * the draft before encoding it, because `encodeShareFragment` throws on a build the contract
 * rejects (fewer than two selections) — outside the previous try block.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { ToastProvider } from '../../src/components/feedback';
import {
  addOrReplace,
  commit,
  createBuild,
  createDraft,
  setEnabled,
  updateSettings,
  type BuildDraft,
} from '../../src/domain/build';
import BuilderPage from '../../src/features/builder/BuilderPage';
import { BY_ID, NOW, apiChat, item } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

function show(
  build: BuildSnapshot,
  draft: BuildDraft = createDraft(build),
  saveState: ReturnType<typeof useBuilder>['saveState'] = { status: 'saved' },
  providers = createFixtureProviders({ now: () => NOW }),
) {
  const apply = vi.fn();
  const restore = vi.fn();
  vi.mocked(useBuilder).mockReturnValue({
    draft,
    ready: true,
    catalogById: BY_ID,
    lastChange: null,
    saveState,
    apply,
    startNew: vi.fn(),
    open: vi.fn(),
    restore,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter>
          <ToastProvider>
            <BuilderPage />
          </ToastProvider>
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, apply, restore };
}

describe('builder selection controls', () => {
  it('shows pricing failures and recovers through the retry control', async () => {
    const providers = createFixtureProviders({ now: () => NOW });
    const estimate = providers.pricing.estimate.bind(providers.pricing);
    let unavailable = true;
    const pricing = vi.spyOn(providers.pricing, 'estimate').mockImplementation((build) => {
      if (unavailable) return Promise.reject(new Error('Pricebook request failed.'));
      return estimate(build);
    });
    show(apiChat(), undefined, undefined, providers);

    const message = await screen.findByText('Pricebook request failed.', {}, { timeout: 5000 });
    const panel = message.closest('[role="alert"]') as HTMLElement;
    expect(panel).toHaveTextContent('Pricing unavailable');
    const attempts = pricing.mock.calls.length;
    unavailable = false;
    await userEvent.click(within(panel).getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(pricing.mock.calls.length).toBeGreaterThan(attempts));
    await waitFor(() => expect(screen.queryByText('Pricing unavailable')).not.toBeInTheDocument());
    expect(screen.queryByText(/nothing priced yet/i)).not.toBeInTheDocument();
  });

  it.each([
    'Browser storage is unavailable.',
    'This build changed in another tab. Reload it before saving.',
  ])('announces and displays the save failure: %s', async (message) => {
    const build = apiChat();
    show(build, createDraft(build), { status: 'error', message });
    const status = await screen.findByText(`Not saved: ${message}`);
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toBeVisible();
  });

  it('keeps a disabled selection visible and re-enableable', async () => {
    const build = setEnabled(apiChat(), 'sel_model', false);
    const { apply } = show(build);

    const row = await screen.findByRole('row', { name: /Demo Aurora Large/ });
    expect(row).toHaveClass('is-disabled');
    expect(row).toHaveTextContent('Excluded');
    expect(row).not.toHaveTextContent('$324');
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

  it('prices repeated storage rows using each selection settings', async () => {
    const storage = item('storage', 'object');
    let build = addOrReplace(apiChat(), storage, BY_ID);
    build = updateSettings(build, 'sel_storage', { provisioned_gb: 10 });
    build = addOrReplace(build, storage, BY_ID, { additional: true });
    const second = build.selections.find((s) => s.kind === 'storage' && s.role === 'secondary')!;
    build = updateSettings(build, second.id, { provisioned_gb: 100 });
    show(build);
    const rows = await screen.findAllByRole('row', { name: /Demo Object Storage/ });
    // The all-parts view and layer view each render the two selections.
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.textContent?.includes('$0.20'))).toHaveLength(2);
    expect(rows.filter((row) => row.textContent?.includes('$2'))).toHaveLength(2);
  });

  it('restores retained history and withholds rollback for unavailable revisions', async () => {
    const original = apiChat();
    const draft = commit(
      createDraft(original),
      (build) => ({ ...build, name: 'Changed' }),
      'Renamed',
      [],
    );
    draft.changes.unshift({ revision: 0, summary: 'Pruned revision', at: NOW, changedKinds: [] });
    const { restore } = show(draft.build, draft);
    await userEvent.click(await screen.findByText(/Revision history/));
    const button = screen.getByRole('button', { name: 'Restore revision 1 as new revision' });
    await userEvent.click(button);
    expect(restore).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('button', { name: 'Restore revision 0 as new revision' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore revision 2 as new revision' })).toBeNull();
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
