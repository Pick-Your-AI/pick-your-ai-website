/*
 * Field metadata derived from the contract JSON Schemas, so facets, spec tables and settings forms
 * follow the contract instead of a hand-maintained duplicate.
 */
import catalogItemSchema from '../../contracts/v1/schemas/catalog-item.schema.json';
import selectionSchema from '../../contracts/v1/schemas/selection.schema.json';
import type { ComponentKind } from '../contracts';

export type FieldType =
  'string' | 'integer' | 'number' | 'boolean' | 'enum' | 'enum-array' | 'string-array';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  required: boolean;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  description?: string;
  isRef: boolean;
}

interface JsonSchemaProp {
  type?: string;
  enum?: string[];
  items?: { type?: string; enum?: string[] };
  minimum?: number;
  maximum?: number;
  pattern?: string;
  description?: string;
  $ref?: string;
}

interface DefsSchema {
  $defs: Record<string, { properties?: Record<string, JsonSchemaProp>; required?: string[] }>;
}

const LABEL_OVERRIDES: Record<string, string> = {
  vram_gb: 'VRAM (GB)',
  ram_gb: 'RAM (GB)',
  disk_gb: 'Disk (GB)',
  max_capacity_gb: 'Max capacity (GB)',
  provisioned_gb: 'Provisioned (GB)',
  cpu_cores: 'CPU cores',
  context_window_tokens: 'Context window (tokens)',
  max_output_tokens: 'Max output (tokens)',
  min_weights_vram_gb: 'Min. weights VRAM (GB)',
  max_allowed_tokens: 'Max allowed tokens',
  rag_pipeline: 'RAG pipeline',
  mcp_server: 'MCP server',
  api_base_url: 'API base URL',
  network_gbps: 'Network (Gbps)',
  rated_power_w: 'Rated power (W)',
  ttl_hours: 'TTL (hours)',
  timeout_ms: 'Timeout (ms)',
  latency_budget_ms: 'Latency budget (ms)',
  top_k: 'Top-k',
  uptime_target_pct: 'Uptime target (%)',
  alert_threshold_pct: 'Alert threshold (%)',
  notify_at_pct: 'Notify at (%)',
  spdx_id: 'SPDX licence id',
  kv_cache_precision: 'KV-cache precision',
  credential_ref: 'Credential reference',
};

export function humanize(key: string): string {
  if (Object.hasOwn(LABEL_OVERRIDES, key)) return LABEL_OVERRIDES[key]!;
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toField(key: string, p: JsonSchemaProp, required: boolean): FieldDef {
  let type: FieldType = 'string';
  let options: string[] | undefined;
  if (p.enum) {
    type = 'enum';
    options = p.enum;
  } else if (p.type === 'array') {
    if (p.items?.enum) {
      type = 'enum-array';
      options = p.items.enum;
    } else type = 'string-array';
  } else if (p.type === 'integer' || p.type === 'number' || p.type === 'boolean') {
    type = p.type;
  }
  return {
    key,
    label: humanize(key),
    type,
    options,
    required,
    minimum: p.minimum,
    maximum: p.maximum,
    pattern: p.pattern,
    description: p.description,
    isRef: /_refs?$/.test(key),
  };
}

function fieldsFrom(schema: DefsSchema, def: string): FieldDef[] {
  const d = schema.$defs[def];
  if (!d?.properties) return [];
  const required = new Set(d.required ?? []);
  return Object.entries(d.properties).map(([k, p]) => toField(k, p, required.has(k)));
}

/** Catalog `spec` fields for a kind (catalog-item.schema.json $defs/spec_<kind>). */
export function specFields(kind: ComponentKind): FieldDef[] {
  return fieldsFrom(catalogItemSchema as unknown as DefsSchema, `spec_${kind}`);
}

/** Selection `settings` fields for a kind (selection.schema.json $defs/settings_<kind>). */
export function settingsFields(kind: ComponentKind): FieldDef[] {
  return fieldsFrom(selectionSchema as unknown as DefsSchema, `settings_${kind}`);
}

/** Enum values are identifiers in the contract; tables read better with sentence-case words. */
const VALUE_LABELS: Record<string, string> = {
  api: 'API',
  api_endpoint: 'API endpoint',
  api_only: 'API only',
  mcp: 'MCP',
  sql: 'SQL',
  tls: 'TLS',
  sso: 'SSO',
  gdpr: 'GDPR',
  vpc: 'VPC',
  kms: 'KMS',
  oidc: 'OIDC',
  saml: 'SAML',
  https: 'HTTPS',
  json: 'JSON',
  csv: 'CSV',
  parquet: 'Parquet',
  s3: 'S3',
  gcs: 'GCS',
  azure_blob: 'Azure Blob',
  oss: 'Open source',
  rag: 'RAG',
  onprem: 'On-premises',
  on_prem: 'On-premises',
  hybrid: 'Hybrid',
  local: 'Local',
  gpu: 'GPU',
  cpu: 'CPU',
  generative: 'Generative',
  embedding: 'Embedding',
  restricted: 'Restricted',
  confidential: 'Confidential',
  internal: 'Internal',
  public: 'Public',
  text: 'Text',
  structured: 'Structured',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  chat: 'Chat',
  agentic: 'Agentic',
  asr: 'Speech-to-text',
  tts: 'Text-to-speech',
};

const wordize = (raw: string): string => {
  const key = raw.trim();
  if (Object.hasOwn(VALUE_LABELS, key)) return VALUE_LABELS[key]!;
  const spaced = key.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export function formatValue(
  value: unknown,
  field?: Pick<FieldDef, 'key'> & Partial<Pick<FieldDef, 'type'>>,
): string {
  if (value === undefined || value === null) return 'Not specified';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    return field?.key.endsWith('_pct') ? `${value}%` : value.toLocaleString('en-US');
  }
  const format = (v: unknown) =>
    field?.type === 'enum' || field?.type === 'enum-array' ? wordize(String(v)) : String(v);
  if (Array.isArray(value)) return value.length ? value.map(format).join(', ') : 'None';
  return format(value);
}
