/*
 * Layer model for the presentation layer.
 *
 * The design mock presents a stack as seven "layers". The contract already defines exactly seven
 * tiers (T0–T6), so a layer IS a tier: no invented taxonomy, no parallel vocabulary. Everything
 * below is display copy; ids and membership come from the contract registry.
 */
import type { CatalogItem, ComponentKind, Tier } from '../contracts';
import { KIND_LABELS, TIERS, kindDef, kindsInTier } from '../contracts';
import type { IconName } from '../components/icon';

export interface Layer {
  tier: Tier;
  /** Full label from the contract taxonomy. */
  name: string;
  /** Short label used in tabs, step lists and summary rows. */
  short: string;
  /** Kicker, e.g. "T1 / MODEL SELECTION". */
  tag: string;
  /** Heading used above the component chooser. */
  title: string;
  /** One-sentence explanation of the decision this layer represents. */
  desc: string;
  /** What the layer contains, used by the catalog directory. */
  catalog: string;
  /** What this layer depends on, used as the "role" metric. */
  depend: string;
  ico: IconName;
}

export const LAYERS: Layer[] = [
  {
    tier: 'T0',
    name: 'Requirements & Configuration',
    short: 'Requirements',
    tag: 'T0 / REQUIREMENTS',
    title: 'Define what you are building',
    desc: 'The workload sets the shape of everything else: modality, volume, latency and data classification decide which later layers are needed at all.',
    catalog: 'Workloads and deployment modes: what the system must do and how it will run.',
    depend: 'Drives every downstream layer',
    ico: 'list',
  },
  {
    tier: 'T1',
    name: 'Models',
    short: 'Models',
    tag: 'T1 / MODEL SELECTION',
    title: 'Choose your model',
    desc: 'A hosted provider model or open weights you run yourself. The context policy bounds how much the model may read.',
    catalog:
      'Providers, models and context policies: who serves the model and how much context it gets.',
    depend: 'Sets serving and compute needs',
    ico: 'brain',
  },
  {
    tier: 'T2',
    name: 'Infrastructure',
    short: 'Infrastructure',
    tag: 'T2 / INFRASTRUCTURE',
    title: 'How will the model run?',
    desc: 'Hosting, accelerators, compute and serving runtime. A hosted API needs none of your own GPUs; open weights do.',
    catalog: 'Hosting platforms, accelerators, compute profiles, inference engines and storage.',
    depend: 'Checked against the model access mode',
    ico: 'server',
  },
  {
    tier: 'T3',
    name: 'Knowledge & Retrieval',
    short: 'Knowledge',
    tag: 'T3 / KNOWLEDGE & RETRIEVAL',
    title: 'Give it the right context',
    desc: 'Sources, knowledge bases, embeddings and vector search. No retrieval layer is also a valid choice.',
    catalog: 'Data sources, knowledge bases, embedding models, vector databases and RAG pipelines.',
    depend: 'Optional for non-RAG workloads',
    ico: 'database',
  },
  {
    tier: 'T4',
    name: 'Agents & Integrations',
    short: 'Agents',
    tag: 'T4 / AGENTS & INTEGRATIONS',
    title: 'Connect the moving parts',
    desc: 'Agent frameworks, tools, MCP servers, memory and integrations. Keep orchestration minimal or make it explicit.',
    catalog: 'Agent frameworks, tools, MCP servers, memory stores and integrations.',
    depend: 'Application architecture',
    ico: 'workflow',
  },
  {
    tier: 'T5',
    name: 'Training & Fine-Tuning',
    short: 'Training',
    tag: 'T5 / TRAINING & FINE-TUNING',
    title: 'Adapt the model to your data',
    desc: 'Fine-tuning is optional: frameworks, training compute, datasets and the model artifact you end up serving.',
    catalog: 'Training frameworks, training compute, datasets and fine-tuned model artifacts.',
    depend: 'Optional workstream',
    ico: 'wand',
  },
  {
    tier: 'T6',
    name: 'Deployment & Operations',
    short: 'Deploy',
    tag: 'T6 / DEPLOYMENT & OPERATIONS',
    title: 'Take your stack to production',
    desc: 'Guardrails, evaluation, deployment target, monitoring and cost policy: the controls that keep the system accountable.',
    catalog:
      'Guardrails, evaluation suites, deployment targets, monitoring stacks and cost policies.',
    depend: 'Serving and hosting requirements',
    ico: 'cloud',
  },
];

const BY_TIER = new Map<Tier, Layer>(LAYERS.map((l) => [l.tier, l]));

export function layerOf(tier: Tier): Layer {
  const layer = BY_TIER.get(tier);
  if (!layer) throw new Error(`Unknown tier: ${tier}`);
  return layer;
}

export const LAYER_TIERS: Tier[] = [...TIERS];

/** Component kinds that belong to a layer, in registry order. */
export function kindsOfLayer(tier: Tier): ComponentKind[] {
  return kindsInTier(tier).map((k) => k.kind);
}

/** Layer of a component kind. */
export function layerOfKind(kind: ComponentKind): Layer {
  return layerOf(kindDef(kind).tier);
}

/** Display label for a layer, e.g. "T1 / Models". */
export function layerTag(tier: Tier): string {
  return `${tier} / ${layerOf(tier).name}`;
}

// ---------------------------------------------------------------------------------------------
// Component presentation helpers (logo tile + colour). Ported from the mock's `component-logo`
// treatment: a 2–3 character tile whose colour is stable for a given item id.

export type LogoColor = 'mint' | 'blue' | 'purple' | 'orange';
const LOGO_COLORS: LogoColor[] = ['mint', 'blue', 'purple', 'orange'];

/** Stable, collision-light hash so the same item always gets the same tile colour. */
export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function logoColor(item: Pick<CatalogItem, 'id'>): LogoColor {
  return LOGO_COLORS[hashString(item.id) % LOGO_COLORS.length]!;
}

/** Short tile text for an item: "Demo C24 GPU" → "C24", "Demo Aurora Large" → "AL". */
export function logoText(item: Pick<CatalogItem, 'name'>): string {
  const words = item.name
    .replace(/^demo\s+/i, '')
    .split(/[\s/]+/)
    .filter(Boolean);
  const code = words.find((w) => /^[A-Z0-9]{2,4}$/.test(w));
  if (code) return code.slice(0, 3);
  const initials = words
    .filter((w) => !/^(and|of|the|no|on|with)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return initials || item.name.slice(0, 2).toUpperCase();
}

export const itemLogo = (item: Pick<CatalogItem, 'id' | 'name'>) => ({
  text: logoText(item),
  color: logoColor(item),
});

/** "Metered"/"Included"/"Unknown billing" chips shown on catalog rows and cards. */
export function kindShortLabel(kind: ComponentKind): string {
  return KIND_LABELS[kind];
}

/**
 * Headline component kind of a layer: the decision users usually start from. Used to open a layer
 * on its most meaningful kind (models rather than model providers) and to seed the compare page.
 * Every kind of the layer is still available as a tab.
 */
const HEADLINE_KIND: Partial<Record<Tier, ComponentKind>> = {
  T0: 'workload',
  T1: 'model',
  T2: 'hosting_platform',
  T3: 'vector_database',
  T4: 'agent_framework',
  T5: 'training_framework',
  T6: 'deployment_target',
};

export function headlineKind(tier: Tier): ComponentKind {
  const preferred = HEADLINE_KIND[tier];
  const kinds = kindsOfLayer(tier);
  if (preferred && kinds.includes(preferred)) return preferred;
  const first = kinds[0];
  if (!first) throw new Error(`Tier ${tier} has no component kinds`);
  return first;
}
