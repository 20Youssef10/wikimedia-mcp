import { describe, expect, it } from 'vitest';
import { RawStdioClient } from '../helpers/raw-stdio.js';
import { startTestHttp, rpc, type TestHttpServer } from '../helpers/raw-http.js';
import { WikimediaClient } from '../../src/upstream/client.js';
import { testConfig } from '../helpers/test-env.js';
import { TokenBucket, createPacedLane } from '../../src/upstream/pacing.js';
import { METRICS_BURST, METRICS_RATE_PER_SECOND } from '../../src/metrics/constants.js';
import { z } from 'zod';
import { GROUP_C_SCHEMAS } from '../../src/metrics/schemas.js';
import { GROUP_F_SCHEMAS } from '../../src/media/schemas.js';
import { loadCorpus } from '../corpus-loader.js';
import {
  createPhase3Harness, installFixtures, payload,
} from './harness.js';

function clean(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([key]) => !key.startsWith('_')));
}

describe('AC-90 — Phase 3 tools/call over stdio and Streamable HTTP', () => {
  it('stdio tools/call for get_pageviews returns resultType + serverInfo _meta', async () => {
    const client = new RawStdioClient();
    try {
      // A locally rejected project proves the transport round-trip without
      // any live outbound call (merge gate is fixture-only).
      const result = await client.request('tools/call', {
        name: 'get_pageviews',
        arguments: { project: 'http://169.254.169.254', article: 'Earth', start: '20200101', end: '20200102' },
      });
      expect(result.body['result']).toBeDefined();
      const res = result.body['result'] as Record<string, unknown>;
      expect(res['resultType']).toBe('complete');
      expect((res['_meta'] as Record<string, unknown>)?.['io.modelcontextprotocol/serverInfo']).toBeDefined();
    } finally {
      client.close();
    }
  }, 30000);

  it('HTTP tools/call works and a mismatched Mcp-Name yields -32020', async () => {
    const config = testConfig({ MCP_TRANSPORT: 'streamable-http', MCP_ALLOWED_HOSTS: '127.0.0.1,localhost' });
    const client = new WikimediaClient(config, { useDispatcher: false });
    const harness = createPhase3Harness();
    installFixtures(harness);
    harness.server.listen({ onUnhandledRequest: 'bypass' });
    let server: TestHttpServer | undefined;
    try {
      server = await startTestHttp(config, client);
      const ok = await rpc(server.url, {
        method: 'tools/call', params: { name: 'get_pageviews', arguments: { article: 'Earth', start: '20261101', end: '20261103' } },
      });
      expect(ok.body['result']).toBeDefined();
      expect((ok.body['result'] as Record<string, unknown>)['resultType']).toBe('complete');
      const bad = await rpc(server.url, {
        method: 'tools/call', params: { name: 'get_pageviews', arguments: { article: 'Earth', start: '20261101', end: '20261103' } },
      }, { nameHeader: 'get_most_read' });
      expect(bad.body['error']).toMatchObject({ code: -32020 });
    } finally {
      server?.server.close();
      harness.close();
      client.close();
    }
  }, 30000);
});

