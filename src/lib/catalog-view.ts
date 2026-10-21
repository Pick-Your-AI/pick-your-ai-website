import { specFields } from './schema-fields';
import type { CatalogItem, ComponentKind } from '../contracts';
import { KIND_LABELS, kindSlug } from '../contracts';
import { formatValue } from './schema-fields';
import { layerOf } from './layers';

/*
 * Catalog ids contain dots (e.g. demo.model.open-8b). The production server does not SPA-rewrite
 * paths that end in something that looks like a file extension, so ids are written into URLs with
 * "~" in place of "." (a character the contract id pattern never uses).
 */
export const idToSlug = (id: string) => id.replace(/\./g, '~');
export const slugToId = (slug: string) => decodeURIComponent(slug).replace(/~/g, '.');

export const kindPath = (kind: ComponentKind) => `/catalog/${kindSlug(kind)}`;
export const itemPath = (item: Pick<CatalogItem, 'id' | 'kind'>) =>
  `${kindPath(item.kind)}/${idToSlug(item.id)}`;

/** The 3–5 most decision-relevant spec fields per kind, shown as table columns and row summaries. */
export const KEY_FIELDS: Record<ComponentKind, string[]> = {
  workload: ['workload_type', 'modalities', 'requests_per_day', 'data_classification'],
  deployment_mode: ['mode', 'allowed_regions'],
  model_provider: ['supported_regions', 'supports_fine_tuning', 'supported_auth'],
  model: [
    'model_type',
    'context_window_tokens',
    'access_modes',
    'model_formats',
    'supports_tool_calling',
  ],
  context_policy: ['max_allowed_tokens', 'supported_truncation'],
  hosting_platform: ['hosting_type', 'regions', 'supports_private_networking'],
  accelerator: ['accelerator_type', 'vram_gb', 'backends', 'precisions'],
  compute_profile: ['accelerator_count', 'cpu_cores', 'ram_gb', 'region'],
  inference_engine: ['backends', 'model_formats', 'supported_precisions', 'supports_multi_gpu'],
  storage: ['storage_type', 'region', 'encryption_at_rest'],
  data_source: ['source_type', 'classification', 'access_controlled'],
  knowledge_base: ['supported_modalities', 'supports_acl', 'supports_incremental_sync'],
  embedding_model: ['embedding_dimensions', 'similarity_metrics', 'access_modes'],
  vector_database: ['supported_metrics', 'max_dimensions', 'supports_acl'],
  rag_pipeline: ['retrieval_mode', 'supports_rerank'],
  agent_framework: [
    'programming_languages',
    'supports_mcp',
    'supports_memory',
    'supports_tool_execution',
  ],
  tool: ['protocol', 'side_effect', 'auth_methods'],
  mcp_server: ['transport', 'auth_methods', 'trust_level'],
  memory_store: ['memory_type', 'backing_type', 'supports_ttl'],
  integration: ['integration_type', 'auth_methods', 'rate_limit_per_minute'],
  training_framework: ['methods', 'backends', 'distributed_supported'],
  training_compute: ['max_gpu_hours', 'ephemeral'],
  training_dataset: [
    'example_count',
    'data_classification',
    'license_verified',
    'privacy_approved',
  ],
  fine_tuned_model: ['artifact_format', 'adapter_only', 'supported_access_modes'],
  guardrail: ['targets', 'policies', 'enforcement'],
  evaluation_suite: ['metric_names', 'mode', 'gate_on_deployment'],
  deployment_target: ['target_type', 'region', 'supports_rollback'],
  monitoring_stack: ['signals', 'pii_redaction', 'retention_days'],
  cost_policy: ['default_currency', 'supports_hard_cap', 'alert_threshold_pct'],
};

export function specValue(item: CatalogItem, key: string): unknown {
  return (item.spec as Record<string, unknown>)[key];
}

