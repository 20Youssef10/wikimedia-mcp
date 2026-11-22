import { createHash } from 'node:crypto';
import { Agent, fetch as undiciFetch } from 'undici';
import type { Config } from '../config.js';
import { ConcurrencyLimiter } from './limiter.js';
import { UpstreamError, parseRetryAfter, withRetry, type RetryOutcome } from './retry.js';
import { isRecord } from '../protocol/meta.js';
import { PolitenessTelemetry, type PolitenessSnapshot } from '../observability/politeness.js';
import { CONTENT_CACHE_MAX_TTL_MS, cacheControlMaxAgeMs, contentCacheKey } from '../protocol/caching.js';
import type { CacheTier } from '../types.js';

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
  /** WP13 — additive cache tier; absent on ordinary uncached responses. */
  cache_tier?: CacheTier;
  /** WP13 — true when a conditional revalidation returned 304. */
  revalidated_304?: boolean;
};

type CacheEntry = { value: unknown; expiresAt: number };

/** WP13 — bounded content cache entry (body kept so 304 can avoid a re-fetch). */
type ContentCacheEntry = {
  json: unknown;
  text: string;
  etag: string | null;
  ttlMs: number;
  expiresAt: number;
  fetchedAt: number;
};

/**
 * Upper bound on how long a coalesced waiter may wait on a shared upstream
 * call. Bounded waits prevent a stalled leader from hanging every caller.
 * This is an internal constant — no new configuration key (WP18).
 */
export const COALESCE_MAX_WAIT_MS = 10_000;

/**
 * Build the deduplication key for an in-flight read. The URL distinguishes
 * lang/project scopes; all header values (including any credential) are
 * reduced to a one-way digest so no raw token ever appears in the key.
 * Distinct credentials therefore produce distinct keys and never coalesce.
 */
export function buildCoalesceKey(
  url: string,
  accept?: string,
  headers?: Record<string, string>,
): string {
  const canonical = headers === undefined
    ? ''
    : Object.entries(headers)
      .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(([name, value]) => `${name.toLowerCase()}=${value}`)
      .join('\n');
  // SHA-256 avoids any cross-tenant key collision while keeping credentials
  // one-way: the raw header values never appear in the returned key.
  const digest = createHash('sha256')
    .update(canonical)
    .update('\u0000')
    .update(accept ?? '')
    .digest('hex');
  return `${url}\u0000${digest}`;
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return 'unknown host'; }
}

/** Case-insensitive lookup over a plain header record (WP13 ETag handling). */
function headerOf(headers: Record<string, string>, name: string): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
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

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : Object.assign(new Error('The upstream request was aborted'), { name: 'AbortError' });
}

type UpstreamOutcome = RetryOutcome<UpstreamResponse>;

type InFlightEntry = {
  promise: Promise<UpstreamOutcome>;
  resolve: (value: UpstreamOutcome) => void;
  reject: (error: unknown) => void;
  controller: AbortController;
  activeWaiters: number;
  joinedWaiters: number;
  /** While true the leader's abort propagates to the shared fetch. */
  propagate: boolean;
  leaderSignal: AbortSignal | undefined;
  leaderListener: (() => void) | undefined;
};

/**
 * Shared outbound client. Uses an undici `Agent` for deterministic connection
 * limits and timeouts, a global p-limit(3) semaphore, a contactable User-Agent
 * on every call, bounded jittered retries, an in-memory metadata cache and
 * (WP18) in-flight request coalescing for identical reads.
 */
export class WikimediaClient {
  readonly limiter: ConcurrencyLimiter;
  /** WP16/17/18 — per-client counters, isolated from other tenants/tests. */
  readonly politeness = new PolitenessTelemetry();
  private readonly dispatcher: Agent;
  private readonly cache = new Map<string, CacheEntry>();
  /** WP13 — separate content tier; the metadata cache above is untouched. */
  private readonly contentCache = new Map<string, ContentCacheEntry>();
  private contentCacheHits = 0;
  private readonly inFlight = new Map<string, InFlightEntry>();
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

