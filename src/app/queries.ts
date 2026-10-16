/*
 * TanStack Query hooks. Every key that depends on a build includes (build id, revision), so results
 * for an earlier revision are never shown as current; previous data is kept only as an explicitly
 * flagged "stale" placeholder while the new revision is evaluated.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { BuildSnapshot, CatalogItem, ComponentKind } from '../contracts';
import { useData } from './data-context';

export function useCatalog() {
  const { catalog } = useData();
  const q = useQuery({
    queryKey: ['catalog', 'snapshot'],
    queryFn: () => catalog.getSnapshot(),
    staleTime: Infinity,
  });
  const byId = useMemo(
    () => new Map<string, CatalogItem>((q.data?.items ?? []).map((i) => [i.id, i])),
    [q.data],
  );
  return { ...q, byId };
}

export function useGraph() {
  const { catalog } = useData();
  return useQuery({
    queryKey: ['catalog', 'graph'],
    queryFn: () => catalog.getDependencyGraph(),
    staleTime: Infinity,
  });
}

export function useRuleset() {
  const { catalog } = useData();
  return useQuery({
    queryKey: ['catalog', 'ruleset'],
    queryFn: () => catalog.getRuleset(),
    staleTime: Infinity,
  });
}

export function usePricebook(id?: string) {
  const { pricing } = useData();
  return useQuery({
    queryKey: ['pricebook', id ?? 'default'],
    queryFn: () => pricing.getPricebook(id),
    staleTime: Infinity,
  });
}

const buildKey = (b: BuildSnapshot | null | undefined) =>
  [b?.id ?? 'none', b?.revision ?? 0] as const;

/** Cost → resources → evaluation for the exact build revision. */
export function useBuildAnalysis(build: BuildSnapshot | null | undefined) {
  const data = useData();
  const enabled = Boolean(build);
  const cost = useQuery({
    queryKey: ['cost', ...buildKey(build)],
    queryFn: () => data.pricing.estimate(build!),
    enabled,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const resources = useQuery({
    queryKey: ['resources', ...buildKey(build)],
    queryFn: () => data.resources.estimate(build!),
    enabled,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const costReady = cost.data && cost.data.build_revision === build?.revision;
  const resourceEstimate =
    resources.data?.status === 'available' &&
    resources.data.estimate.build_revision === build?.revision
      ? resources.data.estimate
      : null;
  const evaluation = useQuery({
    queryKey: ['evaluation', ...buildKey(build), costReady ? 'with-cost' : 'no-cost'],
    queryFn: () =>
      data.compatibility.evaluate(build!, {
        costEstimate: costReady ? cost.data : null,
        resourceEstimate,
      }),
    enabled: enabled && !cost.isPending,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const report = evaluation.data;
  const reportIsCurrent = Boolean(report && build && report.build_revision === build.revision);
  const costIsCurrent = Boolean(costReady);
  return {
    report,
    reportIsCurrent,
    evaluation,
    cost: cost.data,
    costIsCurrent,
    costQuery: cost,
    resources: resources.data,
    resourcesQuery: resources,
  };
}

export function useCompatibleOptions(
  build: BuildSnapshot | null | undefined,
  kind: ComponentKind,
  role = 'primary',
) {
  const { compatibility } = useData();
  return useQuery({
    queryKey: ['options', ...buildKey(build), kind, role],
    queryFn: () => compatibility.compatibleOptions(build!, kind, role),
    enabled: Boolean(build),
    placeholderData: keepPreviousData,
  });
}