export function itemSummary(item: CatalogItem, max = 3): string {
  return KEY_FIELDS[item.kind]
    .slice(0, max)
    .filter((k) => specValue(item, k) !== undefined)
    .map((k) =>
      formatValue(
        specValue(item, k),
        specFields(item.kind).find((f) => f.key === k),
      ),
    )
    .join(' · ');
}

export const BILLING_LABELS: Record<CatalogItem['billing_class'], string> = {
  free: 'Free',
  included: 'Included',
  metered: 'Metered (usage-priced)',
  unknown: 'Unknown billing — not zero cost',
};

/**
 * Short, informative subtitle for a catalog row: one real spec value with a compact label, e.g.
 * "8,192 ctx", "24 GB VRAM", "3 regions". Used under a product name in the parts tables.
 *
 * Rules that keep it honest:
 *  - only values the catalog actually records are shown (nothing is inferred);
 *  - numeric specs win, because they are the most comparable thing on a parts list;
 *  - single generic words ("USD", "Deploy", "GPU") are skipped rather than padded with filler;
 *  - when nothing qualifies, the licence is used, and if that is absent the caller gets ''.
 */
const SPEC_SHORT: Record<string, string> = {
  context_window_tokens: 'ctx',
  max_allowed_tokens: 'max tokens',
  vram_gb: 'GB VRAM',
  requests_per_day: 'req/day',
  accelerator_count: 'accelerators',
  cpu_cores: 'cores',
  ram_gb: 'GB RAM',
  embedding_dimensions: 'dims',
  max_dimensions: 'max dims',
  example_count: 'examples',
  retention_days: 'days',
  max_gpu_hours: 'GPU-h',
  rate_limit_per_minute: 'req/min',
  alert_threshold_pct: 'alert',
  concurrency: 'concurrent',
  avg_input_tokens: 'in tokens',
  avg_output_tokens: 'out tokens',
  latency_budget_ms: 'ms budget',
};

/** Words that carry no distinguishing information in a list of same-kind products. */
const LOW_SIGNAL = new Set([
  'usd',
  'eur',
  'gbp',
  'demo',
  'deploy',
  'block',
  'gpu',
  'cpu',
  'agents',
  'models',
  'infrastructure',
  'knowledge',
  'deploy',
  'api',
  'yes',
  'no',
  'none',
]);

const isNumeric = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

export function rowSubtitle(item: CatalogItem): string {
  const spec = item.spec as Record<string, unknown>;
  const candidates = KEY_FIELDS[item.kind] ?? [];

  // Pass 1: a number with a compact label is the most useful thing to show.
  for (const key of candidates) {
    const v = spec[key];
    if (!isNumeric(v)) continue;
    const short = SPEC_SHORT[key];
    const value = (v as number).toLocaleString('en-US');
    return short ? `${value} ${short}` : value;
  }

  // The subtitle must add information, not restate the kind or layer the row already shows.
  const context = `${KIND_LABELS[item.kind]} ${layerOf(item.tier).name}`.toLowerCase();
  const restates = (text: string) => {
    const t = text.trim().toLowerCase();
    return !t || LOW_SIGNAL.has(t) || context.includes(t);
  };
  // formatValue knows the acronym/enum wording ("api" -> "API"), so reuse it rather than guessing.
  const word = (raw: string, key: string) =>
    formatValue(
      raw,
      specFields(item.kind).find((f) => f.key === key),
    );

  // Pass 2: a short list of values ("text, structured") beats a single generic word.
  for (const key of candidates) {
    const v = spec[key];
    if (!Array.isArray(v) || !v.length) continue;
    const words = v.map((x) => word(String(x), key));
    const joined = words.slice(0, 2).join(', ');
    if (restates(words[0]!)) continue;
    return joined;
  }

  // Pass 3: a multi-word enum still tells you something ("Hybrid (API + self-hosted)").
  for (const key of candidates) {
    const v = spec[key];
    if (typeof v !== 'string' || !v.trim()) continue;
    const text = word(v, key);
    if (restates(text)) continue;
    if (text.includes(' ') || text.length > 6) return text;
  }

  return item.license?.spdx_id ?? '';
}
