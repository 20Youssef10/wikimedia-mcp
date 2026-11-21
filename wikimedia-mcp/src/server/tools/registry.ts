import { McpServer, SUPPORTED_PROTOCOL_VERSIONS, type McpServerOptions, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import type { Config } from '../../config.js';
import type { WikimediaClient } from '../../upstream/client.js';
import { SERVER_INSTRUCTIONS } from '../instructions.js';
import { DISCOVERY } from '../discover.js';
import { cacheHints } from '../../protocol/caching.js';
import { createHandlers } from './handlers.js';
import { IDEMPOTENT_TOOLS, PHASE1_TOOL_NAMES, TOOL_DESCRIPTIONS, TOOL_SCHEMAS } from './schemas.js';
import { registerMinimalResources } from '../resources/index.js';
import { registerMinimalPrompts } from '../prompts/index.js';
import { GROUP_B_DESCRIPTIONS, GROUP_B_TOOL_NAMES, buildGroupBSchemas } from '../../wikidata/schemas.js';
import { GROUP_C_DESCRIPTIONS, GROUP_C_SCHEMAS, GROUP_C_TOOL_NAMES } from '../../metrics/schemas.js';
import { GROUP_F_DESCRIPTIONS, GROUP_F_SCHEMAS, GROUP_F_TOOL_NAMES } from '../../media/schemas.js';
import { GROUP_G_DESCRIPTIONS, GROUP_G_SCHEMAS, GROUP_G_TOOL_NAMES } from '../../groupg/schemas.js';
import { createGroupGHandlers } from '../../groupg/handlers.js';

/** Phase 3 names — all five are pure reads and idempotent (§3.6). */
const GROUP_CF_TOOL_NAMES: readonly string[] = [...GROUP_C_TOOL_NAMES, ...GROUP_F_TOOL_NAMES];

/**
 * Static, integrity-checked tool catalogue (SR-12): nine Phase 1 tools, six
 * Phase 2 Group B tools, five Phase 3 Group C/F tools and two Phase 5 Group G
 * tools (geo_search, get_tables). No write/Enterprise tool is registered.
 */
export const TOOL_NAMES: readonly string[] = [
  ...PHASE1_TOOL_NAMES,
  ...GROUP_B_TOOL_NAMES,
  ...GROUP_CF_TOOL_NAMES,
  ...GROUP_G_TOOL_NAMES,
];

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

  const handlers = { ...createHandlers(client, config), ...createGroupGHandlers(client, config) };
  const groupSchemas = buildGroupBSchemas(config);
  const descriptions: Record<string, string> = {
    ...TOOL_DESCRIPTIONS, ...GROUP_B_DESCRIPTIONS, ...GROUP_C_DESCRIPTIONS, ...GROUP_F_DESCRIPTIONS,
    ...GROUP_G_DESCRIPTIONS,
  };
  const schemas: Record<string, StandardSchemaWithJSON> = {
    ...(TOOL_SCHEMAS as unknown as Record<string, StandardSchemaWithJSON>),
    ...(groupSchemas as unknown as Record<string, StandardSchemaWithJSON>),
    ...(GROUP_C_SCHEMAS as unknown as Record<string, StandardSchemaWithJSON>),
    ...(GROUP_F_SCHEMAS as unknown as Record<string, StandardSchemaWithJSON>),
    ...(GROUP_G_SCHEMAS as unknown as Record<string, StandardSchemaWithJSON>),
  };
  for (const name of TOOL_NAMES) {
    const schema = schemas[name];
    const handler = handlers[name as keyof typeof handlers];
    const description = descriptions[name];
    if (schema === undefined || handler === undefined || description === undefined) continue;
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
          idempotentHint: GROUP_B_TOOL_NAMES.includes(name as typeof GROUP_B_TOOL_NAMES[number])
            || GROUP_CF_TOOL_NAMES.includes(name)
            || GROUP_G_TOOL_NAMES.includes(name as typeof GROUP_G_TOOL_NAMES[number])
            || IDEMPOTENT_TOOLS.has(name),
        },
      },
      async (args: unknown, ctx) => handler(
        args !== null && typeof args === 'object' && !Array.isArray(args)
          ? args as Record<string, unknown> : {},
        signalFromContext(ctx),
      ),
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
