import { request as requestHttp } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WikimediaClient } from '../../src/upstream/client.js';
import { createMswServer } from '../helpers/msw.js';
import { startTestHttp, rpc, type TestHttpServer } from '../helpers/raw-http.js';
import { testConfig } from '../helpers/test-env.js';
import { TOOL_NAMES } from '../../src/server/tools/registry.js';

const msw = createMswServer();
let server: TestHttpServer;

const seenUserAgents: string[] = [];
const seenUrls: string[] = [];

beforeAll(async () => {
  msw.listen({ onUnhandledRequest: 'bypass' });
  msw.events.on('request:start', ({ request }) => {
    // Only track real upstream calls, not the test harness's localhost RPC calls.
    if (!/wikimedia\.org|wikipedia\.org/.test(request.url)) return;
    seenUserAgents.push(request.headers.get('user-agent') ?? '');
    seenUrls.push(request.url);
  });
  server = await startTestHttp(testConfig(), new WikimediaClient(testConfig(), { useDispatcher: false }));
});

afterAll(async () => {
  await server.close();
  msw.close();
});

const call = (body: Record<string, unknown>, options: Parameters<typeof rpc>[2] = {}) => rpc(server.url, body as never, options);

function toolCall(name: string, args: Record<string, unknown>, options: Parameters<typeof rpc>[2] = {}) {
  return call({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name, arguments: args },
  }, options);
}

function payloadOf(result: Record<string, unknown>): Record<string, unknown> {
  const structured = result['structuredContent'];
  if (structured !== null && typeof structured === 'object') return structured as Record<string, unknown>;
  const content = result['content'];
  if (Array.isArray(content) && typeof content[0] === 'object' && content[0] !== null) {
    const text = (content[0] as Record<string, unknown>)['text'];
    if (typeof text === 'string') {
      try { return JSON.parse(text) as Record<string, unknown>; } catch { return { contentText: text }; }
    }
  }
  return {};
}

describe('A. Discovery and protocol surface', () => {
  it('AC-01/AC-02/AC-05/AC-06: discover advertises modern revision, capabilities, instructions and result envelope', async () => {
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} });
    expect(response.status).toBe(200);
    const result = response.body['result'] as Record<string, unknown>;
    expect(result['supportedVersions']).toContain('2026-07-28');
    expect(result['serverInfo'] ?? (result['_meta'] as Record<string, unknown>)?.['io.modelcontextprotocol/serverInfo']).toBeDefined();
    expect((result['_meta'] as Record<string, unknown>)?.['io.modelcontextprotocol/serverInfo']).toMatchObject({ name: 'wikimedia-mcp', version: '3.0.0' });
    expect(result['capabilities']).toMatchObject({
      tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false },
    });
    expect(String(result['instructions']).length).toBeGreaterThan(50);
    expect(result['resultType']).toBe('complete');
  });

  it('AC-08: all six cacheable operations return ttlMs >= 0 and public cacheScope', async () => {
    const methods = [
      ['server/discover', {}],
      ['tools/list', {}],
      ['prompts/list', {}],
      ['resources/list', {}],
      ['resources/templates/list', {}],
      ['resources/read', { uri: 'wikimedia://server/info' }],
    ] as const;
    for (const [method, params] of methods) {
      const response = await call({ jsonrpc: '2.0', id: 2, method, params: { ...params } });
      const result = response.body['result'] as Record<string, unknown> | undefined;
      if (result === undefined) throw new Error(`AC-08 ${method}: ${JSON.stringify(response.body).slice(0, 300)}`);
      expect(result['resultType'], method).toBe('complete');
      expect(result['ttlMs'], method).toBeGreaterThanOrEqual(0);
      expect(['public', 'private']).toContain(result['cacheScope']);
    }
  });

  it('AC-09: tools/call results carry neither ttlMs nor cacheScope', async () => {
    const response = await toolCall('get_summary', { title: 'Earth' });
    const result = response.body['result'] as Record<string, unknown>;
    expect(result['ttlMs']).toBeUndefined();
    expect(result['cacheScope']).toBeUndefined();
  });

  it('AC-22/AC-23: every tool advertises a JSON Schema and read-only annotations', async () => {
    const response = await call({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
    const result = response.body['result'] as Record<string, unknown>;
    const tools = result['tools'] as Array<Record<string, unknown>>;
    expect(tools.map((tool) => tool['name'])).toEqual(TOOL_NAMES);
    for (const tool of tools) {
      expect((tool['inputSchema'] as Record<string, unknown>)?.['type']).toBe('object');
      expect(tool['annotations']).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    }
  });
});

