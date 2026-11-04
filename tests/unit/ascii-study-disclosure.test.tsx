import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { useBuilder } from '../../src/app/builder-context';
import { createHttpProviders } from '../../src/data/http/providers';
import AsciiStudyPage from '../../src/pages/AsciiStudyPage';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

/**
 * Review 5705839049 [P2], review 5720632907 and discussion_r4369655725.
 *
 * The study rendered "Your builds stay in this browser." unconditionally, but
 * `createProviders()` selects `HttpBuildRepository` whenever `VITE_BUILD_STORE=http`
 * (src/data/config.ts:36 -> src/data/http/providers.ts:320) and its `save()` POSTs
 * `/builds` to the API (providers.ts:293). `providers.ts:43` documents that same flag
 * as "Store builds on the API instead of in this browser".
 *
 * The copy is deleted rather than made conditional: catalog mode is not build mode, so
 * `VITE_DATA_MODE` cannot distinguish the supported HTTP-catalog/local-builds
 * combination, and a conditional would only be right for some of the four cases.
 *
 * These cases render through the real HTTP provider factory with remote builds both on
 * and off, which is exactly the configuration the old sentence was false about.
 */

function providersWith(remoteBuilds: boolean) {
  return createHttpProviders({
    baseUrl: 'https://api.test/v1',
    catalogSnapshotId: 'test',
    remoteBuilds,
    // Unit tests make no network calls; any request is a defect worth failing loudly on.
    fetch: () => Promise.reject(new Error('unexpected network request in a unit test')),
  });
}

function renderStudy(remoteBuilds: boolean) {
  vi.mocked(useBuilder).mockReturnValue({
    startNew: vi.fn(),
  } as unknown as ReturnType<typeof useBuilder>);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DataContext.Provider value={providersWith(remoteBuilds)}>
        <MemoryRouter>
          <AsciiStudyPage />
        </MemoryRouter>
      </DataContext.Provider>
    </QueryClientProvider>,
  );
}

/** Any claim that build data never leaves the reader's machine. */
const BROWSER_ONLY_STORAGE =
  /in this browser|in your browser|stays? (?:in|on) your (?:device|browser)/i;

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

describe('ASCII study storage disclosure', () => {
  it.each([true, false])(
    'makes no browser-only build-storage promise when remoteBuilds=%s',
    (remoteBuilds) => {
      const { container } = renderStudy(remoteBuilds);
      expect(container.textContent ?? '').not.toMatch(BROWSER_ONLY_STORAGE);
    },
  );

  it('still labels the work as a synthetic preview', () => {
    const { container } = renderStudy(true);
    expect(container.textContent ?? '').toMatch(/synthetic preview/i);
  });
});
