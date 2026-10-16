import registryJson from '../../contracts/v1/schemas/component-registry.json';
import type {
  CatalogItem,
  CatalogSpecMap,
  Selection,
  SelectionSettingsMap,
} from './generated/contract-types';

/** Canonical component kind ids (contract `component-registry.json`). */
export type ComponentKind = CatalogItem['kind'];
export type Tier = CatalogItem['tier'];
export type Cardinality = 'one' | 'many';
/** Registry-level activation: when a kind is relevant to a build. */
export type KindActivation = 'always' | 'non_api' | 'self_hosted' | 'optional';

export interface KindDefinition {
  kind: ComponentKind;
  tier: Tier;
  cardinality: Cardinality;
  activation: KindActivation;
  notes: string;
}

interface RegistryFile {
  schema_version: string;
  description: string;
  kinds: Record<string, { tier: string; cardinality: string; activation: string; notes: string }>;
}

const registry = registryJson as RegistryFile;

export const REGISTRY_SCHEMA_VERSION = registry.schema_version;

/** Kinds in registry order (T0 → T6). */
export const KINDS: readonly KindDefinition[] = Object.entries(registry.kinds).map(
  ([kind, def]) => ({
    kind: kind as ComponentKind,
    tier: def.tier as Tier,
    cardinality: def.cardinality as Cardinality,
    activation: def.activation as KindActivation,
    notes: def.notes,
  }),
);

export const KIND_BY_ID: ReadonlyMap<ComponentKind, KindDefinition> = new Map(
  KINDS.map((k) => [k.kind, k]),
);

export const TIERS: readonly Tier[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

export function kindsInTier(tier: Tier): KindDefinition[] {
  return KINDS.filter((k) => k.tier === tier);
}

export function isComponentKind(value: string): value is ComponentKind {
  return KIND_BY_ID.has(value as ComponentKind);
}

export function kindDef(kind: ComponentKind): KindDefinition {
  const def = KIND_BY_ID.get(kind);
  if (!def) throw new Error(`Unknown component kind: ${kind}`);
  return def;
}

/** A catalog item narrowed to one kind, with its typed `spec`. */
export type CatalogItemOf<K extends ComponentKind> = Omit<CatalogItem, 'kind' | 'spec'> & {
  kind: K;
  spec: CatalogSpecMap[K];
};

/** A selection narrowed to one kind, with its typed `settings`. */
export type SelectionOf<K extends ComponentKind> = Omit<Selection, 'kind' | 'settings'> & {
  kind: K;
  settings: SelectionSettingsMap[K];
};

export function specOf<K extends ComponentKind>(
  item: CatalogItem,
  kind: K,
): CatalogSpecMap[K] | undefined {
  return item.kind === kind ? (item.spec as CatalogSpecMap[K]) : undefined;
}
