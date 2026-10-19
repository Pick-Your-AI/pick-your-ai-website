import { describe, expect, it, vi } from 'vitest';
import {
  BASELINE_GRAPH,
  BASELINE_RULESET,
  validateContract,
  validatorsReady,
  type ContractTypes,
} from '../../src/contracts';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { createHttpProviders, type HttpProviderConfig } from '../../src/data/http/providers';
import type { DataProviders } from '../../src/data/types';
import { CATALOG } from './scenarios';

const baseUrl = 'https://api.test/v1';
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const config = {
  baseUrl,
  catalogSnapshotId: CATALOG.id,
  pricebookId: DEMO_PRICEBOOK.id,
};

type ArtifactContract = 'CatalogSnapshot' | 'DependencyGraph' | 'Ruleset' | 'Pricebook';

interface ArtifactRead {
  name: string;
  contract: ArtifactContract;
  value: ContractTypes[ArtifactContract];
  path: string;
  options?: Partial<HttpProviderConfig>;
  read: (providers: DataProviders) => Promise<unknown>;
}

const reads: ArtifactRead[] = [
  {
    name: 'default catalog',
    contract: 'CatalogSnapshot',
    value: CATALOG,
    path: `/catalog/snapshots/${CATALOG.id}`,
    read: (p) => p.catalog.getSnapshot(),
  },
  {
    name: 'explicit catalog',
    contract: 'CatalogSnapshot',
    value: { ...CATALOG, id: 'catalog.requested' },
    path: '/catalog/snapshots/catalog.requested',
    read: (p) => p.catalog.getSnapshot('catalog.requested'),
  },
  {
    name: 'baseline dependency graph',
    contract: 'DependencyGraph',
    value: BASELINE_GRAPH,
    path: `/dependencies/${BASELINE_GRAPH.id}`,
    read: (p) => p.catalog.getDependencyGraph(),
  },
  {
    name: 'configured dependency graph',
    contract: 'DependencyGraph',
    value: { ...BASELINE_GRAPH, id: 'graph:requested' },
    path: '/dependencies/graph%3Arequested',
    options: { dependencyGraphId: 'graph:requested' },
    read: (p) => p.catalog.getDependencyGraph(),
  },
  {
    name: 'baseline ruleset',
    contract: 'Ruleset',
    value: BASELINE_RULESET,
    path: `/rulesets/${BASELINE_RULESET.id}?version=${BASELINE_RULESET.version}`,
    read: (p) => p.catalog.getRuleset(),
  },
  {
    name: 'configured ruleset',
    contract: 'Ruleset',
    value: { ...BASELINE_RULESET, id: 'ruleset.requested', version: '2.3.4-preview.1' },
    path: '/rulesets/ruleset.requested?version=2.3.4-preview.1',
    options: { rulesetId: 'ruleset.requested', rulesetVersion: '2.3.4-preview.1' },
    read: (p) => p.catalog.getRuleset(),
  },
  {
    name: 'configured pricebook',
    contract: 'Pricebook',
    value: DEMO_PRICEBOOK,
    path: `/pricebooks/${DEMO_PRICEBOOK.id}`,
    read: (p) => p.pricing.getPricebook(),
  },
  {
    name: 'explicit pricebook',
    contract: 'Pricebook',
    value: { ...DEMO_PRICEBOOK, id: 'pricebook.requested' },
    path: '/pricebooks/pricebook.requested',
    read: (p) => p.pricing.getPricebook('pricebook.requested'),
  },
];

describe('HTTP artifact response identity', () => {
  it.each(reads)('rejects a schema-valid foreign ID for $name', async (artifact) => {
    const foreign = { ...artifact.value, id: 'artifact.foreign' };
    await validatorsReady;
    expect(validateContract(artifact.contract, foreign).ok).toBe(true);
    const fetch = vi.fn(async () => json(foreign));
    const p = createHttpProviders({ ...config, ...artifact.options, fetch });

    await expect(artifact.read(p)).rejects.toMatchObject({
      name: 'DataError',
      kind: 'malformed',
      contract: artifact.contract,
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `${baseUrl}${artifact.path}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each(reads)('accepts the exact requested identity for $name', async (artifact) => {
    const fetch = vi.fn(async () => json(artifact.value));
    const p = createHttpProviders({ ...config, ...artifact.options, fetch });

    await expect(artifact.read(p)).resolves.toEqual(artifact.value);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `${baseUrl}${artifact.path}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each(reads.filter((artifact) => artifact.contract === 'Ruleset'))(
    'rejects the same ruleset ID with a different version for $name',
    async (artifact) => {
      const stale = { ...artifact.value, version: '99.0.0' };
      await validatorsReady;
      expect(validateContract('Ruleset', stale).ok).toBe(true);
      const p = createHttpProviders({
        ...config,
        ...artifact.options,
        fetch: async () => json(stale),
      });

      await expect(artifact.read(p)).rejects.toMatchObject({
        name: 'DataError',
        kind: 'malformed',
        contract: 'Ruleset',
      });
    },
  );

  it('evicts a foreign default snapshot, retries, and caches only the accepted snapshot', async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => json({ ...CATALOG, id: 'catalog.foreign' }))
      .mockImplementationOnce(async () => json(CATALOG));
    const p = createHttpProviders({ ...config, fetch });
    const snapshot = p.catalog.getSnapshot();
    const items = p.catalog.listItems();

    await Promise.all([
      expect(snapshot).rejects.toMatchObject({ kind: 'malformed', contract: 'CatalogSnapshot' }),
      expect(items).rejects.toMatchObject({ kind: 'malformed', contract: 'CatalogSnapshot' }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(p.catalog.getSnapshot()).resolves.toEqual(CATALOG);
    await expect(p.catalog.getSnapshot(CATALOG.id)).resolves.toEqual(CATALOG);
    await expect(p.catalog.listItems()).resolves.toEqual(CATALOG.items);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps an accepted default snapshot when an explicit snapshot response is rejected', async () => {
    const requested = { ...CATALOG, id: 'catalog.requested' };
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => json(CATALOG))
      .mockImplementationOnce(async () => json(CATALOG))
      .mockImplementationOnce(async () => json(requested));
    const p = createHttpProviders({ ...config, fetch });

    await expect(p.catalog.getSnapshot()).resolves.toEqual(CATALOG);
    await expect(p.catalog.getSnapshot(requested.id)).rejects.toMatchObject({
      kind: 'malformed',
      contract: 'CatalogSnapshot',
    });
    await expect(p.catalog.getSnapshot(requested.id)).resolves.toEqual(requested);
    await expect(p.catalog.getSnapshot()).resolves.toEqual(CATALOG);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
