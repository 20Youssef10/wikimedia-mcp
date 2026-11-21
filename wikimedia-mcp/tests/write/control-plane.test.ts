import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, activeToolNames } from '../../src/server/tools/registry.js';
import { WRITE_ANNOTATIONS, WRITE_SCOPES as CAPABILITY_SCOPES, WRITE_TOOL_NAMES } from '../../src/write/constants.js';
import { loadWriteConfig } from '../../src/write/config.js';
import { loadConfig } from '../../src/config.js';
import { AuditStore, canonical } from '../../src/write/audit.js';
import { Capabilities, JtiLedger, RequestStates } from '../../src/write/tokens.js';
import { writeHarness, makeJwt, testWriteConfig } from './harness.js';
import type { ToolResponse } from '../../src/types.js';

const EDIT_ARGS = {
  project: 'testwiki', title: 'Sandbox', text: 'new body', summary: 'automated test',
};
const code = (result: ToolResponse): string =>
  ((result.structuredContent as Record<string, unknown>)['error'] as Record<string, unknown>)?.['code'] as string;

describe('AC-130 / G5 — enabled default with explicit read-only profile', () => {
  it('registers all five write tools by default and keeps a 23-tool read-only profile', () => {
    for (const name of WRITE_TOOL_NAMES) expect(TOOL_NAMES).toContain(name);
    expect(TOOL_NAMES).toHaveLength(28);
    expect(activeToolNames({ READ_ONLY_PROFILE: '1' })).toHaveLength(23);
    for (const name of WRITE_TOOL_NAMES) expect(activeToolNames({ READ_ONLY_PROFILE: '1' })).not.toContain(name);
    const inert = loadWriteConfig({ USER_AGENT: 'QA/1.0 (https://example.org; qa@example.org)' });
    expect(inert?.enabled).toBe(true);
    expect(inert?.issuer).toBe('');
    expect(loadWriteConfig({ USER_AGENT: 'QA/1.0 (https://example.org; qa@example.org)', READ_ONLY_PROFILE: '1' })).toBeNull();
    const base = loadConfig({ USER_AGENT: 'QA/1.0 (https://example.org; qa@example.org)' });
    expect(Object.keys(base).some((key) => /WRITES?_|MRTR|CAPABILITY|UPLOAD_/i.test(key))).toBe(false);
  });
});

