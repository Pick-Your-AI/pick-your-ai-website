import type { ContractName, ContractValidationError } from '../contracts';

export type DataErrorKind =
  | 'network' // request never completed (offline, DNS, CORS, timeout)
  | 'http' // non-2xx response
  | 'malformed' // response is not valid JSON or fails contract validation
  | 'not_found'
  | 'conflict' // stale revision (409)
  | 'unsupported'; // capability not available with this provider

/** Explicit, user-presentable failure from any data provider. */
export class DataError extends Error {
  readonly kind: DataErrorKind;
  readonly status?: number;
  readonly contract?: ContractName;
  readonly validationErrors?: ContractValidationError[];

  constructor(
    kind: DataErrorKind,
    message: string,
    extra: {
      status?: number;
      contract?: ContractName;
      validationErrors?: ContractValidationError[];
      cause?: unknown;
    } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = 'DataError';
    this.kind = kind;
    this.status = extra.status;
    this.contract = extra.contract;
    this.validationErrors = extra.validationErrors;
  }
}

export const DATA_ERROR_TITLES: Record<DataErrorKind, string> = {
  network: 'Could not reach the data service',
  http: 'The data service returned an error',
  malformed: 'Received data that does not match the contract',
  not_found: 'Not found',
  conflict: 'This build changed elsewhere',
  unsupported: 'Not available in this mode',
};

export function isDataError(e: unknown): e is DataError {
  return e instanceof DataError;
}
