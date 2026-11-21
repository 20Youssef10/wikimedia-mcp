import { describe, expect, it } from 'vitest';
import { validateApprovers } from '../../src/write/approvers.js';
import { hashPrefix } from '../../src/write/auth.js';
import { writeHarness } from './harness.js';

const RAW_A = 'oidc-subject-alpha';
const RAW_B = 'oidc-subject-beta';
const config = { approverIds: [RAW_A, RAW_B], twoPersonApproval: true };
const DELETE_ARGS = { project: 'testwiki', title: 'Sandbox', reason: 'test', base_revision: 100 };

const code = (result: { structuredContent: unknown }): string => {
  const view = result.structuredContent as Record<string, unknown>;
  return ((view['error'] as Record<string, unknown> | undefined)?.['code'] as string) ?? '';
};

describe('WP4 — approver identity helper', () => {
  it('accepts two distinct configured subjects and stores only sha256-prefix hashes', () => {
    const result = validateApprovers({ approvals: [RAW_A, RAW_B], ...config });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approvedIds).toEqual([RAW_A, RAW_B]);
    expect(result.hashedIds).toEqual([hashPrefix(RAW_A), hashPrefix(RAW_B)]);
    for (const hash of result.hashedIds) expect(hash).toMatch(/^sha256-prefix:[0-9a-f]{8}$/);
    expect(JSON.stringify(result.hashedIds)).not.toContain(RAW_A);
    expect(JSON.stringify(result.hashedIds)).not.toContain(RAW_B);
  });

  it('rejects duplicate, missing, unconfigured, self and disabled cases with a reason', () => {
    const cases: Array<[Parameters<typeof validateApprovers>[0], string]> = [
      [{ approvals: [RAW_A, RAW_A], ...config }, 'duplicate'],
      [{ approvals: [RAW_A], ...config }, 'missing'],
      [{ approvals: [RAW_A, 'unconfigured'], ...config }, 'unconfigured'],
      [{ approvals: [RAW_A, RAW_B], ...config, requesterSub: RAW_A }, 'self_approval'],
      [{ approvals: [RAW_A, RAW_B], approverIds: config.approverIds, twoPersonApproval: false }, 'approval_disabled'],
    ];
    for (const [input, reason] of cases) {
      const result = validateApprovers(input);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe(reason);
      expect(result.message.length).toBeGreaterThan(0);
      expect(result).not.toHaveProperty('hashedIds');
    }
  });

  it('fails closed with approval_required on duplicates/unconfigured and emits hashed audit approvals', async () => {
    const good = writeHarness({ approverIds: [RAW_A, RAW_B] });
    const { result } = await good.fullFlow('delete_page', DELETE_ARGS, { approvals: [RAW_A, RAW_B] });
    expect(code(result)).toBe('');
    expect(good.transport.mutations.filter((m) => m.action === 'delete')).toHaveLength(1);
    const auditText = JSON.stringify(good.audit.all);
    expect(auditText).not.toContain(RAW_A);
    expect(auditText).not.toContain(RAW_B);
    expect(auditText).toContain('sha256-prefix:');
    expect(good.audit.verify()).toBeNull();

    for (const approvals of [[RAW_A, RAW_A], [RAW_A, 'unconfigured'], [RAW_A]]) {
      const bad = writeHarness({ approverIds: [RAW_A, RAW_B] });
      const outcome = await bad.invoke('delete_page', DELETE_ARGS, { approvals });
      expect(code(outcome)).toBe('approval_required');
      expect(bad.transport.mutations).toHaveLength(0);
    }
  });

  it('leaves tools that do not require approval unchanged (edit_page ignores approvers)', async () => {
    const h = writeHarness({ approverIds: [RAW_A, RAW_B] });
    const { result } = await h.fullFlow('edit_page', {
      project: 'testwiki', title: 'Sandbox', text: 'new body', summary: 'test',
    }, { approvals: [RAW_A, RAW_A] }); // duplicate approvals would fail for a two-person tool
    expect(code(result)).toBe('');
    expect(h.transport.mutations.filter((m) => m.action === 'edit')).toHaveLength(1);
    const editAudit = JSON.stringify(h.audit.all.find((event) => event.outcome === 'executed'));
    expect(editAudit).toContain('"approvals":[]');
  });
});
