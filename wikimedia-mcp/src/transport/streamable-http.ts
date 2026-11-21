import { createServer, type Server } from 'node:http';
import { createMcpHandler, type McpHttpHandler, type McpServer } from '@modelcontextprotocol/server';
import type { Config } from '../config.js';
import type { WikimediaClient } from '../upstream/client.js';
import type { Logger } from '../observability/logging.js';
import { serverFactory } from '../server/tools/registry.js';
import { JSONRPC_CODES } from '../protocol/errors.js';
import { checkHost, checkOrigin } from '../protocol/headers.js';
import {
  createCsrfGuard, CSRF_REQUEST_HEADER, CSRF_RESPONSE_HEADER, isStateChangingRequest,
} from '../protocol/csrf.js';
import { isRecord } from '../protocol/meta.js';
import { isForbiddenHostRpc, forbiddenHostResponse } from '../protocol/host-guard.js';

export type HttpTransportHandle = {
  server: Server;
  handler: McpHttpHandler;
  close: () => Promise<void>;
};

/**
 * Factory seam for the test-only harness. Production callers use the default
 * `serverFactory`; no write tool is ever registered in production (report 08
 * gate G5). Tests inject a harness server that registers a dummy write tool
 * solely to prove the CSRF gate — it is never reachable from `src/index.ts`.
 */
export type ServerFactory = (config: Config, client: WikimediaClient) => () => McpServer;

/**
 * Streamable HTTP transport: a single POST-only endpoint. GET/PUT/DELETE get
 * 405 + Allow: POST; bad Origin/Host get 403 with no JSON-RPC body; wrong
 * Content-Type gets 415. `subscriptions/listen` is rejected with -32601.
 *
 * Optional hardening (off by default): `MCP_REQUIRE_ORIGIN` rejects a missing
 * Origin with 403; `MCP_REQUIRE_CSRF` requires a valid `Mcp-Csrf-Token` on
 * state-changing calls and issues a token in the `MCP-CSRF-Token` response
 * header. Both MUST be enabled for any future write-enabled deployment.
 */
export function startHttpTransport(
  config: Config,
  client: WikimediaClient,
  logger: Logger,
  factory: ServerFactory = serverFactory,
): HttpTransportHandle {
  const handler = createMcpHandler(factory(config, client), {
    legacy: 'reject',
    responseMode: 'json',
    onerror: (error) => logger.error('http transport error', { message: error.message }),
  });
  const csrf = createCsrfGuard(config.csrfSecret, config.csrfTokenTtlMs);

  const server = createServer((req, res) => {
    void (async () => {
      // When CSRF is enabled, hand the client a fresh token on every response
      // so it can echo it on a subsequent state-changing call.
      const extraHeaders: Record<string, string> = config.requireCsrf
        ? { [CSRF_RESPONSE_HEADER]: csrf.issueToken() }
        : {};

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname !== config.httpPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain', ...extraHeaders });
        res.end('Not found');
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain', ...extraHeaders });
        res.end('Method not allowed');
        return;
      }

      const originCheck = checkOrigin(req.headers.origin, config.allowedOrigins, config.requireOrigin);
      if (!originCheck.ok) {
        logger.warn('origin rejected', { reason: originCheck.reason });
        res.writeHead(403, extraHeaders);
        res.end();
        return;
      }
      const hostCheck = checkHost(req.headers.host, config.allowedHosts);
      if (!hostCheck.ok) {
        logger.warn('host rejected', { reason: hostCheck.reason });
        res.writeHead(403, extraHeaders);
        res.end();
        return;
      }

      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.toLowerCase().startsWith('application/json')) {
        res.writeHead(415, { 'Content-Type': 'text/plain', ...extraHeaders });
        res.end('Unsupported Media Type');
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        size += buffer.length;
        if (size > 4 * 1024 * 1024) {
          res.writeHead(413, extraHeaders);
          res.end();
          return;
        }
        chunks.push(buffer);
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');

      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        sendJson(res, 400, {
          jsonrpc: '2.0', id: null,
          error: { code: JSONRPC_CODES.PARSE_ERROR, message: 'Parse error' },
        }, extraHeaders);
        return;
      }

      // CSRF gate: a state-changing call requires a valid signed token when
      // MCP_REQUIRE_CSRF is enabled. Missing/invalid tokens get a bare 403.
      if (config.requireCsrf && isStateChangingRequest(body)) {
        const rawToken = req.headers[CSRF_REQUEST_HEADER];
        const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
        if (!csrf.verifyToken(token)) {
          logger.warn('csrf token rejected', { reason: 'missing_or_invalid_token' });
          res.writeHead(403, extraHeaders);
          res.end();
          return;
        }
      }

      // Phase 1 declares no x-mcp-header parameters: reject any Mcp-Param-* header
      // before dispatch (AC-17) with -32020 HeaderMismatch. The v2 SDK performs
      // the standard-header/body cross-check (AC-15/AC-16) itself.
      const hasParamHeader = Object.keys(req.headers).some((key) => key.toLowerCase().startsWith('mcp-param-'));
      if (hasParamHeader) {
        sendJson(res, 400, {
          jsonrpc: '2.0', id: isRecord(body) ? body['id'] ?? null : null,
          error: { code: JSONRPC_CODES.HEADER_MISMATCH, message: 'HeaderMismatch: Mcp-Param-* headers are not supported in Phase 1' },
        }, extraHeaders);
        return;
      }

      const forbiddenHost = isForbiddenHostRpc(body);
      if (forbiddenHost !== undefined) {
        sendJson(res, 200, forbiddenHostResponse(forbiddenHost.id, forbiddenHost.key), extraHeaders);
        return;
      }

      if (isRecord(body) && body['method'] === 'subscriptions/listen') {
        sendJson(res, 200, {
          jsonrpc: '2.0', id: body['id'] ?? null,
          error: { code: JSONRPC_CODES.METHOD_NOT_FOUND, message: 'Method not found: subscriptions/listen is not available in Phase 1' },
        }, extraHeaders);
        return;
      }

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) headers.append(key, item);
        } else {
          headers.set(key, value);
        }
      }
      // Tie the SDK request signal to a client disconnect so cancellation
      // reaches the tool handler and the upstream fetch (finding H2 / AC-20).
      const disconnect = new AbortController();
      req.once('aborted', () => disconnect.abort(new Error('client_aborted')));
      res.once('close', () => {
        if (!res.writableEnded) disconnect.abort(new Error('client_closed'));
      });
      const request = new Request(url.toString(), {
        method: 'POST',
        headers,
        body: rawBody,
        signal: AbortSignal.any([
          disconnect.signal,
          AbortSignal.timeout(config.httpTimeoutMs),
        ]),
      });

      try {
        const response = await handler.fetch(request);
        res.writeHead(response.status, { ...Object.fromEntries(response.headers.entries()), ...extraHeaders });
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        logger.error('unhandled http fault', { message: error instanceof Error ? error.message : String(error) });
        sendJson(res, 500, {
          jsonrpc: '2.0', id: isRecord(body) ? body['id'] ?? null : null,
          error: { code: JSONRPC_CODES.INTERNAL_ERROR, message: 'Internal error' },
        }, extraHeaders);
      }
    })();
  });

  return {
    server,
    handler,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await handler.close();
    },
  };
}

function sendJson(
  res: import('node:http').ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}
