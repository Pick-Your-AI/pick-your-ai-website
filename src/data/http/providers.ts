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
import type { BuildSnapshot, CatalogSnapshot, ComponentKind, ContractName } from '../../contracts';
import { BASELINE_GRAPH, BASELINE_RULESET } from '../../contracts';
import { DataError } from '../errors';
import { LocalBuildRepository } from '../local-builds';
import { ProvenanceEvidenceProvider } from '../shared';
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
    const body: Record<string, unknown> = { build_revision: build.revision };
    if (evidence.resourceEstimate) body.resource_estimate_id = evidence.resourceEstimate.id;
    if (evidence.costEstimate) body.cost_estimate_id = evidence.costEstimate.id;
    const { value } = await this.client.contract(
      'EvaluationReport',
      'POST',
      `/builds/${enc(build.id)}/evaluate`,
      body,
      { 'Idempotency-Key': idempotencyKey() },
    );
    if (value.build_id !== build.id || value.build_revision !== build.revision) {
      throw new DataError('malformed', 'Evaluation report is for a different build revision.', {
        contract: 'EvaluationReport',
      });
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
    const pricebookId = build.locks.pricebook_id ?? this.cfg.pricebookId;
    if (!pricebookId) throw new DataError('unsupported', 'Build has no pricebook lock.');
    const { value } = await this.client.contract(
      'CostEstimate',
      'POST',
      `/builds/${enc(build.id)}/estimate-cost`,
      { build_revision: build.revision, pricebook_id: pricebookId, period_days: periodDays },
      { 'Idempotency-Key': idempotencyKey() },
    );
    if (value.build_id !== build.id || value.build_revision !== build.revision) {
      throw new DataError('malformed', 'Cost estimate is for a different build revision.', {
        contract: 'CostEstimate',
      });
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

export function createHttpProviders(cfg: HttpProviderConfig): DataProviders {
  const client = new ContractHttpClient({ baseUrl: cfg.baseUrl, fetch: cfg.fetch });
  return {
    mode: 'http',
    catalog: new HttpCatalogRepository(client, cfg),
    builds: cfg.remoteBuilds ? new HttpBuildRepository(client) : new LocalBuildRepository(),
    compatibility: new HttpCompatibilityEvaluator(client),
    pricing: new HttpPricingProvider(client, cfg),
    evidence: new ProvenanceEvidenceProvider(),
    resources: new HttpResourceEstimateProvider(),
  };
}
