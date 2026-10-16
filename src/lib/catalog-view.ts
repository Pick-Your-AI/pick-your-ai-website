import type { CatalogItem, ComponentKind } from '../contracts';
import { kindSlug } from '../contracts';
import { formatValue } from './schema-fields';

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
    .map((k) => specValue(item, k))
    .filter((v) => v !== undefined)
    .map((v) => formatValue(v))
    .join(' · ');
}

export const BILLING_LABELS: Record<CatalogItem['billing_class'], string> = {
  free: 'Free',
  included: 'Included',
  metered: 'Metered (usage-priced)',
  unknown: 'Unknown billing — not zero cost',
};
