import type { ContractName, ContractTypes } from '../../contracts';
import { validateContract, validatorsReady } from '../../contracts';
import { DataError } from '../errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** Minimal JSON client for the contract API (contracts/v1/api/openapi.yaml). */
export class ContractHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ data: unknown; response: Response }> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
        credentials: 'omit',
      });
    } catch (cause) {
      throw new DataError(
        'network',
        `Request to ${path} failed: ${(cause as Error)?.message ?? cause}`,
        { cause },
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response.ok) {
      const kind =
        response.status === 404 ? 'not_found' : response.status === 409 ? 'conflict' : 'http';
      let detail = '';
      try {
        const err = (await response.json()) as { message?: unknown };
        if (typeof err?.message === 'string') detail = `: ${err.message.slice(0, 300)}`;
      } catch {
        /* non-JSON error body */
      }
      throw new DataError(kind, `${method} ${path} returned ${response.status}${detail}`, {
        status: response.status,
      });
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch (cause) {
      throw new DataError('malformed', `${method} ${path} returned invalid JSON.`, {
        cause,
        status: response.status,
      });
    }
    return { data, response };
  }

  /** Requests and validates a contract payload; malformed responses become DataError('malformed'). */
  async contract<N extends ContractName>(
    name: N,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ value: ContractTypes[N]; response: Response }> {
    const { data, response } = await this.request(method, path, body, headers);
    await validatorsReady;
    const result = validateContract(name, data);
    if (!result.ok) {
      throw new DataError('malformed', result.summary, {
        contract: name,
        validationErrors: result.errors,
      });
    }
    return { value: result.value, response };
  }
}

export function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
