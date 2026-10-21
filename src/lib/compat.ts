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

export type CompatOption = CompatibleOption;
export type VerdictMap = ReadonlyMap<string, CompatOption>;

export const verdictKey = (kind: ComponentKind, itemId: string) => `${kind}|${itemId}`;

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
      queryKey: ['compat-kind', build?.id ?? 'none', build?.revision ?? 0, kind, roles[index]],
      queryFn: () => compatibility.compatibleOptions(build!, kind, roles[index]),
      enabled: Boolean(build),
    })),
  });
  const map = new Map<string, CompatOption>();
  queries.forEach((query, index) => {
    for (const option of query.data ?? []) {
      map.set(verdictKey(unique[index]!, option.catalog_item_id), option);
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

/** Verdict for one item, defaulting to `unknown` while the evaluation is in flight. */
export function verdictFor(map: VerdictMap | undefined, kind: ComponentKind, itemId: string) {
  return map?.get(verdictKey(kind, itemId))?.verdict ?? 'unknown';
}

/** Full option (verdict + failing rule ids) for one item, if it has been evaluated. */
export function optionFor(map: VerdictMap | undefined, kind: ComponentKind, itemId: string) {
  return map?.get(verdictKey(kind, itemId));
}
