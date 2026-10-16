/*
 * SYNTHETIC DEMONSTRATION CATALOG.
 *
 * Every item below is fictional. Names, specifications, regions and licences are invented to
 * exercise the builder and the contract's compatibility rules; none describes a real product,
 * vendor, price or measurement. All items carry provenance `verification_status: "unverified"` and
 * a note saying so, and the UI labels them as demo data. Tests validate every item against
 * contracts/v1/schemas/catalog-item.schema.json.
 */
import type {
  CatalogItem,
  CatalogItemOf,
  CatalogSnapshot,
  CatalogSpecMap,
  ComponentKind,
  Tier,
} from '../../contracts';
import { kindDef } from '../../contracts';

export const DEMO_VERSION = 'demo-2026.10';
export const DEMO_CAPTURED_AT = '2026-10-16T00:00:00Z';
export const DEMO_SNAPSHOT_ID = 'catalog.demo.1';
export const DEMO_REGIONS = ['us-east-demo', 'eu-west-demo', 'onprem-demo'] as const;

const PROVENANCE_NOTE =
  'SYNTHETIC DEMO FIXTURE for the PickYour.AI preview. Not a real product, vendor specification, price or measurement.';

interface ItemInput<K extends ComponentKind> {
  slug: string;
  name: string;
  description: string;
  spec: CatalogSpecMap[K];
  billing?: CatalogItem['billing_class'];
  status?: CatalogItem['status'];
  tags?: string[];
  license?: CatalogItem['license'];
  updatedAt?: string;
}

function item<K extends ComponentKind>(kind: K, input: ItemInput<K>): CatalogItemOf<K> {
  return {
    schema_version: '1.0.0',
    id: `demo.${kind}.${input.slug}`,
    kind,
    tier: kindDef(kind).tier as Tier,
    name: input.name,
    version: DEMO_VERSION,
    status: input.status ?? 'active',
    billing_class: input.billing ?? 'included',
    spec: input.spec,
    description: input.description,
    tags: ['synthetic', ...(input.tags ?? [])],
    provenance: [
      { checked_at: DEMO_CAPTURED_AT, verification_status: 'unverified', notes: PROVENANCE_NOTE },
    ],
    ...(input.license ? { license: input.license } : {}),
    updated_at: input.updatedAt ?? DEMO_CAPTURED_AT,
  };
}

const id = (kind: ComponentKind, slug: string) => `demo.${kind}.${slug}`;