describe('AC-131 / G2+G10 — fail-closed write configuration', () => {
  const baseEnv: NodeJS.ProcessEnv = {
    USER_AGENT: 'QA/1.0 (https://example.org; qa@example.org)',
    MCP_WRITES_ENABLED: 'true', MCP_WRITE_GATES_SIGNED: 'true',
    MCP_WRITE_KILL_SWITCH: 'released',
    MCP_WRITE_OAUTH_ISSUER: 'https://issuer.example', MCP_WRITE_OAUTH_AUDIENCE: 'aud',
    MCP_WRITE_OAUTH_CIMD_URL: 'https://issuer.example/cimd',
    MCP_WRITE_OAUTH_CLIENT_ID: 'client', MCP_WRITE_OAUTH_TOKEN_ENDPOINT: 'https://issuer.example/token',
    MCP_WRITE_OAUTH_SCOPES: 'edit', MCP_WRITE_TOKEN_STORE: 'store:write',
    MCP_WRITE_TOKEN_REVOCATION_ENDPOINT: 'https://issuer.example/revoke',
    MCP_MRTR_SECRET: 'm'.repeat(40), MCP_CAPABILITY_SECRET: 'c'.repeat(40),
    MCP_WRITE_ALLOWED_PROJECTS: 'testwiki', MCP_WRITE_AUDIT_SINK: 'memory:test',
    MCP_WRITE_AUDIT_HMAC_SECRET: 'a'.repeat(40), MCP_WRITE_APPROVER_IDS: 'a,b',
    MCP_UPLOAD_TOU_SIGNED_BY: 'Some Person (Role, 2026-11-21)',
    MCP_REQUIRE_ORIGIN: 'true', MCP_REQUIRE_CSRF: 'true',
    MCP_ALLOWED_ORIGINS: 'https://console.example', MCP_ALLOWED_HOSTS: '127.0.0.1',
    MCP_CSRF_SECRET: 's'.repeat(24),
  };
  const present = () => true;

  it('boots with a complete signed, test-only configuration', () => {
    expect(loadWriteConfig(baseEnv, { signoffPresent: present })?.enabled).toBe(true);
  });
  it('fails on missing keys, unsigned gates, released kill switch, wildcard scopes and weak secrets', () => {
    const absent = { ...baseEnv };
    delete absent.MCP_WRITE_AUDIT_SINK;
    expect(() => loadWriteConfig(absent, { signoffPresent: present })).toThrow();
    expect(() => loadWriteConfig({ ...baseEnv, MCP_WRITE_GATES_SIGNED: 'false', MCP_WRITE_KILL_SWITCH: 'engaged' }, { signoffPresent: present })).toThrow();
    expect(() => loadWriteConfig({ ...baseEnv, MCP_WRITE_GATES_SIGNED: 'false' }, { signoffPresent: present })).toThrow();
    expect(() => loadWriteConfig({ ...baseEnv, MCP_WRITE_OAUTH_SCOPES: 'edit,*' }, { signoffPresent: present })).toThrow();
    expect(() => loadWriteConfig({ ...baseEnv, MCP_MRTR_SECRET: 'short' }, { signoffPresent: present })).toThrow();
    expect(() => loadWriteConfig({ ...baseEnv, MCP_REQUIRE_ORIGIN: 'false' }, { signoffPresent: present })).toThrow();
    expect(() => loadWriteConfig({ ...baseEnv, MCP_REQUIRE_CSRF: 'false' }, { signoffPresent: present })).toThrow();
    expect(() => loadWriteConfig(baseEnv, { signoffPresent: () => false })).toThrow();
    expect(() => loadWriteConfig({ ...baseEnv, MCP_WRITE_AUDIT_RETENTION_DAYS: '100' }, { signoffPresent: present })).toThrow();
    expect(() => loadWriteConfig({ ...baseEnv, MCP_WRITE_ALLOWED_PROJECTS: 'enwiki' }, { signoffPresent: present })).toThrow();
  });
});

describe('AC-132 — destructive annotations and group separation', () => {
  it('declares readOnlyHint:false, destructiveHint:true and non-idempotent', () => {
    expect(WRITE_ANNOTATIONS).toEqual({
      readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false,
    });
    for (const name of WRITE_TOOL_NAMES) expect(name).not.toBe('get_recent_changes');
  });
});

describe('AC-133 / G2 — RFC 9207 issuer binding and CIMD pinning', () => {
  it('rejects foreign/missing/non-HTTPS iss, wrong aud, bad signature and expiry', async () => {
    const cases = [
      [{ tokenEndpointIss: 'https://evil.example' }, {}],
      [{}, { iss: 'https://evil.example' }],
      [{}, { aud: 'wrong' }],
      [{}, { exp: Math.floor(Date.now() / 1000) - 10 }],
      [{}, { iss: 'http://issuer.example' }],
    ] as const;
    for (const [fetchOpts, jwtOpts] of cases) {
      const h = writeHarness({}, fetchOpts);
      const result = await h.invoke('edit_page', EDIT_ARGS, { token: makeJwt({ ...jwtOpts }), tokenEndpointIss: fetchOpts.tokenEndpointIss });
      expect(['invalid_issuer', 'authentication_required']).toContain(code(result));
      expect(h.transport.mutations).toHaveLength(0);
    }
    const badSig = writeHarness();
    const tampered = `${badSig.token.slice(0, -4)}AAAA`;
    expect(code(await badSig.invoke('edit_page', EDIT_ARGS, { token: tampered }))).toBe('authentication_required');
  });
});

describe('AC-134 / G2 — least-privilege scope map', () => {
  it('rejects a token without the mapped scope and rejects unknown scopes at boot', async () => {
    expect(CAPABILITY_SCOPES).toEqual({
      edit_page: 'edit', protect_page: 'protect', move_page: 'move', delete_page: 'delete', upload_file: 'upload',
    });
    const h = writeHarness();
    const result = await h.invoke('edit_page', EDIT_ARGS, { token: makeJwt({ scope: 'protect' }) });
    expect(code(result)).toBe('insufficient_scope');
    expect(h.transport.mutations).toHaveLength(0);
  });
});

