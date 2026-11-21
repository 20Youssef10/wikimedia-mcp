import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpServer, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { WikimediaClient } from '../../src/upstream/client.js';
import { cacheHints } from '../../src/protocol/caching.js';
import { DISCOVERY } from '../../src/server/discover.js';
import { SERVER_INSTRUCTIONS } from '../../src/server/instructions.js';
import { CSRF_REQUEST_HEADER, CSRF_RESPONSE_HEADER } from '../../src/protocol/csrf.js';
import type { ServerFactory } from '../../src/transport/streamable-http.js';
import { startTestHttp, rpc, type TestHttpServer } from '../helpers/raw-http.js';
import { testConfig } from '../helpers/test-env.js';

/**
 * TEST-ONLY HARNESS. This factory registers a dummy write tool purely to prove
 * that the CSRF gate fires on state-changing calls. It is injected through the
 * startHttpTransport factory seam and is NEVER used by src/index.ts, so no
 * write-capable tool is present in any production build.
 */
const harnessFactory: ServerFactory = () => () => {
  const server = new McpServer(
    { name: DISCOVERY.serverInfo.name, version: DISCOVERY.serverInfo.version },
    {
      capabilities: { ...DISCOVERY.capabilities },
      instructions: SERVER_INSTRUCTIONS,
      supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS, ...DISCOVERY.supportedVersions],
      cacheHints,
    },
  );
  server.registerTool(
    'delete_page', // TEST ONLY — never registered in production
    {
      description: 'TEST HARNESS ONLY: destructive write tool used to exercise the CSRF gate.',
      inputSchema: z.object({ title: z.string().min(1) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    },
    async ({ title }) => ({
      content: [{ type: 'text' as const, text: `harness-only dry acknowledgement for ${title}` }],
    }),
  );
  return server;
};

let defaultServer: TestHttpServer;
let strictOriginServer: TestHttpServer;
let csrfServer: TestHttpServer;

beforeAll(async () => {
  const client = () => new WikimediaClient(testConfig(), { useDispatcher: false });
  defaultServer = await startTestHttp(testConfig(), client());
  strictOriginServer = await startTestHttp(testConfig({
    MCP_REQUIRE_ORIGIN: 'true',
    MCP_ALLOWED_ORIGINS: 'https://app.test',
  }), client());
  csrfServer = await startTestHttp(testConfig({
    MCP_REQUIRE_CSRF: 'true',
    MCP_CSRF_SECRET: 'harness-only-csrf-secret-value',
  }), client(), harnessFactory);
});

afterAll(async () => {
  await defaultServer.close();
  await strictOriginServer.close();
  await csrfServer.close();
});

const discover = { jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} } as const;

describe('G10(a) REQUIRE_ORIGIN flag — live HTTP enforcement', () => {
  it('default mode accepts a request with no Origin (CLI / non-browser hosts keep working)', async () => {
    const response = await rpc(defaultServer.url, discover as never);
    expect(response.status).toBe(200);
  });

  it('REQUIRE_ORIGIN=true rejects a missing Origin with HTTP 403', async () => {
    const response = await rpc(strictOriginServer.url, discover as never);
    expect(response.status).toBe(403);
    expect(response.text).toBe('');
  });

  it('REQUIRE_ORIGIN=true accepts an allowlisted Origin and rejects a foreign one', async () => {
    const allowed = await rpc(strictOriginServer.url, discover as never, {
      extraHeaders: { Origin: 'https://app.test' },
    });
    expect(allowed.status).toBe(200);
    const foreign = await rpc(strictOriginServer.url, discover as never, {
      extraHeaders: { Origin: 'https://evil.test' },
    });
    expect(foreign.status).toBe(403);
  });
});

describe('G10(c) CSRF gate — proven with the test-only harness', () => {
  const writeCall = {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'delete_page', arguments: { title: 'Sandbox' } },
  } as const;

  it('issues a token in the response header when the flag is enabled', async () => {
    const response = await rpc(csrfServer.url, discover as never);
    expect(response.status).toBe(200);
    const token = response.headers.get(CSRF_RESPONSE_HEADER);
    expect(token).toBeTruthy();
    expect(token).toMatch(/\.[A-Za-z0-9_-]+$/);
  });

  it('blocks a state-changing call with no CSRF token (HTTP 403)', async () => {
    const response = await rpc(csrfServer.url, writeCall as never);
    expect(response.status).toBe(403);
  });

  it('blocks a state-changing call with a forged CSRF token (HTTP 403)', async () => {
    const response = await rpc(csrfServer.url, writeCall as never, {
      extraHeaders: { [CSRF_REQUEST_HEADER]: 'forged.token' },
    });
    expect(response.status).toBe(403);
  });

  it('allows a state-changing call carrying a freshly issued token', async () => {
    const tokenResponse = await rpc(csrfServer.url, discover as never);
    const token = tokenResponse.headers.get(CSRF_RESPONSE_HEADER);
    expect(token).toBeTruthy();
    const response = await rpc(csrfServer.url, writeCall as never, {
      extraHeaders: { [CSRF_REQUEST_HEADER]: token ?? '' },
    });
    expect(response.status).toBe(200);
    expect(response.body['error']).toBeUndefined();
  });

  it('does not require a token for a read-only method', async () => {
    const response = await rpc(csrfServer.url, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} } as never);
    expect(response.status).toBe(200);
  });
});
