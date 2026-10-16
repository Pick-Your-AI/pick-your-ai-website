import type {
  BuildSnapshot,
  CatalogItem,
  CatalogSnapshot,
  CostEstimate,
  DependencyGraph,
  DeploymentManifest,
  EvaluationReport,
  Pricebook,
  ResourceEstimate,
  Ruleset,
  Selection,
} from './generated/contract-types';
import type { ContractValidateFunction, ContractValidationError } from './generated/validators';
import * as validators from './generated/validators.js';

export interface ContractTypes {
  BuildSnapshot: BuildSnapshot;
  CatalogItem: CatalogItem;
  CatalogSnapshot: CatalogSnapshot;
  CostEstimate: CostEstimate;
  DependencyGraph: DependencyGraph;
  DeploymentManifest: DeploymentManifest;
  EvaluationReport: EvaluationReport;
  Pricebook: Pricebook;
  ResourceEstimate: ResourceEstimate;
  Ruleset: Ruleset;
  Selection: Selection;
}

export type ContractName = keyof ContractTypes;
export type { ContractValidationError };

const VALIDATORS: Record<ContractName, ContractValidateFunction> = {
  BuildSnapshot: validators.validateBuildSnapshot,
  CatalogItem: validators.validateCatalogItem,
  CatalogSnapshot: validators.validateCatalogSnapshot,
  CostEstimate: validators.validateCostEstimate,
  DependencyGraph: validators.validateDependencyGraph,
  DeploymentManifest: validators.validateDeploymentManifest,
  EvaluationReport: validators.validateEvaluationReport,
  Pricebook: validators.validatePricebook,
  ResourceEstimate: validators.validateResourceEstimate,
  Ruleset: validators.validateRuleset,
  Selection: validators.validateSelection,
};

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; errors: ContractValidationError[]; summary: string };

/** Validates `data` against a contract JSON Schema (ahead-of-time compiled Ajv validator). */
export function validateContract<N extends ContractName>(
  name: N,
  data: unknown,
): ValidationResult<ContractTypes[N]> {
  const validate = VALIDATORS[name];
  if (validate(data)) return { ok: true, value: data as ContractTypes[N] };
  const errors = validate.errors ?? [];
  return { ok: false, errors, summary: formatErrors(name, errors) };
}

export function formatErrors(name: string, errors: ContractValidationError[]): string {
  const first = errors
    .slice(0, 3)
    .map((e) => `${e.instancePath || '(root)'} ${e.message ?? e.keyword}`)
    .join('; ');
  return `${name} failed schema validation: ${first || 'unknown error'}`;
}

export class ContractValidationFailure extends Error {
  readonly contract: ContractName;
  readonly errors: ContractValidationError[];
  constructor(contract: ContractName, errors: ContractValidationError[]) {
    super(formatErrors(contract, errors));
    this.name = 'ContractValidationFailure';
    this.contract = contract;
    this.errors = errors;
  }
}

/** Validates or throws ContractValidationFailure. */
export function assertContract<N extends ContractName>(name: N, data: unknown): ContractTypes[N] {
  const result = validateContract(name, data);
  if (!result.ok) throw new ContractValidationFailure(name, result.errors);
  return result.value;
}
