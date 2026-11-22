import { createHash } from 'node:crypto';
import type { CacheHint } from '@modelcontextprotocol/server';
import type { CacheTier } from '../types.js';

/** The six cacheable result operations defined by report 09 §3.3 / AC-08. */
export const CACHEABLE_OPERATIONS = [
  'server/discover',
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list',
  'resources/read',
] as const;

export type CacheableOperation = (typeof CACHEABLE_OPERATIONS)[number];

/** Read-only Phase 1 results are public and cacheable. */
export const CACHE_TTL_MS = 60_000;

export const cacheHints: Partial<Record<CacheableOperation, CacheHint>> = {
  'server/discover': { ttlMs: CACHE_TTL_MS, cacheScope: 'public' },
  'tools/list': { ttlMs: CACHE_TTL_MS, cacheScope: 'public' },
  'prompts/list': { ttlMs: CACHE_TTL_MS, cacheScope: 'public' },
  'resources/list': { ttlMs: CACHE_TTL_MS, cacheScope: 'public' },
  'resources/templates/list': { ttlMs: CACHE_TTL_MS, cacheScope: 'public' },
  'resources/read': { ttlMs: CACHE_TTL_MS, cacheScope: 'public' },
};

export function isCacheableOperation(method: string): method is CacheableOperation {
  return (CACHEABLE_OPERATIONS as readonly string[]).includes(method);
}

/** `tools/call` results must never carry ttlMs/cacheScope (AC-09). */
export function assertNoCacheFields(result: Record<string, unknown>): boolean {
  return !('ttlMs' in result) && !('cacheScope' in result);
}

/* -------------------------------------------------------------------------- */
/* WP13 — tiered caching (additive)                                            */
/* -------------------------------------------------------------------------- */

/** Closed set of cache tiers; mirrors `CacheTier` in `src/types.ts`. */
export const CACHE_TIERS = ['metadata', 'content'] as const satisfies readonly CacheTier[];

/**
 * Upper bound for a content-cache TTL. Derived from the existing public cache
 * TTL — no new configuration key and no widening of the existing TTL contract.
 */
export const CONTENT_CACHE_MAX_TTL_MS = CACHE_TTL_MS;

/**
 * Parse an upstream `Cache-Control` header into a bounded max-age. Only a
 * public, non-`no-store` response with an explicit positive `max-age` is
 * cached; everything else falls back to no caching (the caller may still use
 * an ETag for conditional revalidation). Never returns a value above the cap.
 */
export function cacheControlMaxAgeMs(header: string | null | undefined): number | null {
  if (typeof header !== 'string' || header.length === 0) return null;
  const directives = header.split(',').map((part) => part.trim().toLowerCase());
  if (directives.includes('no-store') || directives.includes('private')) return null;
  for (const directive of directives) {
    const match = /^max-age\s*=\s*"?(\d+)"?$/.exec(directive);
    if (match?.[1] === undefined) continue;
    const seconds = Number(match[1]);
    if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
    return Math.min(seconds * 1000, CONTENT_CACHE_MAX_TTL_MS);
  }
  return null;
}

/**
 * Content-cache key: a one-way SHA-256 digest of the resolver-produced URL,
 * backend, accept header and any extra headers. No raw host, token, subject or
 * title appears in the key; the URL itself only comes from the server allowlist.
 */
export function contentCacheKey(
  url: string,
  options: { backend?: string; accept?: string; headers?: Record<string, string> } = {},
): string {
  const extra = options.headers === undefined
    ? ''
    : Object.entries(options.headers)
      .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(([name, value]) => `${name.toLowerCase()}=${value}`)
      .join('\n');
  return createHash('sha256')
    .update(url)
    .update('\u0000')
    .update(options.backend ?? '')
    .update('\u0000')
    .update(options.accept ?? '')
    .update('\u0000')
    .update(extra)
    .digest('hex');
}

/** Additive output field helper; never removes or renames an existing field. */
export function withCacheTier<T extends Record<string, unknown>>(payload: T, tier: CacheTier): T & { cache_tier: CacheTier } {
  return { ...payload, cache_tier: tier };
}
