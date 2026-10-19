import displayLabels from '../../contracts/display-labels/v1.0.0.json';
import type { ComponentKind, Tier } from './registry';

/*
 * Kind names come from the accepted sidecar; tier descriptions and grammar remain local presentation.
 * The frozen registry remains the authority for identifiers, tiers, cardinality and activation.
 * Never use display names as identifiers.
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

/** Accepted English labels are imported verbatim from the independently pinned research sidecar. */
export const KIND_LABELS: Readonly<Record<ComponentKind, string>> = Object.freeze(
  displayLabels.labels,
);

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
