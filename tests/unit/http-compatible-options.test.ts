import Ajv from 'ajv';
import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import openapiSource from '../../contracts/v1/api/openapi.yaml?raw';
import { assertContract, type BuildSnapshot } from '../../src/contracts';
import type { FetchLike } from '../../src/data/http/client';
import { createHttpProviders } from '../../src/data/http/providers';
import { CATALOG, apiChat } from './scenarios';

// Use the unchanged inline OpenAPI response as an independent shape oracle.
const openapi = parse(openapiSource) as {
  paths: Record<
    string,
    { get: { responses: Record<string, { content: Record<string, { schema: object }> }> } }
  >;
};
const responseSchema =
  openapi.paths['/builds/{build_id}/compatible-options']!.get.responses['200']!.content[
    'application/json'
  ]!.schema;
const validResponse = new Ajv().compile(responseSchema);

function pinnedBuild() {
  const build = apiChat();
  build.id = 'build:compatible-options';
  return assertContract('BuildSnapshot', build);
}

function payload(build: BuildSnapshot) {
  return {
    build_id: build.id,
    build_revision: build.revision,
    kind: 'model',
    options: [
      {
        catalog_item_id: 'demo.model.option',
        catalog_item_version: '1.0.0',
        verdict: 'compatible',
        rule_ids: ['rule.demo.option'],
      },
    ],
  };
}

type Payload = ReturnType<typeof payload>;

function responseApi(value: unknown, duringRequest?: () => void) {
  return vi.fn<FetchLike>(async () => {
    duringRequest?.();
    return new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const providers = (fetch: FetchLike) =>
  createHttpProviders({ baseUrl: 'https://api.test/v1', catalogSnapshotId: CATALOG.id, fetch });

const rejected: [string, boolean, (value: Payload) => unknown][] = [
  ['a schema-valid foreign kind', true, (r) => ({ ...r, kind: 'accelerator' })],
  [
    'the missing required kind',
    false,
    (r) => {
      const copy: Record<string, unknown> = { ...r };
      delete copy.kind;
      return copy;
    },
  ],
  ['a non-string kind', false, (r) => ({ ...r, kind: 12 })],
  ['an additional response property', false, (r) => ({ ...r, extra: true })],
  [
    'an additional option property',
    false,
    (r) => ({ ...r, options: [{ ...r.options[0]!, extra: true }] }),
  ],
  ['a numeric rule ID', false, (r) => ({ ...r, options: [{ ...r.options[0]!, rule_ids: [12] }] })],
  [
    'an object rule ID',
    false,
    (r) => ({ ...r, options: [{ ...r.options[0]!, rule_ids: [{ id: 'rule.demo.option' }] }] }),
  ],
  ['a response array', false, () => []],
  ['a non-array option collection', false, (r) => ({ ...r, options: {} })],
  [
    'a missing required option version',
    false,
    (r) => {
      const option: Record<string, unknown> = { ...r.options[0]! };
      delete option.catalog_item_version;
      return { ...r, options: [option] };
    },
  ],
  ['a schema-valid foreign build', true, (r) => ({ ...r, build_id: 'build.foreign' })],
  [
    'a schema-valid foreign revision',
    true,
    (r) => ({ ...r, build_revision: r.build_revision + 1 }),
  ],
  ['a fractional revision', false, (r) => ({ ...r, build_revision: r.build_revision + 0.5 })],
];

describe('HTTP compatible-options response admission', () => {
  it.each(rejected)('rejects %s', async (_name, schemaValid, change) => {
    const build = pinnedBuild();
    const before = structuredClone(build);
    const response: unknown = JSON.parse(JSON.stringify(change(payload(build))));
    expect(validResponse(response)).toBe(schemaValid);
    const api = responseApi(response);
    await expect(
      providers(api).compatibility.compatibleOptions(build, 'model'),
    ).rejects.toMatchObject({ kind: 'malformed' });
    expect(api).toHaveBeenCalledExactlyOnceWith(
      `https://api.test/v1/builds/${encodeURIComponent(build.id)}/compatible-options?kind=model&role=primary`,
      expect.objectContaining({ method: 'GET', credentials: 'omit', body: undefined }),
    );
    expect(build).toEqual(before);
  });

  it.each(['compatible', 'incompatible', 'unknown'] as const)(
    'preserves an exact %s option and its rule IDs',
    async (verdict) => {
      const build = pinnedBuild();
      const before = structuredClone(build);
      const response = payload(build);
      response.options[0]!.verdict = verdict;
      expect(validResponse(response)).toBe(true);
      const api = responseApi(response);
      await expect(providers(api).compatibility.compatibleOptions(build, 'model')).resolves.toEqual(
        response.options,
      );
      expect(api).toHaveBeenCalledTimes(1);
      expect(build).toEqual(before);
    },
  );

  it.each([undefined, 'secondary / & slot'])('preserves the requested role (%s)', async (role) => {
    const build = pinnedBuild();
    const response = payload(build);
    const api = responseApi(response);
    await expect(
      providers(api).compatibility.compatibleOptions(build, 'model', role),
    ).resolves.toEqual(response.options);
    expect(api).toHaveBeenCalledExactlyOnceWith(
      `https://api.test/v1/builds/${encodeURIComponent(build.id)}/compatible-options?kind=model&role=${encodeURIComponent(role ?? 'primary')}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('accepts an empty option list for the requested context', async () => {
    const build = pinnedBuild();
    const response = { ...payload(build), options: [] };
    expect(validResponse(response)).toBe(true);
    await expect(
      providers(responseApi(response)).compatibility.compatibleOptions(build, 'model'),
    ).resolves.toEqual([]);
  });

  it('preserves string values without inventing a stricter inline identifier grammar', async () => {
    const build = pinnedBuild();
    const response = payload(build);
    response.options[0] = {
      catalog_item_id: '',
      catalog_item_version: 'preview',
      verdict: 'unknown',
      rule_ids: ['', 'a display value'],
    };
    expect(validResponse(response)).toBe(true);
    await expect(
      providers(responseApi(response)).compatibility.compatibleOptions(build, 'model'),
    ).resolves.toEqual(response.options);
  });

  it.each([false, true])(
    'binds the response to dispatch when the caller mutates (foreign response: %s)',
    async (foreign) => {
      const build = pinnedBuild();
      const original = structuredClone(build);
      const changed = { build_id: 'build.changed', build_revision: build.revision + 1 };
      const response = { ...payload(build), ...(foreign ? changed : {}) };
      expect(validResponse(response)).toBe(true);
      const api = responseApi(response, () => {
        build.id = changed.build_id;
        build.revision = changed.build_revision;
      });
      const pending = providers(api).compatibility.compatibleOptions(build, 'model');
      if (foreign) await expect(pending).rejects.toMatchObject({ kind: 'malformed' });
      else await expect(pending).resolves.toEqual(response.options);
      expect(api).toHaveBeenCalledExactlyOnceWith(
        `https://api.test/v1/builds/${encodeURIComponent(original.id)}/compatible-options?kind=model&role=primary`,
        expect.objectContaining({ method: 'GET' }),
      );
    },
  );
});
