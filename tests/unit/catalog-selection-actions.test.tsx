/*
 * Catalog selection actions (review 5591558191, findings 1 and 2).
 *
 * The parts register must not re-apply a component that is already in the stack — doing so ran
 * `replaceSelection` over the existing selection and silently reset every configured setting — and
 * a `cardinality: many` kind must be able to take a second selection through the explicit `?add=1`
 * path the builder links to.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot, ComponentKind } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { addOrReplace, createDraft, setEnabled, updateSettings } from '../../src/domain/build';
import { PartList } from '../../src/features/catalog/PartList';
import { BY_ID, NOW, buildWith, apiChat, item } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

function show(
  build: BuildSnapshot,
  path: string,
  kind: ComponentKind = 'tool',
  configure?: (providers: ReturnType<typeof createFixtureProviders>) => void,
) {
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
  const providers = createFixtureProviders({ now: () => NOW });
  configure?.(providers);
  const compatibleOptions = vi.spyOn(providers.compatibility, 'compatibleOptions');
  const view = render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter initialEntries={[path]}>
          <PartList mode="kind" kind={kind} />
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, apply, compatibleOptions };
}

const withTool = () => buildWith([...apiChatPicks(), ['tool', 'search']]);

function apiChatPicks(): [string, string][] {
  return [
    ['workload', 'support-chat'],
    ['deployment_mode', 'api'],
    ['model_provider', 'aurora'],
    ['model', 'aurora-large'],
    ['context_policy', 'standard-8k'],
  ];
}

describe('catalog selection actions', () => {
  it('preserves a disabled model and its configured settings when revisited', async () => {
    const build = setEnabled(
      updateSettings(apiChat(), 'sel_model', { temperature: 0.37 }),
      'sel_model',
      false,
    );
    const { apply } = show(build, '/catalog/model?show=all', 'model');
    const row = await screen.findByRole('row', { name: /Demo Aurora Large/ });
    const button = within(row).getByRole('button', { name: /In stack/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(apply).not.toHaveBeenCalled();
    expect(build.selections.find((s) => s.id === 'sel_model')).toMatchObject({
      enabled: false,
      settings: { temperature: 0.37 },
    });
  });

  it('does not re-apply a component that is already in the stack', async () => {
    // A configured tool: re-adding it would have reset these settings to their defaults.
    const build = updateSettings(withTool(), 'sel_tool', {
      enabled: true,
      permissions: 'read-only',
    });
    const { apply } = show(build, '/catalog/tool?show=all');

    const button = await screen.findByRole('button', { name: /In stack/ });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toContain('already selected');
    fireEvent.click(button);
    expect(apply).not.toHaveBeenCalled();
  });

  it('adds an additional selection of a many-kind on ?add=1 without replacing the primary', async () => {
    const build = updateSettings(withTool(), 'sel_tool', { permissions: 'read-only' });
    const { apply } = show(build, '/catalog/tool?show=all&add=1');

    expect(await screen.findByText(/Adding an additional component/i)).toBeInTheDocument();
    const row = await screen.findByRole('row', { name: /Demo Ticket Writer/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Add' }));

    expect(apply).toHaveBeenCalledTimes(1);
    const [change, summary] = apply.mock.calls[0] as [(b: BuildSnapshot) => BuildSnapshot, string];
    expect(summary).toMatch(/additional/i);
    const next = change(build);
    const tools = next.selections.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(2);
    // The existing selection and its settings survive; the new one takes a distinct role.
    expect(tools[0]!.catalog_item_id).toBe('demo.tool.search');
    expect(tools[0]!.role).toBe('primary');
    expect(tools[0]!.settings).toEqual({ enabled: true, permissions: 'read-only' });
    expect(tools[1]!.catalog_item_id).toBe('demo.tool.ticket-writer');
    expect(tools[1]!.role).toBe('secondary');
  });

  it('allows another copy of the selected item with independent settings', async () => {
    const build = updateSettings(withTool(), 'sel_tool', { permissions: 'read-only' });
    const { apply } = show(build, '/catalog/tool?show=all&add=1');
    const row = await screen.findByRole('row', { name: /Demo Web Search/ });
    // The button must name the operation: an enabled "In stack" label contradicts itself.
    const button = within(row).getByRole('button', { name: 'Add' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    const [change] = apply.mock.calls[0] as [(b: BuildSnapshot) => BuildSnapshot];
    const selections = change(build).selections.filter((s) => s.kind === 'tool');
    expect(selections).toHaveLength(2);
    expect(selections[0]).toEqual(build.selections.find((s) => s.kind === 'tool'));
    expect(selections[1]!.catalog_item_id).toBe(selections[0]!.catalog_item_id);
    expect(selections[1]!.role).toBe('secondary');
  });

  it('evaluates the role of a secondary replacement through the picker', async () => {
    const build = addOrReplace(apiChat(), item('model_provider', 'openlab'), BY_ID, {
      additional: true,
    });
    const secondary = build.selections.find(
      (s) => s.kind === 'model_provider' && s.role === 'secondary',
    )!;
    const { compatibleOptions } = show(
      build,
      `/catalog/model-provider?replace=${secondary.id}`,
      'model_provider',
    );
    await screen.findByRole('row', { name: /Demo Open Weights Lab/ });
    expect(compatibleOptions).toHaveBeenCalledWith(build, 'model_provider', 'secondary');
  });

  it('keeps the no-op guard for single-cardinality kinds even with add=1', async () => {
    show(apiChat(), '/catalog/workload?show=all&add=1', 'workload');
    const row = await screen.findByRole('row', { name: /Demo Customer Support Chat/ });
    expect(within(row).getByRole('button', { name: /In stack/ })).toBeDisabled();
  });

  it('keeps replacing the primary selection when ?add=1 is absent', async () => {
    const build = withTool();
    const { apply } = show(build, '/catalog/tool?show=all');

    const row = await screen.findByRole('row', { name: /Demo Ticket Writer/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Add' }));

    expect(apply).toHaveBeenCalledTimes(1);
    const [change] = apply.mock.calls[0] as [(b: BuildSnapshot) => BuildSnapshot];
    const next = change(build);
    const tools = next.selections.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]!.catalog_item_id).toBe('demo.tool.ticket-writer');
  });
});

it('retains the catalog heading and retries a failed catalog request in place', async () => {
  let failed = true;
  show(apiChat(), '/catalog/model', 'model', (providers) => {
    const original = providers.catalog.getSnapshot.bind(providers.catalog);
    vi.spyOn(providers.catalog, 'getSnapshot').mockImplementation((id) =>
      failed ? Promise.reject(new Error('Catalog unavailable')) : original(id),
    );
  });
  const catalogAlert = await screen.findByRole('alert');
  expect(catalogAlert).toHaveTextContent('Catalog unavailable');
  expect(screen.getByRole('heading', { level: 1, name: 'Choose an AI model' })).toBeInTheDocument();
  failed = false;
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('table')).toBeInTheDocument();
  await waitFor(() => expect(catalogAlert).not.toBeInTheDocument());
  // Compatibility failed independently while the catalog was unavailable. Retry that too.
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.queryByText('Catalog unavailable')).not.toBeInTheDocument());
});
