import { SERVER_INFO_META_KEY } from './meta.js';
import { toolError, type ToolErrorOptions } from './errors.js';
import { assembleProvenanceBlock } from '../attribution/assemble.js';
import type { Attribution, License, ProvenanceBlock, ToolErrorCode, ToolResponse } from '../types.js';

export const SERVER_NAME = 'wikimedia-mcp';
export const SERVER_VERSION = '3.0.0';

export const serverInfo = Object.freeze({ name: SERVER_NAME, version: SERVER_VERSION });

/** A stub `input_required` result (AC-07): deliberately not cacheable. */
export function inputRequiredStub(): {
  resultType: 'input_required';
  inputRequests: unknown[];
  _meta: Record<string, unknown>;
} {
  return {
    resultType: 'input_required',
    inputRequests: [],
    _meta: { [SERVER_INFO_META_KEY]: serverInfo },
  };
}

/**
 * WP15 — additively group flat provenance into a compact block. Covers tools
 * that assemble provenance themselves (for example the Phase 3 media tools)
 * without touching their flat fields. A payload that already has a block is
 * returned unchanged; payloads without flat provenance are untouched.
 */
export function withProvenanceBlock(payload: Record<string, unknown>): Record<string, unknown> {
  if ('provenance_block' in payload) return payload;
  if (typeof payload['source'] !== 'string') return payload;
  const license = payload['license'];
  const attribution = payload['attribution'];
  if (license === null || typeof license !== 'object' || Array.isArray(license)) return payload;
  if (attribution === null || typeof attribution !== 'object' || Array.isArray(attribution)) return payload;
  const block: ProvenanceBlock = assembleProvenanceBlock({
    source: payload['source'] as string,
    license: license as License,
    attribution: attribution as Attribution,
    revision: typeof payload['revision'] === 'number' ? payload['revision'] : null,
    timestamp: typeof payload['timestamp'] === 'string' ? payload['timestamp'] : null,
  });
  return { ...payload, provenance_block: block };
}

export function okToolResult(payload: Record<string, unknown>): ToolResponse {
  const enriched = withProvenanceBlock(payload);
  return {
    content: [{ type: 'text', text: JSON.stringify(enriched) }],
    structuredContent: enriched,
  };
}

export function errorToolResult(
  code: ToolErrorCode,
  message: string,
  options: ToolErrorOptions = {},
): ToolResponse {
  const error = toolError(code, message, options);
  return {
    content: [{ type: 'text', text: JSON.stringify({ error }) }],
    structuredContent: { error },
    isError: true,
  };
}
