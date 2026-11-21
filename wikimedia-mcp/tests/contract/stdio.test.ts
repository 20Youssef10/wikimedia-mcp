import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RawStdioClient } from '../helpers/raw-stdio.js';
import { TOOL_NAMES } from '../../src/server/tools/registry.js';

let client: RawStdioClient;

beforeAll(() => {
  client = new RawStdioClient();
});

afterAll(() => {
  client.close();
});

describe('transport parity over stdio (AC-32)', () => {
  it('AC-01/AC-02: server/discover advertises 2026-07-28, instructions and result envelope', async () => {
    const { body } = await client.request('server/discover', {}, 101);
    const result = body['result'] as Record<string, unknown>;
    expect(result['supportedVersions']).toContain('2026-07-28');
    expect(result['resultType']).toBe('complete');
    expect((result['_meta'] as Record<string, unknown>)?.['io.modelcontextprotocol/serverInfo']).toMatchObject({ name: 'wikimedia-mcp' });
    expect(String(result['instructions']).length).toBeGreaterThan(50);
    expect(result['ttlMs']).toBeGreaterThanOrEqual(0);
    expect(result['cacheScope']).toBe('public');
  }, 20000);

  it('AC-22/AC-23: tools/list exposes the nine tools with read-only annotations', async () => {
    const { body } = await client.request('tools/list', {}, 102);
    const tools = (body['result'] as Record<string, unknown>)['tools'] as Array<Record<string, unknown>>;
    expect(tools.map((tool) => tool['name'])).toEqual(TOOL_NAMES);
    for (const tool of tools) {
      expect(tool['annotations']).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it('AC-03: a request without _meta yields -32602', async () => {
    const { body } = await client.raw(JSON.stringify({ jsonrpc: '2.0', id: 103, method: 'server/discover', params: {} }), 103);
    expect(body['error']).toMatchObject({ code: -32602 });
  });

  it('AC-10: an unsupported version yields -32022', async () => {
    // The era is decided by the opening request on stdio, so use a fresh client.
    const probe = new RawStdioClient();
    try {
      const { body } = await probe.request('server/discover', {}, 104, '2025-11-25');
      expect(body['error']).toMatchObject({ code: -32022 });
    } finally {
      probe.close();
    }
  });

  it('AC-13: subscriptions/listen is not offered (-32601)', async () => {
    const { body } = await client.request('subscriptions/listen', { notifications: {} }, 105);
    expect(body['error']).toMatchObject({ code: -32601 });
  });

  it('AC-09: a tools/call error result carries no cache fields', async () => {
    const { body } = await client.request('tools/call', { name: 'get_summary', arguments: {} }, 106);
    const result = body['result'] as Record<string, unknown>;
    expect(result['isError']).toBe(true);
    expect(result['ttlMs']).toBeUndefined();
    expect(result['cacheScope']).toBeUndefined();
  });
});
