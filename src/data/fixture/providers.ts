/*
 * Fixture providers: synthetic, schema-validated data served in-browser. They exercise the same
 * interfaces and validation paths as the HTTP providers, with a small simulated latency so loading
 * states are real.
 */
import type {
  BuildSnapshot,
  CatalogSnapshot,
  ComponentKind,
  CostEstimate,
  DependencyGraph,
  EvaluationReport,
  Pricebook,
  Ruleset,
} from '../../contracts';
import { BASELINE_GRAPH, BASELINE_RULESET, assertContract } from '../../contracts';
import { estimateCost } from '../../domain/cost';
import { evaluateBuild } from '../../domain/evaluator';
import { DataError } from '../errors';
import { LocalBuildRepository } from '../local-builds';
import { ProvenanceEvidenceProvider, compatibleOptionsLocal } from '../shared';
import type {
  CatalogRepository,
  CompatibilityEvaluator,
  CompatibleOption,
  DataProviders,
  EvaluationEvidence,
  PricingProvider,
  ResourceEstimateProvider,
  ResourceEstimateResult,
} from '../types';
import { DEMO_CATALOG } from './catalog';
import { DEMO_PRICEBOOK } from './pricebook';

export interface FixtureOptions {
  catalog?: CatalogSnapshot;
  pricebook?: Pricebook;
  graph?: DependencyGraph;
  ruleset?: Ruleset;
  latencyMs?: number;
  now?: () => string;
}

const delay = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export class FixtureCatalogRepository implements CatalogRepository {
  private readonly snapshot: CatalogSnapshot;
  private readonly graph: DependencyGraph;
  private readonly ruleset: Ruleset;
  private readonly latency: number;
  constructor(opts: FixtureOptions = {}) {
    // Validate fixtures exactly as live responses would be validated.
    this.snapshot = assertContract('CatalogSnapshot', opts.catalog ?? DEMO_CATALOG);
    this.graph = assertContract('DependencyGraph', opts.graph ?? BASELINE_GRAPH);
    this.ruleset = assertContract('Ruleset', opts.ruleset ?? BASELINE_RULESET);
    this.latency = opts.latencyMs ?? 0;
  }
  async getSnapshot(snapshotId?: string) {
    await delay(this.latency);
    if (snapshotId && snapshotId !== this.snapshot.id) {
      throw new DataError('not_found', `Catalog snapshot ${snapshotId} is not available.`);
    }
    return this.snapshot;
  }
  async listItems(kind?: ComponentKind) {
    const s = await this.getSnapshot();
    return kind ? s.items.filter((i) => i.kind === kind) : s.items;
  }
  async getItem(id: string) {
    const item = (await this.getSnapshot()).items.find((i) => i.id === id);
    if (!item) throw new DataError('not_found', `Catalog item ${id} not found.`);
    return item;
  }
  async getDependencyGraph() {
    await delay(this.latency);
    return this.graph;
  }
  async getRuleset() {
    await delay(this.latency);
    return this.ruleset;
  }
}

export class LocalCompatibilityEvaluator implements CompatibilityEvaluator {
  private readonly catalog: CatalogRepository;
  private readonly now: () => string;
  constructor(catalog: CatalogRepository, now: () => string = () => new Date().toISOString()) {
    this.catalog = catalog;
    this.now = now;
  }
  async evaluate(
    build: BuildSnapshot,
    evidence: EvaluationEvidence = {},
  ): Promise<EvaluationReport> {
    const [snapshot, ruleset] = await Promise.all([
      this.catalog.getSnapshot(),
      this.catalog.getRuleset(),
    ]);
    const report = evaluateBuild({
      build,
      catalog: snapshot,
      ruleset,
      resourceEstimate: evidence.resourceEstimate ?? null,
      costEstimate: evidence.costEstimate ?? null,
      evaluatedAt: this.now(),
    });
    return assertContract('EvaluationReport', report);
  }
  async compatibleOptions(
    build: BuildSnapshot,
    kind: ComponentKind,
    role = 'primary',
  ): Promise<CompatibleOption[]> {
    const [snapshot, ruleset] = await Promise.all([
      this.catalog.getSnapshot(),
      this.catalog.getRuleset(),
    ]);
    return compatibleOptionsLocal(build, snapshot, ruleset, kind, role);
  }
}

export class FixturePricingProvider implements PricingProvider {
  private readonly catalog: CatalogRepository;
  private readonly pricebook: Pricebook;
  private readonly now: () => string;
  constructor(catalog: CatalogRepository, opts: FixtureOptions = {}) {
    this.catalog = catalog;
    this.pricebook = assertContract('Pricebook', opts.pricebook ?? DEMO_PRICEBOOK);
    this.now = opts.now ?? (() => new Date().toISOString());
  }
  async getPricebook(pricebookId?: string) {
    if (pricebookId && pricebookId !== this.pricebook.id) {
      throw new DataError('not_found', `Pricebook ${pricebookId} is not available.`);
    }
    return this.pricebook;
  }
  async estimate(build: BuildSnapshot, periodDays = 30): Promise<CostEstimate> {
    const snapshot = await this.catalog.getSnapshot();
    const pricebook = await this.getPricebook(build.locks.pricebook_id);
    const estimate = estimateCost(build, new Map(snapshot.items.map((i) => [i.id, i])), pricebook, {
      periodDays,
      now: this.now(),
    });
    return assertContract('CostEstimate', estimate);
  }
}

/** No capacity estimator exists yet; the honest answer is "no evidence" (rules report Unknown). */
export class UnavailableResourceEstimateProvider implements ResourceEstimateProvider {
  async estimate(): Promise<ResourceEstimateResult> {
    return {
      status: 'unavailable',
      reason:
        'No calibrated capacity estimator is connected. Memory-fit rules stay Unknown rather than being guessed from model size.',
    };
  }
}

export function createFixtureProviders(opts: FixtureOptions = {}): DataProviders {
  const catalog = new FixtureCatalogRepository(opts);
  return {
    mode: 'fixture',
    catalog,
    builds: new LocalBuildRepository(),
    compatibility: new LocalCompatibilityEvaluator(catalog, opts.now),
    pricing: new FixturePricingProvider(catalog, opts),
    evidence: new ProvenanceEvidenceProvider(),
    resources: new UnavailableResourceEstimateProvider(),
  };
}