export const DEMO_ITEMS: CatalogItem[] = [
  // ---------------------------------------------------------------- T0
  item('workload', {
    slug: 'support-chat',
    name: 'Demo Customer Support Chat',
    description: 'Conversational assistant answering customer questions in text.',
    spec: {
      workload_type: 'chat',
      modalities: ['text'],
      concurrency: 4,
      requests_per_day: 2000,
      avg_input_tokens: 600,
      avg_output_tokens: 300,
      latency_budget_ms: 4000,
      data_classification: 'internal',
    },
  }),
  item('workload', {
    slug: 'document-qa',
    name: 'Demo Document Q&A',
    description: 'Answers questions grounded in an internal document collection (retrieval).',
    spec: {
      workload_type: 'rag',
      modalities: ['text'],
      concurrency: 2,
      requests_per_day: 500,
      avg_input_tokens: 2500,
      avg_output_tokens: 400,
      data_classification: 'confidential',
    },
  }),
  item('workload', {
    slug: 'ops-agent',
    name: 'Demo Operations Agent',
    description: 'Agent that reads tickets and calls tools to triage and update them.',
    spec: {
      workload_type: 'agentic',
      modalities: ['text', 'structured'],
      concurrency: 2,
      requests_per_day: 300,
      avg_input_tokens: 1500,
      avg_output_tokens: 600,
      data_classification: 'internal',
    },
  }),
  item('workload', {
    slug: 'restricted-assistant',
    name: 'Demo Restricted-Data Assistant',
    description: 'Assistant handling restricted records; observability must redact data.',
    spec: {
      workload_type: 'chat',
      modalities: ['text'],
      concurrency: 1,
      requests_per_day: 100,
      data_classification: 'restricted',
    },
  }),
  item('deployment_mode', {
    slug: 'api',
    name: 'Managed API (no self-hosting)',
    description: 'Call a hosted model API. No GPUs, hosting or inference runtime to manage.',
    spec: { mode: 'api' },
  }),
  item('deployment_mode', {
    slug: 'managed',
    name: 'Managed platform',
    description: 'A managed platform hosts the model; you choose the platform and region.',
    spec: { mode: 'managed', allowed_regions: ['us-east-demo', 'eu-west-demo'] },
  }),
  item('deployment_mode', {
    slug: 'self-hosted',
    name: 'Self-hosted',
    description: 'Run model weights on infrastructure you control.',
    spec: { mode: 'self_hosted', allowed_regions: [...DEMO_REGIONS] },
  }),
  item('deployment_mode', {
    slug: 'hybrid',
    name: 'Hybrid (API + self-hosted)',
    description: 'Combine hosted APIs with self-hosted components.',
    spec: { mode: 'hybrid', allowed_regions: [...DEMO_REGIONS] },
  }),

  // ---------------------------------------------------------------- T1
  item('model_provider', {
    slug: 'aurora',
    name: 'Demo Provider Aurora',
    description: 'Fictional hosted-API model provider.',
    spec: {
      supports_fine_tuning: true,
      supported_regions: ['us-east-demo', 'eu-west-demo'],
      supported_auth: ['api_key'],
    },
  }),
  item('model_provider', {
    slug: 'openlab',
    name: 'Demo Open Weights Lab',
    description: 'Fictional publisher of downloadable model weights.',
    spec: { supports_fine_tuning: true, supported_regions: [...DEMO_REGIONS] },
  }),
  item('model', {
    slug: 'aurora-large',
    name: 'Demo Aurora Large',
    description: 'API-only general model with a long context window and tool calling.',
    billing: 'metered',
    spec: {
      provider_ref: id('model_provider', 'aurora'),
      model_type: 'generative',
      modalities_in: ['text', 'image'],
      modalities_out: ['text'],
      context_window_tokens: 128000,
      max_output_tokens: 8192,
      supports_tool_calling: true,
      supports_json_schema: true,
      supports_fine_tuning: false,
      access_modes: ['api'],
      weight_access: 'none',
      model_formats: ['api_only'],
    },
  }),
  item('model', {
    slug: 'aurora-mini',
    name: 'Demo Aurora Mini',
    description: 'Smaller API-only model for high-volume chat.',
    billing: 'metered',
    spec: {
      provider_ref: id('model_provider', 'aurora'),
      model_type: 'generative',
      modalities_in: ['text'],
      modalities_out: ['text'],
      context_window_tokens: 32000,
      max_output_tokens: 4096,
      supports_tool_calling: true,
      access_modes: ['api'],
      weight_access: 'none',
      model_formats: ['api_only'],
    },
  }),
  item('model', {
    slug: 'open-8b',
    name: 'Demo Open 8B',
    description: 'Open-weights model sized for a single accelerator.',
    spec: {
      provider_ref: id('model_provider', 'openlab'),
      model_type: 'generative',
      modalities_in: ['text'],
      modalities_out: ['text'],
      context_window_tokens: 8192,
      max_output_tokens: 2048,
      supports_tool_calling: true,
      supports_fine_tuning: true,
      access_modes: ['weights'],
      weight_access: 'open',
      model_formats: ['safetensors', 'gguf'],
      supported_precisions: ['bf16', 'fp16', 'int8', 'int4'],
    },
    license: {
      spdx_id: 'LicenseRef-Demo-Open',
      commercial_use_allowed: true,
      self_hosting_allowed: true,
    },
  }),
  item('model', {
    slug: 'open-70b',
    name: 'Demo Open 70B',
    description: 'Large open-weights model; typically needs several accelerators.',
    spec: {
      provider_ref: id('model_provider', 'openlab'),
      model_type: 'generative',
      modalities_in: ['text'],
      modalities_out: ['text'],
      context_window_tokens: 32768,
      max_output_tokens: 4096,
      supports_tool_calling: true,
      supports_fine_tuning: true,
      access_modes: ['weights'],
      weight_access: 'restricted',
      model_formats: ['safetensors'],
      supported_precisions: ['bf16', 'fp8'],
    },
    license: { spdx_id: 'LicenseRef-Demo-Community', commercial_use_allowed: false },
  }),
  item('context_policy', {
    slug: 'standard-8k',
    name: 'Standard context (8K cap)',
    description: 'Caps prompt plus reserved output at 8,192 tokens; rejects overflow.',
    spec: { max_allowed_tokens: 8192, supported_truncation: ['reject', 'truncate_oldest'] },
  }),
  item('context_policy', {
    slug: 'long-128k',
    name: 'Long context (128K cap)',
    description: 'Allows up to 128,000 tokens with summarisation or sliding windows.',
    spec: {
      max_allowed_tokens: 128000,
      supported_truncation: ['reject', 'summarize', 'sliding_window'],
    },
  }),

  // ---------------------------------------------------------------- T2
  item('hosting_platform', {
    slug: 'nimbus-cloud',
    name: 'Demo Nimbus Cloud',
    description: 'Fictional public cloud offering CUDA accelerators in two regions.',
    spec: {
      hosting_type: 'cloud',
      regions: ['us-east-demo', 'eu-west-demo'],
      accelerator_refs: [id('accelerator', 'c24'), id('accelerator', 'c80')],
      supports_private_networking: true,
    },
  }),
  item('hosting_platform', {
    slug: 'onprem-rack',
    name: 'Demo On-Prem Rack',
    description: 'Fictional on-premises rack with ROCm accelerators.',
    spec: {
      hosting_type: 'on_prem',
      regions: ['onprem-demo'],
      accelerator_refs: [id('accelerator', 'r48')],
      supports_private_networking: true,
    },
  }),
  item('hosting_platform', {
    slug: 'managed-host',
    name: 'Demo Managed Model Host',
    description: 'Fictional managed model-hosting service.',
    spec: { hosting_type: 'managed_api', regions: ['us-east-demo'] },
  }),
  item('accelerator', {
    slug: 'c24',
    name: 'Demo C24 GPU',
    description: 'Fictional 24 GB CUDA GPU.',
    spec: {
      accelerator_type: 'gpu',
      vendor: 'Demo Silicon (fictional)',
      model_name: 'C24',
      vram_gb: 24,
      backends: ['cuda'],
      precisions: ['fp16', 'bf16', 'int8', 'int4'],
      interconnect: 'pcie',
    },
  }),
  item('accelerator', {
    slug: 'c80',
    name: 'Demo C80 GPU',
    description: 'Fictional 80 GB CUDA GPU with a high-speed interconnect.',
    spec: {
      accelerator_type: 'gpu',
      vendor: 'Demo Silicon (fictional)',
      model_name: 'C80',
      vram_gb: 80,
      backends: ['cuda'],
      precisions: ['fp16', 'bf16', 'fp8', 'int8'],
      interconnect: 'nvlink',
    },
  }),
  item('accelerator', {
    slug: 'r48',
    name: 'Demo R48 Accelerator',
    description: 'Fictional 48 GB ROCm accelerator.',
    spec: {
      accelerator_type: 'gpu',
      vendor: 'Demo Devices (fictional)',
      model_name: 'R48',
      vram_gb: 48,
      backends: ['rocm'],
      precisions: ['fp16', 'bf16', 'int8'],
      interconnect: 'pcie',
    },
  }),
  item('compute_profile', {
    slug: 'nimbus-1x-c24',
    name: 'Nimbus 1× C24 instance',
    description: 'Single-GPU instance on Demo Nimbus Cloud.',
    billing: 'metered',
    spec: {
      hosting_ref: id('hosting_platform', 'nimbus-cloud'),
      accelerator_ref: id('accelerator', 'c24'),
      accelerator_count: 1,
      cpu_cores: 8,
      ram_gb: 64,
      disk_gb: 200,
      region: 'us-east-demo',
    },
  }),
  item('compute_profile', {
    slug: 'nimbus-4x-c80',
    name: 'Nimbus 4× C80 instance',
    description: 'Four-GPU instance on Demo Nimbus Cloud.',
    billing: 'metered',
    spec: {
      hosting_ref: id('hosting_platform', 'nimbus-cloud'),
      accelerator_ref: id('accelerator', 'c80'),
      accelerator_count: 4,
      cpu_cores: 48,
      ram_gb: 512,
      disk_gb: 2000,
      region: 'us-east-demo',
      network_gbps: 100,
    },
  }),
  item('compute_profile', {
    slug: 'rack-2x-r48',
    name: 'On-prem 2× R48 node',
    description: 'Two-accelerator node in the Demo On-Prem Rack.',
    billing: 'unknown',
    spec: {
      hosting_ref: id('hosting_platform', 'onprem-rack'),
      accelerator_ref: id('accelerator', 'r48'),
      accelerator_count: 2,
      cpu_cores: 32,
      ram_gb: 256,
      region: 'onprem-demo',
    },
  }),
  item('inference_engine', {
    slug: 'serve',
    name: 'Demo Serve',
    description: 'Fictional GPU serving runtime with tensor parallelism.',
    spec: {
      backends: ['cuda', 'rocm'],
      model_formats: ['safetensors'],
      supported_precisions: ['fp16', 'bf16', 'fp8', 'int8'],
      supports_tool_calling: true,
      supports_multi_gpu: true,
      max_batch_size: 64,
    },
  }),
  item('inference_engine', {
    slug: 'lite',
    name: 'Demo Lite Runtime',
    description: 'Fictional lightweight runtime for quantised single-device models.',
    spec: {
      backends: ['cuda', 'metal', 'cpu'],
      model_formats: ['gguf'],
      supported_precisions: ['int8', 'int4'],
      supports_tool_calling: false,
      supports_multi_gpu: false,
      max_batch_size: 4,
    },
  }),
  item('storage', {
    slug: 'object',
    name: 'Demo Object Storage',
    description: 'Object storage for documents, artifacts and indexes.',
    billing: 'metered',
    spec: {
      storage_type: 'object',
      hosting_ref: id('hosting_platform', 'nimbus-cloud'),
      region: 'us-east-demo',
      encryption_at_rest: true,
      max_capacity_gb: 100000,
    },
  }),
  item('storage', {
    slug: 'block',
    name: 'Demo Block Volume',
    description: 'Block storage attached to compute.',
    billing: 'metered',
    spec: {
      storage_type: 'block',
      region: 'us-east-demo',
      encryption_at_rest: true,
      max_capacity_gb: 4000,
    },
  }),

  // ---------------------------------------------------------------- T3
  item('data_source', {
    slug: 'file-share',
    name: 'Demo Policy File Share',
    description: 'Folder of internal policy documents.',
    spec: {
      source_type: 'file',
      modalities: ['text'],
      classification: 'internal',
      refresh_supported: true,
      access_controlled: true,
    },
  }),
  item('data_source', {
    slug: 'crm',
    name: 'Demo CRM Connector',
    description: 'Connector to a fictional CRM holding confidential customer records.',
    billing: 'unknown',
    spec: {
      source_type: 'connector',
      modalities: ['text', 'structured'],
      classification: 'confidential',
      refresh_supported: true,
      access_controlled: true,
    },
  }),
  item('knowledge_base', {
    slug: 'policies',
    name: 'Demo Policies Knowledge Base',
    description: 'Curated corpus built from the policy file share.',
    spec: {
      data_source_refs: [id('data_source', 'file-share')],
      supported_modalities: ['text'],
      supports_acl: true,
      supports_incremental_sync: true,
    },
  }),
  item('knowledge_base', {
    slug: 'customers',
    name: 'Demo Customer Knowledge Base',
    description: 'Corpus over CRM records; access control not supported.',
    spec: {
      data_source_refs: [id('data_source', 'crm')],
      supported_modalities: ['text', 'structured'],
      supports_acl: false,
    },
  }),
  item('embedding_model', {
    slug: 'embed-768',
    name: 'Demo Embed 768',
    description: 'Open-weights text embedding model (768 dimensions).',
    spec: {
      provider_ref: id('model_provider', 'openlab'),
      embedding_dimensions: 768,
      max_input_tokens: 4096,
      similarity_metrics: ['cosine'],
      supported_modalities: ['text'],
      access_modes: ['weights'],
    },
  }),
  item('embedding_model', {
    slug: 'embed-1536',
    name: 'Demo Embed 1536',
    description: 'API text embedding model (1,536 dimensions).',
    billing: 'metered',
    spec: {
      provider_ref: id('model_provider', 'aurora'),
      embedding_dimensions: 1536,
      max_input_tokens: 8192,
      similarity_metrics: ['cosine', 'dot'],
      supported_modalities: ['text'],
      access_modes: ['api'],
    },
  }),
  item('vector_database', {
    slug: 'vectorstore',
    name: 'Demo VectorStore',
    description: 'Vector database with hybrid search and access control.',
    billing: 'metered',
    spec: {
      supported_metrics: ['cosine', 'dot'],
      max_dimensions: 4096,
      supports_hybrid_search: true,
      supports_acl: true,
      regions: ['us-east-demo', 'eu-west-demo'],
      hosting_ref: id('hosting_platform', 'nimbus-cloud'),
    },
  }),
  item('vector_database', {
    slug: 'lite-index',
    name: 'Demo Lite Index',
    description: 'Embedded vector index limited to 1,024 dimensions and euclidean distance.',
    spec: { supported_metrics: ['euclidean'], max_dimensions: 1024, supports_acl: false },
  }),
  item('rag_pipeline', {
    slug: 'dense',
    name: 'Demo Dense Retrieval Pipeline',
    description: 'Embeds documents and retrieves by vector similarity, with reranking.',
    spec: {
      retrieval_mode: 'dense',
      supports_rerank: true,
      supported_chunking: ['fixed', 'semantic'],
    },
  }),
  item('rag_pipeline', {
    slug: 'keyword',
    name: 'Demo Keyword Retrieval Pipeline',
    description: 'Keyword search only; needs no embedding model or vector database.',
    spec: { retrieval_mode: 'keyword', supports_rerank: false, supported_chunking: ['fixed'] },
  }),

  // ---------------------------------------------------------------- T4
  item('agent_framework', {
    slug: 'agentkit-py',
    name: 'Demo AgentKit (Python)',
    description: 'Agent framework with tool execution, MCP and memory support.',
    spec: {
      programming_languages: ['python'],
      supports_mcp: true,
      supports_memory: true,
      supports_multi_agent: true,
      supports_tool_execution: true,
    },
  }),
  item('agent_framework', {
    slug: 'flow-ts',
    name: 'Demo Flow (TypeScript)',
    description: 'Lightweight workflow framework without MCP or memory.',
    spec: {
      programming_languages: ['typescript', 'javascript'],
      supports_mcp: false,
      supports_memory: false,
      supports_multi_agent: false,
      supports_tool_execution: true,
    },
  }),
  item('tool', {
    slug: 'search',
    name: 'Demo Web Search Tool',
    description: 'Read-only search tool.',
    spec: {
      protocol: 'http',
      side_effect: 'read_only',
      auth_methods: ['api_key'],
      is_networked: true,
    },
  }),
  item('tool', {
    slug: 'ticket-writer',
    name: 'Demo Ticket Writer',
    description: 'Creates and updates tickets — a mutating tool that needs permission guardrails.',
    spec: {
      protocol: 'mcp',
      side_effect: 'mutating',
      auth_methods: ['oauth2'],
      required_scopes: ['tickets.write'],
      is_networked: true,
    },
  }),
  item('mcp_server', {
    slug: 'gateway',
    name: 'Demo MCP Gateway',
    description: 'Remote MCP server exposing the ticket tool over streamable HTTP.',
    spec: {
      transport: 'streamable_http',
      tool_refs: [id('tool', 'ticket-writer')],
      auth_methods: ['oauth2'],
      trust_level: 'internal',
    },
  }),
  item('mcp_server', {
    slug: 'local',
    name: 'Demo Local MCP Server',
    description: 'Local stdio MCP server.',
    spec: { transport: 'stdio', auth_methods: ['none'], trust_level: 'trusted_external' },
  }),
  item('memory_store', {
    slug: 'vector-memory',
    name: 'Demo Long-Term Vector Memory',
    description: 'Long-term memory stored in a vector database.',
    spec: {
      memory_type: 'long_term',
      backing_type: 'vector',
      encryption_at_rest: true,
      supports_ttl: true,
    },
  }),
  item('memory_store', {
    slug: 'session',
    name: 'Demo Session Memory',
    description: 'In-memory per-session scratchpad.',
    spec: { memory_type: 'session', backing_type: 'in_memory', supports_ttl: true },
  }),
  item('integration', {
    slug: 'helpdesk',
    name: 'Demo Helpdesk API',
    description: 'API integration with a fictional helpdesk.',
    spec: {
      integration_type: 'api',
      auth_methods: ['oauth2'],
      rate_limit_per_minute: 120,
      associated_tool_refs: [id('tool', 'ticket-writer')],
    },
  }),
  item('integration', {
    slug: 'webhook',
    name: 'Demo Webhook Notifier',
    description: 'Outbound webhook notifications.',
    billing: 'free',
    spec: { integration_type: 'webhook', auth_methods: ['api_key'] },
  }),

  // ---------------------------------------------------------------- T5
  item('training_framework', {
    slug: 'tune',
    name: 'Demo Tune',
    description: 'Fine-tuning toolkit supporting LoRA and SFT on CUDA.',
    spec: {
      methods: ['lora', 'qlora', 'sft'],
      backends: ['cuda'],
      model_formats: ['safetensors'],
      distributed_supported: true,
    },
  }),
  item('training_framework', {
    slug: 'tune-rocm',
    name: 'Demo Tune ROCm',
    description: 'Fine-tuning toolkit for ROCm accelerators (DPO and SFT).',
    spec: { methods: ['sft', 'dpo'], backends: ['rocm'], model_formats: ['safetensors'] },
  }),
  item('training_compute', {
    slug: 'nimbus-burst',
    name: 'Demo Nimbus training burst',
    description: 'Ephemeral training capacity on the Nimbus 4× C80 instance.',
    billing: 'metered',
    spec: {
      compute_profile_ref: id('compute_profile', 'nimbus-4x-c80'),
      max_gpu_hours: 200,
      ephemeral: true,
      storage_ref: id('storage', 'object'),
    },
  }),
  item('training_dataset', {
    slug: 'support-transcripts',
    name: 'Demo Support Transcripts (approved)',
    description: 'Licence-verified, privacy-approved conversation dataset.',
    spec: {
      data_source_refs: [id('data_source', 'file-share')],
      example_count: 5000,
      data_classification: 'internal',
      license_verified: true,
      privacy_approved: true,
      held_out_test_set: true,
    },
  }),
  item('training_dataset', {
    slug: 'crm-export',
    name: 'Demo CRM Export (not approved)',
    description: 'Customer records export without licence or privacy approval.',
    spec: {
      data_source_refs: [id('data_source', 'crm')],
      example_count: 20000,
      data_classification: 'confidential',
      license_verified: false,
      privacy_approved: false,
    },
  }),
  item('fine_tuned_model', {
    slug: 'open-8b-support',
    name: 'Demo Open 8B — support adapter',
    description: 'LoRA adapter derived from Demo Open 8B with the approved transcripts.',
    spec: {
      base_model_ref: id('model', 'open-8b'),
      training_framework_ref: id('training_framework', 'tune'),
      training_dataset_ref: id('training_dataset', 'support-transcripts'),
      artifact_format: 'safetensors',
      adapter_only: true,
      supported_access_modes: ['weights'],
    },
  }),

  // ---------------------------------------------------------------- T6
  item('guardrail', {
    slug: 'shield',
    name: 'Demo Shield',
    description: 'Blocks prompt injection, PII leakage and unauthorised tool calls.',
    spec: {
      targets: ['input', 'output', 'retrieval', 'tool'],
      policies: ['pii', 'prompt_injection', 'tool_permissions', 'secrets'],
      enforcement: 'block',
    },
  }),
  item('guardrail', {
    slug: 'pii-filter',
    name: 'Demo PII Filter',
    description: 'Redacts personal data in inputs and outputs only.',
    spec: { targets: ['input', 'output'], policies: ['pii'], enforcement: 'redact' },
  }),
  item('evaluation_suite', {
    slug: 'quality-gate',
    name: 'Demo Quality Gate',
    description:
      'Defines answer-quality and safety gates. Defines gates only — no measured results.',
    spec: {
      metric_names: ['answer_quality', 'groundedness', 'tool_safety'],
      mode: 'both',
      gate_on_deployment: true,
    },
  }),
  item('evaluation_suite', {
    slug: 'smoke',
    name: 'Demo Smoke Checks',
    description: 'Offline smoke checks for latency and error rates.',
    spec: {
      metric_names: ['latency_ms', 'error_rate'],
      mode: 'offline',
      gate_on_deployment: false,
    },
  }),
  item('deployment_target', {
    slug: 'api-endpoint',
    name: 'Demo API Endpoint',
    description: 'Autoscaling API endpoint on Demo Nimbus Cloud with rollback.',
    spec: {
      target_type: 'api_endpoint',
      hosting_ref: id('hosting_platform', 'nimbus-cloud'),
      region: 'us-east-demo',
      supports_autoscale: true,
      supports_rollback: true,
    },
  }),
  item('deployment_target', {
    slug: 'internal-app',
    name: 'Demo Internal Web App',
    description: 'Internal application deployment without autoscaling.',
    spec: { target_type: 'application', region: 'eu-west-demo', supports_rollback: false },
  }),
  item('monitoring_stack', {
    slug: 'observe',
    name: 'Demo Observe',
    description: 'Traces, cost and quality signals with PII redaction.',
    spec: {
      signals: ['latency', 'errors', 'token_usage', 'cost', 'traces', 'quality', 'security'],
      pii_redaction: true,
      retention_days: 30,
      exporter: 'otlp',
    },
  }),
  item('monitoring_stack', {
    slug: 'basic-metrics',
    name: 'Demo Basic Metrics',
    description: 'Latency and error metrics only; no redaction.',
    spec: {
      signals: ['latency', 'errors'],
      pii_redaction: false,
      retention_days: 7,
      exporter: 'prometheus',
    },
  }),
  item('cost_policy', {
    slug: 'hard-cap',
    name: 'Monthly hard cap',
    description: 'Blocks the build when a complete quote exceeds the monthly budget.',
    spec: { default_currency: 'USD', supports_hard_cap: true, alert_threshold_pct: 80 },
  }),
  item('cost_policy', {
    slug: 'alerts-only',
    name: 'Budget alerts only',
    description: 'Notifies at a threshold but does not block.',
    spec: { default_currency: 'USD', supports_hard_cap: false, alert_threshold_pct: 90 },
  }),
];

export const DEMO_CATALOG: CatalogSnapshot = {
  schema_version: '1.0.0',
  id: DEMO_SNAPSHOT_ID,
  revision: 1,
  captured_at: DEMO_CAPTURED_AT,
  items: DEMO_ITEMS,
};

export const demoItemId = id;