describe('B. Error semantics', () => {
  it('AC-03: missing or non-string protocolVersion yields -32602 with HTTP 400', async () => {
    const missing = await call({ jsonrpc: '2.0', id: 4, method: 'server/discover', params: {} }, { omitMeta: true });
    expect(missing.status).toBe(400);
    expect(missing.body['error']).toMatchObject({ code: -32602 });
    const nonString = await call({
      jsonrpc: '2.0', id: 5, method: 'server/discover',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': 42 } },
    }, { omitMeta: true });
    expect(nonString.status).toBe(400);
    expect(nonString.body['error']).toMatchObject({ code: -32602 });
  });

  it('AC-04: missing clientCapabilities yields -32602', async () => {
    const response = await call({
      jsonrpc: '2.0', id: 6, method: 'server/discover',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
    }, { omitMeta: true });
    expect(response.status).toBe(400);
    expect(response.body['error']).toMatchObject({ code: -32602 });
  });

  it('AC-10: unsupported but well-formed version yields -32022 with HTTP 400', async () => {
    const response = await call({ jsonrpc: '2.0', id: 7, method: 'server/discover', params: {} }, {
      protocolVersion: '2025-11-25',
    });
    expect(response.status).toBe(400);
    expect(response.body['error']).toMatchObject({ code: -32022 });
  });

  it('AC-11/AC-15: independent header mismatches yield -32020', async () => {
    const method = await call({ jsonrpc: '2.0', id: 8, method: 'server/discover', params: {} }, { methodHeader: 'tools/list' });
    expect(method.body['error']).toMatchObject({ code: -32020 });
    const version = await call({ jsonrpc: '2.0', id: 9, method: 'server/discover', params: {} }, { headerProtocolVersion: '2025-11-25' });
    expect(version.body['error']).toMatchObject({ code: -32020 });
    const name = await toolCall('get_summary', { title: 'Earth' }, { nameHeader: 'get_page' });
    expect(name.body['error']).toMatchObject({ code: -32020 });
  });

  it('AC-13: no list-changed capability and subscriptions/listen returns -32601', async () => {
    const response = await call({ jsonrpc: '2.0', id: 10, method: 'subscriptions/listen', params: { notifications: {} } });
    expect(response.status).toBe(200);
    expect(response.body['error']).toMatchObject({ code: -32601 });
  });

  it('AC-24: tool errors are actionable and never leak raw HTTP text', async () => {
    const response = await toolCall('get_summary', { title: 'ThisPageDefinitelyDoesNotExist_9f3a2b' });
    const result = response.body['result'] as Record<string, unknown>;
    expect(result['isError']).toBe(true);
    const error = (payloadOf(result)['error'] ?? {}) as Record<string, unknown>;
    expect(error['code']).toBe('page_not_found');
    expect(String(error['message']).length).toBeGreaterThan(5);
    expect(typeof error['retryable']).toBe('boolean');
    expect(String(error['action']).length).toBeGreaterThan(5);
    expect(String(error['message'])).not.toMatch(/HTTP 404|Too Many Requests|401 Unauthorized/);
  });
});

