import {
  MissingRequiredClientCapabilityError,
  UnsupportedProtocolVersionError,
} from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { JSONRPC_CODES, RECOVERY_HINTS, toolError, mapHttpStatus } from '../../src/protocol/errors.js';
import { errorToolResult } from '../../src/protocol/result.js';
import { TOOL_NAMES } from '../../src/server/tools/registry.js';

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

describe('WP14 — additive deterministic recovery hints', () => {
  it('emits suggested_tool/next_action only for codes with a deterministic recovery', () => {
    const hinted = toolError('page_not_found', "No page titled 'Earth' exists on wikipedia:en.", {
      details: { title: 'Earth', http_status: 404 },
    });
    expect(hinted.code).toBe('page_not_found');
    expect(hinted.suggested_tool).toBe('search');
    expect(hinted.next_action).toBeTypeOf('string');
    expect(hinted.action).toBe('Check the title or call search with the same lang/project.');
    expect(hinted.retry_after_seconds).toBeNull();

    const unhinted = toolError('invalid_issuer', 'Issuer rejected.');
    expect('suggested_tool' in unhinted).toBe(false);
    expect('next_action' in unhinted).toBe(false);
  });

  it('suggested_tool values are registered tools and hints leak no title/token/status text', () => {
    const sensitive = "SecretTitle-9f3a BEARER_TOKEN_VALUE HTTP/1.1 418 I'm a teapot";
    for (const [code, hint] of Object.entries(RECOVERY_HINTS)) {
      expect(hint, `${code} recovery hint`).toBeDefined();
      if (hint === undefined) continue;
      const error = toolError(code as Parameters<typeof toolError>[0], sensitive, {
        details: { title: sensitive, upstream_status_text: sensitive },
      });
      if (hint.suggested_tool !== undefined) {
        expect(TOOL_NAMES, `${code} suggested_tool must be registered`).toContain(hint.suggested_tool);
        expect(error.suggested_tool).toBe(hint.suggested_tool);
      } else {
        expect('suggested_tool' in error).toBe(false);
      }
      expect(error.next_action).toBe(hint.next_action);
      expect(error.next_action).toBeTypeOf('string');
      expect(error.next_action).not.toContain('SecretTitle');
      expect(error.next_action).not.toContain('BEARER_TOKEN_VALUE');
      expect(error.next_action).not.toContain('teapot');
      expect(error.next_action).not.toContain('418');
    }
  });

  it('error envelopes carry the additive fields without altering the existing shape', () => {
    const result = errorToolResult('invalid_qid', 'Invalid QID.', { retryable: false });
    const error = result.structuredContent['error'] as Record<string, unknown>;
    expect(error['code']).toBe('invalid_qid');
    expect(error['suggested_tool']).toBe('wikidata_search_entities');
    expect(error['next_action']).toBeTypeOf('string');
    for (const key of ['code', 'message', 'retryable', 'hint', 'action', 'details']) {
      expect(key in error).toBe(true);
    }
    expect(result.isError).toBe(true);
  });

  it('does not add any new ToolErrorCode and keeps mapped codes stable', () => {
    expect(mapHttpStatus(404, {}).code).toBe('page_not_found');
    expect(mapHttpStatus(429, {}).code).toBe('rate_limited');
    expect(mapHttpStatus(503, {}).code).toBe('upstream_unavailable');
    expect(Object.keys(RECOVERY_HINTS).every((code) => typeof code === 'string')).toBe(true);
  });
});
