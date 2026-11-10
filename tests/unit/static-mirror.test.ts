/*
 * Static-mirror data path: real immutable artifacts are consumed by the website with no dynamic
 * service. `VITE_API_SURFACE=static` keeps catalog, ruleset, dependency graph and pricebook reads
 * on the existing contract GET endpoints, and runs evaluation and cost estimation locally, which
 * is how the fixtures already work.
 *
 * These tests read the committed artifacts from public/v1 rather than an in-memory mock, so they
 * prove both that the files satisfy the frozen schemas and that the providers can consume them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BASELINE_GRAPH, BASELINE_RULESET } from '../../src/contracts';
import { addOrReplace, createBuild } from '../../src/domain/build';
import { createProviders, DataConfigError } from '../../src/data/config';
import { createHttpProviders } from '../../src/data/http/providers';

const PILOT_SNAPSHOT = 'catalog.pilot.open-1';
const PILOT_PRICEBOOK = 'prices.pilot.1';
const API_BASE = '/v1';
const log: { method: string; url: string }[] = [];

function staticFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET';
  const path = url.slice(API_BASE.length).split('?')[0] ?? '';
  log.push({ method, url });
  // A static mirror cannot serve dynamic endpoints. 405 is deliberate, so a call that should have
  // stayed local fails here instead of looking like a working backend.
  if (method !== 'GET' && method !== 'HEAD') {
    return Promise.resolve(
      new Response(JSON.stringify({ code: 'method_not_allowed', message: method }), {
        status: 405,
      }),
    );
  }
  try {
    const content = readFileSync(join(process.cwd(), 'public', API_BASE, path));
    return Promise.resolve(new Response(content));
  } catch {
    return Promise.resolve(
      new Response(JSON.stringify({ code: 'not_found', message: path }), { status: 404 }),
    );
  }
}

function staticProviders() {
  return createHttpProviders({
    baseUrl: API_BASE,
    catalogSnapshotId: PILOT_SNAPSHOT,
    pricebookId: PILOT_PRICEBOOK,
    staticMirror: true,
    fetch: staticFetch,
  });
}

beforeEach(() => log.splice(0));

describe('the committed pilot artifacts are contract-valid and consumable', () => {
  it('serves the real publisher and model from the static artifact', async () => {
    const providers = staticProviders();
    expect(providers.mode).toBe('http');
    const snapshot = await providers.catalog.getSnapshot();
    expect(snapshot.id).toBe(PILOT_SNAPSHOT);
    expect(snapshot.items.map((item) => item.id)).toEqual([
      'cat.model_provider.qwen',
      'cat.model.qwen25_05b_instruct',
    ]);
    const model = await providers.catalog.getItem('cat.model.qwen25_05b_instruct');
    expect(model.version).toBe('7ae557604adf67be50417f59c2c2f167def9a775');
    expect(model.license?.spdx_id).toBe('Apache-2.0');
    expect(model.provenance.map((entry) => entry.verification_status)).toEqual([
      'unverified',
      'unverified',
      'unverified',
    ]);
    // Evidence must be pinned to the immutable revision, never a moving `main` URL.
    expect(
      model.provenance.every((entry) => (entry.source_uri ?? '').includes(model.version)),
    ).toBe(true);
    // Only safetensors is published for this revision; `pytorch` is not established by any source.
    expect((model.spec as { model_formats?: string[] }).model_formats).toEqual(['safetensors']);
    expect(model.tags ?? []).not.toContain('synthetic');
  });

  it('loads the baseline graph and ruleset from the same static surface', async () => {
    const providers = staticProviders();
    const [graph, ruleset] = await Promise.all([
      providers.catalog.getDependencyGraph(),
      providers.catalog.getRuleset(),
    ]);
    expect(graph.id).toBe(BASELINE_GRAPH.id);
    expect(ruleset.id).toBe(BASELINE_RULESET.id);
  });

  it('evaluates and prices a build locally without any write endpoint', async () => {
    const providers = staticProviders();
    const items = await new Map(
      (await providers.catalog.getSnapshot()).items.map((item) => [item.id, item]),
    );
    const base = createBuild({ catalogSnapshotId: PILOT_SNAPSHOT, now: '2026-11-05T14:30:00Z' });
    base.locks.pricebook_id = PILOT_PRICEBOOK;
    const withModel = addOrReplace(base, items.get('cat.model.qwen25_05b_instruct')!, items);
    const report = await providers.compatibility.evaluate(withModel);
    expect(report.build_id).toBe(withModel.id);
    expect(report.build_revision).toBe(withModel.revision);
    // The pilot has no workload, deployment mode or context selection, so the published baseline
    // rules correctly fail the required T0/T1 foundation instead of claiming compatibility.
    expect(report.findings.some((f) => f.code === 'RULE_REQUIRED_FOUNDATION')).toBe(true);
    expect(log.some((request) => request.url.includes('/rulesets/'))).toBe(true);
    const cost = await providers.pricing.estimate(withModel);
    expect(cost.pricebook_id).toBe(PILOT_PRICEBOOK);
    expect(cost.currency).toBe('USD');
    // Only the Apache license rate exists. A zero license fee is not evidence of zero hosting.
    expect(log.every((request) => request.method === 'GET')).toBe(true);
    expect(log.map((request) => request.url)).not.toContain('/v1/builds');
  });

  it('does not silently change the existing full API surface', async () => {
    const providers = createHttpProviders({
      baseUrl: API_BASE,
      catalogSnapshotId: PILOT_SNAPSHOT,
      pricebookId: PILOT_PRICEBOOK,
      staticMirror: false,
      fetch: staticFetch,
    });
    const items = new Map(
      (await providers.catalog.getSnapshot()).items.map((item) => [item.id, item]),
    );
    const build = addOrReplace(
      createBuild({ catalogSnapshotId: PILOT_SNAPSHOT }),
      items.get('cat.model.qwen25_05b_instruct')!,
      items,
    );
    // Full mode still uses the contract's dynamic evaluator; against a static-only surface the 405
    // proves it did not quietly fall back to a local answer.
    await expect(providers.compatibility.evaluate(build)).rejects.toThrow(/405/);
    expect(log.some((request) => request.method === 'POST')).toBe(true);
  });

  it('keeps unknown capacity evidence unknown rather than guessing it', async () => {
    expect(
      (
        await staticProviders().resources.estimate(
          createBuild({ catalogSnapshotId: PILOT_SNAPSHOT }),
        )
      ).status,
    ).toBe('unavailable');
  });

  it('selects the static surface from build configuration', async () => {
    vi.stubGlobal('fetch', staticFetch);
    try {
      const providers = createProviders({
        VITE_DATA_MODE: 'http',
        VITE_API_BASE_URL: API_BASE,
        VITE_CATALOG_SNAPSHOT: PILOT_SNAPSHOT,
        VITE_PRICEBOOK_ID: PILOT_PRICEBOOK,
        VITE_API_SURFACE: 'static',
      });
      expect((await providers.catalog.getSnapshot()).id).toBe(PILOT_SNAPSHOT);
      expect(providers.mode).toBe('http');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects an unusable API-surface configuration', () => {
    expect(() =>
      createProviders({
        VITE_DATA_MODE: 'http',
        VITE_API_BASE_URL: API_BASE,
        VITE_CATALOG_SNAPSHOT: PILOT_SNAPSHOT,
        VITE_API_SURFACE: 'partial',
      }),
    ).toThrow(DataConfigError);
  });
});
