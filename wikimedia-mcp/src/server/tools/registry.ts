import { McpServer, SUPPORTED_PROTOCOL_VERSIONS, type McpServerOptions } from '@modelcontextprotocol/server';
import type { Config } from '../../config.js';
import type { WikimediaClient } from '../../upstream/client.js';
import { SERVER_INSTRUCTIONS } from '../instructions.js';
import { DISCOVERY } from '../discover.js';
import { cacheHints } from '../../protocol/caching.js';
import { createHandlers } from './handlers.js';
import { IDEMPOTENT_TOOLS, TOOL_DESCRIPTIONS, TOOL_SCHEMAS } from './schemas.js';
import { registerMinimalResources } from '../resources/index.js';
import { registerMinimalPrompts } from '../prompts/index.js';

/** Static, integrity-checked tool catalogue (SR-12): nine named tools only. */
export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as Array<keyof typeof TOOL_SCHEMAS>;

/**
 * Extract the inbound cancellation signal from the SDK tool-handler context.
 * The SDK exposes the original HTTP request as `ctx.http.req` (and some
 * transports surface `ctx.request` directly); both are accepted (finding H2).
 */
export function signalFromContext(ctx: unknown): AbortSignal | undefined {
  if (ctx === null || typeof ctx !== 'object') return undefined;
  const record = ctx as Record<string, unknown>;
  const candidates: unknown[] = [record['signal'], record['request']];
  const http = record['http'];
  if (http !== null && typeof http === 'object') {
    const httpRecord = http as Record<string, unknown>;
    candidates.push(httpRecord['request'], httpRecord['req']);
  }
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== 'object') continue;
    if ('aborted' in candidate && 'addEventListener' in candidate) return candidate as AbortSignal;
    if ('signal' in candidate) {
      const signal = (candidate as { signal?: unknown }).signal;
      if (signal !== null && typeof signal === 'object' && 'aborted' in signal && 'addEventListener' in signal) {
        return signal as AbortSignal;
      }
    }
  }
  return undefined;
}

export function buildMcpServer(config: Config, client: WikimediaClient): McpServer {
  const options: McpServerOptions = {
    capabilities: { ...DISCOVERY.capabilities },
    instructions: SERVER_INSTRUCTIONS,
    supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS, ...DISCOVERY.supportedVersions],
    cacheHints,
  };

  const server = new McpServer({ name: DISCOVERY.serverInfo.name, version: DISCOVERY.serverInfo.version }, options);

  const handlers = createHandlers(client, config);
  for (const name of TOOL_NAMES) {
    server.registerTool(
      name,
      {
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: TOOL_SCHEMAS[name],
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
          idempotentHint: IDEMPOTENT_TOOLS.has(name),
        },
      },
      async (args: Record<string, unknown>, ctx: unknown) => handlers[name](args, signalFromContext(ctx)),
    );
  }

  registerMinimalResources(server);
  registerMinimalPrompts(server);

  return server;
}

/** A fresh server per request/connection — the factory used by both transports. */
export function serverFactory(config: Config, client: WikimediaClient): () => McpServer {
  return () => buildMcpServer(config, client);
}
