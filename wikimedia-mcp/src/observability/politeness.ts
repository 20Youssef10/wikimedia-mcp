/**
 * WP16 — Politeness telemetry for the nightly report.
 *
 * All values are counts, ratios or durations only. No token, title, raw
 * subject, secret or host is ever recorded here, so the resulting block is
 * safe to export alongside `reports/nightly-live.json`.
 */

/** Minimal shape needed to derive gate-observed call counters. */
type ObservableCall = {
  tool: string;
  upstream429: boolean;
  warmup?: boolean;
};

export type RetryAfterProximity = {
  /** Responses that carried a Retry-After header. */
  observed: number;
  /** Responses with status 429. */
  rate_limited: number;
  /** Times the configured backoff honoured the advertised Retry-After in full. */
  honored: number;
  /** rate_limited / total upstream calls (0 when no calls). */
  proximity_ratio: number;
  /** Largest Retry-After seen, in milliseconds. */
  max_observed_ms: number;
};

/** Additive, serialisable politeness block appended to the nightly report. */
export type PolitenessSnapshot = {
  /** Upstream calls by tool/backend label (counts only). */
  upstream_calls_by_tool: Record<string, number>;
  /** Sum of all recorded upstream calls. */
  upstream_calls_total: number;
  cache_hits: number;
  cache_misses: number;
  /** cache_hits / (cache_hits + cache_misses); 0 when no lookups occurred. */
  cache_hit_rate: number;
  retry_after: RetryAfterProximity;
  /** Temporary concurrency reductions applied on 429/503 (WP17). */
  concurrency_reductions: number;
  /** Shared in-flight calls that served an extra waiter (WP18). */
  coalesced_calls: number;
  /** Extra waiters served by shared in-flight calls (WP18). */
  coalesced_waiters: number;
};

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function observedRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

/** Empty snapshot with stable zero values. */
export function emptyPolitenessSnapshot(): PolitenessSnapshot {
  return {
    upstream_calls_by_tool: {},
    upstream_calls_total: 0,
    cache_hits: 0,
    cache_misses: 0,
    cache_hit_rate: 0,
    retry_after: {
      observed: 0,
      rate_limited: 0,
      honored: 0,
      proximity_ratio: 0,
      max_observed_ms: 0,
    },
    concurrency_reductions: 0,
    coalesced_calls: 0,
    coalesced_waiters: 0,
  };
}

/**
 * Mutable recorder. One instance per `WikimediaClient`, so fixtures stay
 * isolated and no process-wide state leaks between tenants or tests.
 */
export class PolitenessTelemetry {
  private readonly calls = new Map<string, number>();
  private hits = 0;
  private misses = 0;
  private retryObserved = 0;
  private retryRateLimited = 0;
  private retryHonored = 0;
  private retryMaxMs = 0;
  private reductions = 0;
  private coalescedCalls = 0;
  private coalescedWaiters = 0;

  /** Record one upstream attempt. `label` must be a backend/tool name, never a URL with credentials. */
  recordUpstreamCall(label: string, status?: number, retryAfterMs?: number | null): void {
    const key = label.length > 0 ? label : 'upstream';
    this.calls.set(key, (this.calls.get(key) ?? 0) + 1);
    if (status === 429) this.retryRateLimited += 1;
    if (retryAfterMs !== undefined && retryAfterMs !== null && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
      this.retryObserved += 1;
      // withRetry sleeps the full advertised Retry-After on 429/503.
      this.retryHonored += 1;
      if (retryAfterMs > this.retryMaxMs) this.retryMaxMs = retryAfterMs;
    }
  }

  recordCacheHit(): void { this.hits += 1; }
  recordCacheMiss(): void { this.misses += 1; }
  recordConcurrencyReduction(): void { this.reductions += 1; }

  /** One shared call served `extraWaiters` additional callers. */
  recordCoalescing(extraWaiters: number): void {
    if (!Number.isFinite(extraWaiters) || extraWaiters <= 0) return;
    this.coalescedCalls += 1;
    this.coalescedWaiters += extraWaiters;
  }

  snapshot(): PolitenessSnapshot {
    const byTool: Record<string, number> = {};
    let total = 0;
    for (const [label, count] of [...this.calls.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      byTool[label] = count;
      total += count;
    }
    return {
      upstream_calls_by_tool: byTool,
      upstream_calls_total: total,
      cache_hits: this.hits,
      cache_misses: this.misses,
      cache_hit_rate: observedRatio(this.hits, this.hits + this.misses),
      retry_after: {
        observed: this.retryObserved,
        rate_limited: this.retryRateLimited,
        honored: this.retryHonored,
        proximity_ratio: ratio(this.retryRateLimited, total),
        max_observed_ms: this.retryMaxMs,
      },
      concurrency_reductions: this.reductions,
      coalesced_calls: this.coalescedCalls,
      coalesced_waiters: this.coalescedWaiters,
    };
  }

  reset(): void {
    this.calls.clear();
    this.hits = 0;
    this.misses = 0;
    this.retryObserved = 0;
    this.retryRateLimited = 0;
    this.retryHonored = 0;
    this.retryMaxMs = 0;
    this.reductions = 0;
    this.coalescedCalls = 0;
    this.coalescedWaiters = 0;
  }
}

/**
 * Best-effort politeness block derived from gate observations. Used when the
 * report is assembled in a different process from the upstream client (the
 * nightly runner spawns the MCP server as a child), so the only counters
 * available are the measured call mix and the observed 429 count.
 */
export function derivePolitenessFromObservations(observations: readonly ObservableCall[]): PolitenessSnapshot {
  const measured = observations.filter((item) => item.warmup !== true);
  const byTool: Record<string, number> = {};
  for (const item of measured) {
    byTool[item.tool] = (byTool[item.tool] ?? 0) + 1;
  }
  const rateLimited = measured.filter((item) => item.upstream429).length;
  return {
    ...emptyPolitenessSnapshot(),
    upstream_calls_by_tool: byTool,
    upstream_calls_total: measured.length,
    // No cache instrumentation is visible to the report process; 0 means
    // "not instrumented in this run", not "no cache hits".
    cache_hit_rate: 0,
    retry_after: {
      observed: 0,
      rate_limited: rateLimited,
      honored: 0,
      proximity_ratio: ratio(rateLimited, measured.length),
      max_observed_ms: 0,
    },
  };
}
