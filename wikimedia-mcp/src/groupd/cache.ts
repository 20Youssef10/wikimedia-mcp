import { createHash } from 'node:crypto';
import {
  RECENT_CHANGES_CACHE_MAX_BYTES,
  RECENT_CHANGES_CACHE_MAX_ENTRIES,
} from './constants.js';

export type CachedWindow = {
  key: string;
  /** Upstream ETag used for the single conditional revalidation per hit. */
  etag: string | null;
  /** Parsed upstream JSON, re-validated on every read. */
  body: unknown;
  fetchedAt: number;
  bytes: number;
};

/** Guard against a malformed/corrupted cached value entering the response. */
export function isValidCachedBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const root = body as Record<string, unknown>;
  const query = root['query'];
  if (query === undefined) return true;
  if (query === null || typeof query !== 'object' || Array.isArray(query)) return false;
  const recent = (query as Record<string, unknown>)['recentchanges'];
  return Array.isArray(recent);
}

/**
 * In-process ETag/LRU cache for bounded recent-change windows. In-memory only
 * (never disk/chat), capacity-bounded by both entries and aggregate bytes, with
 * injectable clock for deterministic freshness/staleness tests.
 */
export class RecentChangesCache {
  private readonly entries = new Map<string, CachedWindow>();
  private bytes = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  get(key: string): CachedWindow | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (!isValidCachedBody(entry.body)) {
      this.delete(key);
      return undefined;
    }
    // Move to the end for LRU ordering.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  put(entry: Omit<CachedWindow, 'bytes'>): CachedWindow {
    const bytes = Buffer.byteLength(JSON.stringify(entry.body ?? null), 'utf8');
    const stored: CachedWindow = { ...entry, bytes };
    const existing = this.entries.get(entry.key);
    if (existing !== undefined) {
      this.bytes -= existing.bytes;
      this.entries.delete(entry.key);
    }
    this.entries.set(entry.key, stored);
    this.bytes += stored.bytes;
    while (this.entries.size > RECENT_CHANGES_CACHE_MAX_ENTRIES || this.bytes > RECENT_CHANGES_CACHE_MAX_BYTES) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      const old = this.entries.get(oldest.value);
      if (old !== undefined) this.bytes -= old.bytes;
      this.entries.delete(oldest.value);
    }
    return stored;
  }

  delete(key: string): void {
    const existing = this.entries.get(key);
    if (existing !== undefined) this.bytes -= existing.bytes;
    this.entries.delete(key);
  }

  get size(): number { return this.entries.size; }
  get byteSize(): number { return this.bytes; }
  get now(): number { return this.clock(); }
}

/** Cache key = SHA-256 of the frozen query parameters and window-end minute. */
export function buildCacheKey(query: {
  source: string;
  namespace: number;
  applied_limit: number;
  requested_seconds: number;
  include_bots: boolean;
  change_types: readonly string[] | null;
  end: string;
}): string {
  const minuteBucket = Math.floor(Date.parse(query.end) / 60_000) * 60_000;
  return createHash('sha256').update(JSON.stringify({
    source: query.source,
    namespace: query.namespace,
    applied_limit: query.applied_limit,
    requested_seconds_bucket: Math.floor(query.requested_seconds / 60),
    include_bots: query.include_bots,
    change_types: query.change_types,
    window_end_minute: minuteBucket,
  })).digest('hex');
}
