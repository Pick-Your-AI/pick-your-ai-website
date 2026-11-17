import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuilderProvider, useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import { ToastProvider } from '../../src/components/feedback';
import { BASELINE_GRAPH, BASELINE_RULESET, validateContract } from '../../src/contracts';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { createDraft } from '../../src/domain/build';
import { encodeShareFragment, exportBuild } from '../../src/domain/share';
import MyBuildsPage from '../../src/pages/MyBuildsPage';
import SharedBuildPage from '../../src/pages/SharedBuildPage';
import { apiChat, CATALOG, NOW } from './scenarios';

const CONFIGURED_PRICEBOOK = 'prices.test.current';
const UNAVAILABLE_MODEL = 'model.test.retired';

/** Synthetic, schema-valid snapshot whose immutable artifacts this deployment cannot resolve. */
function foreignBuild(): BuildSnapshot {
  const build = apiChat();
  return {
    ...build,
    id: 'build.test.imported',
    name: 'Synthetic older build',
    revision: 8,
    lifecycle: 'ready',
    owner_ref: 'synthetic.original-owner',
    locks: {
      catalog_snapshot_id: 'catalog.test.older',
      ruleset_id: 'ruleset.test.older',
      ruleset_version: '0.8.0',
      dependency_graph_id: 'graph.test.older',
      dependency_graph_revision: 3,
      pricebook_id: 'prices.test.older',
    },
    selections: build.selections.map((selection) =>
      selection.kind === 'model'
        ? { ...selection, catalog_item_id: UNAVAILABLE_MODEL, catalog_item_version: '0.4.0' }
        : selection,
    ),
    links: [
      {
        id: 'link.test.unavailable-model',
        from_selection_id: 'sel_model',
        to_selection_id: 'sel_model_provider',
        relation: 'provided_by',
        required: true,
      },
      {
        id: 'link.test.present-items',
        from_selection_id: 'sel_workload',
        to_selection_id: 'sel_deployment_mode',
        relation: 'uses',
      },
    ],
  };
}

function freezeDeep(value: object) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freezeDeep(child);
  }
  Object.freeze(value);
}

async function harness(page?: ReactNode, path = '/builds', initial?: BuildSnapshot) {
  const providers = createFixtureProviders({
    now: () => NOW,
    pricebook: { ...DEMO_PRICEBOOK, id: CONFIGURED_PRICEBOOK },
  });
  providers.catalog.defaultPricebookId = CONFIGURED_PRICEBOOK;
  if (initial) {
    await providers.builds.save(createDraft(initial), null);
    localStorage.setItem('pyai.currentBuildId', initial.id);
  }
  const save = vi.spyOn(providers.builds, 'save');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let api!: ReturnType<typeof useBuilder>;
  function Probe() {
    api = useBuilder();
    return null;
  }
  const view = render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <BuilderProvider>
          <MemoryRouter initialEntries={[path]}>
            <ToastProvider>
              <Probe />
              {page}
            </ToastProvider>
          </MemoryRouter>
        </BuilderProvider>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.ready).toBe(true));
  return {
    ...view,
    providers,
    save,
    get api() {
      return api;
    },
  };
}

