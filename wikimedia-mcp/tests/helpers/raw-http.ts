import { WikimediaClient } from '../../src/upstream/client.js';
import { Logger } from '../../src/observability/logging.js';
import { startHttpTransport, type HttpTransportHandle, type ServerFactory } from '../../src/transport/streamable-http.js';
import type { Config } from '../../src/config.js';

export type TestHttpServer = HttpTransportHandle & { port: number; url: string };

export async function startTestHttp(
  config: Config,
  client: WikimediaClient,
  factory?: ServerFactory,
): Promise<TestHttpServer> {
  const handle = startHttpTransport(config, client, new Logger('error'), factory);
  await new Promise<void>((resolve) => handle.server.listen(0, '127.0.0.1', () => resolve()));
  const address = handle.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { ...handle, port, url: `http://127.0.0.1:${port}${config.httpPath}` };
}

export type RpcEnvelope = {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
};

export type RawResult = {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
  text: string;
};

function meta(protocolVersion = '2026-07-28'): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': protocolVersion,
    'io.modelcontextprotocol/clientInfo': { name: 'contract-test-client', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

export type RpcOptions = {
  protocolVersion?: string;
  headerProtocolVersion?: string;
  methodHeader?: string;
  nameHeader?: string;
  extraHeaders?: Record<string, string>;
  omitMeta?: boolean;
  rawBody?: string;
  httpMethod?: string;
};

/** Send a raw JSON-RPC request with the required 2026-07-28 routing headers. */
export async function rpc(
  url: string,
  request: RpcEnvelope,
  options: RpcOptions = {},
): Promise<RawResult> {
  const version = options.protocolVersion ?? '2026-07-28';
  const params: Record<string, unknown> = {
    ...(request.params ?? {}),
    ...(options.omitMeta ? {} : { _meta: meta(version) }),
  };
  const body: Record<string, unknown> = { jsonrpc: '2.0', id: request.id ?? 1, method: request.method, params };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': options.headerProtocolVersion ?? version,
    'Mcp-Method': options.methodHeader ?? request.method,
  };
  const nameValue = request.method === 'resources/read'
    ? (typeof params['uri'] === 'string' ? params['uri'] : undefined)
    : (typeof params['name'] === 'string' ? params['name'] : undefined);
  if (nameValue !== undefined) {
    headers['Mcp-Name'] = options.nameHeader ?? nameValue;
  }
  if (options.nameHeader !== undefined) headers['Mcp-Name'] = options.nameHeader;
  Object.assign(headers, options.extraHeaders ?? {});
  const httpMethod = options.httpMethod ?? 'POST';
  const response = await fetch(url, {
    method: httpMethod,
    headers,
    ...(httpMethod === 'POST'
      ? { body: options.rawBody ?? JSON.stringify(body) }
      : {}),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = text.length > 0 ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* non-JSON */ }
  return { status: response.status, headers: response.headers, body: parsed, text };
}
