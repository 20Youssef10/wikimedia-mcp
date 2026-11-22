import { McpServer, SUPPORTED_PROTOCOL_VERSIONS, type McpServerOptions, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import type { Config } from '../../config.js';
import type { ToolResponse } from '../../types.js';
import type { WikimediaClient } from '../../upstream/client.js';
import { SERVER_INSTRUCTIONS } from '../instructions.js';
import { DISCOVERY } from '../discover.js';
import { cacheHints } from '../../protocol/caching.js';
import { createHandlers } from './handlers.js';
import { toolAnnotations } from './annotations.js';
import { PHASE1_TOOL_NAMES, TOOL_DESCRIPTIONS, TOOL_SCHEMAS } from './schemas.js';
import { registerMinimalResources } from '../resources/index.js';
import { registerMinimalPrompts } from '../prompts/index.js';
import { GROUP_B_DESCRIPTIONS, GROUP_B_TOOL_NAMES, buildGroupBSchemas } from '../../wikidata/schemas.js';
import { GROUP_C_DESCRIPTIONS, GROUP_C_SCHEMAS, GROUP_C_TOOL_NAMES } from '../../metrics/schemas.js';
import { GROUP_F_DESCRIPTIONS, GROUP_F_SCHEMAS, GROUP_F_TOOL_NAMES } from '../../media/schemas.js';
import { GROUP_G_DESCRIPTIONS, GROUP_G_SCHEMAS, GROUP_G_TOOL_NAMES } from '../../groupg/schemas.js';
import { createGroupGHandlers } from '../../groupg/handlers.js';
import { GROUP_D_DESCRIPTIONS, GROUP_D_SCHEMAS, GROUP_D_TOOL_NAMES } from '../../groupd/schemas.js';
import { createGroupDHandlers } from '../../groupd/handlers.js';
import { WRITE_DESCRIPTIONS, WRITE_TOOL_NAMES } from '../../write/constants.js';
import { WRITE_STANDARD_SCHEMAS } from '../../write/schemas.js';
import { createWriteHandlers, type WriteInvocation } from '../../write/handlers.js';
import { defaultWriteRuntime } from '../../write/default-runtime.js';
import { isReadOnlyProfile } from '../../write/config.js';

/** Phase 3 names — all five are pure reads and idempotent (§3.6). */
const GROUP_CF_TOOL_NAMES: readonly string[] = [...GROUP_C_TOOL_NAMES, ...GROUP_F_TOOL_NAMES];

/**
 * Static, integrity-checked DEFAULT catalogue (SR-12): 23 read-only tools plus
 * the five gated write tools, enabled by explicit Product Owner risk
 * acceptance on 2026-11-21 (write-security/signoff.md). Every write control
 * remains active; no write is auto-confirmed.
 */
export const TOOL_NAMES: readonly string[] = [
  ...PHASE1_TOOL_NAMES,
  ...GROUP_B_TOOL_NAMES,
  ...GROUP_CF_TOOL_NAMES,
  ...GROUP_G_TOOL_NAMES,
  ...GROUP_D_TOOL_NAMES,
  ...WRITE_TOOL_NAMES,
];

/** A read-only deployment can still assert the 23-tool catalogue via READ_ONLY_PROFILE=1. */
export function activeToolNames(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  return isReadOnlyProfile(env)
    ? TOOL_NAMES.filter((name) => !WRITE_TOOL_NAMES.includes(name as typeof WRITE_TOOL_NAMES[number]))
    : TOOL_NAMES;
}

/** Translate SDK MRTR/HTTP context into the server-side write invocation. */
function writeInvocation(
  name: string,
  raw: Record<string, unknown>,
  ctx: unknown,
  token: string,
  signal: AbortSignal | undefined,
): WriteInvocation {
  const record = ctx !== null && typeof ctx === 'object' ? ctx as Record<string, unknown> : {};
  const mcpReq = record['mcpReq'] !== null && typeof record['mcpReq'] === 'object'
    ? record['mcpReq'] as Record<string, unknown> : {};
  const rawState = mcpReq['requestState'];
  let requestState: string | undefined;
  if (typeof rawState === 'function') {
    try { requestState = (rawState as () => string | undefined)(); } catch { requestState = undefined; }
  } else if (typeof rawState === 'string') requestState = rawState;
  const answers = mcpReq['inputResponses'];
  const inputResponses = answers !== null && typeof answers === 'object' && !Array.isArray(answers)
    ? Object.entries(answers as Record<string, unknown>).map(([id, value]) => ({ id, value }))
    : undefined;
  const envelope = mcpReq['envelope'] !== null && typeof mcpReq['envelope'] === 'object'
    ? mcpReq['envelope'] as Record<string, unknown> : {};
  const rawApprovals = envelope['io.wikimedia-mcp/approvals'];
  const approvals = Array.isArray(rawApprovals)
    ? rawApprovals.filter((entry): entry is string => typeof entry === 'string') : undefined;
  const http = record['http'] !== null && typeof record['http'] === 'object'
    ? record['http'] as Record<string, unknown> : {};
  const req = http['req'] as Request | undefined;
  const origin = typeof req?.headers?.get === 'function' ? (req.headers.get('origin') ?? 'stdio') : 'stdio';
  const id = mcpReq['id'];
  const correlationId = typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
  void name;
  return {
    raw, token, origin,
    ...(requestState === undefined ? {} : { requestState }),
    ...(inputResponses === undefined ? {} : { inputResponses }),
    ...(approvals === undefined ? {} : { approvals }),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(signal === undefined ? {} : { signal }),
  };
}

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

  const writeProfile = isReadOnlyProfile() ? undefined : defaultWriteRuntime(config);
  const writeHandlers = writeProfile === undefined ? {} : createWriteHandlers(writeProfile.runtime);
  const handlers = {
    ...createHandlers(client, config),
    ...createGroupGHandlers(client, config),
    ...createGroupDHandlers(client, config),
    ...writeHandlers,
  };
  const groupSchemas = buildGroupBSchemas(config);
  const descriptions: Record<string, string> = {
    ...TOOL_DESCRIPTIONS, ...GROUP_B_DESCRIPTIONS, ...GROUP_C_DESCRIPTIONS, ...GROUP_F_DESCRIPTIONS,
    ...GROUP_G_DESCRIPTIONS, ...GROUP_D_DESCRIPTIONS,
    ...(writeProfile === undefined ? {} : WRITE_DESCRIPTIONS),
  };
  const schemas: Record<string, StandardSchemaWithJSON> = {
    ...(TOOL_SCHEMAS as unknown as Record<string, StandardSchemaWithJSON>),
    ...(groupSchemas as unknown as Record<string, StandardSchemaWithJSON>),
    ...(GROUP_C_SCHEMAS as unknown as Record<string, StandardSchemaWithJSON>),
    ...(GROUP_F_SCHEMAS as unknown as Record<string, StandardSchemaWithJSON>),
    ...(GROUP_G_SCHEMAS as unknown as Record<string, StandardSchemaWithJSON>),
    ...(GROUP_D_SCHEMAS as unknown as Record<string, StandardSchemaWithJSON>),
    ...(writeProfile === undefined ? {} : WRITE_STANDARD_SCHEMAS as unknown as Record<string, StandardSchemaWithJSON>),
  };
  for (const name of activeToolNames()) {
    const schema = schemas[name];
    const handler = handlers[name as keyof typeof handlers];
    const description = descriptions[name];
    if (schema === undefined || handler === undefined || description === undefined) continue;
    const isWrite = (WRITE_TOOL_NAMES as readonly string[]).includes(name);
    const annotations = toolAnnotations(name);
    server.registerTool(
      name,
      { description, inputSchema: schema, annotations },
      async (args: unknown, ctx) => {
        const raw = args !== null && typeof args === 'object' && !Array.isArray(args)
          ? args as Record<string, unknown> : {};
        if (isWrite && writeProfile !== undefined) {
          const writeHandler = (writeHandlers as unknown as Record<string, (r: Record<string, unknown>, i: WriteInvocation) => Promise<ToolResponse>>)[name]!;
          return writeHandler(raw, writeInvocation(name, raw, ctx, writeProfile.token, signalFromContext(ctx)));
        }
        return (handler as (input: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResponse>)(raw, signalFromContext(ctx));
      },
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
