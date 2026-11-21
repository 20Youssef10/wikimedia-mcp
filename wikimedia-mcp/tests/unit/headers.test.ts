import { describe, expect, it } from 'vitest';
import { checkOrigin, checkHost } from '../../src/protocol/headers.js';
import { parseRequestMeta, MetaError, SUPPORTED_PROTOCOL_VERSION } from '../../src/protocol/meta.js';

/**
 * Routing-header/body validation (AC-03/AC-04/AC-11/AC-15/AC-16/AC-17) is
 * exercised against the LIVE HTTP path in tests/contract/http.test.ts: the v2
 * SDK's createMcpHandler performs it. A former in-repo duplicate validator was
 * deleted as dead code (G10(d)); this file keeps only the live boundary checks
 * and _meta parsing assertions.
 */
describe('HTTP boundary checks and _meta (AC-03/AC-04/AC-11/AC-18/AC-19)', () => {
  it('validates Origin and Host allowlists (AC-18/AC-19)', () => {
    expect(checkOrigin('https://evil.test', ['https://app.test'])).toEqual({ ok: false, reason: 'origin_not_allowed' });
    expect(checkOrigin(undefined, [])).toEqual({ ok: true });
    expect(checkHost('localhost:3000', ['localhost'])).toEqual({ ok: true });
    expect(checkHost('169.254.169.254', ['localhost'])).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(checkHost(undefined, ['localhost'])).toEqual({ ok: false, reason: 'missing_host' });
  });

  it('REQUIRE_ORIGIN=false (default) accepts a missing Origin so non-browser hosts keep working', () => {
    expect(checkOrigin(undefined, [], false)).toEqual({ ok: true });
    expect(checkOrigin(undefined, ['https://app.test'], false)).toEqual({ ok: true });
  });

  it('REQUIRE_ORIGIN=true rejects a missing Origin with origin_not_allowed reason', () => {
    expect(checkOrigin(undefined, ['https://app.test'], true)).toEqual({ ok: false, reason: 'missing_origin' });
  });

  it('REQUIRE_ORIGIN=true still accepts an allowlisted Origin and rejects a foreign one', () => {
    expect(checkOrigin('https://app.test', ['https://app.test'], true)).toEqual({ ok: true });
    expect(checkOrigin('https://evil.test', ['https://app.test'], true)).toEqual({ ok: false, reason: 'origin_not_allowed' });
  });

  it('requires a string protocolVersion and a clientCapabilities object (AC-03/AC-04)', () => {
    const valid = {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': SUPPORTED_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    };
    expect(parseRequestMeta(valid).protocolVersion).toBe('2026-07-28');
    expect(() => parseRequestMeta({})).toThrow(MetaError);
    expect(() => parseRequestMeta({ _meta: { 'io.modelcontextprotocol/protocolVersion': 123 } })).toThrow(MetaError);
    expect(() => parseRequestMeta({ _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } })).toThrow(MetaError);
  });
});
