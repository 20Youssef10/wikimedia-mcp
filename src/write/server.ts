import type { McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { WRITE_ANNOTATIONS, WRITE_DESCRIPTIONS, WRITE_TOOL_NAMES, type WriteToolName } from './constants.js';
import { WRITE_STANDARD_SCHEMAS } from './schemas.js';
import type { WriteHandler } from './handlers.js';
import type { WriteConfig } from './config.js';

/**
 * Gated registration helper. This module is NEVER imported by the default
 * server entrypoint: with MCP_WRITES_ENABLED=false no write tool, client or
 * credential is registered. A future write-enabled deployment must load this
 * explicitly after AC-155 sign-off.
 */
export function assertWritesActivatable(config: WriteConfig, signoffPresent: boolean): void {
  if (!config.enabled || !config.gatesSigned || !signoffPresent) {
    throw new Error('Write tools are hard-blocked: signed gate record and all G1–G12 evidence are required.');
  }
}

export function registerWriteTools(
  server: McpServer,
  config: WriteConfig,
  signoffPresent: boolean,
  handlers: Record<WriteToolName, WriteHandler>,
): void {
  assertWritesActivatable(config, signoffPresent);
  for (const name of WRITE_TOOL_NAMES) {
    server.registerTool(
      name,
      {
        description: WRITE_DESCRIPTIONS[name],
        inputSchema: WRITE_STANDARD_SCHEMAS[name] as StandardSchemaWithJSON,
        annotations: { ...WRITE_ANNOTATIONS },
      },
      async (args: unknown) => handlers[name](
        args !== null && typeof args === 'object' && !Array.isArray(args)
          ? args as Record<string, unknown> : {},
        // A real deployment supplies the secret-store token via a request-scoped
        // context; this helper intentionally does not fabricate one.
        { token: '', raw: {} },
      ),
    );
  }
}
