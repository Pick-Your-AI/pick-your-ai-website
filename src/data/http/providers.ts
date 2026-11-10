/*
 * HTTP providers for the contract API (contracts/v1/api/openapi.yaml, base path /v1). Every response
 * is validated against the contract schema before use. Endpoints:
 *   GET  /catalog/snapshots/{snapshot_id}         CatalogRepository
 *   GET  /dependencies/{dependency_id}            CatalogRepository.getDependencyGraph
 *   GET  /rulesets/{ruleset_id}?version=           CatalogRepository.getRuleset
 *   GET  /pricebooks/{pricebook_id}               PricingProvider.getPricebook
 *   POST /builds, GET|PUT /builds/{id}            HttpBuildRepository (If-Match revision CAS)
 *   POST /builds/{id}/evaluate                    CompatibilityEvaluator.evaluate
 *   GET  /builds/{id}/compatible-options          CompatibilityEvaluator.compatibleOptions
 *   POST /builds/{id}/estimate-cost               PricingProvider.estimate
 * There is no read endpoint for resource estimates or a "current snapshot" in v1; the snapshot id
 * and graph/ruleset ids are configuration (see docs/DATA_INTEGRATION.md).
 */
import type {
  BuildSnapshot,
  CatalogSnapshot,
  ComponentKind,
  ContractName,
  CostEstimate,
  Pricebook,
  Ruleset,
} from '../../contracts';
import { assertContract, BASELINE_GRAPH, BASELINE_RULESET } from '../../contracts';
import { DataError } from '../errors';
import { LocalBuildRepository } from '../local-builds';
import { UnavailableResourceEstimateProvider } from '../fixture/providers';
import { ProvenanceEvidenceProvider, compatibleOptionsLocal } from '../shared';
import type {
  BuildRepository,
  CatalogRepository,
  CompatibilityEvaluator,
  CompatibleOption,
  DataProviders,
  EvaluationEvidence,
  PricingProvider,
  ResourceEstimateProvider,
  ResourceEstimateResult,
  SavedBuildSummary,
  StoredBuild,
} from '../types';
import { estimateCost } from '../../domain/cost';
import { evaluateBuild } from '../../domain/evaluator';
import { ContractHttpClient, type FetchLike, idempotencyKey } from './client';

export interface HttpProviderConfig {
  baseUrl: string;
  catalogSnapshotId: string;
  dependencyGraphId?: string;
  rulesetId?: string;
  rulesetVersion?: string;
  pricebookId?: string;
  fetch?: FetchLike;
  /** Store builds on the API instead of in this browser (VITE_BUILD_STORE=http). */
  remoteBuilds?: boolean;
  /**
   * The API serves immutable GET artifacts only (VITE_API_SURFACE=static): catalog snapshot,
   * pricebook, ruleset and dependency graph. Everything else runs locally, exactly as it does
   * against fixtures. Use this to consume real data without deploying a dynamic service.
   */
  staticMirror?: boolean;
}

const enc = encodeURIComponent;

function hasOnlyKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function requireArtifactId<T extends { id: string }>(
  contract: ContractName,
  value: T,
  requestedId: string,
): T {
  if (value.id !== requestedId) {
    throw new DataError('malformed', `${contract} does not match the requested ID.`, { contract });
  }
  return value;
}

export class HttpCatalogRepository implements CatalogRepository {
  private snapshot: Promise<CatalogSnapshot> | null = null;
  private readonly client: ContractHttpClient;
  private readonly cfg: HttpProviderConfig;
  constructor(client: ContractHttpClient, cfg: HttpProviderConfig) {
    this.client = client;
    this.cfg = cfg;
  }
  /** The configured pricebook, so a new build locks the artifact this deployment publishes. */
  get defaultPricebookId(): string | undefined {
    return this.cfg.pricebookId;
  }
  getSnapshot(snapshotId?: string) {
    const id = snapshotId ?? this.cfg.catalogSnapshotId;
    if (snapshotId && snapshotId !== this.cfg.catalogSnapshotId) {
      return this.client
        .contract('CatalogSnapshot', 'GET', `/catalog/snapshots/${enc(id)}`)
        .then((r) => requireArtifactId('CatalogSnapshot', r.value, id));
    }
    this.snapshot ??= this.client
      .contract('CatalogSnapshot', 'GET', `/catalog/snapshots/${enc(id)}`)
      .then((r) => requireArtifactId('CatalogSnapshot', r.value, id))
      .catch((e) => {
        this.snapshot = null; // allow retry after failure
        throw e;
      });
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
    const id = this.cfg.dependencyGraphId ?? BASELINE_GRAPH.id;
    const { value } = await this.client.contract(
      'DependencyGraph',
      'GET',
      `/dependencies/${enc(id)}`,
    );
    return requireArtifactId('DependencyGraph', value, id);
  }
  async getRuleset() {
    const id = this.cfg.rulesetId ?? BASELINE_RULESET.id;
    const version = this.cfg.rulesetVersion ?? BASELINE_RULESET.version;
    const { value } = await this.client.contract(
      'Ruleset',
      'GET',
      `/rulesets/${enc(id)}?version=${enc(version)}`,
    );
    if (value.id !== id || value.version !== version) {
      throw new DataError('malformed', 'Ruleset does not match the requested ID and version.', {
        contract: 'Ruleset',
      });
    }
    return value;
  }
}