async function expectPreservedCopy(
  h: Awaited<ReturnType<typeof harness>>,
  original: BuildSnapshot,
  name = original.name,
) {
  await waitFor(() => {
    expect(h.api.draft?.build.name).toBe(name);
    expect(h.api.draft?.build.id).not.toBe(original.id);
    expect(h.api.saveState.status).toBe('saved');
  });
  const copy = h.api.draft!.build;
  expect(copy.revision).toBe(1);
  expect(copy.lifecycle).toBe('draft');
  expect(copy.owner_ref).toBe('local.browser');
  expect.soft(copy.locks).toEqual(original.locks);
  expect.soft(copy.selections).toEqual(original.selections);
  expect.soft(copy.links).toEqual(original.links);
  expect(copy.objectives).toEqual(original.objectives);
  expect(copy.policy).toEqual(original.policy);
  expect(h.api.draft!.revisions).toEqual([copy]);
  const persisted = await h.providers.builds.get(copy.id);
  expect.soft(persisted.build.locks).toEqual(original.locks);
  expect.soft(persisted.build.selections).toEqual(original.selections);
  expect.soft(persisted.build.links).toEqual(original.links);
  expect(h.save).toHaveBeenCalledWith(h.api.draft, null);
  expect(localStorage.getItem('pyai.currentBuildId')).toBe(copy.id);
  // Keeping foreign locks must keep missing artifacts unresolved, not silently substitute defaults.
  const catalogResolution = await h.providers.catalog
    .getSnapshot(copy.locks.catalog_snapshot_id)
    .then(
      () => 'resolved',
      (error: unknown) => (error as { kind: string }).kind,
    );
  const pricebookResolution = await h.providers.pricing.getPricebook(copy.locks.pricebook_id).then(
    () => 'resolved',
    (error: unknown) => (error as { kind: string }).kind,
  );
  expect.soft(catalogResolution).toBe('not_found');
  expect.soft(pricebookResolution).toBe('not_found');
}

beforeEach(() => localStorage.clear());

describe('importing and copying immutable build snapshots', () => {
  it('preserves foreign locks, unavailable selections and their links through real startNew and persistence', async () => {
    const original = foreignBuild();
    expect(validateContract('BuildSnapshot', original).ok).toBe(true);
    const before = structuredClone(original);
    freezeDeep(original);
    const h = await harness();
    expect(h.api.catalogById.has(UNAVAILABLE_MODEL)).toBe(false);
    act(() => h.api.startNew(original, 'Synthetic imported copy'));
    await expectPreservedCopy(h, original, 'Synthetic imported copy');
    expect(original).toEqual(before);
  });

  it('preserves a JSON import through My Builds and the real provider', async () => {
    const original = foreignBuild();
    const json = JSON.stringify(exportBuild(original, 'fixture', NOW));
    const h = await harness(<MyBuildsPage />);
    const input = h.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([json], 'synthetic-older-build.json', { type: 'application/json' });
    // jsdom File has no text() in this runtime; supply the browser API used by the real handler.
    Object.defineProperty(file, 'text', { value: async () => json });
    fireEvent.change(input, { target: { files: [file] } });
    await expectPreservedCopy(h, original);
    expect(JSON.parse(json).build).toEqual(original);
  });

  it('preserves the working build when My Builds saves a copy', async () => {
    const original = foreignBuild();
    const before = structuredClone(original);
    const h = await harness(<MyBuildsPage />, '/builds', original);
    await userEvent.click(screen.getByRole('button', { name: 'Save a copy' }));
    await expectPreservedCopy(h, original, `${original.name} (copy)`);
    expect((await h.providers.builds.get(original.id)).build).toEqual(before);
  });

  it('preserves a shared snapshot when importing its real read-only preview', async () => {
    const original = foreignBuild();
    const fragment = encodeShareFragment(original, 'fixture');
    const h = await harness(<SharedBuildPage />, `/shared#${fragment}`);
    expect(await screen.findByText('Not in this catalog')).toBeVisible();
    expect(h.save).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Import to my builds' }));
    await expectPreservedCopy(h, original);
  });

  it('still uses this deployment’s defaults for an ordinary new blank build', async () => {
    const h = await harness();
    act(() => h.api.startNew());
    await waitFor(() => expect(h.api.saveState.status).toBe('saved'));
    expect(h.api.draft!.build.locks).toEqual({
      catalog_snapshot_id: CATALOG.id,
      ruleset_id: BASELINE_RULESET.id,
      ruleset_version: BASELINE_RULESET.version,
      dependency_graph_id: BASELINE_GRAPH.id,
      dependency_graph_revision: BASELINE_GRAPH.revision,
      pricebook_id: CONFIGURED_PRICEBOOK,
    });
    expect(h.api.draft!.build.selections).toEqual([]);
    expect(h.api.draft!.build.links).toEqual([]);
  });
});
