/*
 * TanStack Query hooks. Build-dependent keys include id, revision and snapshot content, so an
 * edited staged draft cannot reuse another snapshot's results. Previous cost/report data stays
 * an explicitly flagged placeholder; capacity evidence awaits current results.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { BuildSnapshot, CatalogItem, ComponentKind } from '../contracts';
import { buildQueryKey } from './build-query-key';
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

/** Cost → resources → evaluation for the exact build snapshot. */
export function useBuildAnalysis(build: BuildSnapshot | null | undefined) {
  const data = useData();
  const enabled = Boolean(build);
  const cost = useQuery({
    queryKey: ['cost', ...buildQueryKey(build)],
    queryFn: () => data.pricing.estimate(build!),
    enabled,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const resources = useQuery({
    queryKey: ['resources', ...buildQueryKey(build)],
    queryFn: () => data.resources.estimate(build!),
    enabled,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const costReady =
    build &&
    !cost.isError &&
    !cost.isPlaceholderData &&
    cost.data?.build_id === build.id &&
    cost.data.build_revision === build.revision;
  const resourceEstimate =
    build &&
    !resources.isError &&
    !resources.isPlaceholderData &&
    resources.data?.status === 'available' &&
    resources.data.estimate.build_id === build.id &&
    resources.data.estimate.build_revision === build.revision
      ? resources.data.estimate
      : null;
  const evaluation = useQuery({
    queryKey: [
      'evaluation',
      ...buildQueryKey(build),
      // Changed evidence must not reuse an earlier report merely by retaining its ID.
      costReady ? cost.data : null,
      resourceEstimate,
    ],
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
  const reportIsCurrent = Boolean(
    !evaluation.isPlaceholderData &&
    !evaluation.isError &&
    !cost.isFetching &&
    (!resources.isFetching || !resourceEstimate) &&
    report &&
    build &&
    report.build_id === build.id &&
    report.build_revision === build.revision,
  );
  const costIsCurrent = Boolean(costReady);
  return {
    report,
    reportIsCurrent,
    evaluation,
    cost: cost.data,
    costIsCurrent,
    costQuery: cost,
    resources:
      build &&
      !resources.isPlaceholderData &&
      !resources.isError &&
      (resources.data?.status === 'unavailable' || resourceEstimate)
        ? resources.data
        : undefined,
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
    queryKey: ['options', ...buildQueryKey(build), kind, role],
    queryFn: () => compatibility.compatibleOptions(build!, kind, role),
    enabled: Boolean(build),
    placeholderData: keepPreviousData,
  });
}
