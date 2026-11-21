import { describe, expect, it } from 'vitest';
import { CACHEABLE_OPERATIONS, cacheHints, isCacheableOperation, assertNoCacheFields } from '../../src/protocol/caching.js';
import { inputRequiredStub } from '../../src/protocol/result.js';
import { WikimediaClient, buildCoalesceKey } from '../../src/upstream/client.js';
import { testConfig } from '../helpers/test-env.js';

describe('caching metadata (AC-07/AC-08/AC-09)', () => {
  it('defines hints for exactly the six cacheable operations', () => {
    expect(CACHEABLE_OPERATIONS).toEqual([
      'server/discover', 'tools/list', 'prompts/list',
      'resources/list', 'resources/templates/list', 'resources/read',
    ]);
    for (const operation of CACHEABLE_OPERATIONS) {
      const hint = cacheHints[operation];
      expect(hint).toBeDefined();
      expect(hint?.ttlMs).toBeGreaterThanOrEqual(0);
      expect(hint?.cacheScope).toBe('public');
    }
  });

  it('does not treat tools/call as cacheable', () => {
    expect(isCacheableOperation('tools/call')).toBe(false);
    expect(assertNoCacheFields({ title: 'Earth' })).toBe(true);
    expect(assertNoCacheFields({ ttlMs: 10 })).toBe(false);
  });

  it('input_required stub carries neither ttlMs nor cacheScope', () => {
    const stub = inputRequiredStub();
    expect(stub.resultType).toBe('input_required');
    expect('ttlMs' in stub).toBe(false);
    expect('cacheScope' in stub).toBe(false);
  });
});

describe('WP18 — cache and coalescing interaction (fixture-only)', () => {
  const URL_A = 'https://en.wikipedia.org/api/rest_v1/page/summary/Earth';

  it('concurrent cache misses share one upstream read, then hit the cache', async () => {
    let calls = 0;
    const client = new WikimediaClient(testConfig(), {
      useDispatcher: false,
      fetchImpl: async () => {
        calls += 1;
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        return new Response('{"ok":true}', { status: 200 });
      },
    });
    try {
      const loader = () => client.getJson(URL_A, { backend: 'wikimedia-rest-v1' });
      const [first, second] = await Promise.all([
        client.cached('shared-key', loader),
        client.cached('shared-key', loader),
      ]);
      expect(calls).toBe(1);
      expect(first).toEqual(second);
      expect(client.cacheSize).toBe(1);

      // A third sequential lookup is served from the cache with no upstream call.
      const third = await client.cached('shared-key', loader);
      expect(calls).toBe(1);
      expect(third).toEqual(first);

      const snapshot = client.politenessSnapshot;
      expect(snapshot.cache_misses).toBe(2);
      expect(snapshot.cache_hits).toBe(1);
      expect(snapshot.upstream_calls_total).toBe(1);
      expect(snapshot.coalesced_waiters).toBe(1);
      expect(snapshot.coalesced_calls).toBe(1);
    } finally {
      client.close();
    }
  });

  it('opt-out calls are never coalesced with each other', async () => {
    let calls = 0;
    const client = new WikimediaClient(testConfig(), {
      useDispatcher: false,
      fetchImpl: async () => {
        calls += 1;
        return new Response('{"ok":true}', { status: 200 });
      },
    });
    try {
      await Promise.all([
        client.getJson(URL_A, { coalesce: false }),
        client.getJson(URL_A, { coalesce: false }),
      ]);
      expect(calls).toBe(2);
      expect(client.politenessSnapshot.coalesced_waiters).toBe(0);
    } finally {
      client.close();
    }
  });

  it('buildCoalesceKey is deterministic and excludes raw credentials', () => {
    const headers = { Authorization: 'Bearer TOKEN_VALUE', Cookie: 'sid=SESSION_VALUE' };
    const key = buildCoalesceKey(URL_A, 'application/json', headers);
    expect(key).toBe(buildCoalesceKey(URL_A, 'application/json', headers));
    expect(key).not.toContain('TOKEN_VALUE');
    expect(key).not.toContain('SESSION_VALUE');
    expect(key).not.toContain('Bearer');
    expect(buildCoalesceKey(URL_A, 'application/json', { ...headers, 'X-Extra': 'v' })).not.toBe(key);
  });
});
