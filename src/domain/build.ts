/*
 * Build operations. Every change produces a NEW immutable BuildSnapshot revision (revision + 1);
 * earlier revisions are kept in the draft history and never rewritten. Evaluations, estimates and
 * quotes are scoped to (build id, revision), so any change makes earlier results stale.
 *
 * Selection roles: the contract's rules address `role: "primary"`. A kind's first selection is
 * primary; further selections of `cardinality: many` kinds get distinct roles.
 */
import type {
  BuildSnapshot,
  CatalogItem,
  ComponentKind,
  Selection,
  SelectionSettingsMap,
} from '../contracts';
import { BASELINE_GRAPH, BASELINE_RULESET, kindDef } from '../contracts';
import { primarySelection } from './activation';

export const DEFAULT_PRICEBOOK_ID = 'prices.demo.1';

export type BuildObjectives = BuildSnapshot['objectives'];

export interface ChangeRecord {
  revision: number;
  at: string;
  summary: string;
  changedKinds: ComponentKind[];
}

export interface BuildDraft {
  /** Head revision. */
  build: BuildSnapshot;
  /** All revisions, oldest first (head included). */
  revisions: BuildSnapshot[];
  changes: ChangeRecord[];
}

export const MAX_REVISIONS_KEPT = 50;

export interface NewBuildOptions {
  id?: string;
  name?: string;
  catalogSnapshotId: string;
  now?: string;
  objectives?: Partial<BuildObjectives>;
}

export function newBuildId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `build.local.${rand}`;
}

export function createBuild(opts: NewBuildOptions): BuildSnapshot {
  const now = opts.now ?? new Date().toISOString();
  return {
    schema_version: '1.0.0',
    id: opts.id ?? newBuildId(),
    revision: 1,
    name: opts.name ?? 'Untitled AI stack',
    owner_ref: 'local.browser',
    lifecycle: 'draft',
    created_at: now,
    updated_at: now,
    objectives: {
      region: 'us-east-demo',
      currency: 'USD',
      data_classification: 'internal',
      ...opts.objectives,
    },
    locks: {
      catalog_snapshot_id: opts.catalogSnapshotId,
      ruleset_id: BASELINE_RULESET.id,
      ruleset_version: BASELINE_RULESET.version,
      dependency_graph_id: BASELINE_GRAPH.id,
      dependency_graph_revision: BASELINE_GRAPH.revision,
      pricebook_id: DEFAULT_PRICEBOOK_ID,
    },
    selections: [],
    links: [],
    policy: {
      fail_on_unknown: false,
      require_evaluations_for_production: true,
      allow_unverified_catalog_items: true,
      min_resource_confidence: 'calibrated',
    },
  };
}

export function createDraft(build: BuildSnapshot, summary = 'Created build'): BuildDraft {
  return {
    build,
    revisions: [build],
    changes: [{ revision: build.revision, at: build.updated_at, summary, changedKinds: [] }],
  };
}

/** Applies a pure change to the head and appends the next revision. */
export function commit(
  draft: BuildDraft,
  change: (b: BuildSnapshot) => BuildSnapshot,
  summary: string,
  changedKinds: ComponentKind[],
  now: string = new Date().toISOString(),
): BuildDraft {
  const head = draft.build;
  const changed = change(structuredClone(head));
  const next: BuildSnapshot = { ...changed, revision: head.revision + 1, updated_at: now };
  const revisions = [...draft.revisions, next].slice(-MAX_REVISIONS_KEPT);
  const changes = [
    ...draft.changes,
    { revision: next.revision, at: now, summary, changedKinds },
  ].slice(-MAX_REVISIONS_KEPT);
  return { build: next, revisions, changes };
}

const ROLE_SEQUENCE = ['primary', 'secondary', 'tertiary'];

function nextRole(build: BuildSnapshot, kind: ComponentKind): string {
  const used = new Set(build.selections.filter((s) => s.kind === kind).map((s) => s.role));
  for (const r of ROLE_SEQUENCE) if (!used.has(r)) return r;
  let n = ROLE_SEQUENCE.length + 1;
  while (used.has(`additional-${n}`)) n++;
  return `additional-${n}`;
}

