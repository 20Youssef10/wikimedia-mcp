import { describe, expect, it } from 'vitest';
import {
  assertNoWriteTool, createCsrfGuard, CSRF_REQUEST_HEADER, CSRF_RESPONSE_HEADER,
  findWriteCredentialEnvKeys, isStateChangingRequest, WRITE_TOOL_DENYLIST,
} from '../../src/protocol/csrf.js';
import { TOOL_NAMES, activeToolNames } from '../../src/server/tools/registry.js';

const SECRET = 'unit-test-csrf-secret-at-least-16-chars';

describe('CSRF token mechanism (report 08 G10(c), §5.9)', () => {
  it('issues a token that verifies with the same secret', () => {
    const guard = createCsrfGuard(SECRET, 300000);
    const token = guard.issueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(guard.verifyToken(token)).toBe(true);
  });

  it('rejects missing, malformed, tampered and wrong-secret tokens', () => {
    const guard = createCsrfGuard(SECRET, 300000);
    const token = guard.issueToken();
    expect(guard.verifyToken(undefined)).toBe(false);
    expect(guard.verifyToken('')).toBe(false);
    expect(guard.verifyToken('not-a-token')).toBe(false);

    const [payload, sig] = token.split('.');
    expect(payload).toBeDefined();
    expect(sig).toBeDefined();
    const flipped = `${sig![0] === 'A' ? 'B' : 'A'}${sig!.slice(1)}`;
    expect(guard.verifyToken(`${payload}.${flipped}`)).toBe(false);

    const other = createCsrfGuard('a-different-16-char-secret-value', 300000);
    expect(other.verifyToken(token)).toBe(false);
  });

  it('enforces the TTL and rejects future-dated tokens', () => {
    let now = 1_000_000;
    const guard = createCsrfGuard(SECRET, 1000, () => now);
    const token = guard.issueToken();
    expect(guard.verifyToken(token)).toBe(true);
    now += 1001;
    expect(guard.verifyToken(token)).toBe(false);

    now = 1_000_000;
    const future = createCsrfGuard(SECRET, 300000, () => now - 120_000).issueToken();
    expect(guard.verifyToken(future)).toBe(false);
  });

  it('names the canonical wire headers', () => {
    expect(CSRF_REQUEST_HEADER).toBe('mcp-csrf-token');
    expect(CSRF_RESPONSE_HEADER).toBe('MCP-CSRF-Token');
  });
});

describe('state-changing classification and write-tool deny-list (G5/G10)', () => {
  it('contains the three report 05 §2 write-tool names plus the §1.1 mutators', () => {
    expect(WRITE_TOOL_DENYLIST).toContain('edit_page');
    expect(WRITE_TOOL_DENYLIST).toContain('upload_file');
    expect(WRITE_TOOL_DENYLIST).toContain('delete_page');
    expect(WRITE_TOOL_DENYLIST).toContain('move_page');
    expect(WRITE_TOOL_DENYLIST).toContain('protect_page');
  });

  it('classifies only deny-listed tools/call as state-changing', () => {
    const call = (name: string) => ({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} },
    });
    expect(isStateChangingRequest(call('edit_page'))).toBe(true);
    expect(isStateChangingRequest(call('delete_page'))).toBe(true);
    expect(isStateChangingRequest(call('get_summary'))).toBe(false);
    expect(isStateChangingRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).toBe(false);
    expect(isStateChangingRequest(null)).toBe(false);
  });

  it('the production catalogue contains no write tool', () => {
    expect(() => assertNoWriteTool(activeToolNames({ READ_ONLY_PROFILE: '1' }))).not.toThrow();
    expect(() => assertNoWriteTool([...TOOL_NAMES, 'edit_page'])).toThrow(/edit_page/);
  });

  it('detects write-credential-shaped env keys but ignores read-only config', () => {
    expect(findWriteCredentialEnvKeys({
      USER_AGENT: 'x', USER: 'tester', MCP_CSRF_SECRET: 'not-a-write-credential',
    })).toEqual([]);
    expect(findWriteCredentialEnvKeys({
      USER_AGENT: 'x', WIKIMEDIA_OAUTH_TOKEN: 'secret', WRITE_TOKEN: 'secret',
    }).sort()).toEqual(['WIKIMEDIA_OAUTH_TOKEN', 'WRITE_TOKEN']);
  });
});