  /** Snapshot of the additive politeness telemetry (counts/ratios only). */
  get politenessSnapshot(): PolitenessSnapshot { return this.politeness.snapshot(); }

  /** Number of in-flight shared reads currently being coalesced. */
  get inFlightCount(): number { return this.inFlight.size; }

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
      backend?: string;
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
    this.politeness.recordUpstreamCall(options.backend ?? 'raw', response.status);
    return {
      status: response.status,
      text: await response.text(),
      headers: Object.fromEntries(response.headers.entries()),
    };
  }

  /**
   * Wait on a shared upstream outcome. A caller's signal only rejects that
   * caller; the shared call is cancelled only when the final active waiter
   * aborts. Waits are bounded so a stalled leader cannot hang other callers.
   */
  private waitForMember(entry: InFlightEntry, signal: AbortSignal | undefined): Promise<UpstreamOutcome> {
    const decrement = (): void => { entry.activeWaiters -= 1; };
    if (signal === undefined) return entry.promise.finally(decrement);
    if (signal.aborted) {
      decrement();
      return Promise.reject(abortError(signal));
    }
    return new Promise<UpstreamOutcome>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        clearTimeout(timer);
        decrement();
      };
      const onAbort = (): void => {
        if (settled) return;
        const wasLast = entry.activeWaiters <= 1;
        cleanup();
        if (wasLast) entry.controller.abort(signal.reason);
        reject(abortError(signal));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error('coalesced upstream wait exceeded its bounded window'));
      }, COALESCE_MAX_WAIT_MS);
      signal.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        (value) => { if (!settled) { cleanup(); resolve(value); } },
        (error: unknown) => { if (!settled) { cleanup(); reject(error); } },
      );
    });
  }

  /** Join or create a shared upstream read. */
  private coalesceGetJson(
    key: string | undefined,
    callerSignal: AbortSignal | undefined,
    run: (signal: AbortSignal | undefined) => Promise<UpstreamOutcome>,
  ): Promise<UpstreamOutcome> {
    if (key === undefined) return run(callerSignal);

    const existing = this.inFlight.get(key);
    if (existing !== undefined) {
      existing.activeWaiters += 1;
      existing.joinedWaiters += 1;
      // Once a second caller joins, no single caller may cancel the shared read.
      existing.propagate = false;
      if (existing.leaderSignal !== undefined && existing.leaderListener !== undefined) {
        existing.leaderSignal.removeEventListener('abort', existing.leaderListener);
        existing.leaderListener = undefined;
      }
      return this.waitForMember(existing, callerSignal);
    }

    const controller = new AbortController();
    let resolve!: (value: UpstreamOutcome) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<UpstreamOutcome>((res, rej) => { resolve = res; reject = rej; });
    const entry: InFlightEntry = {
      promise, resolve, reject, controller,
      activeWaiters: 1, joinedWaiters: 0, propagate: true,
      leaderSignal: callerSignal, leaderListener: undefined,
    };
    const leaderSignal = callerSignal;
    if (leaderSignal !== undefined) {
      const listener = (): void => { if (entry.propagate) entry.controller.abort(leaderSignal.reason); };
      entry.leaderListener = listener;
      leaderSignal.addEventListener('abort', listener, { once: true });
    }
    this.inFlight.set(key, entry);
    void (async () => {
      try {
        entry.resolve(await run(controller.signal));
      } catch (error) {
        entry.reject(error);
      } finally {
        if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
        if (entry.leaderSignal !== undefined && entry.leaderListener !== undefined) {
          entry.leaderSignal.removeEventListener('abort', entry.leaderListener);
        }
        if (entry.joinedWaiters > 0) this.politeness.recordCoalescing(entry.joinedWaiters);
        // Avoid an unhandled rejection if every waiter aborted.
        promise.catch(() => {});
      }
    })();
    return this.waitForMember(entry, callerSignal);
  }

  async getJson(
    url: string,
    options: {
      signal?: AbortSignal;
      backend?: string;
      accept?: string;
      headers?: Record<string, string>;
      /** Set false to opt a specific call out of in-flight coalescing. */
      coalesce?: boolean;
    } = {},
  ): Promise<UpstreamResponse> {
    const label = options.backend ?? 'upstream';
    const key = options.coalesce === false ? undefined : buildCoalesceKey(url, options.accept, options.headers);
    const outcome = await this.coalesceGetJson(key, options.signal, async (runSignal) => withRetry(
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
            if (runSignal !== undefined) init.signal = runSignal;
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
        this.politeness.recordUpstreamCall(label, response.status, retryAfterMs);
        if (response.status === 429) {
          this.total429 += 1;
          if (this.limiter.reduce('429')) this.politeness.recordConcurrencyReduction();
          throw new UpstreamError(`Upstream returned 429 from ${options.backend ?? 'upstream'}`, 429, retryAfterMs);
        }
        if (response.status >= 500) {
          if (response.status === 503 && this.limiter.reduce('503')) this.politeness.recordConcurrencyReduction();
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
    ));
    return outcome.value;
  }

  /**
   * WP13 — bounded content tier. Uses the upstream `Cache-Control: max-age`
   * (clamped to `CONTENT_CACHE_MAX_TTL_MS`) as the freshness lifetime and the
   * `ETag` for one conditional revalidation per hit. A 304 serves the cached
   * body without a full re-fetch. This is a separate map: the metadata cache,
   * its TTLs and cache keys are unchanged.
   */
  async cachedContent(
    url: string,
    options: {
      signal?: AbortSignal;
      backend?: string;
      accept?: string;
      headers?: Record<string, string>;
      coalesce?: boolean;
    } = {},
  ): Promise<UpstreamResponse> {
    const key = contentCacheKey(url, options);
    const now = Date.now();
    const entry = this.contentCache.get(key);
    const extraHeaders = options.headers ?? {};
    // A conditional request is only ever sent when we hold a matching ETag.
    const etag = entry?.etag ?? null;
    const sentConditional = etag !== null;
    const revalidationHeaders = etag === null
      ? extraHeaders
      : { ...extraHeaders, 'If-None-Match': etag };

    const response = await this.getJson(url, {
      ...options,
      ...(revalidationHeaders === extraHeaders && options.headers === undefined
        ? {}
        : { headers: revalidationHeaders }),
    });

    if (response.status === 304 && entry !== undefined && sentConditional) {
      this.contentCacheHits += 1;
      // Upstream confirmed the representation is current. Refresh only the
      // freshness window; the cached body is returned unchanged.
      const refresh = cacheControlMaxAgeMs(headerOf(response.headers, 'cache-control')) ?? entry.ttlMs;
      entry.fetchedAt = now;
      entry.expiresAt = now + Math.min(refresh, CONTENT_CACHE_MAX_TTL_MS);
      return {
        ...response,
        status: 200,
        json: entry.json,
        text: entry.text,
        cache_tier: 'content',
        revalidated_304: true,
      };
    }

    if (response.status === 200) {
      const maxAgeMs = cacheControlMaxAgeMs(headerOf(response.headers, 'cache-control'));
      if (maxAgeMs !== null) {
        const etag = headerOf(response.headers, 'etag');
        this.contentCache.set(key, {
          json: response.json,
          text: response.text,
          etag,
          ttlMs: maxAgeMs,
          expiresAt: now + maxAgeMs,
          fetchedAt: now,
        });
        return { ...response, cache_tier: 'content' };
      }
      // A 200 without a usable freshness lifetime invalidates any stale entry.
      this.contentCache.delete(key);
    }
    return response;
  }

  /** WP13 — number of content entries and conditional hits (fixture telemetry). */
  get contentCacheSize(): number { return this.contentCache.size; }
  get contentRevalidationCount(): number { return this.contentCacheHits; }

  /** Cached siteinfo/rightsinfo/metadata getter with a strict TTL. */
  async cached<T>(key: string, loader: () => Promise<T>, ttlMs = this.config.metadataCacheTtlMs): Promise<T> {
    const now = Date.now();
    const entry = this.cache.get(key);
    if (entry !== undefined && entry.expiresAt > now) {
      this.politeness.recordCacheHit();
      return entry.value as T;
    }
    this.politeness.recordCacheMiss();
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
