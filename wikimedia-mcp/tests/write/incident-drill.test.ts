import { describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { revokeToken } from '../../src/write/auth.js';
import { canonical } from '../../src/write/audit.js';
import { makeJwt, writeHarness } from './harness.js';

/**
 * G12 drill — executed against the isolated fixture harness only. No real
 * wiki mutation and no live credential is used. Artefact:
 * write-security/incident-revocation-drill.md
 */
describe('AC-142 / G12 — executed incident and revocation drill', () => {
  it('engages kill switch, deny-lists a jti, revokes the issuer token, exports and verifies the audit chain', async () => {
    const timeline: string[] = [];
    const h = writeHarness();
    timeline.push('t0: suspected capability theft declared; owner=on-call');

    // 1. Kill switch engaged immediately.
    const halted = writeHarness({ killSwitch: 'engaged' });
    const stopped = await halted.invoke('edit_page', {
      project: 'testwiki', title: 'Sandbox', text: 'x', summary: 'x',
    });
    const stoppedCode = ((stopped.structuredContent as Record<string, unknown>)['error'] as Record<string, unknown>)['code'];
    expect(stoppedCode).toBe('write_halted');
    timeline.push('t1: MCP_WRITE_KILL_SWITCH=engaged; subsequent write halted with write_halted, zero mutation');

    // 2. Deny-list the capability jti from a preview state.
    const preview = await h.invoke('edit_page', {
      project: 'testwiki', title: 'Sandbox', text: 'x', summary: 'x', dry_run: true,
    });
    const state = (preview.structuredContent as Record<string, unknown>)['requestState'] as string;
    const jti = (JSON.parse(Buffer.from(state.slice(1).split('.')[0]!, 'base64url').toString()) as { jti: string }).jti;
    h.ledger.deny(jti);
    const denied = await h.invoke('edit_page', {
      project: 'testwiki', title: 'Sandbox', text: 'x', summary: 'x', dry_run: true,
    }, { requestState: state, inputResponses: [{ id: 'confirm_write', value: true }] });
    const deniedCode = ((denied.structuredContent as Record<string, unknown>)['error'] as Record<string, unknown>)['code'];
    expect(deniedCode).toBe('confirmation_invalid');
    timeline.push(`t2: jti ${jti.slice(0, 8)}... deny-listed; replay rejected with confirmation_invalid`);

    // 3. Issuer-side revocation via the configured endpoint (fixture fetch).
    const tokenId = `sha256-prefix:${createHash('sha256').update(makeJwt()).digest('hex').slice(0, 8)}`;
    let revoked = false;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === h.config.revocationEndpoint && init?.method === 'POST') {
        revoked = String(init.body ?? '').includes('token_id_hint');
        return new Response('', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };
    expect(await revokeToken(h.config, tokenId, fetchImpl)).toBe(true);
    expect(revoked).toBe(true);
    timeline.push('t3: issuer revocation endpoint called with token id hint; HTTP 200 acknowledged');

    // 4. Export the audit chain and verify tamper detection.
    const exported = h.audit.all.map((event) => ({ ...event }));
    expect(exported.length).toBeGreaterThan(0);
    expect(h.audit.verify()).toBeNull();
    const tampered = exported.map((event) => ({ ...event }));
    tampered[0]!.tool = 'delete_page';
    const broke = tampered.some((event) => {
      const expected = createHmac('sha256', h.config.auditHmacSecret)
        .update(canonical({ ...event, record_hash: null })).digest('hex');
      return expected !== event.record_hash;
    });
    expect(broke).toBe(true);
    timeline.push('t4: audit chain exported, verified intact, then tamper simulation detected a broken record');

    console.log('[G12 drill] ' + timeline.join(' | '));
  });
});
