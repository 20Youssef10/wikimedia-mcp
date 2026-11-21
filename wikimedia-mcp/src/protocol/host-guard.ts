import { JSONRPC_CODES } from './errors.js';
import { SERVER_INFO_META_KEY } from './meta.js';
import { serverInfo } from './result.js';

/** Caller-supplied host parameters are never accepted (report 08 SR-3 / T-01). */
export const FORBIDDEN_HOST_KEYS = ['host', 'api_url', 'endpoint', 'base_url'] as const;

export function findForbiddenHostKey(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  return FORBIDDEN_HOST_KEYS.find((key) => key in record);
}

/**
 * A `tools/call` response that rejects a caller-supplied host before any SDK
 * validation or outbound request. Returns a complete JSON-RPC response object.
 */
export function forbiddenHostResponse(id: unknown, key: string): Record<string, unknown> {
  const error = {
    code: 'host_not_allowed',
    message: `Parameter '${key}' is not accepted. Hosts are fixed by the server allowlist; no outbound request was made.`,
    retryable: false,
    retry_after_seconds: null,
    hint: 'Remove the host parameter and use lang/project only.',
    action: 'Do not supply host/api_url parameters; hosts are fixed by the server allowlist.',
    details: { rejected_key: key },
  };
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result: {
      content: [{ type: 'text', text: JSON.stringify({ error }) }],
      structuredContent: { error },
      isError: true,
      resultType: 'complete',
      _meta: { [SERVER_INFO_META_KEY]: serverInfo },
    },
  };
}

export function isForbiddenHostRpc(body: unknown): { key: string; id: unknown } | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (record['method'] !== 'tools/call') return undefined;
  const params = record['params'];
  if (typeof params !== 'object' || params === null) return undefined;
  const key = findForbiddenHostKey((params as Record<string, unknown>)['arguments']);
  return key === undefined ? undefined : { key, id: record['id'] };
}

export { JSONRPC_CODES };