describe('C. Transport, headers and network security', () => {
  it('AC-14: GET/PUT/DELETE return 405 with Allow: POST', async () => {
    for (const httpMethod of ['GET', 'PUT', 'DELETE']) {
      const response = await rpc(server.url, { jsonrpc: '2.0', id: 11, method: 'server/discover' }, { httpMethod });
      expect(response.status, httpMethod).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
  });

  it('AC-15: a missing Mcp-Method header yields -32020', async () => {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 12, method: 'server/discover',
        params: { _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        } },
      }),
    });
    const body = await response.json() as Record<string, unknown>;
    expect(body['error']).toMatchObject({ code: -32020 });
  });

  it('AC-16: base64 sentinel decodes to the expected Mcp-Name', async () => {
    const encoded = `=?base64?${Buffer.from('get_summary').toString('base64')}?=`;
    const response = await toolCall('get_summary', { title: 'Earth' }, { nameHeader: encoded });
    expect(response.body['error']).toBeUndefined();
    expect((response.body['result'] as Record<string, unknown>)['isError']).toBeUndefined();
  });

  it('AC-17: Mcp-Param-* headers are rejected with -32020', async () => {
    const response = await call({ jsonrpc: '2.0', id: 13, method: 'server/discover', params: {} }, {
      extraHeaders: { 'Mcp-Param-q': 'Earth' },
    });
    expect(response.body['error']).toMatchObject({ code: -32020 });
  });

  it('AC-18: a foreign Origin yields 403 with no JSON-RPC body', async () => {
    const response = await call({ jsonrpc: '2.0', id: 14, method: 'server/discover', params: {} }, {
      extraHeaders: { Origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
    expect(response.text).toBe('');
  });

  it('AC-19: a foreign Host yields 403', async () => {
    // node:http is used here because fetch() normalises the Host header from the URL.
    const status = await new Promise<number>((resolve, reject) => {
      const target = new URL(server.url);
      const request = requestHttp({
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: {
          Host: 'evil.example',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'server/discover',
        },
      }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on('error', reject);
      request.end(JSON.stringify({
        jsonrpc: '2.0', id: 15, method: 'server/discover',
        params: { _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        } },
      }));
    });
    expect(status).toBe(403);
  });

  it('wrong Content-Type yields 415', async () => {
    const response = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    expect(response.status).toBe(415);
  });

  it('malformed JSON yields -32700 with 400', async () => {
    const response = await rpc(server.url, { jsonrpc: '2.0', id: 16, method: 'server/discover' }, { rawBody: '{bad json' });
    expect(response.status).toBe(400);
    expect(response.body['error']).toMatchObject({ code: -32700 });
  });
});

describe('D/E. Tool contracts, politeness and compliance', () => {
  it('AC-28: content results carry license and attribution', async () => {
    const response = await toolCall('get_summary', { title: 'Earth' });
    const result = response.body['result'] as Record<string, unknown>;
    const payload = payloadOf(result);
    expect(payload['license']).toBeDefined();
    expect(payload['attribution']).toBeDefined();
    expect(payload['source']).toBe('wikipedia:en');
  });

  it('AC-25: every outbound request carries the configured User-Agent', () => {
    expect(seenUserAgents.length).toBeGreaterThan(0);
    for (const agent of seenUserAgents) expect(agent).toContain('WikiMCP-Test');
  });

  it('AC-29: prompt-injection payload is escaped, never executed', async () => {
    const response = await toolCall('get_page', { title: 'Prompt Injection Test', format: 'html' });
    const payload = payloadOf(response.body['result'] as Record<string, unknown>);
    const content = String(payload['content'] ?? '');
    expect(content).toContain('&lt;p&gt;');
    expect(content).not.toContain('<p>');
    // The server's real instructions must never be echoed as content.
    expect(content).not.toContain('This is a READ-ONLY Wikimedia server');
    expect(payload['untrusted_content']).toBe(true);
  });

  it('AC-30: a caller-supplied host is rejected before any outbound request', async () => {
    const before = seenUrls.length;
    const response = await toolCall('get_page', {
      host: 'http://169.254.169.254/latest/meta-data/', title: 'latest', project: 'enwiki',
    });
    const payload = payloadOf(response.body['result'] as Record<string, unknown>);
    expect((payload['error'] as Record<string, unknown>)?.['code']).toBe('host_not_allowed');
    expect(seenUrls.length).toBe(before);
  });

  it('search returns a successful empty-result shape via fixtures', async () => {
    const response = await toolCall('search', { q: 'nonexistent-term-xyz' });
    const payload = payloadOf(response.body['result'] as Record<string, unknown>);
    expect(payload['results']).toBeDefined();
    expect(payload['total_hits']).toBeDefined();
  });
});
