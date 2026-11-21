import type { CacheHint } from '@modelcontextprotocol/server';

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
