import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mapHttpStatus } from '../../src/protocol/errors.js';
import { UpstreamError } from '../../src/upstream/retry.js';
import { WikimediaClient } from '../../src/upstream/client.js';
import { createHandlers } from '../../src/server/tools/handlers.js';
import { createMswServer } from '../helpers/msw.js';
import { testConfig } from '../helpers/test-env.js';

describe('resilience error mapping (fixture-only)', () => {
  it('maps 429 to retryable rate_limited with actionable recovery', () => {
    const error = mapHttpStatus(429, { retryAfterSeconds: 1, backend: 'wikimedia-rest-v1' });
    expect(error).toMatchObject({ code: 'rate_limited', retryable: true, retry_after_seconds: 1 });
    expect(error.action.length).toBeGreaterThan(5);
  });

  it('maps 503 to retryable upstream_unavailable and 404 to non-retryable page_not_found', () => {
    expect(mapHttpStatus(503, {})).toMatchObject({ code: 'upstream_unavailable', retryable: true });
    const missing = mapHttpStatus(404, { title: 'Missing', source: 'wikipedia:en' });
    expect(missing).toMatchObject({ code: 'page_not_found', retryable: false });
    expect(missing.message).toContain('Missing');
    expect(missing.hint).toContain('search');
  });

  it('never surfaces raw HTTP status text in messages', () => {
    for (const status of [401, 403, 429, 500, 503]) {
      const message = mapHttpStatus(status, {}).message;
      expect(message).not.toMatch(/HTTP \d+|Too Many Requests|Unauthorized|Service Unavailable/);
    }
    expect(new UpstreamError('429', 429).status).toBe(429);
  });
});

describe('M5 — get_media must not swallow upstream faults', () => {
  type Fault = '503' | '429' | 'detail';
  let fault: Fault = '503';

  const config = testConfig();
  const client = new WikimediaClient(config, {
    useDispatcher: false,
    fetchImpl: async (url) => {
      if (url.includes('prop=images')) {
        return new Response(JSON.stringify({
          query: { pages: { 1: { title: 'Earth', images: [{ title: 'File:Earth.jpg' }] } } },
        }), { status: 200 });
      }
      if (fault === '503') return new Response('upstream down', { status: 503 });
      if (fault === '429') {
        return new Response('{}', { status: 429, headers: { 'Retry-After': '0' } });
      }
      // Per-item/detail failure (not an UpstreamError) must degrade to warnings.
      throw new Error('media detail parse failure');
    },
  });
  const handlers = createHandlers(client, config);

  afterAll(() => { client.close(); });

  function errorOf(result: { structuredContent?: Record<string, unknown> }): Record<string, unknown> {
    return (result.structuredContent?.['error'] ?? {}) as Record<string, unknown>;
  }

  it('503 on the imageinfo batch surfaces upstream_unavailable', async () => {
    fault = '503';
    const result = await handlers.get_media({ title: 'Earth' });
    expect(errorOf(result)).toMatchObject({ code: 'upstream_unavailable', retryable: true });
  });

  it('429 on the imageinfo batch surfaces rate_limited', async () => {
    fault = '429';
    const result = await handlers.get_media({ title: 'Earth' });
    expect(errorOf(result)).toMatchObject({ code: 'rate_limited', retryable: true });
  });

  it('a per-item detail failure degrades to warnings, not a tool error', async () => {
    fault = 'detail';
    const result = await handlers.get_media({ title: 'Earth' });
    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload['truncated']).toBe(true);
    expect(payload['warnings']).toBeDefined();
  });
});

describe('H3 / TC-A-014 — 429 then success with Retry-After', () => {
  const msw = createMswServer();
  const config = testConfig({ RETRY_MAX_ATTEMPTS: '3', RETRY_AFTER_FALLBACK_MS: '1' });
  const client = new WikimediaClient(config, { useDispatcher: false });
  const handlers = createHandlers(client, config);
  let calls = 0;

  beforeAll(() => {
    msw.listen({ onUnhandledRequest: 'bypass' });
    msw.use(http.get('*/api/rest_v1/page/summary/:title', ({ request, params }) => {
      const title = String(params['title'] ?? '');
      if (title.includes('RateLimitedEarth')) {
        calls += 1;
        const header = title.includes('1s') ? '1' : '0';
        if (calls === 1) {
          return HttpResponse.json({ type: 'rate_limited' }, {
            status: 429,
            headers: { 'Retry-After': header },
          });
        }
        return HttpResponse.json({
          title: 'Earth', extract: 'Earth is the third planet.', revision: 1, timestamp: '2026-11-20T09:14:22Z',
        });
      }
      void request;
      return HttpResponse.json({ title: 'Earth' });
    }));
  });

  afterAll(() => { client.close(); msw.close(); });

  it('eventually succeeds with license/attribution and bounded retries', async () => {
    calls = 0;
    const result = await handlers.get_summary({ title: 'RateLimitedEarth' });
    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload['title']).toBe('Earth');
    expect(payload['license']).toBeDefined();
    expect(payload['attribution']).toBeDefined();
    expect(calls).toBe(2);
  });

  it('honours Retry-After: 1 before retrying', async () => {
    calls = 0;
    const start = Date.now();
    const result = await handlers.get_summary({ title: 'RateLimitedEarth1s' });
    expect(result.isError).toBeUndefined();
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
    expect(calls).toBe(2);
  });
});
