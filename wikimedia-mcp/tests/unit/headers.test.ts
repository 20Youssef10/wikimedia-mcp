import { describe, expect, it } from 'vitest';
import {
  validateRoutingHeaders, checkOrigin, checkHost, HeaderMismatchError,
} from '../../src/protocol/headers.js';
import { parseRequestMeta, MetaError, SUPPORTED_PROTOCOL_VERSION } from '../../src/protocol/meta.js';

describe('routing headers and _meta (AC-03/AC-04/AC-11/AC-16/AC-17)', () => {
  const base = {
    headerProtocolVersion: '2026-07-28',
    headerMethod: 'tools/call',
    headerName: 'get_summary',
    bodyProtocolVersion: '2026-07-28',
    bodyMethod: 'tools/call',
    bodyName: 'get_summary',
    extraParamHeaders: [],
  };

  it('accepts matching headers', () => {
    expect(() => validateRoutingHeaders(base)).not.toThrow();
  });

  it('rejects each mismatch independently with HeaderMismatchError', () => {
    expect(() => validateRoutingHeaders({ ...base, headerProtocolVersion: '2025-11-25' })).toThrow(HeaderMismatchError);
    expect(() => validateRoutingHeaders({ ...base, headerMethod: 'server/discover' })).toThrow(HeaderMismatchError);
    expect(() => validateRoutingHeaders({ ...base, headerName: 'get_page' })).toThrow(HeaderMismatchError);
    expect(() => validateRoutingHeaders({ ...base, headerProtocolVersion: undefined as unknown as string })).toThrow(HeaderMismatchError);
  });

  it('decodes the base64 sentinel before comparison (AC-16)', () => {
    const encoded = `=?base64?${Buffer.from('get_summary').toString('base64')}?=`;
    expect(() => validateRoutingHeaders({ ...base, headerName: encoded })).not.toThrow();
    expect(() => validateRoutingHeaders({ ...base, headerName: '=?base64?not!valid?=' })).toThrow(HeaderMismatchError);
  });

  it('rejects Mcp-Param-* headers in Phase 1 (AC-17)', () => {
    expect(() => validateRoutingHeaders({
      ...base, extraParamHeaders: [['Mcp-Param-q', 'Earth']],
    })).toThrow(HeaderMismatchError);
  });

  it('validates Origin and Host allowlists (AC-18/AC-19)', () => {
    expect(checkOrigin('https://evil.test', ['https://app.test'])).toEqual({ ok: false, reason: 'origin_not_allowed' });
    expect(checkOrigin(undefined, [])).toEqual({ ok: true });
    expect(checkHost('localhost:3000', ['localhost'])).toEqual({ ok: true });
    expect(checkHost('169.254.169.254', ['localhost'])).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(checkHost(undefined, ['localhost'])).toEqual({ ok: false, reason: 'missing_host' });
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
