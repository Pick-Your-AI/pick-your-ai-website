import { hashKey, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';
import { buildQueryKey } from '../../src/app/build-query-key';
import { DataContext } from '../../src/app/data-context';
import { useBuildAnalysis, useCompatibleOptions } from '../../src/app/queries';
import { validatorsReady } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { importBuild, MAX_IMPORT_BYTES } from '../../src/domain/share';
import { useCompatByKind } from '../../src/lib/compat';
import { apiChat, NOW } from './scenarios';

describe('synthetic snapshot query depth', () => {
  it.each(['array', 'object'] as const)(
    'analyzes an accepted 10,000-level %s extension without overflowing the query hash',
    async (container) => {
      await validatorsReady;
      const clean = apiChat();
      const open = container === 'array' ? '[' : '{"child":';
      const close = container === 'array' ? ']' : '}';
      const text =
        JSON.stringify(clean).slice(0, -1) +
        ',"extensions":{"x_nested":' +
        open.repeat(10_000) +
        '0' +
        close.repeat(10_000) +
        '}}';
      expect(text.length).toBeLessThan(MAX_IMPORT_BYTES);
      const imported = importBuild(text, 'fixture');
      expect(imported.ok).toBe(true);
      if (!imported.ok) throw new Error('Synthetic import rejected');
      const providers = createFixtureProviders({ now: () => NOW });
      expect(await providers.compatibility.evaluate(imported.build)).toEqual(
        await providers.compatibility.evaluate(clean),
      );
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      const wrapper = ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>
          <DataContext.Provider value={providers}>{children}</DataContext.Provider>
        </QueryClientProvider>
      );
      const hook = renderHook(
        () => ({
          analysis: useBuildAnalysis(imported.build),
          options: useCompatibleOptions(imported.build, 'model'),
          byKind: useCompatByKind(imported.build, ['model_provider']),
        }),
        { wrapper },
      );
      try {
        await waitFor(() => {
          expect(hook.result.current.analysis.reportIsCurrent).toBe(true);
          expect(hook.result.current.analysis.costIsCurrent).toBe(true);
          expect(hook.result.current.analysis.resourcesQuery.isSuccess).toBe(true);
          expect(hook.result.current.options.isSuccess).toBe(true);
          expect(hook.result.current.byKind.isSuccess).toBe(true);
        });
        const key = buildQueryKey(imported.build);
        expect(typeof key[2]).toBe('string');
        expect(hashKey(key)).toBe(hashKey(buildQueryKey(JSON.parse(text))));
        // The deeply nested leaf remains part of the identity, not just its prefix.
        const changed = JSON.parse(
          text.replace(open.repeat(10_000) + '0', open.repeat(10_000) + '1'),
        );
        expect(hashKey(buildQueryKey(changed))).not.toBe(hashKey(key));
      } finally {
        hook.unmount();
        client.clear();
      }
    },
  );

  it('canonicalizes nested object keys and preserves JSON escaping and value distinctions', () => {
    const build = apiChat();
    const withEscapes = {
      ...build,
      extensions: { x_value: { '"\\\n': ['"\\\n', null, false, 42] } },
    };
    const identity = buildQueryKey(withEscapes)[2];
    expect(typeof identity).toBe('string');
    expect(JSON.parse(identity as string)).toEqual(withEscapes);
    const key = (value: unknown) =>
      hashKey(buildQueryKey({ ...build, extensions: { x_value: value } }));
    expect(key({ z: { b: 2, a: 1 }, a: ['"\\\n', null] })).toBe(
      key({ a: ['"\\\n', null], z: { a: 1, b: 2 } }),
    );
    const values = [null, false, true, 0, 1, '0', 'null', '', [], {}, [0, 1], [1, 0], ['0'], [0]];
    expect(new Set(values.map(key)).size).toBe(values.length);
    expect(key({ a: 'b,c:d' })).not.toBe(key({ a: 'b', c: 'd' }));
    expect(key({ omitted: undefined })).toBe(key({}));
    expect(key([undefined])).toBe(key([null]));
    expect(buildQueryKey(null)).toEqual(buildQueryKey(undefined));
  });

  it('observes content changes on the same snapshot object', () => {
    const build = { ...apiChat(), extensions: { x_value: { nested: 1 } } };
    const before = hashKey(buildQueryKey(build));
    build.extensions.x_value.nested = 2;
    expect(hashKey(buildQueryKey(build))).not.toBe(before);
  });
});
