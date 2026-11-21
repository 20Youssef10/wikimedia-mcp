import type { ToolError, ToolErrorCode } from '../types.js';

/** JSON-RPC error codes used by the 2026-07-28 surface (report 09 §2.5). */
export const JSONRPC_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  INVALID_PARAMS: -32602,
  METHOD_NOT_FOUND: -32601,
  INTERNAL_ERROR: -32603,
  HEADER_MISMATCH: -32020,
  MISSING_CAPABILITY: -32021,
  UNSUPPORTED_VERSION: -32022,
} as const;

const DEFAULT_ACTIONS: Partial<Record<ToolErrorCode, string>> = {
  rate_limited: 'Wait for retry_after_seconds (or the indicated backoff) and retry the call.',
  quota_exhausted: 'Reduce call volume or wait for the quota reset window before retrying.',
  upstream_unavailable: 'Retry shortly; the upstream service is temporarily unavailable.',
  timeout: 'Retry the call; consider a smaller limit or narrower query.',
  internal_error: 'Retry once; if the error persists, report it with the correlation ID.',
  page_not_found: 'Check the title or call search with the same lang/project.',
  invalid_section: 'Call get_sections without a section argument to list valid section indices.',
  unsupported_project: 'Use a supported project name or Wikimedia project code.',
  host_not_allowed: 'Do not supply host/api_url parameters; hosts are fixed by the server allowlist.',
};

export type ToolErrorOptions = {
  retryable?: boolean;
  retryAfterSeconds?: number | null;
  hint?: string | null;
  details?: Record<string, unknown>;
  action?: string;
};

export function toolError(
  code: ToolErrorCode,
  message: string,
  options: ToolErrorOptions = {},
): ToolError {
  const action = options.action ?? DEFAULT_ACTIONS[code] ?? 'Review the error message and retry with corrected arguments.';
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    retry_after_seconds: options.retryAfterSeconds ?? null,
    hint: options.hint ?? null,
    action,
    details: options.details ?? {},
  };
}

/** Map an upstream HTTP status to a tool error, without leaking raw status text. */
export function mapHttpStatus(
  status: number,
  context: { title?: string; source?: string; backend?: string; retryAfterSeconds?: number | null },
): ToolError {
  if (status === 404) {
    const subject = context.title ?? 'resource';
    const source = context.source ?? 'the requested wiki';
    return toolError('page_not_found', `No page titled '${subject}' exists on ${source}. Check the spelling or call search with the same lang/project.`, {
      retryable: false,
      hint: `Call search({ q: '${subject}' }).`,
      details: { http_status: 404, backend: context.backend ?? 'wikimedia' },
    });
  }
  if (status === 400 || status === 422) {
    return toolError('validation_error', 'The upstream request was rejected as invalid. Check the supplied arguments.', {
      retryable: false,
      details: { http_status: status, backend: context.backend ?? 'wikimedia' },
    });
  }
  if (status === 429) {
    return toolError('rate_limited', 'The upstream service is rate-limiting requests. Backing off before retry.', {
      retryable: true,
      retryAfterSeconds: context.retryAfterSeconds ?? null,
      details: { http_status: 429, backend: context.backend ?? 'wikimedia' },
    });
  }
  if (status === 401 || status === 403) {
    return toolError('upstream_unavailable', 'The upstream service refused the request. Check configuration and try again.', {
      retryable: false,
      details: { http_status: status, backend: context.backend ?? 'wikimedia' },
    });
  }
  if (status >= 500) {
    return toolError('upstream_unavailable', 'The upstream service is temporarily unavailable. Retry shortly.', {
      retryable: true,
      details: { http_status: status, backend: context.backend ?? 'wikimedia' },
    });
  }
  return toolError('internal_error', 'The upstream request failed unexpectedly. Retry with the correlation ID.', {
    retryable: true,
    details: { http_status: status, backend: context.backend ?? 'wikimedia' },
  });
}

export function isToolError(value: unknown): value is ToolError {
  return typeof value === 'object' && value !== null
    && typeof (value as ToolError).code === 'string'
    && typeof (value as ToolError).message === 'string';
}