function nextSelectionId(build: BuildSnapshot, kind: ComponentKind): string {
  const base = `sel_${kind}`;
  const used = new Set(build.selections.map((s) => s.id));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Contract-required settings plus sensible, clearly user-editable defaults. */
export function defaultSettings(
  build: BuildSnapshot,
  item: CatalogItem,
  catalog: ReadonlyMap<string, CatalogItem>,
): Record<string, unknown> {
  const spec = item.spec as Record<string, unknown>;
  const objectives = build.objectives;
  const modeSel = primarySelection(build, 'deployment_mode');
  const mode = modeSel
    ? (catalog.get(modeSel.catalog_item_id)?.spec as { mode?: string } | undefined)?.mode
    : undefined;
  switch (item.kind) {
    case 'workload': {
      const s: SelectionSettingsMap['workload'] = {};
      for (const key of [
        'concurrency',
        'requests_per_day',
        'avg_input_tokens',
        'avg_output_tokens',
        'latency_budget_ms',
      ] as const) {
        if (typeof spec[key] === 'number') s[key] = spec[key] as number;
      }
      return { ...s };
    }
    case 'model': {
      const access = (spec.access_modes as string[]) ?? [];
      const selfHosted = mode === 'self_hosted' || (mode === 'hybrid' && !access.includes('api'));
      const servingMode = access.includes('api') && !selfHosted ? 'api' : 'weights';
      const precisions = (spec.supported_precisions as string[] | undefined) ?? [];
      return servingMode === 'weights' && precisions[0]
        ? { serving_mode: servingMode, precision: precisions[0] }
        : { serving_mode: servingMode };
    }
    case 'context_policy': {
      const cap = typeof spec.max_allowed_tokens === 'number' ? spec.max_allowed_tokens : 8192;
      const reserved = 512;
      return {
        requested_context_tokens: Math.max(1, Math.min(4096, cap - reserved)),
        reserved_output_tokens: reserved,
        truncation_strategy: ((spec.supported_truncation as string[] | undefined) ?? ['reject'])[0],
      };
    }
    case 'hosting_platform': {
      const regions = (spec.regions as string[] | undefined) ?? [];
      const region = regions.includes(objectives.region) ? objectives.region : regions[0];
      return region ? { region } : {};
    }
    case 'accelerator':
      return { device_count: 1 };
    case 'compute_profile':
      return {
        instances: 1,
        reserved_hours_per_month: 720,
        ...(typeof spec.region === 'string' ? { region: spec.region } : {}),
      };
    case 'inference_engine': {
      const modelSel = primarySelection(build, 'model');
      const precision = (modelSel?.settings as { precision?: string } | undefined)?.precision;
      const supported = (spec.supported_precisions as string[]) ?? [];
      return {
        tensor_parallel_size: 1,
        ...(precision && supported.includes(precision)
          ? { precision }
          : supported[0]
            ? { precision: supported[0] }
            : {}),
      };
    }
    case 'storage':
      return {
        provisioned_gb: 50,
        ...(typeof spec.region === 'string' ? { region: spec.region } : {}),
      };
    case 'vector_database': {
      const embSel = primarySelection(build, 'embedding_model');
      const emb = embSel ? catalog.get(embSel.catalog_item_id) : undefined;
      const dims = (emb?.spec as { embedding_dimensions?: number } | undefined)
        ?.embedding_dimensions;
      const metrics = (spec.supported_metrics as string[]) ?? ['cosine'];
      return { index_dimension: dims ?? 768, similarity_metric: metrics[0] ?? 'cosine' };
    }
    case 'embedding_model':
      return typeof spec.embedding_dimensions === 'number'
        ? { output_dimensions: spec.embedding_dimensions }
        : {};
    case 'knowledge_base':
      return {
        chunk_size_tokens: 400,
        chunk_overlap_tokens: 40,
        acl_enforced: spec.supports_acl === true,
      };
    case 'rag_pipeline':
      return { top_k: 5, rerank_enabled: spec.supports_rerank === true };
    case 'tool':
      return { enabled: true };
    case 'data_source':
      return { enabled: true };
    case 'integration':
      return { enabled: true };
    case 'deployment_target':
      return {
        environment: 'staging',
        ...(typeof spec.region === 'string' ? { region: spec.region } : {}),
      };
    case 'cost_policy':
      return {
        enforce_hard_cap: spec.supports_hard_cap === true,
        ...(objectives.monthly_budget_amount
          ? { monthly_budget_amount: objectives.monthly_budget_amount }
          : {}),
        ...(typeof spec.alert_threshold_pct === 'number'
          ? { notify_at_pct: spec.alert_threshold_pct }
          : {}),
      };
    default:
      return {};
  }
}

function objectivesFromWorkload(objectives: BuildObjectives, item: CatalogItem): BuildObjectives {
  if (item.kind !== 'workload') return objectives;
  const spec = item.spec as Record<string, unknown>;
  const next = { ...objectives };
  if (typeof spec.requests_per_day === 'number') next.requests_per_day = spec.requests_per_day;
  if (typeof spec.avg_input_tokens === 'number') next.avg_input_tokens = spec.avg_input_tokens;
  if (typeof spec.avg_output_tokens === 'number') next.avg_output_tokens = spec.avg_output_tokens;
  if (typeof spec.concurrency === 'number') next.max_concurrency = spec.concurrency;
  if (typeof spec.latency_budget_ms === 'number') next.max_latency_ms = spec.latency_budget_ms;
  if (typeof spec.data_classification === 'string') {
    next.data_classification = spec.data_classification as BuildObjectives['data_classification'];
  }
  return next;
}

export interface AddOptions {
  /** Add as an additional selection instead of replacing the primary (cardinality "many" only). */
  additional?: boolean;
}

/** Adds an item. For `cardinality: one` kinds (or when not additional) it replaces the primary. */
export function addOrReplace(
  build: BuildSnapshot,
  item: CatalogItem,
  catalog: ReadonlyMap<string, CatalogItem>,
  opts: AddOptions = {},
): BuildSnapshot {
  const kind = item.kind;
  const existing =
    primarySelection(build, kind) ??
    build.selections.find((s) => s.kind === kind && s.role === 'primary');
  const many = kindDef(kind).cardinality === 'many';
  if (existing && !(opts.additional && many)) {
    return replaceSelection(build, existing.id, item, catalog);
  }
  const selection: Selection = {
    id: nextSelectionId(build, kind),
    kind,
    catalog_item_id: item.id,
    catalog_item_version: item.version,
    role: nextRole(build, kind),
    enabled: true,
    settings: defaultSettings(build, item, catalog),
  };
  return {
    ...build,
    objectives: objectivesFromWorkload(build.objectives, item),
    selections: [...build.selections, selection],
  };
}

export function replaceSelection(
  build: BuildSnapshot,
  selectionId: string,
  item: CatalogItem,
  catalog: ReadonlyMap<string, CatalogItem>,
): BuildSnapshot {
  return {
    ...build,
    objectives: objectivesFromWorkload(build.objectives, item),
    selections: build.selections.map((s) =>
      s.id === selectionId
        ? {
            ...s,
            catalog_item_id: item.id,
            catalog_item_version: item.version,
            settings: defaultSettings(build, item, catalog),
          }
        : s,
    ),
  };
}

/** Removes a selection and any links that reference it. Never removes other selections. */
export function removeSelection(build: BuildSnapshot, selectionId: string): BuildSnapshot {
  const removed = build.selections.find((s) => s.id === selectionId);
  let selections = build.selections.filter((s) => s.id !== selectionId);
  // Promote the next selection of the same kind to primary so rules keep addressing a component.
  if (removed?.role === 'primary') {
    const promote = selections.find((s) => s.kind === removed.kind);
    if (promote)
      selections = selections.map((s) => (s.id === promote.id ? { ...s, role: 'primary' } : s));
  }
  return {
    ...build,
    selections,
    links: build.links.filter(
      (l) => l.from_selection_id !== selectionId && l.to_selection_id !== selectionId,
    ),
  };
}

export function updateSettings(
  build: BuildSnapshot,
  selectionId: string,
  patch: Record<string, unknown>,
): BuildSnapshot {
  return {
    ...build,
    selections: build.selections.map((s) => {
      if (s.id !== selectionId) return s;
      const settings = { ...(s.settings as Record<string, unknown>) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v)))
          delete settings[k];
        else settings[k] = v;
      }
      return { ...s, settings };
    }),
  };
}

export function setEnabled(
  build: BuildSnapshot,
  selectionId: string,
  enabled: boolean,
): BuildSnapshot {
  return {
    ...build,
    selections: build.selections.map((s) => (s.id === selectionId ? { ...s, enabled } : s)),
  };
}

export function updateObjectives(
  build: BuildSnapshot,
  patch: Partial<BuildObjectives>,
): BuildSnapshot {
  const objectives = { ...build.objectives } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v)))
      delete objectives[k];
    else objectives[k] = v;
  }
  return { ...build, objectives: objectives as BuildObjectives };
}

export function rename(build: BuildSnapshot, name: string): BuildSnapshot {
  return { ...build, name: name.trim().slice(0, 160) || build.name };
}

export function selectionsOfKind(build: BuildSnapshot, kind: ComponentKind): Selection[] {
  return build.selections.filter((s) => s.kind === kind);
}

/** The contract requires at least two selections for a schema-valid BuildSnapshot. */
export const MIN_SELECTIONS_FOR_SNAPSHOT = 2;
