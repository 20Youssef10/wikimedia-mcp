import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WikimediaClient, type FetchLike } from '../../src/upstream/client.js';
import { createHandlers } from '../../src/server/tools/handlers.js';
import { startTestHttp, type TestHttpServer } from '../helpers/raw-http.js';
import { testConfig } from '../helpers/test-env.js';

const config = testConfig({ HTTP_TIMEOUT_MS: '4000' });
let upstreamSignal: AbortSignal | undefined;
let started: (() => void) | undefined;
const startedPromise = new Promise<void>((resolve) => { started = resolve; });

const fetchImpl: FetchLike = async (_url, init) => {
  upstreamSignal = init?.signal as AbortSignal | undefined;
  started?.();
  return new Promise<Response>((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('upstream was not cancelled')), 3000);
    upstreamSignal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('upstream aborted'), { name: 'AbortError' }));
    }, { once: true });
  });
};

const client = new WikimediaClient(config, { useDispatcher: false, fetchImpl });
let server: TestHttpServer;

beforeAll(async () => {
  server = await startTestHttp(config, client);
});

afterAll(async () => {
  await server.close();
  client.close();
});

describe('H2 / AC-20 — inbound cancellation propagates to upstream', () => {
  it('aborting a tools/call cancels the upstream fetch and frees the slot', async () => {
    const controller = new AbortController();
    const request = fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'get_summary',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: {
          name: 'get_summary',
          arguments: { title: 'Earth' },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'abort-test', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
      signal: controller.signal,
    });

    await startedPromise;
    expect(upstreamSignal?.aborted).toBe(false);
    controller.abort();
    await expect(request).rejects.toThrow();

    // Give the server a tick to observe the abort and release the semaphore.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(upstreamSignal?.aborted).toBe(true);
    expect(client.limiter.activeCount).toBe(0);
  });

  it('direct handler cancellation maps to a retryable timeout envelope', async () => {
    let directSignal: AbortSignal | undefined;
    const directClient = new WikimediaClient(config, {
      useDispatcher: false,
      fetchImpl: async (_url, init) => {
        directSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => {
          directSignal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        });
      },
    });
    const directHandlers = createHandlers(directClient, config);
    const controller = new AbortController();
    const pending = directHandlers.get_summary({ title: 'Earth' }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const result = await pending;
    expect(result.isError).toBe(true);
    const error = result.structuredContent?.['error'] as Record<string, unknown> | undefined;
    expect(error?.['code']).toBe('timeout');
    expect(error?.['retryable']).toBe(true);
    directClient.close();
  });
});
