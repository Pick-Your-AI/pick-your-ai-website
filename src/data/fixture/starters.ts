/*
 * Starter stacks (demo). Each starter is composed ONLY from synthetic demo catalog items and opens
 * prefilled in the builder. They illustrate typical shapes of an AI stack; they are not
 * recommendations, and their compatibility is whatever the contract rules report once opened.
 */
import type { BuildSnapshot, CatalogItem, ComponentKind } from '../../contracts';
import { addOrReplace, createBuild, updateSettings } from '../../domain/build';
import { DEMO_ITEMS, DEMO_SNAPSHOT_ID, demoItemId } from './catalog';

export interface Starter {
  id: string;
  title: string;
  summary: string;
  rationale: { kind: ComponentKind; why: string }[];
  build: () => BuildSnapshot;
}

const byId: ReadonlyMap<string, CatalogItem> = new Map(DEMO_ITEMS.map((i) => [i.id, i]));

function compose(id: string, name: string, picks: [ComponentKind, string][]): BuildSnapshot {
  let b = createBuild({ id: `build.starter.${id}`, catalogSnapshotId: DEMO_SNAPSHOT_ID, name });
  for (const [kind, slug] of picks) {
    const item = byId.get(demoItemId(kind, slug));
    if (!item) throw new Error(`Starter ${id}: no demo item ${kind}.${slug}`);
    b = addOrReplace(b, item, byId);
  }
  return b;
}

export const STARTERS: Starter[] = [
  {
    id: 'api-support-chat',
    title: 'Provider-API support chat (demo)',
    summary:
      'A customer-support assistant that calls a hosted model API, with a guardrail and monitoring. No infrastructure to run.',
    rationale: [
      { kind: 'deployment_mode', why: 'API mode keeps hosting, GPUs and serving out of scope.' },
      { kind: 'model', why: 'A hosted general-purpose model offered by the selected provider.' },
      { kind: 'context_policy', why: 'An 8k window is enough for short support conversations.' },
      {
        kind: 'guardrail',
        why: 'Filters unsafe or off-topic replies before they reach customers.',
      },
      { kind: 'monitoring_stack', why: 'Tracks latency, errors and usage once traffic starts.' },
    ],
    build: () =>
      compose('api-support-chat', 'Provider-API support chat (demo)', [
        ['workload', 'support-chat'],
        ['deployment_mode', 'api'],
        ['model_provider', 'aurora'],
        ['model', 'aurora-large'],
        ['context_policy', 'standard-8k'],
        ['guardrail', 'shield'],
        ['monitoring_stack', 'observe'],
      ]),
  },
  {
    id: 'self-hosted-one-gpu',
    title: 'Self-hosted open model on one GPU (demo)',
    summary:
      'An open-weights model served on a single rented accelerator. Shows how T2 infrastructure becomes required in self-hosted mode.',
    rationale: [
      { kind: 'deployment_mode', why: 'Self-hosted mode activates hosting, compute and serving.' },
      { kind: 'model', why: 'A small open-weights model that can be downloaded and served.' },
      {
        kind: 'accelerator',
        why: 'One accelerator; whether the model fits needs capacity evidence.',
      },
      {
        kind: 'inference_engine',
        why: 'The serving runtime that loads the weights and exposes an API.',
      },
      { kind: 'storage', why: 'Object storage holds model weights and artifacts.' },
    ],
    build: () =>
      compose('self-hosted-one-gpu', 'Self-hosted open model on one GPU (demo)', [
        ['workload', 'support-chat'],
        ['deployment_mode', 'self-hosted'],
        ['model_provider', 'openlab'],
        ['model', 'open-8b'],
        ['context_policy', 'standard-8k'],
        ['hosting_platform', 'nimbus-cloud'],
        ['accelerator', 'c24'],
        ['compute_profile', 'nimbus-1x-c24'],
        ['inference_engine', 'serve'],
        ['storage', 'object'],
      ]),
  },
  {
    id: 'document-qa-rag',
    title: 'Document Q&A with retrieval (demo)',
    summary:
      'Answers questions from internal documents using retrieval-augmented generation (T3) on top of a hosted model.',
    rationale: [
      { kind: 'context_policy', why: 'A long window leaves room for retrieved passages.' },
      { kind: 'knowledge_base', why: 'The policy documents the assistant should answer from.' },
      { kind: 'embedding_model', why: 'Produces 1536-dimension vectors for the documents.' },
      { kind: 'vector_database', why: 'Index dimension is set to 1536 to match the embeddings.' },
      { kind: 'rag_pipeline', why: 'Dense retrieval feeds the most relevant chunks to the model.' },
      { kind: 'guardrail', why: 'Checks answers before they are shown to users.' },
    ],
    build: () =>
      updateSettings(
        compose('document-qa-rag', 'Document Q&A with retrieval (demo)', [
          ['workload', 'document-qa'],
          ['deployment_mode', 'api'],
          ['model_provider', 'aurora'],
          ['model', 'aurora-large'],
          ['context_policy', 'long-128k'],
          ['data_source', 'file-share'],
          ['knowledge_base', 'policies'],
          ['embedding_model', 'embed-1536'],
          ['vector_database', 'vectorstore'],
          ['rag_pipeline', 'dense'],
          ['guardrail', 'shield'],
        ]),
        'sel_vector_database',
        { index_dimension: 1536 },
      ),
  },
  {
    id: 'ticket-triage-agent',
    title: 'Ticket-triage agent with tools (demo)',
    summary:
      'An operations agent (T4) that reads requests and files tickets through a tool exposed by an MCP server.',
    rationale: [
      {
        kind: 'agent_framework',
        why: 'Orchestrates the model, tool calls and conversation state.',
      },
      { kind: 'tool', why: 'A ticket-writing tool; it has side effects, so it needs guarding.' },
      { kind: 'mcp_server', why: 'A gateway that exposes the tool to the agent over MCP.' },
      { kind: 'guardrail', why: 'Constrains what the agent may do with a mutating tool.' },
      { kind: 'monitoring_stack', why: 'Records tool calls and failures for review.' },
    ],
    build: () =>
      compose('ticket-triage-agent', 'Ticket-triage agent with tools (demo)', [
        ['workload', 'ops-agent'],
        ['deployment_mode', 'api'],
        ['model_provider', 'aurora'],
        ['model', 'aurora-large'],
        ['context_policy', 'standard-8k'],
        ['agent_framework', 'agentkit-py'],
        ['tool', 'ticket-writer'],
        ['mcp_server', 'gateway'],
        ['guardrail', 'shield'],
        ['monitoring_stack', 'observe'],
      ]),
  },
];
