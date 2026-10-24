import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { addOrReplace, createDraft } from '../../src/domain/build';
import ComparePage from '../../src/pages/ComparePage';
import ComponentDetailPage from '../../src/features/catalog/ComponentDetailPage';
import { BY_ID, NOW, apiChat, item } from './scenarios';
vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));
const { useBuilder } = await import('../../src/app/builder-context');
afterEach(cleanup);
for (const detail of [false, true]) {
 it(`reproduces stale compatible verdict in ${detail ? 'detail' : 'compare'}`, async () => {
  const build = apiChat();
  let current = createDraft(build);
  let release: (v: any) => void = () => {};
  const pending = new Promise<any>((r) => { release = r; });
  const providers = createFixtureProviders({ now: () => NOW });
  const original = providers.compatibility.compatibleOptions.bind(providers.compatibility);
  providers.compatibility.compatibleOptions = vi.fn(async (b, kind, role) => {
    const result = await original(b, kind, role);
    if (b.revision !== build.revision) await pending;
    return result;
  });
  vi.mocked(useBuilder).mockImplementation(() => ({draft:current,ready:true,catalogById:BY_ID,lastChange:null,saveState:{status:'saved'},apply:vi.fn(),startNew:vi.fn(),open:vi.fn(),restore:vi.fn()}));
  const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const tree = () => <QueryClientProvider client={client}><DataContext.Provider value={providers}><MemoryRouter initialEntries={[detail ? '/catalog/model/demo~model~aurora-large' : '/compare?ids=demo~model~aurora-large']}><Routes><Route path='/compare' element={<ComparePage/>}/><Route path='/catalog/:kindSlug/:itemSlug' element={<ComponentDetailPage/>}/></Routes></MemoryRouter></DataContext.Provider></QueryClientProvider>;
  const view = render(tree());
  const initial = detail ? await screen.findByText('No conflicts in demo rules') : await screen.findByText('Compatible');
  expect(initial).toBeInTheDocument();
  current = createDraft({...addOrReplace(build, item('deployment_mode', 'self-hosted'), BY_ID), revision:build.revision+1});
  view.rerender(tree());
  await act(async () => {await new Promise(r => setTimeout(r,25));});
  expect(providers.compatibility.compatibleOptions).toHaveBeenCalledWith(expect.objectContaining({revision:build.revision+1}), 'model', 'primary');
  // The new revision is unresolved, but the previous revision's success is still rendered.
  expect(detail ? screen.getByText('No conflicts in demo rules') : screen.getByText('Compatible')).toBeInTheDocument();
  await act(async () => {release(undefined); await new Promise(r => setTimeout(r,25));});
  expect(detail ? screen.getByText('1 demo conflict to review') : screen.getByText('Incompatible')).toBeInTheDocument();
 });
}

