/*
 * Regressions for the four source findings in review 5779787725 / 5781685065 on PR #343.
 *
 * Each case fails on the reviewed head `e26eda2` and passes after the corrections:
 *  1. a brand-new build locked `prices.demo.1` while the static mirror publishes `prices.pilot.1`;
 *  2. static compatibility returned a verdict for a build locked to a different ruleset;
 *  3. the shared banner called a sourced pilot catalog synthetic, and the publisher record carried
 *     a provider-wide Apache-2.0 license inferred from one model;
 *  4. `VITE_API_SURFACE=static` with `VITE_BUILD_STORE=http` was silently downgraded to local storage.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BASELINE_RULESET } from '../../src/contracts';
import { createProviders, DataConfigError } from '../../src/data/config';
import { createHttpProviders } from '../../src/data/http/providers';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import type { DataProviders } from '../../src/data/types';
import { createBuild } from '../../src/domain/build';
import { DemoBanner } from '../../src/components/layout';
import { DataContext } from '../../src/app/data-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/feedback';

const SNAPSHOT = 'catalog.pilot.open-1';
const PRICEBOOK = 'prices.pilot.1';
const API = '/v1';

function staticFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET';
  const path = url.slice(API.length).split('?')[0] ?? '';
  if (method !== 'GET') return Promise.resolve(new Response('{}', { status: 405 }));
  try {
    return Promise.resolve(new Response(readFileSync(join(process.cwd(), 'public', API, path))));
  } catch {
    return Promise.resolve(new Response('{}', { status: 404 }));
  }
}

const prov = (overrides: Partial<Parameters<typeof createHttpProviders>[0]> = {}) =>
  createHttpProviders({
    baseUrl: API,
    catalogSnapshotId: SNAPSHOT,
    pricebookId: PRICEBOOK,
    staticMirror: true,
    fetch: staticFetch,
    ...overrides,
  });

function bannerText(): string {
  return screen.getByRole('note', { name: 'Demo mode' }).textContent ?? '';
}

function renderBanner(providers: DataProviders) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providers}>
        <MemoryRouter>
          <ToastProvider>
            <DemoBanner />
          </ToastProvider>
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
}

describe('finding 1: a new build locks the pricebook this deployment publishes', () => {
  it('exposes the configured pricebook as the new-build default', () => {
    expect(prov().catalog.defaultPricebookId).toBe(PRICEBOOK);
  });

  it('leaves the fixture default alone when no pricebook is configured', () => {
    const p = createHttpProviders({
      baseUrl: API,
      catalogSnapshotId: SNAPSHOT,
      staticMirror: true,
      fetch: staticFetch,
    });
    expect(p.catalog.defaultPricebookId).toBeUndefined();
  });

  it('prices a build created only from that default, with no manual lock edit', async () => {
    const providers = prov();
    const build = createBuild({
      catalogSnapshotId: SNAPSHOT,
      pricebookId: providers.catalog.defaultPricebookId,
    });
    expect(build.locks.pricebook_id).toBe(PRICEBOOK);
    // This is the first-visit path: no fixture pricebook exists in the mirror, so the old default
    // would 404 here rather than price.
    const cost = await providers.pricing.estimate(build);
    expect(cost.pricebook_id).toBe(PRICEBOOK);
  });
});

describe('finding 2: static evaluation refuses a ruleset the build did not lock', () => {
  it('evaluates when the build locks the published ruleset', async () => {
    const providers = prov();
    const build = createBuild({ catalogSnapshotId: SNAPSHOT });
    const report = await providers.compatibility.evaluate(build);
    expect(report.ruleset_id).toBe(BASELINE_RULESET.id);
  });

  it('refuses when the build locks a different ruleset id', async () => {
    const providers = prov();
    const build = createBuild({ catalogSnapshotId: SNAPSHOT });
    build.locks.ruleset_id = 'rules.imported.9';
    await expect(providers.compatibility.evaluate(build)).rejects.toThrow(/different ruleset/);
  });

  it('refuses when the build locks a different ruleset version', async () => {
    const providers = prov();
    const build = createBuild({ catalogSnapshotId: SNAPSHOT });
    build.locks.ruleset_version = '0.0.1';
    await expect(providers.compatibility.evaluate(build)).rejects.toThrow(/different ruleset/);
    await expect(providers.compatibility.compatibleOptions(build, 'model')).rejects.toThrow(
      /different ruleset/,
    );
  });
});

describe('finding 5: a foreign snapshot lock never yields a false-revision answer', () => {
  // The report, verdict and cost are all labelled with build.locks.catalog_snapshot_id, so a build
  // pinned elsewhere must fail rather than be answered from catalog.pilot.open-1.
  const foreign = () => {
    const b = createBuild({ catalogSnapshotId: SNAPSHOT, pricebookId: PRICEBOOK });
    b.locks.catalog_snapshot_id = 'catalog.other.9';
    return b;
  };

  it('refuses to evaluate a build pinned to an unpublished snapshot', async () => {
    await expect(prov().compatibility.evaluate(foreign())).rejects.toThrow(
      /does not publish|different snapshot/i,
    );
  });

  it('refuses to propose compatible options for it', async () => {
    await expect(prov().compatibility.compatibleOptions(foreign(), 'model')).rejects.toThrow(
      /does not publish|different snapshot/i,
    );
  });

  it('refuses to price it, even when the pricebook matches', async () => {
    await expect(prov().pricing.estimate(foreign())).rejects.toThrow(
      /does not publish|different snapshot/i,
    );
  });

  it('still answers normally for the published snapshot', async () => {
    const ok = createBuild({ catalogSnapshotId: SNAPSHOT, pricebookId: PRICEBOOK });
    await expect(prov().compatibility.evaluate(ok)).resolves.toBeDefined();
    await expect(prov().pricing.estimate(ok)).resolves.toBeDefined();
  });
});

describe('finding 3: sourced records are not described as synthetic', () => {
  const snapshot = JSON.parse(
    readFileSync('public/v1/catalog/snapshots/catalog.pilot.open-1', 'utf8'),
  );

  it('does not give the publisher a provider-wide license inferred from one model', () => {
    const publisher = snapshot.items.find(
      (i: { id: string }) => i.id === 'cat.model_provider.qwen',
    );
    expect(publisher.license).toBeUndefined();
    expect(String(publisher.description)).toMatch(/not of the publisher/i);
    const model = snapshot.items.find(
      (i: { id: string }) => i.id === 'cat.model.qwen25_05b_instruct',
    );
    expect(model.license.spdx_id).toBe('Apache-2.0');
    expect(
      model.provenance.every(
        (p: { verification_status: string }) => p.verification_status === 'unverified',
      ),
    ).toBe(true);
  });

  it('does not claim synthetic data in fixture mode', async () => {
    const providers = createFixtureProviders({ now: () => '2026-11-05T14:30:00Z' });
    renderBanner(providers);
    await waitFor(() => expect(bannerText()).toMatch(/use synthetic illustrative demo data/));
  });

  it('does not assert a sourced pilot for the full API surface', async () => {
    // `mode: 'http'` covers both static and full. Full has no requirement to serve the pilot, so the
    // banner must stay neutral rather than claiming provenance it has not read.
    const full = createHttpProviders({
      baseUrl: API,
      catalogSnapshotId: SNAPSHOT,
      staticMirror: false,
      fetch: staticFetch,
    });
    expect(full.mode).toBe('http');
    renderBanner(full);
    await waitFor(() => expect(bannerText()).toMatch(/configured catalog source/));
    expect(bannerText()).not.toMatch(/sourced pilot catalog/);
    expect(bannerText()).not.toMatch(/use synthetic illustrative demo data/);
  });

  it('is neutral for static mode too, leaving provenance to the record level', async () => {
    renderBanner(prov());
    await waitFor(() => expect(bannerText()).toMatch(/configured catalog source/));
    expect(bannerText()).not.toMatch(/sourced pilot catalog/);
  });
});

describe('finding 4: static mode cannot silently downgrade API build storage', () => {
  it('fails closed instead of replacing the requested store with local storage', () => {
    expect(() =>
      createProviders({
        VITE_DATA_MODE: 'http',
        VITE_API_BASE_URL: API,
        VITE_CATALOG_SNAPSHOT: SNAPSHOT,
        VITE_BUILD_STORE: 'http',
        VITE_API_SURFACE: 'static',
      }),
    ).toThrow(DataConfigError);
  });

  it('still allows static with local build storage, and performs no writes', async () => {
    const calls: string[] = [];
    const counting = (url: string, init?: RequestInit) => {
      calls.push(init?.method ?? 'GET');
      return staticFetch(url, init);
    };
    const providers = createHttpProviders({
      baseUrl: API,
      catalogSnapshotId: SNAPSHOT,
      pricebookId: PRICEBOOK,
      staticMirror: true,
      fetch: counting,
    });
    await providers.catalog.getSnapshot();
    await providers.pricing.estimate(
      createBuild({ catalogSnapshotId: SNAPSHOT, pricebookId: PRICEBOOK }),
    );
    expect(new Set(calls)).toEqual(new Set(['GET']));
  });

  it('leaves full + http unchanged', () => {
    const p = createProviders({
      VITE_DATA_MODE: 'http',
      VITE_API_BASE_URL: API,
      VITE_CATALOG_SNAPSHOT: SNAPSHOT,
      VITE_BUILD_STORE: 'http',
      VITE_API_SURFACE: 'full',
    });
    expect(p.mode).toBe('http');
  });
});
