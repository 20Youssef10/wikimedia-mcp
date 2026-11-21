import { toolError, type ToolErrorOptions } from '../protocol/errors.js';
import { errorToolResult } from '../protocol/result.js';
import type { ToolError, ToolErrorCode, ToolResponse } from '../types.js';
import { WRITE_ERROR_CODES } from './constants.js';

const HINTS: Partial<Record<ToolErrorCode, string>> = {
  validation_error: 'Correct the arguments and retry; a token, credential, host or confirmation must never be a tool argument.',
  invalid_project: 'Use a project from the configured write allowlist; no write was attempted.',
  invalid_language: 'Use a valid 2-12 character Wikimedia language code.',
  authentication_required: 'Authenticate with the configured OAuth issuer and retry; no write was attempted.',
  invalid_issuer: 'Use a token from the configured HTTPS issuer; no write was attempted.',
  insufficient_scope: 'Obtain a token carrying the required scope for this tool; no write was attempted.',
  confirmation_required: 'Repeat the call with the returned requestState and an affirmative inputResponses entry.',
  confirmation_invalid: 'Start a fresh preview; the confirmation state was forged, replayed, expired or bound to other inputs.',
  capability_invalid: 'Start a fresh preview; the capability was forged, replayed, expired or scoped to another target.',
  blast_radius_exceeded: 'Narrow the target or reduce the size; a configured write limit was exceeded.',
  write_halted: 'The write kill switch is engaged or a credential was revoked; no write was attempted.',
  target_changed: 'The target changed after preview; fetch a fresh preview before retrying.',
  approval_required: 'Obtain two distinct configured approvers (neither the requester) before retrying.',
  licence_not_signed_off: 'Supply an allowlisted licence with attribution, author and source URL, and record the ToU sign-off.',
  rate_limited: 'Wait for retry_after_seconds and retry.',
  upstream_unavailable: 'Retry shortly; the upstream wiki is temporarily unavailable.',
  timeout: 'Retry with a smaller payload or narrower target.',
  internal_error: 'Retry once; if it persists, report the correlation ID.',
};

for (const code of WRITE_ERROR_CODES) {
  if (HINTS[code] === undefined) throw new Error(`write error hint missing for ${code}`);
}

export class WriteError extends Error {
  constructor(readonly toolError: ToolError) {
    super(toolError.message);
    this.name = 'WriteError';
  }
}

export function writeError(
  code: ToolErrorCode,
  message: string,
  options: ToolErrorOptions = {},
): ToolError {
  const hint = options.hint ?? HINTS[code] ?? 'Review the error and retry.';
  return toolError(code, message, {
    ...options,
    hint,
    action: options.action ?? hint,
  });
}

export function throwWrite(code: ToolErrorCode, message: string, options: ToolErrorOptions = {}): never {
  throw new WriteError(writeError(code, message, options));
}

/** Write envelope: `action` equals `hint` (contract 16 §3.3). */
export function writeErrorResult(name: string, error: unknown): ToolResponse {
  if (error instanceof WriteError) {
    const t = error.toolError;
    return errorToolResult(t.code, t.message, {
      retryable: t.retryable,
      retryAfterSeconds: t.retry_after_seconds,
      hint: t.hint,
      action: t.action,
      details: { ...t.details, tool: name, backend: t.details['backend'] ?? 'write' },
    });
  }
  return errorToolResult('internal_error', 'An internal error occurred in a write tool. Retry with the correlation ID.', {
    retryable: true,
    hint: HINTS.internal_error ?? 'Retry once; if it persists, report the correlation ID.',
    details: { tool: name, error_type: error instanceof Error ? error.name : 'unknown' },
  });
}
