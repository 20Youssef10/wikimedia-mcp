import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CACHEABLE_OPERATIONS, CACHE_TIERS, CACHE_TTL_MS, cacheHints, isCacheableOperation,
  assertNoCacheFields, cacheControlMaxAgeMs, contentCacheKey, withCacheTier,
} from '../../src/protocol/caching.js';
import { inputRequiredStub } from '../../src/protocol/result.js';
import { WikimediaClient, buildCoalesceKey } from '../../src/upstream/client.js';
import { createHandlers } from '../../src/server/tools/handlers.js';
import { testConfig } from '../helpers/test-env.js';

type Cassette = {
  case_id: string;
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  };
};
const cassette = (name: string): Cassette => JSON.parse(
  readFileSync(new URL(`../fixtures/cassettes/WP13/${name}`, import.meta.url), 'utf8'),
) as Cassette;

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

describe('WP13 — tiered content caching (fixture-only, ETag/304)', () => {
  const URL_A = 'https://en.wikipedia.org/api/rest_v1/page/summary/Wp13FixturePage';

  it('uses a closed tier set and bounds Cache-Control max-age to the existing TTL', () => {
    expect([...CACHE_TIERS]).toEqual(['metadata', 'content']);
    expect(cacheControlMaxAgeMs('public, max-age=60')).toBe(60_000);
    expect(cacheControlMaxAgeMs('public, max-age=99999999')).toBe(CACHE_TTL_MS);
    expect(cacheControlMaxAgeMs('no-store, max-age=60')).toBeNull();
    expect(cacheControlMaxAgeMs('private, max-age=60')).toBeNull();
    expect(cacheControlMaxAgeMs(null)).toBeNull();
    expect(withCacheTier({ title: 'Earth' }, 'content')).toEqual({ title: 'Earth', cache_tier: 'content' });
  });

  it('serves the cached body on a 304 without a full re-fetch', async () => {
    const ok = cassette('content-200-etag.json');
    const notModified = cassette('content-304.json');
    let calls = 0;
    const client = new WikimediaClient(testConfig(), {
      useDispatcher: false,
      fetchImpl: async (_url, init) => {
        calls += 1;
        const headers = new Headers(init?.headers as HeadersInit);
        if (calls === 1) {
          expect(headers.get('if-none-match')).toBeNull();
          return new Response(JSON.stringify(ok.response.body), { status: 200, headers: ok.response.headers });
        }
        expect(headers.get('if-none-match')).toBe('"wp13-etag-1"');
        return new Response(null, { status: 304, headers: notModified.response.headers });
      },
    });
    try {
      const first = await client.cachedContent(URL_A, { backend: 'wikimedia-rest-v1' });
      expect(first.cache_tier).toBe('content');
      expect(first.json).toEqual(ok.response.body);
      expect(client.contentCacheSize).toBe(1);

      const second = await client.cachedContent(URL_A, { backend: 'wikimedia-rest-v1' });
      expect(calls).toBe(2); // one 200 + one conditional 304, never a full re-fetch
      expect(second.status).toBe(200);
      expect(second.json).toEqual(ok.response.body);
      expect(second.text).toBe(first.text);
      expect(second.cache_tier).toBe('content');
      expect(second.revalidated_304).toBe(true);
      expect(client.contentRevalidationCount).toBe(1);
    } finally {
      client.close();
    }
  });

  it('never caches a no-store response and never changes the metadata tier', async () => {
    const fixture = cassette('content-no-store.json');
    let calls = 0;
    const client = new WikimediaClient(testConfig(), {
      useDispatcher: false,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(fixture.response.body), { status: 200, headers: fixture.response.headers });
      },
    });
    try {
      const first = await client.cachedContent(URL_A, { backend: 'wikimedia-rest-v1' });
      const second = await client.cachedContent(URL_A, { backend: 'wikimedia-rest-v1' });
      expect(calls).toBe(2);
      expect(first.cache_tier).toBeUndefined();
      expect(second.cache_tier).toBeUndefined();
      expect(client.contentCacheSize).toBe(0);
      const metadata = await client.cached('metadata-key', async () => ({ ok: true }));
      expect('cache_tier' in metadata).toBe(false);
    } finally {
      client.close();
    }
  });

  it('cache keys expose no raw host, token, subject or title', () => {
    const options = {
      backend: 'wikimedia-rest-v1',
      headers: { Authorization: 'Bearer SECRET_TOKEN_VALUE', Cookie: 'subject=RAW_SUBJECT' },
    };
    const key = contentCacheKey(URL_A, options);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain('wikipedia.org');
    expect(key).not.toContain('SECRET_TOKEN_VALUE');
    expect(key).not.toContain('RAW_SUBJECT');
    expect(contentCacheKey(URL_A, options)).toBe(key);
    // Distinct credential scopes never share a content-cache key.
    expect(contentCacheKey(URL_A, {
      backend: 'wikimedia-rest-v1',
      headers: { Authorization: 'Bearer OTHER_TOKEN' },
    })).not.toBe(key);
  });

  it('emits additive cache_tier on a tool payload while retaining flat fields', async () => {
    const ok = cassette('content-200-etag.json');
    const notModified = cassette('content-304.json');
    let calls = 0;
    const client = new WikimediaClient(testConfig(), {
      useDispatcher: false,
      fetchImpl: async (_url, init) => {
        calls += 1;
        const headers = new Headers(init?.headers as HeadersInit);
        if (calls === 1) {
          return new Response(JSON.stringify(ok.response.body), { status: 200, headers: ok.response.headers });
        }
        expect(headers.get('if-none-match')).toBe('"wp13-etag-1"');
        return new Response(null, { status: 304, headers: notModified.response.headers });
      },
    });
    try {
      const handlers = createHandlers(client, testConfig());
      const first = await handlers['get_summary']({ title: 'Wp13FixturePage', lang: 'en', project: 'wikipedia' });
      const second = await handlers['get_summary']({ title: 'Wp13FixturePage', lang: 'en', project: 'wikipedia' });
      const payload = second.structuredContent;
      expect(calls).toBe(2);
      expect(payload['cache_tier']).toBe('content');
      for (const field of ['title', 'source', 'license', 'attribution']) {
        expect(field in payload).toBe(true);
      }
      expect(payload['title']).toBe(first.structuredContent['title']);
      expect(assertNoCacheFields(payload)).toBe(true); // cache_tier is not ttlMs/cacheScope
    } finally {
      client.close();
    }
  });
});
