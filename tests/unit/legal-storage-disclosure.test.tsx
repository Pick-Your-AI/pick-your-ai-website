import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot } from '../../src/contracts';
import { createProviders, type DataEnv } from '../../src/data/config';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import type { DataProviders } from '../../src/data/types';
import { createDraft } from '../../src/domain/build';
import LegalPage from '../../src/pages/LegalPage';
import { CATALOG, NOW, apiChat } from './scenarios';

const API_BASE = 'https://api.test/v1';
const HTTP_ENV: DataEnv = {
  VITE_DATA_MODE: 'http',
  VITE_API_BASE_URL: API_BASE,
  VITE_CATALOG_SNAPSHOT: CATALOG.id,
  VITE_PRICEBOOK_ID: DEMO_PRICEBOOK.id,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A test API, not a claim about a deployed service or its retention policy. */
function apiFor(build: BuildSnapshot) {
  const fixture = createFixtureProviders({ now: () => NOW });
  const saved = new Map<string, BuildSnapshot>();
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.slice(API_BASE.length);
    if (init?.method === 'GET' && path === `/catalog/snapshots/${CATALOG.id}`) return json(CATALOG);
    if (init?.method === 'POST' && path === '/builds') {
      const snapshot = JSON.parse(String(init.body)) as BuildSnapshot;
      saved.set(snapshot.id, snapshot);
      return json(snapshot, 201);
    }
    if (init?.method === 'GET' && path === `/builds/${encodeURIComponent(build.id)}`)
      return saved.has(build.id) ? json(saved.get(build.id)) : json({}, 404);
    if (init?.method === 'POST' && path === `/builds/${encodeURIComponent(build.id)}/evaluate`)
      return json(await fixture.compatibility.evaluate(build));
    if (init?.method === 'POST' && path === `/builds/${encodeURIComponent(build.id)}/estimate-cost`)
      return json(await fixture.pricing.estimate(build));
    throw new Error(`Unexpected test request: ${init?.method} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, saved };
}

function showNotice(providers: DataProviders) {
  render(
    <DataContext.Provider value={providers}>
      <MemoryRouter>
        <LegalPage />
      </MemoryRouter>
    </DataContext.Provider>,
  );
  return screen.getByRole('region', { name: 'Privacy' });
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('privacy notice matches supported storage and transport configurations', () => {
  it('keeps the default browser-storage and self-hosted-font disclosures', async () => {
    const build = apiChat();
    const api = apiFor(build);
    const providers = createProviders({});
    await providers.builds.save(createDraft(build), null);
    expect(localStorage.getItem(`pyai.build.${build.id}`)).not.toBeNull();
    expect(api.fetch).not.toHaveBeenCalled();
    localStorage.clear();
    expect(await providers.builds.list()).toEqual([]);

    const notice = showNotice(providers);
    expect(notice).toHaveTextContent(/builds.*saved in this browser/i);
    expect(notice).toHaveTextContent(/typefaces are self-hosted/i);
    expect(notice).toHaveTextContent(/no analytics, advertising or third-party scripts/i);
  });

  it('discloses analysis metadata sent in HTTP mode even with local build storage', async () => {
    const build = apiChat();
    const api = apiFor(build);
    const providers = createProviders({ ...HTTP_ENV, VITE_BUILD_STORE: 'local' });
    await providers.builds.save(createDraft(build), null);
    expect(api.fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(`pyai.build.${build.id}`)).not.toBeNull();

    await providers.compatibility.evaluate(build);
    await providers.pricing.estimate(build);
    expect(
      api.fetch.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))]),
    ).toEqual([
      [`${API_BASE}/builds/${build.id}/evaluate`, { build_revision: build.revision }],
      [
        `${API_BASE}/builds/${build.id}/estimate-cost`,
        { build_revision: build.revision, pricebook_id: DEMO_PRICEBOOK.id, period_days: 30 },
      ],
    ]);
    expect(api.saved.size).toBe(0);

    const notice = showNotice(providers);
    expect(notice).toHaveTextContent(
      /API mode.*build identifiers.*revisions.*analysis parameters/i,
    );
    expect(notice).toHaveTextContent(/sent to the configured API/i);
    expect(notice).not.toHaveTextContent(/they are not sent to us/i);
  });

  it('distinguishes remote snapshot saving from clearing browser copies', async () => {
    const build = apiChat();
    const api = apiFor(build);
    const providers = createProviders({ ...HTTP_ENV, VITE_BUILD_STORE: 'http' });
    await providers.builds.save(createDraft(build), null);
    expect(api.fetch).toHaveBeenCalledWith(
      `${API_BASE}/builds`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(build) }),
    );
    expect(localStorage.getItem(`pyai.build.${build.id}`)).not.toBeNull();

    const requestsBeforeClearing = api.fetch.mock.calls.length;
    localStorage.clear();
    expect(await providers.builds.list()).toEqual([]);
    expect(api.fetch).toHaveBeenCalledTimes(requestsBeforeClearing);
    // A browser clear sends no deletion request; this test API's saved record is still readable.
    expect((await providers.builds.get(build.id)).build).toEqual(build);

    const notice = showNotice(providers);
    expect(notice).toHaveTextContent(/remote build saving.*complete build snapshots.*sent/i);
    expect(notice).toHaveTextContent(/clearing.*removes browser-stored copies and preferences/i);
    expect(notice).toHaveTextContent(/does not request deletion of API-stored builds/i);
    expect(notice).not.toHaveTextContent(/your builds stay in this browser/i);
  });

  it.each(['local', 'http'])(
    'allows another-origin API disclosure with %s storage',
    async (store) => {
      const build = apiChat();
      const api = apiFor(build);
      const providers = createProviders({ ...HTTP_ENV, VITE_BUILD_STORE: store });
      await providers.catalog.getSnapshot();
      expect(api.fetch).toHaveBeenCalledWith(
        `${API_BASE}/catalog/snapshots/${CATALOG.id}`,
        expect.objectContaining({ method: 'GET', credentials: 'omit' }),
      );
      expect(new URL(API_BASE).origin).not.toBe(window.location.origin);

      const notice = showNotice(providers);
      expect(notice).toHaveTextContent(/configured API.*may use another origin/i);
      expect(notice).not.toHaveTextContent(/no request to any other origin/i);
    },
  );
});
