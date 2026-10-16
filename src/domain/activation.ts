/*
 * Activation semantics from the contract:
 *  - Registry activation (component-registry.json): always | non_api | self_hosted | optional —
 *    decides whether a kind is needed for the build's deployment mode.
 *  - Graph edge activation (docs/DEPENDENCIES.md): always | self_hosted | non_api | rag_enabled |
 *    agents_enabled | fine_tuning_enabled | if_selected | production_only — decides whether a
 *    dependency edge is currently relevant for invalidation. Unknown activation is treated as active
 *    ("conservatively invalidate and reevaluate").
 */
import type { BuildSnapshot, CatalogItem, ComponentKind, DependencyGraph } from '../contracts';
import { KINDS, kindDef } from '../contracts';

export type DeploymentModeValue = 'api' | 'managed' | 'self_hosted' | 'hybrid';
export type EdgeActivation = DependencyGraph['edges'][number]['activation'];

export interface BuildContext {
  /** Mode of the enabled primary deployment_mode selection; undefined when not chosen or unresolvable. */
  mode: DeploymentModeValue | undefined;
  selectedKinds: ReadonlySet<ComponentKind>;
  ragEnabled: boolean;
  agentsEnabled: boolean;
  fineTuningEnabled: boolean;
  production: boolean | undefined;
}

export function primarySelection(build: BuildSnapshot, kind: ComponentKind) {
  return build.selections.find((s) => s.kind === kind && s.role === 'primary' && s.enabled);
}

export function buildContext(
  build: BuildSnapshot,
  catalog: ReadonlyMap<string, CatalogItem>,
): BuildContext {
  const active = build.selections.filter((s) => s.enabled);
  const selectedKinds = new Set(active.map((s) => s.kind));
  const modeSel = primarySelection(build, 'deployment_mode');
  const modeItem = modeSel ? catalog.get(modeSel.catalog_item_id) : undefined;
  const mode =
    modeItem?.kind === 'deployment_mode'
      ? ((modeItem.spec as { mode: DeploymentModeValue }).mode ?? undefined)
      : undefined;
  const target = primarySelection(build, 'deployment_target');
  const env = target ? (target.settings as { environment?: string }).environment : undefined;
  return {
    mode,
    selectedKinds,
    ragEnabled: selectedKinds.has('rag_pipeline'),
    agentsEnabled: selectedKinds.has('agent_framework'),
    fineTuningEnabled: KINDS.some((k) => k.tier === 'T5' && selectedKinds.has(k.kind)),
    production: target ? (env === undefined ? undefined : env === 'production') : false,
  };
}

/** Three-valued: true/false, or undefined when it cannot be determined. */
export function edgeActive(
  activation: EdgeActivation,
  ctx: BuildContext,
  ends: [ComponentKind, ComponentKind],
): boolean | undefined {
  switch (activation) {
    case 'always':
      return true;
    case 'self_hosted':
      return ctx.mode === undefined
        ? undefined
        : ctx.mode === 'self_hosted' || ctx.mode === 'hybrid';
    case 'non_api':
      return ctx.mode === undefined ? undefined : ctx.mode !== 'api';
    case 'rag_enabled':
      return ctx.ragEnabled;
    case 'agents_enabled':
      return ctx.agentsEnabled;
    case 'fine_tuning_enabled':
      return ctx.fineTuningEnabled;
    case 'if_selected':
      return ctx.selectedKinds.has(ends[0]) && ctx.selectedKinds.has(ends[1]);
    case 'production_only':
      return ctx.production;
  }
}

export type KindNeed = 'needed' | 'not_needed' | 'optional' | 'depends_on_mode';

/** Whether a kind is needed under the build's deployment mode (registry activation). */
export function kindNeed(kind: ComponentKind, mode: DeploymentModeValue | undefined): KindNeed {
  const { activation } = kindDef(kind);
  if (activation === 'always') return 'needed';
  if (activation === 'optional') return 'optional';
  if (mode === undefined) return 'depends_on_mode';
  if (activation === 'non_api') return mode === 'api' ? 'not_needed' : 'needed';
  return mode === 'self_hosted' || mode === 'hybrid' ? 'needed' : 'not_needed';
}

export const KIND_NEED_LABEL: Record<KindNeed, string> = {
  needed: 'Needed',
  not_needed: 'Not needed for this mode',
  optional: 'Optional',
  depends_on_mode: 'Depends on deployment mode',
};

export interface Coverage {
  needed: ComponentKind[];
  satisfied: ComponentKind[];
  missing: ComponentKind[];
  dependsOnMode: ComponentKind[];
  optionalSelected: ComponentKind[];
}

export function coverage(build: BuildSnapshot, ctx: BuildContext): Coverage {
  const needed: ComponentKind[] = [];
  const satisfied: ComponentKind[] = [];
  const missing: ComponentKind[] = [];
  const dependsOnMode: ComponentKind[] = [];
  const optionalSelected: ComponentKind[] = [];
  for (const k of KINDS) {
    const need = kindNeed(k.kind, ctx.mode);
    const has = Boolean(primarySelection(build, k.kind));
    if (need === 'needed') {
      needed.push(k.kind);
      (has ? satisfied : missing).push(k.kind);
    } else if (need === 'depends_on_mode') {
      dependsOnMode.push(k.kind);
    } else if (need === 'optional' && has) {
      optionalSelected.push(k.kind);
    }
  }
  return { needed, satisfied, missing, dependsOnMode, optionalSelected };
}
