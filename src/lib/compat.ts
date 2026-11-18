/*
 * Per-candidate compatibility, keyed for catalog UIs.
 *
 * `compatibleOptions(build, kind)` answers "what would happen to the current build if this catalog
 * item were the selection for this kind" — exactly what a component card or catalog row needs.
 * Verdicts are the contract's three-valued `compatible | incompatible | unknown`; unknown is never
 * treated as compatible. The failing rule ids are kept so a card can say *why*, not just that.
 */
import { useQueries } from '@tanstack/react-query';
import { kindDef, type BuildSnapshot, type ComponentKind } from '../contracts';
import { nextRole } from '../domain/build';
import type { CompatibleOption } from '../data/types';
import { useData } from '../app/data-context';
import { buildQueryKey } from '../app/build-query-key';

export type CompatOption = CompatibleOption;
export type VerdictMap = ReadonlyMap<string, CompatOption>;

// Tuple encoding keeps arbitrary response strings distinct, including separators in ids/versions.
export const verdictKey = (kind: ComponentKind, itemId: string, itemVersion: string) =>
  JSON.stringify([kind, itemId, itemVersion]);

/** Independent kind queries retain successful verdicts while failed kinds can retry. */
export function useCompatByKind(
  build: BuildSnapshot | null | undefined,
  kinds: ComponentKind[],
  options: { role?: string; additional?: boolean } = {},
) {
  const { compatibility } = useData();
  const unique = [...new Set(kinds)];
  const roles = unique.map(
    (kind) =>
      options.role ??
      (build && options.additional && kindDef(kind).cardinality === 'many'
        ? nextRole(build, kind)
        : 'primary'),
  );
  const queries = useQueries({
    queries: unique.map((kind, index) => ({
      queryKey: ['compat-kind', ...buildQueryKey(build), kind, roles[index]],
      queryFn: () => compatibility.compatibleOptions(build!, kind, roles[index]),
      enabled: Boolean(build),
    })),
  });
  const map = new Map<string, CompatOption>();
  queries.forEach((query, index) => {
    // Failed refreshes may retain cached data, but those decisions are not current.
    if (query.isError) return;
    for (const option of query.data ?? []) {
      map.set(
        verdictKey(unique[index]!, option.catalog_item_id, option.catalog_item_version),
        option,
      );
    }
  });
  const failed = queries.filter((query) => query.isError);
  return {
    data: map as VerdictMap,
    isSuccess: queries.length > 0 && queries.every((query) => query.isSuccess),
    isError: failed.length > 0,
    error: failed[0]?.error ?? null,
    refetch: () => Promise.all(failed.map((query) => query.refetch())),
  };
}

/** Verdict for one exact item version, defaulting to `unknown` while the evaluation is in flight. */
export function verdictFor(
  map: VerdictMap | undefined,
  kind: ComponentKind,
  itemId: string,
  itemVersion: string,
) {
  return optionFor(map, kind, itemId, itemVersion)?.verdict ?? 'unknown';
}

/** Full option (verdict + failing rule ids) for one item, if it has been evaluated. */
export function optionFor(
  map: VerdictMap | undefined,
  kind: ComponentKind,
  itemId: string,
  itemVersion: string,
) {
  return map?.get(verdictKey(kind, itemId, itemVersion));
}
