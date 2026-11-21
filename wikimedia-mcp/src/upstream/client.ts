import { Agent, fetch as undiciFetch } from 'undici';
import type { Config } from '../config.js';
import { ConcurrencyLimiter } from './limiter.js';
import { UpstreamError, parseRetryAfter, withRetry } from './retry.js';
import { isRecord } from '../protocol/meta.js';

export type FetchLike = (
  url: string,
  init?: Omit<RequestInit, 'dispatcher'> & { dispatcher?: unknown },
) => Promise<Response>;

export type UpstreamResponse = {
  status: number;
  json: unknown;
  text: string;
  retryAfterMs: number | null;
  /** Response headers (ETag / Last-Modified feed Phase 2 Wikibase provenance). */
  headers: Record<string, string>;
};

type CacheEntry = { value: unknown; expiresAt: number };

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return 'unknown host'; }
}

function errorDetail(error: unknown): string {
  if (error === null || typeof error !== 'object') return '';
  const value = error as { message?: unknown; cause?: unknown };
  const parts: string[] = [typeof value.message === 'string' ? value.message : ''];
  if (value.cause !== null && typeof value.cause === 'object') {
    const cause = value.cause as { code?: unknown; message?: unknown };
    if (typeof cause.code === 'string') parts.push(cause.code);
    if (typeof cause.message === 'string') parts.push(cause.message);
  }
  return parts.filter((part) => part.length > 0).join(' ');
}

/** Node/undici throw a TypeError with a network cause when DNS/connect fails. */
function isNetworkFetchError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|UND_ERR|getaddrinfo|socket hang up|network/i
    .test(errorDetail(error));
}

/**
 * Shared outbound client. Uses an undici `Agent` for deterministic connection
 * limits and timeouts, a global p-limit(3) semaphore, a contactable User-Agent
 * on every call, bounded jittered retries and an in-memory metadata cache.
 */
export class WikimediaClient {
  readonly limiter: ConcurrencyLimiter;
  private readonly dispatcher: Agent;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly fetchImpl: FetchLike;
  private readonly useDispatcher: boolean;

  constructor(
    private readonly config: Config,
    options: { fetchImpl?: FetchLike; useDispatcher?: boolean } = {},
  ) {
    this.useDispatcher = options.useDispatcher ?? true;
    this.limiter = new ConcurrencyLimiter(config.concurrencyLimit);
    this.dispatcher = new Agent({
      connections: config.concurrencyLimit,
      keepAliveTimeout: 10_000,
      connect: { timeout: config.httpTimeoutMs },
    });
    // undici's own fetch accepts its Agent as a dispatcher; Node's global fetch
    // (a different undici build) does not. Tests disable the dispatcher so MSW
    // can intercept via globalThis.fetch.
    this.fetchImpl = options.fetchImpl ?? ((url, init) => this.useDispatcher
      ? undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>
      : globalThis.fetch(url, init as RequestInit));
  }

  /** Number of upstream calls observed with status 429 (M4 instrumentation). */
  private total429 = 0;
  get rateLimitedCount(): number { return this.total429; }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      'User-Agent': this.config.userAgent,
      Accept: 'application/json',
      ...extra,
    };
  }

  /**
   * Run a task under the single global concurrency semaphore. Group B's WDQS
   * semaphore is nested inside this one, keeping global outbound ≤ 3 (AC-26).
   */
  async outbound<T>(task: () => Promise<T>): Promise<T> {
    return this.limiter.run(task);
  }

  /**
   * Raw GET with the shared User-Agent and dispatcher, but without retries or
   * JSON parsing. Used by the SPARQL pipeline, which implements its own
   * endpoint-chain / 429 / 503 policy (§4.7) and must see raw status codes.
   */
  async rawRequest(
    url: string,
    options: {
      headers?: Record<string, string>;
      signal?: AbortSignal;
      redirect?: 'follow' | 'error' | 'manual';
    } = {},
  ): Promise<{ status: number; text: string; headers: Record<string, string> }> {
    let response: Response;
    try {
      const init: Omit<RequestInit, 'dispatcher'> & { dispatcher?: unknown } = {
        method: 'GET',
        headers: this.headers(options.headers ?? {}),
        redirect: options.redirect ?? 'manual',
      };
      if (this.useDispatcher) init.dispatcher = this.dispatcher;
      if (options.signal !== undefined) init.signal = options.signal;
      response = await this.fetchImpl(url, init);
    } catch (error) {
      if (isNetworkFetchError(error)) {
        throw new UpstreamError(`Network error contacting ${hostnameOf(url)}`, 0, null, hostnameOf(url));
      }
      throw error;
    }
    return {
      status: response.status,
      text: await response.text(),
      headers: Object.fromEntries(response.headers.entries()),
    };
  }

  async getJson(
    url: string,
    options: { signal?: AbortSignal; backend?: string; accept?: string; headers?: Record<string, string> } = {},
  ): Promise<UpstreamResponse> {
    const outcome = await withRetry(
      async () => {
        let response: Response;
        try {
          response = await this.limiter.run(() => {
            const init: Omit<RequestInit, 'dispatcher'> & { dispatcher?: unknown } = {
              method: 'GET',
              headers: this.headers({
                ...(options.headers ?? {}),
                ...(options.accept === undefined ? {} : { Accept: options.accept }),
              }),
            };
            if (this.useDispatcher) init.dispatcher = this.dispatcher;
            if (options.signal !== undefined) init.signal = options.signal;
            return this.fetchImpl(url, init);
          });
        } catch (error) {
          if (isNetworkFetchError(error)) {
            const host = hostnameOf(url);
            throw new UpstreamError(`Network error contacting ${host}`, 0, null, host);
          }
          throw error;
        }

        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.config.retryAfterFallbackMs);
        const text = await response.text();
        if (response.status === 429) {
          this.total429 += 1;
          throw new UpstreamError(`Upstream returned 429 from ${options.backend ?? 'upstream'}`, 429, retryAfterMs);
        }
        if (response.status >= 500) {
          throw new UpstreamError(`Upstream ${response.status} from ${options.backend ?? 'upstream'}`, response.status);
        }
        let parsed: unknown = null;
        try {
          parsed = text.length > 0 ? JSON.parse(text) : null;
        } catch {
          if (response.ok) parsed = null;
        }
        return {
          status: response.status,
          json: parsed,
          text,
          retryAfterMs,
          headers: Object.fromEntries(response.headers.entries()),
        };
      },
      {
        maxAttempts: this.config.retryMaxAttempts,
        baseMs: this.config.retryBackoffBaseMs,
        maxMs: this.config.retryBackoffMaxMs,
        retryAfterFallbackMs: this.config.retryAfterFallbackMs,
      },
    );
    return outcome.value;
  }

  /** Cached siteinfo/rightsinfo/metadata getter with a strict TTL. */
  async cached<T>(key: string, loader: () => Promise<T>, ttlMs = this.config.metadataCacheTtlMs): Promise<T> {
    const now = Date.now();
    const entry = this.cache.get(key);
    if (entry !== undefined && entry.expiresAt > now) return entry.value as T;
    const value = await loader();
    this.cache.set(key, { value, expiresAt: now + ttlMs });
    return value;
  }

  get cacheSize(): number { return this.cache.size; }

  close(): void {
    this.dispatcher.destroy();
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
