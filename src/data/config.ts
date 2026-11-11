/*
 * Provider selection by build-time configuration. See docs/DATA_INTEGRATION.md.
 *   VITE_DATA_MODE        fixture (default) | http
 *   VITE_API_BASE_URL     contract API base, e.g. https://api.example/v1   (http mode)
 *   VITE_CATALOG_SNAPSHOT catalog snapshot id to load                    (http mode)
 *   VITE_PRICEBOOK_ID     pricebook id                                    (required for http static; optional for full)
 *   VITE_BUILD_STORE      local (default) | http — where builds are saved
 *   VITE_API_SURFACE      full (default) | static — static consumes immutable GET artifacts
 *                         (catalog snapshot, pricebook, ruleset, dependencies) and evaluates
 *                         locally, so real data can be consumed without a dynamic service.
 */
import { createFixtureProviders } from './fixture/providers';
import { createHttpProviders } from './http/providers';
import type { DataProviders } from './types';

export interface DataEnv {
  VITE_DATA_MODE?: string;
  VITE_API_BASE_URL?: string;
  VITE_CATALOG_SNAPSHOT?: string;
  VITE_PRICEBOOK_ID?: string;
  VITE_BUILD_STORE?: string;
  VITE_API_SURFACE?: string;
}

export class DataConfigError extends Error {}

export function createProviders(env: DataEnv): DataProviders {
  const mode = env.VITE_DATA_MODE || 'fixture';
  if (mode === 'fixture') return createFixtureProviders({ latencyMs: 120 });
  if (mode !== 'http')
    throw new DataConfigError(`VITE_DATA_MODE must be "fixture" or "http", got "${mode}".`);
  const surface = env.VITE_API_SURFACE || 'full';
  if (surface !== 'full' && surface !== 'static')
    throw new DataConfigError(`VITE_API_SURFACE must be "full" or "static", got "${surface}".`);
  if (!env.VITE_API_BASE_URL)
    throw new DataConfigError('VITE_API_BASE_URL is required when VITE_DATA_MODE=http.');
  if (!env.VITE_CATALOG_SNAPSHOT)
    throw new DataConfigError('VITE_CATALOG_SNAPSHOT is required when VITE_DATA_MODE=http.');
  const remoteBuilds = env.VITE_BUILD_STORE === 'http';
  // A static mirror cannot serve build writes. Refusing the combination is better than silently
  // downgrading the operator's explicit request for API persistence to browser-local storage.
  if (surface === 'static' && remoteBuilds) {
    throw new DataConfigError(
      'VITE_BUILD_STORE=http cannot be combined with VITE_API_SURFACE=static: a static mirror serves ' +
        'immutable GET artifacts only and cannot persist builds. Use VITE_BUILD_STORE=local, or ' +
        'VITE_API_SURFACE=full with a dynamic API.',
    );
  }
  if (surface === 'static' && !env.VITE_PRICEBOOK_ID?.trim())
    throw new DataConfigError(
      'VITE_PRICEBOOK_ID is required when VITE_API_SURFACE=static. Set it to a pricebook published by the mirror.',
    );
  return createHttpProviders({
    baseUrl: env.VITE_API_BASE_URL,
    catalogSnapshotId: env.VITE_CATALOG_SNAPSHOT,
    pricebookId: env.VITE_PRICEBOOK_ID || undefined,
    remoteBuilds,
    staticMirror: surface === 'static',
  });
}
