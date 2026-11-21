import {
  MissingRequiredClientCapabilityError,
  UnsupportedProtocolVersionError,
} from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { JSONRPC_CODES, toolError, mapHttpStatus } from '../../src/protocol/errors.js';

describe('protocol error codes (AC-12/AC-24)', () => {
  it('maps the SDK -32021 capability-shortfall error', () => {
    const error = new MissingRequiredClientCapabilityError({
      requiredCapabilities: { elicitation: {} },
    });
    expect(error.code).toBe(-32021);
    expect(JSONRPC_CODES.MISSING_CAPABILITY).toBe(-32021);
    // Phase 1 read tools require no client capabilities, so no Phase 1 method
    // can legitimately produce this error; the SDK mapping is wired for later.
  });

  it('maps the SDK -32022 unsupported-version error', () => {
    const error = new UnsupportedProtocolVersionError({
      supported: ['2026-07-28'], requested: '2025-11-25',
    });
    expect(error.code).toBe(-32022);
    expect(JSONRPC_CODES.UNSUPPORTED_VERSION).toBe(-32022);
  });

  it('every tool error carries an actionable action and boolean retryable', () => {
    for (const code of ['rate_limited', 'quota_exhausted', 'page_not_found', 'internal_error'] as const) {
      const error = toolError(code, 'test message');
      expect(typeof error.retryable).toBe('boolean');
      expect(error.action.length).toBeGreaterThan(5);
    }
    expect(mapHttpStatus(429, {}).action.length).toBeGreaterThan(5);
  });
});
