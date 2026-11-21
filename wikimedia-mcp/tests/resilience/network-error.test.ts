import { describe, expect, it } from 'vitest';
import { WikimediaClient } from '../../src/upstream/client.js';
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
