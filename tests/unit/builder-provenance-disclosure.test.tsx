/* Offline synthetic scenarios: changing record tags/identities does not establish real sourcing. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { CatalogSnapshot } from '../../src/contracts';
import { DEMO_CATALOG } from '../../src/data/fixture/catalog';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { createDraft } from '../../src/domain/build';
import BuilderPage from '../../src/features/builder/BuilderPage';
import { BuilderLoading } from '../../src/features/builder/BuilderLoading';
import { buildMarkdown } from '../../src/features/builder/BuildToolbar';
import { NOW, apiChat } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));
const configured = { ...DEMO_PRICEBOOK, id: 'prices.test.configured' };
const sourced: CatalogSnapshot = {
  ...DEMO_CATALOG,
  items: DEMO_CATALOG.items.map((item) => ({
    ...item,
    tags: item.tags?.filter((tag) => tag !== 'synthetic'),
    provenance: [
      {
        checked_at: NOW,
        verification_status: 'unverified',
        source_uri: 'https://example.test/source',
      },
    ],
  })),
};
const mixed: CatalogSnapshot = {
  ...sourced,
  items: sourced.items.map((item) =>
    item.kind === 'model' ? DEMO_CATALOG.items.find((demo) => demo.id === item.id)! : item,
  ),
};

function show(catalog = DEMO_CATALOG, book = DEMO_PRICEBOOK, pending = false, omitLock = false) {
  const build = apiChat();
  build.locks.pricebook_id = book.id;
  if (omitLock) delete build.locks.pricebook_id;
  vi.mocked(useBuilder).mockReturnValue({
    draft: createDraft(build),
    ready: true,
    catalogById: new Map(catalog.items.map((item) => [item.id, item])),
    lastChange: null,
    saveState: { status: 'saved' },
    apply: vi.fn(),
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
  const providers = createFixtureProviders({ catalog, pricebook: book, now: () => NOW });
  // Even HTTP mode cannot establish source provenance; no network is used by these providers.
  providers.mode = 'http';
  if (pending)
    vi.spyOn(providers.pricing, 'getPricebook').mockImplementation(() => new Promise(() => {}));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter>
          <BuilderPage />
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
}

const fixtureDescription =
  'One row per component slot, in dependency order. Prices and compatibility come from synthetic demo data; nothing here is a quote or a vendor specification.';

describe('builder provenance disclosures', () => {
  it('uses neutral wording before provenance is loaded', () => {
    const view = render(
      <MemoryRouter>
        <BuilderLoading />
      </MemoryRouter>,
    );
    expect(screen.getByText(/One row per component slot/)).not.toHaveTextContent('synthetic');
    view.unmount();
  });

  it('preserves the loaded fixture description and price caveats, including in HTTP mode', async () => {
    show();
    await screen.findByText('Not a quote · synthetic demo pricebook');
    expect(screen.getByText(fixtureDescription)).toBeInTheDocument();
    await screen.findByText('/30 days · synthetic estimate');
  });

  it.each([DEMO_CATALOG, sourced])(
    'describes configured rates independently of component tags',
    async (catalog) => {
      show(catalog, configured);
      await screen.findByText('Not a quote · locked pricebook estimate');
      await screen.findByText('/30 days · pricebook estimate');
      expect(screen.queryByText(fixtureDescription)).not.toBeInTheDocument();
      expect(screen.queryByText(/synthetic demo pricebook/)).not.toBeInTheDocument();
      expect(screen.getByText(/One row per component slot/)).toHaveTextContent(
        catalog === DEMO_CATALOG
          ? 'Components are synthetic demo data'
          : 'Component evidence is recorded per item',
      );
    },
  );

  it('keeps synthetic prices explicit with an untagged catalog', async () => {
    show(sourced);
    await screen.findByText('Not a quote · synthetic demo pricebook');
    await screen.findByText('/30 days · synthetic estimate');
    expect(screen.getByText(/One row per component slot/)).not.toHaveTextContent(
      'compatibility come from synthetic',
    );
  });

  it('describes the configured default without claiming the optional pricebook lock exists', async () => {
    show(sourced, configured, false, true);
    await screen.findByText('Not a quote · configured pricebook estimate');
    await screen.findByText('/30 days · pricebook estimate');
    expect(screen.queryByText('Not a quote · locked pricebook estimate')).not.toBeInTheDocument();
    expect(screen.queryByText('Not a quote · pricebook unavailable')).not.toBeInTheDocument();
  });

  it('labels synthetic selections in a mixed catalog without calling every record synthetic', async () => {
    show(mixed, configured);
    await screen.findByText('Not a quote · locked pricebook estimate');
    const model = screen.getByRole('link', { name: 'Demo Aurora Large' }).closest('tr')!;
    expect(within(model).getByText('Synthetic')).toBeInTheDocument();
    const workload = screen
      .getByRole('link', { name: 'Demo Customer Support Chat' })
      .closest('tr')!;
    expect(within(workload).queryByText('Synthetic')).not.toBeInTheDocument();
    expect(screen.getByText(/One row per component slot/)).toHaveTextContent(
      'Synthetic demo records are labelled',
    );
  });

  it('does not guess fixture price provenance while the locked book is unavailable', async () => {
    show(DEMO_CATALOG, DEMO_PRICEBOOK, true);
    await screen.findByRole('heading', { name: 'Compatibility notes' });
    await waitFor(() =>
      expect(screen.getByText('Not a quote · pricebook unavailable')).toBeInTheDocument(),
    );
    expect(screen.queryByText(fixtureDescription)).not.toBeInTheDocument();
    expect(screen.queryByText(/synthetic demo pricebook/)).not.toBeInTheDocument();
  });
});

describe('Markdown keeps record and price provenance separate', () => {
  it.each([DEMO_CATALOG, sourced, mixed])(
    'retains selected record labels and provenance without a blanket synthetic claim',
    (catalog) => {
      const build = apiChat();
      build.locks.pricebook_id = configured.id;
      const markdown = buildMarkdown(build, new Map(catalog.items.map((item) => [item.id, item])));
      expect(markdown).not.toContain('Demo components, prices and results are synthetic');
      expect(markdown).toContain(`Pricebook: ${configured.id}`);
      expect(markdown).toContain('not a quote or independent verification');
      if (catalog !== DEMO_CATALOG) expect(markdown).toContain('https://example.test/source');
      expect(markdown.includes('Demo Aurora Large (Synthetic)')).toBe(catalog !== sourced);
      expect(markdown.includes('Demo Customer Support Chat (Synthetic)')).toBe(
        catalog === DEMO_CATALOG,
      );
      expect(markdown).toContain('Recorded: unverified');
    },
  );

  it('retains explicit fixture prices and handles missing records without inferring provenance', () => {
    const build = apiChat();
    const markdown = buildMarkdown(build, new Map());
    expect(markdown).toContain('Synthetic demo pricebook');
    expect(markdown).toContain('demo.model.aurora-large');
    expect(markdown).not.toContain('demo.model.aurora-large (Synthetic)');
  });
});

describe('Markdown resolves the selected record and renders evidence as text', () => {
  it.each(['id', 'version', 'kind'] as const)(
    'withholds another record’s claims when its %s differs from the selection',
    (field) => {
      const build = apiChat();
      const selection = build.selections.find((entry) => entry.kind === 'model')!;
      build.selections = [selection];
      const original = DEMO_CATALOG.items.find((item) => item.id === selection.catalog_item_id)!;
      const foreign = {
        ...original,
        [field]: field === 'kind' ? 'workload' : `${original[field]}.other`,
        name: 'Other record name',
        provenance: [
          {
            checked_at: NOW,
            verification_status: 'verified' as const,
            source_uri: 'https://example.test/other-version',
          },
        ],
      };
      const markdown = buildMarkdown(build, new Map([[selection.catalog_item_id, foreign]]));
      expect(markdown).toContain(selection.catalog_item_id);
      expect(markdown).toContain('Record unavailable for selected version or kind');
      expect(markdown).not.toContain('Other record name');
      expect(markdown).not.toContain('(Synthetic)');
      expect(markdown).not.toContain('Recorded: verified');
      expect(markdown).not.toContain('https://example.test/other-version');
    },
  );

  it('keeps delimiters, line breaks and markup in names and source text inside their table cells', () => {
    const build = apiChat();
    const selection = build.selections.find((entry) => entry.kind === 'model')!;
    build.selections = [selection];
    const original = DEMO_CATALOG.items.find((item) => item.id === selection.catalog_item_id)!;
    const record = {
      ...original,
      name: '<b>Literal</b> | [label](https://example.test)\n**new row**',
      provenance: [
        {
          checked_at: NOW,
          verification_status: 'unverified' as const,
          source_uri:
            'https://example.test/source?x=<b>&y=a|b\r\n![image](https://example.test/image)',
        },
      ],
    };
    const markdown = buildMarkdown(build, new Map([[record.id, record]]));
    const rows = markdown.split('\n').filter((line) => line.startsWith('|'));
    expect(rows).toHaveLength(3);
    expect(rows[2]).toContain('&lt;b&gt;Literal&lt;/b&gt;');
    expect(rows[2]).toContain(String.raw`\| \[label\]\(https://example.test\) \*\*new row\*\*`);
    expect(rows[2]).toContain(
      String.raw`https://example.test/source?x=&lt;b&gt;&amp;y=a\|b \!\[image\]\(https://example.test/image\)`,
    );
    // Five cells require six unescaped delimiters, even when record text contains pipes.
    expect(rows[2]!.match(/(?<!\\)\|/g)).toHaveLength(6);
    expect(markdown).not.toContain('<b>');
    expect(markdown).not.toContain('![image]');
  });
});
