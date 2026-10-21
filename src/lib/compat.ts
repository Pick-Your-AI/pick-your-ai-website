/*
 * Per-candidate compatibility, keyed for catalog UIs.
 *
 * `compatibleOptions(build, kind)` answers "what would happen to the current build if this catalog
 * item were the selection for this kind" — exactly what a component card or catalog row needs.
 * Verdicts are the contract's three-valued `compatible | incompatible | unknown`; unknown is never
 * treated as compatible. The failing rule ids are kept so a card can say *why*, not just that.
 */
import { useQuery } from '@tanstack/react-query';
import { kindDef, type BuildSnapshot, type ComponentKind } from '../contracts';
import { nextRole } from '../domain/build';
import type { CompatibleOption } from '../data/types';
import { useData } from '../app/data-context';

export type CompatOption = CompatibleOption;
export type VerdictMap = ReadonlyMap<string, CompatOption>;

export const verdictKey = (kind: ComponentKind, itemId: string) => `${kind}|${itemId}`;

/** One query for many kinds, so a layer (or the whole catalog) needs a single round of work. */
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
  return useQuery({
    queryKey: [
      'compat',
      build?.id ?? 'none',
      build?.revision ?? 0,
      unique.join(','),
      roles.join(','),
    ],
    queryFn: async (): Promise<VerdictMap> => {
      // Settled, not all: one kind failing to evaluate must not blank every other verdict.
      const results = await Promise.allSettled(
        unique.map(
          async (kind, index) =>
            [kind, await compatibility.compatibleOptions(build!, kind, roles[index])] as const,
        ),
      );
      const map = new Map<string, CompatOption>();
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const [kind, options] = result.value;
        for (const option of options) map.set(verdictKey(kind, option.catalog_item_id), option);
      }
      return map;
    },
    enabled: Boolean(build) && unique.length > 0,
  });
}

/** Verdict for one item, defaulting to `unknown` while the evaluation is in flight. */
export function verdictFor(map: VerdictMap | undefined, kind: ComponentKind, itemId: string) {
  return map?.get(verdictKey(kind, itemId))?.verdict ?? 'unknown';
}

/** Full option (verdict + failing rule ids) for one item, if it has been evaluated. */
export function optionFor(map: VerdictMap | undefined, kind: ComponentKind, itemId: string) {
  return map?.get(verdictKey(kind, itemId));
}
