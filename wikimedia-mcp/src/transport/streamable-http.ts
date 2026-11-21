import { createServer, type Server } from 'node:http';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import type { Config } from '../config.js';
import type { WikimediaClient } from '../upstream/client.js';
import type { Logger } from '../observability/logging.js';
import { serverFactory } from '../server/tools/registry.js';
import { JSONRPC_CODES } from '../protocol/errors.js';
import { checkHost, checkOrigin } from '../protocol/headers.js';
import { isRecord } from '../protocol/meta.js';
import { isForbiddenHostRpc, forbiddenHostResponse } from '../protocol/host-guard.js';

export type HttpTransportHandle = {
  server: Server;
  handler: McpHttpHandler;
  close: () => Promise<void>;
};

/**
 * Streamable HTTP transport: a single POST-only endpoint. GET/PUT/DELETE get
 * 405 + Allow: POST; bad Origin/Host get 403 with no JSON-RPC body; wrong
 * Content-Type gets 415. `subscriptions/listen` is rejected with -32601.
 */
export function startHttpTransport(config: Config, client: WikimediaClient, logger: Logger): HttpTransportHandle {
  const handler = createMcpHandler(serverFactory(config, client), {
    legacy: 'reject',
    responseMode: 'json',
    onerror: (error) => logger.error('http transport error', { message: error.message }),
  });

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname !== config.httpPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain' });
        res.end('Method not allowed');
        return;
      }

      const originCheck = checkOrigin(req.headers.origin, config.allowedOrigins);
      if (!originCheck.ok) {
        logger.warn('origin rejected', { reason: originCheck.reason });
        res.writeHead(403);
        res.end();
        return;
      }
      const hostCheck = checkHost(req.headers.host, config.allowedHosts);
      if (!hostCheck.ok) {
        logger.warn('host rejected', { reason: hostCheck.reason });
        res.writeHead(403);
        res.end();
        return;
      }

      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.toLowerCase().startsWith('application/json')) {
        res.writeHead(415, { 'Content-Type': 'text/plain' });
        res.end('Unsupported Media Type');
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        size += buffer.length;
        if (size > 4 * 1024 * 1024) {
          res.writeHead(413);
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
        });
        return;
      }

      // Phase 1 declares no x-mcp-header parameters: reject any Mcp-Param-* header
      // before dispatch (AC-17) with -32020 HeaderMismatch.
      const hasParamHeader = Object.keys(req.headers).some((key) => key.toLowerCase().startsWith('mcp-param-'));
      if (hasParamHeader) {
        sendJson(res, 400, {
          jsonrpc: '2.0', id: isRecord(body) ? body['id'] ?? null : null,
          error: { code: JSONRPC_CODES.HEADER_MISMATCH, message: 'HeaderMismatch: Mcp-Param-* headers are not supported in Phase 1' },
        });
        return;
      }

      const forbiddenHost = isForbiddenHostRpc(body);
      if (forbiddenHost !== undefined) {
        sendJson(res, 200, forbiddenHostResponse(forbiddenHost.id, forbiddenHost.key));
        return;
      }

      if (isRecord(body) && body['method'] === 'subscriptions/listen') {
        sendJson(res, 200, {
          jsonrpc: '2.0', id: body['id'] ?? null,
          error: { code: JSONRPC_CODES.METHOD_NOT_FOUND, message: 'Method not found: subscriptions/listen is not available in Phase 1' },
        });
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
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        logger.error('unhandled http fault', { message: error instanceof Error ? error.message : String(error) });
        sendJson(res, 500, {
          jsonrpc: '2.0', id: isRecord(body) ? body['id'] ?? null : null,
          error: { code: JSONRPC_CODES.INTERNAL_ERROR, message: 'Internal error' },
        });
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
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