export class HttpCompatibilityEvaluator implements CompatibilityEvaluator {
  private readonly client: ContractHttpClient;
  constructor(client: ContractHttpClient) {
    this.client = client;
  }
  async evaluate(build: BuildSnapshot, evidence: EvaluationEvidence = {}) {
    const { id, revision } = build;
    const locks = { ...build.locks };
    const body: Record<string, unknown> = { build_revision: revision };
    if (evidence.resourceEstimate) body.resource_estimate_id = evidence.resourceEstimate.id;
    if (evidence.costEstimate) body.cost_estimate_id = evidence.costEstimate.id;
    const { value } = await this.client.contract(
      'EvaluationReport',
      'POST',
      `/builds/${enc(id)}/evaluate`,
      body,
      { 'Idempotency-Key': idempotencyKey() },
    );
    if (value.build_id !== id || value.build_revision !== revision) {
      throw new DataError('malformed', 'Evaluation report is for a different build revision.', {
        contract: 'EvaluationReport',
      });
    }
    if (
      value.catalog_snapshot_id !== locks.catalog_snapshot_id ||
      value.ruleset_id !== locks.ruleset_id ||
      value.ruleset_version !== locks.ruleset_version ||
      value.dependency_graph_id !== locks.dependency_graph_id ||
      value.dependency_graph_revision !== locks.dependency_graph_revision
    ) {
      throw new DataError(
        'malformed',
        'Evaluation report does not match the requested catalog, ruleset, and dependency graph.',
        { contract: 'EvaluationReport' },
      );
    }
    return value;
  }
  async compatibleOptions(
    build: BuildSnapshot,
    kind: ComponentKind,
    role = 'primary',
  ): Promise<CompatibleOption[]> {
    const { id, revision } = build;
    const { data } = await this.client.request(
      'GET',
      `/builds/${enc(id)}/compatible-options?kind=${enc(kind)}&role=${enc(role)}`,
    );
    const verdicts = new Set(['compatible', 'incompatible', 'unknown']);
    const valid =
      hasOnlyKeys(data, ['build_id', 'build_revision', 'kind', 'options']) &&
      data.build_id === id &&
      Number.isInteger(data.build_revision) &&
      data.kind === kind &&
      Array.isArray(data.options) &&
      data.options.every(
        (o: unknown) =>
          hasOnlyKeys(o, ['catalog_item_id', 'catalog_item_version', 'verdict', 'rule_ids']) &&
          typeof o.catalog_item_id === 'string' &&
          typeof o.catalog_item_version === 'string' &&
          typeof o.verdict === 'string' &&
          verdicts.has(o.verdict) &&
          Array.isArray(o.rule_ids) &&
          o.rule_ids.every((ruleId: unknown) => typeof ruleId === 'string'),
      );
    if (!valid)
      throw new DataError('malformed', 'compatible-options response does not match the contract.');
    if (data.build_revision !== revision) {
      throw new DataError(
        'malformed',
        'compatible-options response is for a different build revision.',
      );
    }
    return data.options as CompatibleOption[];
  }
}

export class HttpPricingProvider implements PricingProvider {
  private readonly client: ContractHttpClient;
  private readonly cfg: HttpProviderConfig;
  constructor(client: ContractHttpClient, cfg: HttpProviderConfig) {
    this.client = client;
    this.cfg = cfg;
  }
  async getPricebook(pricebookId?: string) {
    const id = pricebookId ?? this.cfg.pricebookId;
    if (!id) throw new DataError('unsupported', 'No pricebook is configured.');
    const { value } = await this.client.contract('Pricebook', 'GET', `/pricebooks/${enc(id)}`);
    return requireArtifactId('Pricebook', value, id);
  }
  async estimate(build: BuildSnapshot, periodDays = 30) {
    const { id, revision } = build;
    const pricebookId = build.locks.pricebook_id ?? this.cfg.pricebookId;
    if (!pricebookId) throw new DataError('unsupported', 'Build has no pricebook lock.');
    const { value } = await this.client.contract(
      'CostEstimate',
      'POST',
      `/builds/${enc(id)}/estimate-cost`,
      { build_revision: revision, pricebook_id: pricebookId, period_days: periodDays },
      { 'Idempotency-Key': idempotencyKey() },
    );
    if (value.build_id !== id || value.build_revision !== revision) {
      throw new DataError('malformed', 'Cost estimate is for a different build revision.', {
        contract: 'CostEstimate',
      });
    }
    if (value.pricebook_id !== pricebookId || value.period_days !== periodDays) {
      throw new DataError(
        'malformed',
        'Cost estimate does not match the requested pricebook and period.',
        { contract: 'CostEstimate' },
      );
    }
    return value;
  }
}