describe('AC-135 / G2+T-04 — no token in tool arguments or output', () => {
  it('rejects token/confirmation/host arguments and keeps the bearer out of all output', async () => {
    for (const key of ['token', 'confirmation', 'credential', 'host', 'api_url']) {
      const h = writeHarness();
      const result = await h.invoke('edit_page', { ...EDIT_ARGS, [key]: 'secret-value' });
      expect(code(result)).toBe('validation_error');
      expect(JSON.stringify(result)).not.toContain('secret-value');
      expect(h.transport.mutations).toHaveLength(0);
    }
    const unauth = writeHarness();
    const result = await unauth.invoke('edit_page', { project: 'enwiki', title: 'Sandbox', text: 'x', summary: 'x' }, {
      token: '',
    });
    expect(code(result)).toBe('authentication_required');
    expect(JSON.stringify(result)).not.toContain(unauth.token);
  });
});

describe('AC-136 / G3 — preview-only first round', () => {
  it('returns input_required with confirm_write, exact prompt and a signed state, no mutation', async () => {
    const h = writeHarness();
    const result = await h.invoke('edit_page', EDIT_ARGS);
    const view = result.structuredContent as Record<string, unknown>;
    expect(view['resultType']).toBe('input_required');
    const request = (view['inputRequests'] as Array<Record<string, unknown>>)[0]!;
    expect(request['id']).toBe('confirm_write');
    expect(JSON.stringify(request['prompt'])).toContain('Sandbox');
    expect(JSON.stringify(request['prompt'])).toContain('automated test');
    expect(String(view['requestState']).startsWith('~')).toBe(true);
    expect(view['audit_event_id']).toBeDefined();
    expect(h.transport.mutations).toHaveLength(0);
  });
});

describe('AC-137 / G3 — forged, replayed, expired and mismatched requestState', () => {
  it('rejects all confirmation failures with zero outbound write', async () => {
    const h = writeHarness();
    const { state } = await h.fullFlow('edit_page', { ...EDIT_ARGS, dry_run: true });
    const denied = await h.invoke('edit_page', EDIT_ARGS, {
      requestState: state, inputResponses: [{ id: 'confirm_write', value: true }],
    });
    expect(code(denied)).toBe('confirmation_invalid');
    for (const raw of ['~forged.payload', 'plain', '']) {
      const result = await h.invoke('edit_page', EDIT_ARGS, {
        requestState: raw, inputResponses: [{ id: 'confirm_write', value: true }],
      });
      expect(code(result)).toBe('confirmation_invalid');
    }
    const missing = await h.invoke('edit_page', EDIT_ARGS, { requestState: state });
    expect(code(missing)).toBe('confirmation_invalid');
    const nonAffirmative = writeHarness();
    const preview = await nonAffirmative.invoke('edit_page', EDIT_ARGS);
    const s2 = (preview.structuredContent as Record<string, unknown>)['requestState'] as string;
    expect(code(await nonAffirmative.invoke('edit_page', EDIT_ARGS, {
      requestState: s2, inputResponses: [{ id: 'confirm_write', value: false }],
    }))).toBe('confirmation_required');
    expect(h.transport.mutations).toHaveLength(0);
  });

  it('binds state to actor, tool, target and params hash via signed claims', () => {
    const ledger = new JtiLedger();
    const states = new RequestStates('m'.repeat(40), 120, ledger, () => 1000);
    const payload = {
      actor: { tenant: 't', sub: 's', client_id_hash: 'c' }, tool: 'edit_page',
      target: { source: 'wikipedia:en', namespace: 0, title: 'Sandbox' },
      params_hash: 'abc', base_revision: 1, approvals: [],
    };
    const raw = states.issue(payload);
    expect(() => states.verify(raw, { ...payload, tool: 'delete_page' })).toThrow();
    expect(() => states.verify(raw, { ...payload, params_hash: 'def' })).toThrow();
    expect(() => states.verify(raw, { ...payload, actor: { ...payload.actor, sub: 'other' } })).toThrow();
    expect(states.verify(raw, payload).jti).toBeTruthy();
  });
});

