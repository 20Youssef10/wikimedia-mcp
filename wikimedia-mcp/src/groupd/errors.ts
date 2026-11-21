import { ResolverError } from '../resolver.js';
import { toolError, type ToolErrorOptions } from '../protocol/errors.js';
import { errorToolResult } from '../protocol/result.js';
import { UpstreamError } from '../upstream/retry.js';
import type { ToolError, ToolErrorCode, ToolResponse } from '../types.js';
import { BACKEND_NAME } from './constants.js';

/** An error already carrying the fully formed Group D tool error envelope. */
export class GroupDError extends Error {
  constructor(readonly toolError: ToolError) {
    super(toolError.message);
    this.name = 'GroupDError';
  }
}

const HINTS: Partial<Record<ToolErrorCode, string>> = {
  validation_error: 'Correct the invalid arguments and retry the call; no outbound request was made.',
  invalid_project: 'Use a supported Wikimedia project name or project code such as enwiki, commonswiki or testwiki.',
  invalid_language: 'Use a 2-12 character Wikimedia language code such as en, de or fr.',
  invalid_cursor: 'Call get_recent_changes again without `continue` to start a fresh bounded window, then pass back the new cursor unchanged.',
  stale_window: 'Retry with a larger time_window_seconds or a fresh call; do not conclude that no changes occurred.',
  rate_limited: 'Wait for retry_after_seconds and retry the call.',
  upstream_unavailable: 'Retry shortly; the upstream wiki is temporarily unavailable.',
  timeout: 'Retry the call with a smaller limit or shorter time window.',
  internal_error: 'Retry once; if it persists, report it with the correlation ID.',
};

export function groupDError(
  code: ToolErrorCode,
  message: string,
  options: ToolErrorOptions = {},
): ToolError {
  return toolError(code, message, {
    ...options,
    hint: options.hint ?? HINTS[code] ?? 'Review the arguments and retry the call.',
    details: { backend: BACKEND_NAME, ...(options.details ?? {}) },
  });
}

export function throwGroupD(code: ToolErrorCode, message: string, options: ToolErrorOptions = {}): never {
  throw new GroupDError(groupDError(code, message, options));
}

/** Map *every* Group D failure into the shared write-free error envelope. */
export function mapGroupDError(name: string, error: unknown): ToolResponse {
  if (error instanceof GroupDError) {
    const t = error.toolError;
    return errorToolResult(t.code, t.message, {
      retryable: t.retryable,
      retryAfterSeconds: t.retry_after_seconds,
      hint: t.hint,
      details: { ...t.details, tool: name },
      action: t.action,
    });
  }
  if (error instanceof ResolverError) {
    // Contract §3.4: host-shaped or unresolvable projects are `invalid_project`.
    const code: ToolErrorCode = error.kind === 'invalid_language' ? 'invalid_language' : 'invalid_project';
    return errorToolResult(code, error.message, {
      retryable: false,
      hint: HINTS[code] ?? "Review the arguments and retry the call.",
      details: { tool: name, kind: error.kind },
    });
  }
  if (error instanceof UpstreamError) {
    if (error.status === 429) {
      return errorToolResult('rate_limited', 'Upstream rate limit reached after bounded retries.', {
        retryable: true,
        retryAfterSeconds: Math.max(1, Math.ceil((error.retryAfterMs ?? 1000) / 1000)),
        hint: HINTS.rate_limited ?? "Wait for retry_after_seconds and retry the call.",
        details: { tool: name, http_status: 429 },
      });
    }
    if (error.status === 0) {
      const host = error.host ?? 'the upstream host';
      return errorToolResult('upstream_unavailable', `Could not reach the upstream wiki at ${host}.`, {
        retryable: true,
        hint: `Check DNS/network access to ${host} and retry the call.`,
        details: { tool: name, host, network: true },
      });
    }
    return errorToolResult('upstream_unavailable', 'The upstream service is temporarily unavailable. Retry shortly.', {
      retryable: true,
      hint: HINTS.upstream_unavailable ?? "Retry shortly; the upstream wiki is temporarily unavailable.",
      details: { tool: name, http_status: error.status },
    });
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return errorToolResult('timeout', 'The upstream request was cancelled or timed out. Retry the call.', {
      retryable: true,
      hint: HINTS.timeout ?? "Retry the call with a smaller limit or shorter time window.",
      details: { tool: name },
    });
  }
  return errorToolResult('internal_error', 'An internal error occurred in get_recent_changes. Retry with the correlation ID.', {
    retryable: true,
    hint: HINTS.internal_error ?? "Retry once; if it persists, report it with the correlation ID.",
    details: { tool: name, error_type: error instanceof Error ? error.name : 'unknown' },
  });
}
