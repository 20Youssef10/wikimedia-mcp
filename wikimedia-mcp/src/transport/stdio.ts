import { PassThrough } from 'node:stream';
import { StdioServerTransport, serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { Config } from '../config.js';
import type { WikimediaClient } from '../upstream/client.js';
import type { Logger } from '../observability/logging.js';
import { serverFactory } from '../server/tools/registry.js';
import { JSONRPC_CODES } from '../protocol/errors.js';
import { isRecord } from '../protocol/meta.js';
import { isForbiddenHostRpc, forbiddenHostResponse } from '../protocol/host-guard.js';

/**
 * stdio transport. stdout is reserved for JSON-RPC; every log line goes to
 * stderr. `subscriptions/listen` is intercepted before the SDK serving entry
 * sees it so Phase 1 returns -32601 (AC-13) with no long-lived stream.
 */
export function startStdioTransport(
  config: Config,
  client: WikimediaClient,
  logger: Logger,
  onShutdown?: () => void,
): StdioServerHandle {
  const inbound = new PassThrough();
  const outbound = new PassThrough();
  const transport = new StdioServerTransport(inbound, outbound);

  const handle = serveStdio(serverFactory(config, client), {
    legacy: 'reject',
    transport,
    onerror: (error) => logger.error('stdio transport error', { message: error.message }),
  });

  outbound.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
  });

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) dispatchLine(line);
      newline = buffer.indexOf('\n');
    }
  });
  process.stdin.on('end', () => { inbound.end(); });

  function dispatchLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: JSONRPC_CODES.PARSE_ERROR, message: 'Parse error' },
      })}\n`);
      return;
    }
    const forbiddenHost = isForbiddenHostRpc(message);
    if (forbiddenHost !== undefined) {
      process.stdout.write(`${JSON.stringify(forbiddenHostResponse(forbiddenHost.id, forbiddenHost.key))}\n`);
      return;
    }
    if (isRecord(message) && message['method'] === 'subscriptions/listen') {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: message['id'] ?? null,
        error: { code: JSONRPC_CODES.METHOD_NOT_FOUND, message: 'Method not found: subscriptions/listen is not available in Phase 1' },
      })}\n`);
      return;
    }
    inbound.write(`${line}\n`);
  }

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      // WP19 — best-effort final telemetry flush on every shutdown path.
      onShutdown?.();
      await handle.close();
      client.close();
    } finally {
      process.exit(0);
    }
  }
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });

  logger.info('stdio transport ready', { protocolVersion: '2026-07-28' });
  return handle;
}
