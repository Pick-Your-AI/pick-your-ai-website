/* Synthetic build scenarios shared by unit tests (MASTER_PROMPT §11). */
import type { BuildSnapshot, CatalogItem, ResourceEstimate } from '../../src/contracts';
import { addOrReplace, createBuild, updateSettings } from '../../src/domain/build';
import { DEMO_CATALOG, demoItemId } from '../../src/data/fixture/catalog';

export const CATALOG = DEMO_CATALOG;
export const BY_ID: ReadonlyMap<string, CatalogItem> = new Map(CATALOG.items.map((i) => [i.id, i]));
export const NOW = '2026-10-16T12:00:00Z';

export function item(kind: string, slug: string): CatalogItem {
  const found = BY_ID.get(demoItemId(kind as CatalogItem['kind'], slug));
  if (!found) throw new Error(`no demo item ${kind}.${slug}`);
  return found;
}

export function buildWith(picks: [string, string][], base?: BuildSnapshot): BuildSnapshot {
  let b =
    base ?? createBuild({ id: 'build.test.scenario', catalogSnapshotId: CATALOG.id, now: NOW });
  for (const [kind, slug] of picks) b = addOrReplace(b, item(kind, slug), BY_ID);
  return b;
}

/** T0 + T1 only: valid API build; T2–T6 omitted. */
export const apiChat = () =>
  buildWith([
    ['workload', 'support-chat'],
    ['deployment_mode', 'api'],
    ['model_provider', 'aurora'],
    ['model', 'aurora-large'],
    ['context_policy', 'standard-8k'],
  ]);

/** API mode with a weights-only model from another provider: contradictory selections. */
export const contradictory = () =>
  buildWith([
    ['workload', 'support-chat'],
    ['deployment_mode', 'api'],
    ['model_provider', 'aurora'],
    ['model', 'open-8b'],
    ['context_policy', 'standard-8k'],
  ]);

/** Self-hosted single-GPU stack; no capacity evidence, so memory-fit rules are Unknown. */
export const selfHosted = () =>
  buildWith([
    ['workload', 'support-chat'],
    ['deployment_mode', 'self-hosted'],
    ['model_provider', 'openlab'],
    ['model', 'open-8b'],
    ['context_policy', 'standard-8k'],
    ['hosting_platform', 'nimbus-cloud'],
    ['accelerator', 'c24'],
    ['compute_profile', 'nimbus-1x-c24'],
    ['inference_engine', 'serve'],
  ]);

/** RAG with mismatched embedding (768) and index dimension (1536). */
export const ragMismatch = () => {
  const b = buildWith([
    ['workload', 'document-qa'],
    ['deployment_mode', 'api'],
    ['model_provider', 'aurora'],
    ['model', 'aurora-large'],
    ['context_policy', 'standard-8k'],
    ['data_source', 'file-share'],
    ['knowledge_base', 'policies'],
    ['embedding_model', 'embed-768'],
    ['vector_database', 'vectorstore'],
    ['rag_pipeline', 'dense'],
  ]);
  return updateSettings(b, 'sel_vector_database', { index_dimension: 1536 });
};

export function resourceEstimate(
  build: BuildSnapshot,
  requiredGb: string,
  confidence: ResourceEstimate['estimates'][number]['confidence'],
): ResourceEstimate {
  return {
    schema_version: '1.0.0',
    id: `resources.test.r${build.revision}`,
    build_id: build.id,
    build_revision: build.revision,
    generated_at: NOW,
    estimates: [
      {
        metric: 'inference.estimated_required_vram_gb',
        value: requiredGb,
        unit: 'gb',
        estimator_id: 'test.estimator',
        estimator_version: '0.0-test',
        confidence,
        assumptions: ['Synthetic test value.'],
        selection_ids: ['sel_model', 'sel_accelerator'],
      },
      {
        metric: 'inference.estimated_peak_per_device_vram_gb',
        value: requiredGb,
        unit: 'gb',
        estimator_id: 'test.estimator',
        estimator_version: '0.0-test',
        confidence,
        assumptions: ['Synthetic test value.'],
        selection_ids: ['sel_model', 'sel_accelerator'],
      },
    ],
  };
}
