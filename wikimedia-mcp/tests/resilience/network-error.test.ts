import { describe, expect, it } from 'vitest';
import { WikimediaClient, buildCoalesceKey } from '../../src/upstream/client.js';
import { UpstreamError } from '../../src/upstream/retry.js';
import { createHandlers } from '../../src/server/tools/handlers.js';
import { testConfig } from '../helpers/test-env.js';

const config = testConfig();

function dnsFailure(host: string): TypeError {
  const cause = Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  return new TypeError('fetch failed', { cause });
}

describe('network-level failures map to upstream_unavailable, not internal_error', () => {
  it('client.getJson wraps a DNS failure in UpstreamError status 0 with the host', async () => {
    const client = new WikimediaClient(config, {
      useDispatcher: false,
      fetchImpl: async () => { throw dnsFailure('en.wikipedia.org'); },
    });
    await expect(client.getJson('https://en.wikipedia.org/api/rest_v1/page/summary/Earth'))
      .rejects.toMatchObject({ name: 'UpstreamError', status: 0, host: 'en.wikipedia.org' });
    client.close();
  });

  it('tool envelope is retryable, names the failed host in the hint, and has no TypeError detail', async () => {
    const client = new WikimediaClient(config, {
      useDispatcher: false,
      // zh-hans resolves to zh.wikipedia.org; that is the host actually contacted.
      fetchImpl: async () => { throw dnsFailure('zh.wikipedia.org'); },
    });
    const handlers = createHandlers(client, config);
    const result = await handlers.get_summary({ title: 'Earth', lang: 'zh-hans' });
    expect(result.isError).toBe(true);
    const error = result.structuredContent?.['error'] as Record<string, unknown> | undefined;
    expect(error).toMatchObject({ code: 'upstream_unavailable', retryable: true });
    expect(String(error?.['hint'])).toContain('zh.wikipedia.org');
    expect(String(error?.['action'])).toContain('zh.wikipedia.org');
    expect((error?.['details'] as Record<string, unknown>)?.['network']).toBe(true);
    expect(error?.['code']).not.toBe('internal_error');
    expect(JSON.stringify(result)).not.toContain('TypeError');
    client.close();
  });

  it('genuine programming faults still map to internal_error', async () => {
    const client = new WikimediaClient(config, {
      useDispatcher: false,
      fetchImpl: async () => { throw new TypeError('cannot read property of undefined'); },
    });
    const handlers = createHandlers(client, config);
    const result = await handlers.get_summary({ title: 'Earth' });
    const error = result.structuredContent?.['error'] as Record<string, unknown> | undefined;
    expect(error?.['code']).toBe('internal_error');
    client.close();
  });

  it('UpstreamError status 0 keeps the host field', () => {
    const error = new UpstreamError('Network error contacting x.wikipedia.org', 0, null, 'x.wikipedia.org');
    expect(error.host).toBe('x.wikipedia.org');
    expect(error.status).toBe(0);
  });
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
const URL_A = 'https://en.wikipedia.org/api/rest_v1/page/summary/Earth';
const URL_FR = 'https://fr.wikipedia.org/api/rest_v1/page/summary/Terre';

describe('WP18 — in-flight request coalescing (fixture-only, no real egress)', () => {
  it('two identical concurrent reads share one upstream call with identical responses', async () => {
    let calls = 0;
    const client = new WikimediaClient(testConfig(), {
      useDispatcher: false,
      fetchImpl: async () => {
        calls += 1;
        await delay(15);
        return new Response(JSON.stringify({ call: calls }), { status: 200 });
      },
    });
    try {
      const [first, second] = await Promise.all([
        client.getJson(URL_A, { backend: 'wikimedia-rest-v1' }),
        client.getJson(URL_A, { backend: 'wikimedia-rest-v1' }),
      ]);
      expect(calls).toBe(1);
      expect(first.json).toEqual(second.json);
      expect(first.json).toEqual({ call: 1 });
      expect(client.inFlightCount).toBe(0);
      const snapshot = client.politenessSnapshot;
      expect(snapshot.coalesced_calls).toBe(1);
      expect(snapshot.coalesced_waiters).toBe(1);
      expect(snapshot.upstream_calls_total).toBe(1);

      // A later sequential call is a fresh upstream request, not a stale share.
      const third = await client.getJson(URL_A, { backend: 'wikimedia-rest-v1' });
      expect(calls).toBe(2);
      expect(third.json).toEqual({ call: 2 });
    } finally {
      client.close();
    }
  });

  it('aborting one waiter neither cancels the shared call nor affects the other', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const client = new WikimediaClient(testConfig(), {
      useDispatcher: false,
      fetchImpl: async (_url, init) => {
        upstreamSignal = init?.signal as AbortSignal | undefined;
        await delay(25);
        return new Response('{"ok":true}', { status: 200 });
      },
    });
    try {
      const controller = new AbortController();
      const leader = client.getJson(URL_A, { signal: controller.signal, backend: 'wikimedia-rest-v1' });
      const follower = client.getJson(URL_A, { backend: 'wikimedia-rest-v1' });
      controller.abort();
      await expect(leader).rejects.toMatchObject({ name: 'AbortError' });
      await expect(follower).resolves.toMatchObject({ status: 200 });
      expect(upstreamSignal?.aborted).toBe(false);
      expect(client.inFlightCount).toBe(0);
    } finally {
      client.close();
    }
  });

  it('fans an upstream error out to every waiter', async () => {
    const client = new WikimediaClient(testConfig({ RETRY_MAX_ATTEMPTS: '1' }), {
      useDispatcher: false,
      fetchImpl: async () => { throw new Error('boom'); },
    });
    try {
      const results = await Promise.allSettled([
        client.getJson(URL_A, { backend: 'wikimedia-rest-v1' }),
        client.getJson(URL_A, { backend: 'wikimedia-rest-v1' }),
      ]);
      expect(results[0]?.status).toBe('rejected');
      expect(results[1]?.status).toBe('rejected');
      const firstReason = (results[0] as PromiseRejectedResult).reason;
      const secondReason = (results[1] as PromiseRejectedResult).reason;
      expect(firstReason).toBe(secondReason);
      expect(client.inFlightCount).toBe(0);
    } finally {
      client.close();
    }
  });

  it('never coalesces across credentials, lang/project scopes or distinct methods', async () => {
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
        client.getJson(URL_A, { headers: { Authorization: 'Bearer SECRET_A' } }),
        client.getJson(URL_A, { headers: { Authorization: 'Bearer SECRET_B' } }),
      ]);
      expect(calls).toBe(2);

      calls = 0;
      await Promise.all([
        client.getJson(URL_A, { backend: 'x' }),
        client.getJson(URL_FR, { backend: 'x' }),
      ]);
      expect(calls).toBe(2);

      calls = 0;
      await Promise.all([
        client.getJson(URL_A, { accept: 'application/json' }),
        client.getJson(URL_A, { accept: 'text/html' }),
      ]);
      expect(calls).toBe(2);
      expect(client.politenessSnapshot.coalesced_waiters).toBe(0);
    } finally {
      client.close();
    }
  });

  it('the coalescing key never contains a token and differs per auth context', () => {
    const keyA = buildCoalesceKey(URL_A, undefined, { Authorization: 'Bearer SUPER_SECRET_TOKEN' });
    const keyB = buildCoalesceKey(URL_A, undefined, { Authorization: 'Bearer OTHER_SECRET_TOKEN' });
    expect(keyA).not.toContain('SUPER_SECRET_TOKEN');
    expect(keyA).not.toContain('Bearer');
    expect(keyB).not.toContain('OTHER_SECRET_TOKEN');
    expect(keyA).not.toBe(keyB);
    expect(buildCoalesceKey(URL_A)).not.toBe(buildCoalesceKey(URL_FR));
  });
});