export class HttpResourceEstimateProvider implements ResourceEstimateProvider {
  async estimate(): Promise<ResourceEstimateResult> {
    return {
      status: 'unavailable',
      reason:
        'The v1 API has no read endpoint for resource estimates; memory-fit rules stay Unknown.',
    };
  }
}

/** Remote builds per openapi: POST creates revision 1; PUT with If-Match replaces atomically. */
export class HttpBuildRepository implements BuildRepository {
  private readonly client: ContractHttpClient;
  private readonly local: LocalBuildRepository;
  constructor(client: ContractHttpClient, local = new LocalBuildRepository()) {
    this.client = client;
    this.local = local;
  }
  list(): Promise<SavedBuildSummary[]> {
    // v1 has no list endpoint; the browser keeps an index of builds it created.
    return this.local.list();
  }
  async get(buildId: string): Promise<StoredBuild> {
    const { value } = await this.client.contract('BuildSnapshot', 'GET', `/builds/${enc(buildId)}`);
    requireArtifactId('BuildSnapshot', value, buildId);
    return { build: value, revisions: [value], changes: [] };
  }
  async save(stored: StoredBuild, expectedRevision: number | null): Promise<StoredBuild> {
    const b = stored.build;
    const { id, revision } = b;
    // A saved revision must permit an exact +1 step in JavaScript. Capture the
    // submitted identity before awaiting so caller mutation cannot retarget it.
    const nextRevision = expectedRevision === null ? 1 : expectedRevision + 1;
    if (
      (expectedRevision !== null &&
        (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) ||
      revision !== nextRevision
    ) {
      throw new DataError(
        'malformed',
        expectedRevision === null
          ? 'A new remote build must start at revision 1.'
          : 'A remote build update must use the next revision after a valid saved revision.',
        { contract: 'BuildSnapshot' },
      );
    }
    const { value } =
      expectedRevision === null
        ? await this.client.contract('BuildSnapshot', 'POST', '/builds', b, {
            'Idempotency-Key': idempotencyKey(),
          })
        : await this.client.contract('BuildSnapshot', 'PUT', `/builds/${enc(id)}`, b, {
            'If-Match': `"${expectedRevision}"`,
            'Idempotency-Key': idempotencyKey(),
          });
    requireArtifactId('BuildSnapshot', value, id);
    if (value.revision !== revision) {
      throw new DataError('malformed', 'BuildSnapshot does not match the submitted revision.', {
        contract: 'BuildSnapshot',
      });
    }
    const saved = { ...stored, build: value };
    await this.local.save(saved, null);
    return saved;
  }
  remove(buildId: string): Promise<void> {
    return this.local.remove(buildId); // v1 has no delete; forget locally only.
  }
}

/**
 * Pricing over a static mirror: fetch the published immutable pricebook, then compute the estimate
 * in the browser using the same local estimator the fixtures use. No dynamic endpoints involved.
 */
/**
 * Static-mirror compatibility. The published ruleset is the only one this deployment serves, so a
 * build locked to a different ruleset id/version must not receive a baseline verdict presented
 * against its own revision. Returning an explicit unsupported result keeps "unknown" honest.
 */
export class StaticMirrorCompatibilityEvaluator implements CompatibilityEvaluator {
  private readonly catalog: CatalogRepository;
  private readonly now: () => string;
  constructor(catalog: CatalogRepository, now: () => string = () => new Date().toISOString()) {
    this.catalog = catalog;
    this.now = now;
  }
  /**
   * A report stamps the snapshot and ruleset ids from the build lock, so evaluating against this
   * deployment's current artifacts would label findings with a revision they were not computed
   * from. The snapshot is resolved *by the locked id* — `getSnapshot` validates it — so a lock this
   * deployment does not publish fails here instead of being answered from the current revision.
   */
  private async lockedArtifacts(
    build: BuildSnapshot,
  ): Promise<{ snapshot: CatalogSnapshot; ruleset: Ruleset }> {
    const { ruleset_id: id, ruleset_version: version } = build.locks;
    const ruleset = await this.catalog.getRuleset();
    if (id !== ruleset.id || version !== ruleset.version) {
      throw new DataError(
        'unsupported',
        `Build locks ruleset ${id}@${version}, but this deployment publishes ${ruleset.id}@${ruleset.version}. Compatibility is not evaluated against a different ruleset.`,
      );
    }
    const snapshotId = build.locks.catalog_snapshot_id;
    const snapshot = await this.catalog.getSnapshot(snapshotId).catch(() => {
      throw new DataError(
        'unsupported',
        `Build locks catalog snapshot ${snapshotId}, which this deployment does not publish. Compatibility is not evaluated against a different snapshot.`,
      );
    });
    /*
     * The report also carries the graph identity from the lock, while the builder's change-impact
     * analysis reads this deployment's configured graph. A foreign graph lock would therefore be
     * stamped on a report whose impact was computed elsewhere, so it is refused for the same
     * reason as a foreign snapshot.
     */
    const graph = await this.catalog.getDependencyGraph();
    // A revision is a distinct immutable artifact: the same id at a different revision is not the
    // graph the build locked, and stamping it would misattribute the report.
    if (
      build.locks.dependency_graph_id !== graph.id ||
      build.locks.dependency_graph_revision !== graph.revision
    ) {
      throw new DataError(
        'unsupported',
        `Build locks dependency graph ${build.locks.dependency_graph_id}@${build.locks.dependency_graph_revision}, but this deployment publishes ${graph.id}@${graph.revision}. Compatibility is not reported against a different graph.`,
      );
    }
    return { snapshot, ruleset };
  }
  async evaluate(build: BuildSnapshot, evidence: EvaluationEvidence = {}) {
    const { snapshot, ruleset } = await this.lockedArtifacts(build);
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
  async compatibleOptions(build: BuildSnapshot, kind: ComponentKind, role = 'primary') {
    const { snapshot, ruleset } = await this.lockedArtifacts(build);
    return compatibleOptionsLocal(build, snapshot, ruleset, kind, role);
  }
}

export class StaticMirrorPricingProvider implements PricingProvider {
  private readonly client: ContractHttpClient;
  private readonly cfg: HttpProviderConfig;
  private readonly catalog: CatalogRepository;
  private readonly now: () => string;
  constructor(
    client: ContractHttpClient,
    cfg: HttpProviderConfig,
    catalog: CatalogRepository,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.client = client;
    this.cfg = cfg;
    this.catalog = catalog;
    this.now = now;
  }
  async getPricebook(pricebookId?: string): Promise<Pricebook> {
    const id = pricebookId ?? this.cfg.pricebookId;
    if (!id) throw new DataError('unsupported', 'No pricebook is configured.');
    const { value } = await this.client.contract('Pricebook', 'GET', `/pricebooks/${enc(id)}`);
    return requireArtifactId('Pricebook', value, id);
  }
  async estimate(build: BuildSnapshot, periodDays = 30): Promise<CostEstimate> {
    const pricebook = await this.getPricebook(build.locks.pricebook_id);
    // The estimate is labelled with the build's lock, so it must be priced from that revision.
    const snapshotId = build.locks.catalog_snapshot_id;
    const snapshot = await this.catalog.getSnapshot(snapshotId).catch(() => {
      throw new DataError(
        'unsupported',
        `Build locks catalog snapshot ${snapshotId}, which this deployment does not publish. Cost is not estimated against a different snapshot.`,
      );
    });
    const estimate = estimateCost(build, new Map(snapshot.items.map((i) => [i.id, i])), pricebook, {
      periodDays,
      now: this.now(),
    });
    return assertContract('CostEstimate', estimate);
  }
}

export function createHttpProviders(cfg: HttpProviderConfig): DataProviders {
  const client = new ContractHttpClient({ baseUrl: cfg.baseUrl, fetch: cfg.fetch });
  const catalog = new HttpCatalogRepository(client, cfg);
  if (cfg.staticMirror) {
    return {
      mode: 'http',
      catalog,
      builds: new LocalBuildRepository(),
      compatibility: new StaticMirrorCompatibilityEvaluator(catalog),
      pricing: new StaticMirrorPricingProvider(client, cfg, catalog),
      evidence: new ProvenanceEvidenceProvider(),
      resources: new UnavailableResourceEstimateProvider(),
    };
  }
  return {
    mode: 'http',
    catalog,
    builds: cfg.remoteBuilds ? new HttpBuildRepository(client) : new LocalBuildRepository(),
    compatibility: new HttpCompatibilityEvaluator(client),
    pricing: new HttpPricingProvider(client, cfg),
    evidence: new ProvenanceEvidenceProvider(),
    resources: new HttpResourceEstimateProvider(),
  };
}
