/*
 * Catalog selection actions (review 5591558191, findings 1 and 2).
 *
 * The parts register must not re-apply a component that is already in the stack — doing so ran
 * `replaceSelection` over the existing selection and silently reset every configured setting — and
 * a `cardinality: many` kind must be able to take a second selection through the explicit `?add=1`
 * path the builder links to.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft, updateSettings } from '../../src/domain/build';
import { PartList } from '../../src/features/catalog/PartList';
import { BY_ID, NOW, buildWith } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

function show(build: BuildSnapshot, path: string) {
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
        <MemoryRouter initialEntries={[path]}>
          <PartList mode="kind" kind="tool" />
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, apply };
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