describe('AC-91 — UA, concurrency and class pacing', () => {
  it('every outbound Phase 3 call carries the configured User-Agent', async () => {
    const harness = createPhase3Harness();
    installFixtures(harness);
    harness.server.listen({ onUnhandledRequest: 'bypass' });
    try {
      await harness.handlers['get_pageviews']({ article: 'Earth', start: '20261101', end: '20261103' });
      harness.state.simulate = 'beta-404';
      await harness.handlers['get_file_metadata']({ filename: 'File:Commons-logo.svg', project: 'commonswiki' });
      expect(harness.state.userAgents.length).toBeGreaterThan(0);
      expect(harness.state.userAgents.every((ua) => ua.includes('WikiMCP-Test'))).toBe(true);
      expect(harness.client.limiter.ceiling).toBeLessThanOrEqual(3);
    } finally {
      harness.close();
    }
  });

  it('Class M is 1 req/s burst 2; Class I is 2 req/s burst 3; nested semaphore min(2, limit)', () => {
    expect(METRICS_RATE_PER_SECOND).toBe(1);
    expect(METRICS_BURST).toBe(2);
    expect(createPacedLane(2, 1, 2).ceiling).toBe(2);
    expect(createPacedLane(3, 2, 3)).toMatchObject({ ratePerSecond: 2, burst: 3 });
  });

  it('token bucket delays the third token by one second with a fake clock', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const bucket = new TokenBucket(1, 2, { now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    await bucket.take();
    await bucket.take();
    await bucket.take();
    expect(sleeps).toEqual([1000]);
  });
});

describe('AC-93 — 429 stays on source and honours Retry-After (TC-C-010)', () => {
  it('eventual success after a 429 with Retry-After: 0', async () => {
    const harness = createPhase3Harness({ RETRY_MAX_ATTEMPTS: '3', RETRY_AFTER_FALLBACK_MS: '1' });
    harness.state.simulate = '429-retry-after-0';
    installFixtures(harness);
    harness.server.listen({ onUnhandledRequest: 'bypass' });
    try {
      const result = await harness.handlers['get_pageviews']({
        article: 'Earth', start: '20261101', end: '20261103',
      });
      expect(result.isError).toBeUndefined();
      expect(payload(result)['count']).toBe(3);
      expect(harness.state.analytics429).toBe(1);
    } finally {
      harness.close();
    }
  });
});

describe('AC-92 — live CF-M3/CF-M4 gate (nightly only)', () => {
  it.skip('runs the live 150-sample/class load gate with WMCP_LIVE=1', () => {
    // Nightly only: no live network in the merge gate. See contract §7.1.
  });
});

describe('AC-94 — corpus cases map to AC and validate against schemas', () => {
  const AC_MAP: Record<string, string> = {
    'TC-C-004': 'AC-64/AC-65', 'TC-C-005': 'AC-66', 'TC-C-006': 'AC-65',
    'TC-C-007': 'AC-70/AC-74', 'TC-C-008': 'AC-66', 'TC-C-009': 'AC-67',
    'TC-C-010': 'AC-93', 'TC-C-011': 'AC-67',
    'TC-F-004': 'AC-76', 'TC-F-005': 'AC-62/AC-76', 'TC-F-006': 'AC-77/AC-82',
    'TC-F-007': 'AC-78/AC-88', 'TC-F-008': 'AC-79', 'TC-F-009': 'AC-80',
    'TC-F-010': 'AC-81', 'TC-F-011': 'AC-86', 'TC-F-012': 'AC-82',
  };

  it('each new fixture case validates against its frozen Phase 3 schema', () => {
    const schemas: Record<string, z.ZodType> = { ...GROUP_C_SCHEMAS, ...GROUP_F_SCHEMAS };
    const failures: string[] = [];
    const cases = loadCorpus().test_cases.filter((c) => AC_MAP[c.id] !== undefined);
    expect(cases).toHaveLength(17);
    for (const testCase of cases) {
      expect(testCase.mode).toBe('fixture');
      // TC-C-008 deliberately uses the out-of-schema 'today' sentinel to
      // exercise the local invalid_date_range guard; like Phase 1 security
      // cases it is excluded from the schema-shape assertion.
      if (testCase.id === 'TC-C-008') continue;
      const parsed = schemas[testCase.tool]?.safeParse(clean(testCase.params));
      if (parsed === undefined || !parsed.success) failures.push(testCase.id);
    }
    expect(failures).toEqual([]);
  });

  it('new case IDs match the frozen §7.2 table', () => {
    for (const id of Object.keys(AC_MAP)) {
      expect(loadCorpus().test_cases.some((c) => c.id === id)).toBe(true);
    }
  });
});