describe('AC-138 / G3 — target re-validation closes the TOCTOU gap', () => {
  it('returns target_changed when the revision moves after preview', async () => {
    const h = writeHarness();
    const preview = await h.invoke('edit_page', { ...EDIT_ARGS, base_revision: 100 });
    const state = (preview.structuredContent as Record<string, unknown>)['requestState'] as string;
    h.transport.revision = 101;
    const result = await h.invoke('edit_page', { ...EDIT_ARGS, base_revision: 100 }, {
      requestState: state, inputResponses: [{ id: 'confirm_write', value: true }],
    });
    expect(code(result)).toBe('target_changed');
    expect(h.transport.mutations).toHaveLength(0);
  });
});

describe('AC-139 / G7 — dry-run', () => {
  it('returns a complete would-change result without mutating', async () => {
    const h = writeHarness();
    const { preview, result } = await h.fullFlow('edit_page', { ...EDIT_ARGS, dry_run: true });
    expect((preview.structuredContent as Record<string, unknown>)['resultType']).toBe('input_required');
    expect(result.structuredContent).toMatchObject({
      resultType: 'complete', executed: false, would_change: true, action: 'edit', base_revision: 100,
    });
    expect(String((result.structuredContent as Record<string, unknown>)['diff'])).toContain('+new body');
    expect(h.transport.mutations).toHaveLength(0);
  });
});

describe('AC-140 / G4 — capability scoping and replay', () => {
  it('rejects cross-target, cross-actor, cross-tool, expired and replayed capability tokens', () => {
    const ledger = new JtiLedger();
    const caps = new Capabilities('c'.repeat(40), 300, ledger, () => 1000);
    const claims = {
      actor: { tenant: 't', sub: 's', client_id_hash: 'c' }, tool: 'edit_page',
      target: { source: 'wikipedia:en', namespace: 0, title: 'Sandbox' },
      scope: 'edit', base_revision: 1, content_hash: 'sha256:x', approvals: [],
    };
    const raw = caps.issue(claims);
    expect(() => caps.verify(raw, { ...claims, target: { ...claims.target, title: 'Other' } })).toThrow();
    expect(() => caps.verify(raw, { ...claims, actor: { ...claims.actor, sub: 'other' } })).toThrow();
    expect(() => caps.verify(raw, { ...claims, tool: 'delete_page' })).toThrow();
    expect(caps.verify(raw, claims).jti).toBeTruthy();
    expect(() => caps.verify(raw, claims)).toThrow();

    const deniedRaw = caps.issue(claims);
    ledger.deny(JSON.parse(Buffer.from(deniedRaw.slice(1).split('.')[0]!, 'base64url').toString())['jti'] as string);
    expect(() => caps.verify(deniedRaw, claims)).toThrow();
  });
});

describe('AC-141 / G4 — blast-radius limits', () => {
  it('rejects disallowed project, oversized text, and per-actor quota with no mutation', async () => {
    const disallowed = writeHarness();
    expect(code(await disallowed.invoke('edit_page', { ...EDIT_ARGS, project: 'enwiki' }))).toBe('blast_radius_exceeded');
    const oversize = writeHarness({ maxBytesPerEdit: 4 });
    expect(code(await oversize.invoke('edit_page', EDIT_ARGS))).toBe('blast_radius_exceeded');
    const quota = writeHarness({ maxEditsPerSession: 0 });
    const { result } = await quota.fullFlow('edit_page', EDIT_ARGS);
    expect(code(result)).toBe('blast_radius_exceeded');
    for (const h of [disallowed, oversize]) expect(h.transport.mutations).toHaveLength(0);
  });
});

describe('AC-142 / G4+G12 — kill switch and jti deny-list', () => {
  it('halts at preview, capability issue and execution and revokes a single capability', async () => {
    const halted = writeHarness({ killSwitch: 'engaged' });
    expect(code(await halted.invoke('edit_page', EDIT_ARGS))).toBe('write_halted');
    expect(halted.transport.mutations).toHaveLength(0);
    const ledger = new JtiLedger();
    const caps = new Capabilities('c'.repeat(40), 300, ledger, () => Date.now());
    const claims = {
      actor: { tenant: 't', sub: 's', client_id_hash: 'c' }, tool: 'edit_page',
      target: { source: 'wikipedia:en', namespace: 0, title: 'Sandbox' },
      scope: 'edit', base_revision: 1, content_hash: 'sha256:x', approvals: [],
    };
    const raw = caps.issue(claims);
    const jti = (JSON.parse(Buffer.from(raw.slice(1).split('.')[0]!, 'base64url').toString()) as { jti: string }).jti;
    ledger.deny(jti);
    expect(() => caps.verify(raw, claims)).toThrow();
  });
});

