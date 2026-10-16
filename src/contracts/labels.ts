import type { ComponentKind, Tier } from './registry';

/*
 * Presentation labels. The contract registry defines ids, tiers, cardinality and activation but no
 * display names; these labels follow the research project's T0–T6 taxonomy and are display-only.
 * Never use them as identifiers.
 */

export const TIER_LABELS: Record<Tier, string> = {
  T0: 'Requirements & Configuration',
  T1: 'Models',
  T2: 'Infrastructure',
  T3: 'Knowledge & Retrieval',
  T4: 'Agents & Integrations',
  T5: 'Training & Fine-Tuning',
  T6: 'Deployment & Operations',
};

export const TIER_SUMMARIES: Record<Tier, string> = {
  T0: 'What the system must do and how it will be deployed.',
  T1: 'Who provides the model, which model, and how much context it gets.',
  T2: 'Where it runs: hosting, accelerators, compute, serving runtime and storage.',
  T3: 'Optional: connect data sources, knowledge bases, embeddings and retrieval.',
  T4: 'Optional: agent frameworks, tools, MCP servers, memory and integrations.',
  T5: 'Optional: fine-tune a model with your own data.',
  T6: 'Guardrails, evaluation, deployment target, monitoring and budget controls.',
};

export const KIND_LABELS: Record<ComponentKind, string> = {
  workload: 'Workload / Use Case',
  deployment_mode: 'Deployment Mode',
  model_provider: 'Model Provider',
  model: 'AI Model',
  context_policy: 'Context Policy',
  hosting_platform: 'Hosting Platform',
  accelerator: 'Accelerator',
  compute_profile: 'Compute Profile',
  inference_engine: 'Inference Engine',
  storage: 'Storage',
  data_source: 'Data Source',
  knowledge_base: 'Knowledge Base',
  embedding_model: 'Embedding Model',
  vector_database: 'Vector Database',
  rag_pipeline: 'RAG Pipeline',
  agent_framework: 'Agent Framework',
  tool: 'Tool',
  mcp_server: 'MCP Server',
  memory_store: 'Memory Store',
  integration: 'Integration',
  training_framework: 'Training Framework',
  training_compute: 'Training Compute',
  training_dataset: 'Training Dataset',
  fine_tuned_model: 'Fine-Tuned Model',
  guardrail: 'Guardrail',
  evaluation_suite: 'Evaluation Suite',
  deployment_target: 'Deployment Target',
  monitoring_stack: 'Monitoring Stack',
  cost_policy: 'Cost Policy',
};

/** URL slug for a kind (ids use underscores; URLs use hyphens). */
export const kindSlug = (kind: ComponentKind): string => kind.replace(/_/g, '-');
export const kindFromSlug = (slug: string): string => slug.replace(/-/g, '_');

/** Lower-cases a label for use mid-sentence while keeping acronyms (AI, MCP, RAG) intact. */
export const labelInSentence = (label: string): string =>
  label
    .split(' ')
    .map((w) => (/^[A-Z]{2,}/.test(w) ? w : w.toLowerCase()))
    .join(' ');

/** "a"/"an" + label in sentence case. */
export const withArticle = (label: string): string => {
  // Acronyms are read letter by letter ("an MCP server"), words by their first vowel ("an embedding").
  const vowelSound = /^[A-Z]{2,}/.test(label)
    ? /^[AEFHILMNORSX]/.test(label)
    : /^[aeiou]/i.test(label);
  return `${vowelSound ? 'an' : 'a'} ${labelInSentence(label)}`;
};
