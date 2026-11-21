import { SERVER_INFO_META_KEY } from './meta.js';
import { toolError, type ToolErrorOptions } from './errors.js';
import type { ToolErrorCode, ToolResponse } from '../types.js';

export const SERVER_NAME = 'wikimedia-mcp';
export const SERVER_VERSION = '1.0.0';

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

export function okToolResult(payload: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
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