describe('AC-143 / G6 — audit fields on every attempt', () => {
  it('emits all mandated fields and matches the request correlation id', async () => {
    const h = writeHarness();
    const preview = await h.invoke('edit_page', EDIT_ARGS, { correlationId: 'req-123' });
    const event = h.audit.all[0]!;
    expect(canonical(event)).toContain('req-123');
    for (const field of [
      'event_id', 'timestamp', 'actor', 'tool', 'action', 'target', 'base_revision', 'new_revision',
      'diff_hash', 'content_hash', 'confirmation_id', 'capability_id', 'approvals', 'outcome',
      'error_code', 'correlation_id', 'token_id', 'origin', 'prev_hash', 'record_hash',
    ]) expect(event).toHaveProperty(field);
    expect(JSON.stringify(event)).not.toContain(h.token);
    expect((preview.structuredContent as Record<string, unknown>)['audit_event_id']).toBe(event.event_id);
    expect(h.audit.verify()).toBeNull();
  });
});

describe('AC-144 / G6 — tamper evidence and retention', () => {
  it('detects edit, deletion and reordering; retention >= 365 and a daily anchor', () => {
    const config = testWriteConfig();
    const anchored: unknown[] = [];
    const store = new AuditStore(config, () => Date.parse('2026-11-21T17:20:00Z'), (a) => anchored.push(a));
    const base = {
      actor: { issuer: config.issuer, sub_hash: 'x', tenant: 't', client_id_hash: 'y' },
      tool: 'edit_page', action: 'edit', target: { source: 'wikipedia:en', namespace: 0, title: 'Sandbox' },
      base_revision: null, new_revision: null, diff_hash: null, content_hash: null,
      confirmation_id: null, capability_id: null, approvals: [], outcome: 'executed',
      error_code: null, correlation_id: 'r', token_id: 't', origin: 'stdio',
    };
    store.append(base);
    store.append(base);
    expect(store.verify()).toBeNull();
    expect(store.retentionDays).toBeGreaterThanOrEqual(365);
    expect(store.anchorDaily()).not.toBeNull();
    expect(anchored).toHaveLength(1);

    const edited = new AuditStore(config, () => Date.now());
    edited.append(base); edited.append(base);
    edited.mutable[0]!.tool = 'delete_page';
    expect(edited.verify()).toBe(0);

    const deleted = new AuditStore(config, () => Date.now());
    deleted.append(base); deleted.append(base);
    deleted.mutable.splice(1, 1);
    const anchoredHead = deleted.head;
    deleted.mutable.pop();
    expect(deleted.verifyHead(anchoredHead)).toBe(false);

    const reordered = new AuditStore(config, () => Date.now());
    reordered.append(base); reordered.append({ ...base, correlation_id: 'r2' });
    const [first, second] = reordered.mutable;
    reordered.mutable[0] = second!; reordered.mutable[1] = first!;
    expect(reordered.verify()).toBe(0);
  });
});

describe('AC-145 / G11 — two distinct approvers', () => {
  it('blocks self-approval and a single approver for high-impact tools', async () => {
    for (const [tool, args] of [
      ['delete_page', { project: 'testwiki', title: 'Sandbox', reason: 'test', base_revision: 100 }],
      ['protect_page', { project: 'testwiki', title: 'Sandbox', protections: [{ type: 'edit', level: 'sysop', expiry: 'infinite' }], reason: 'test' }],
    ] as const) {
      const h = writeHarness({}, {});
      const result = await h.invoke(tool, args, { approvals: ['approver-a'] });
      expect(code(result)).toBe('approval_required');
      expect(h.transport.mutations).toHaveLength(0);
    }
  });
});

