import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolResponse } from '../../src/types.js';
import { AuditStore, type AuditEventInput } from '../../src/write/audit.js';
import type { WriteToolName } from '../../src/write/constants.js';
import {
  buildHarnessPlan, buildRollbackEvidence, guardExecuteAuthorisation, guardProject,
  HARNESS_LABEL, parseHarnessFlags, runRollbackHarness, writeRollbackEvidence,
  type HarnessInvocation,
} from '../../src/cli/rollback-harness.js';
import { testWriteConfig, writeHarness } from '../write/harness.js';

const AUDIT_BASE: AuditEventInput = {
  actor: { issuer: 'https://issuer.example', sub_hash: 'x', tenant: 't', client_id_hash: 'y' },
  tool: 'edit_page', action: 'edit', target: { source: 'wikipedia:en', namespace: 0, title: 'Sandbox' },
  base_revision: null, new_revision: null, diff_hash: null, content_hash: null,
  confirmation_id: null, capability_id: null, approvals: [], outcome: 'executed',
  error_code: null, correlation_id: 'r', token_id: 't', origin: 'stdio',
};

type Call = { tool: WriteToolName; args: Record<string, unknown>; invocation: HarnessInvocation };

let dir: string;
beforeEach(() => { dir = mkdtempSync('/tmp/opencode/wmcp-rollback-'); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function fixtureInvoker(calls: Call[], executed = false) {
  return async (tool: WriteToolName, args: Record<string, unknown>, invocation: HarnessInvocation): Promise<ToolResponse> => {
    calls.push({ tool, args, invocation });
    const structured = invocation.requestState === undefined
      ? { resultType: 'input_required', requestState: '~signed-state' }
      : { resultType: 'complete', executed, would_change: true };
    return { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured };
  };
}

function chainDeps() {
  const store = new AuditStore(testWriteConfig(), () => Date.parse('2026-11-21T00:00:00Z'));
  store.append(AUDIT_BASE);
  const anchor = store.anchorDaily()!;
  return {
    exportChain: () => store.export(),
    verifyChain: () => store.verify() === null && store.verifyHead(anchor.head),
  };
}

describe('WP5 — testwiki rollback recording harness', () => {
  it('dry-run makes no mutating call and returns executed:false, would_change:true', async () => {
    const calls: Call[] = [];
    const evidence = await runRollbackHarness(
      { project: 'testwiki', tool: 'edit_page', args: { title: 'Sandbox' }, mode: 'dry-run' },
      { invoke: fixtureInvoker(calls, false), ...chainDeps() },
    );
    expect(calls.length).toBe(2); // preview + confirmation; no transport mutation
    expect(calls.every((call) => call.args['dry_run'] === true)).toBe(true);
    expect(evidence.executed).toBe(false);
    expect(evidence.would_change).toBe(true);
    expect(evidence.preview_result_type).toBe('input_required');
    expect(evidence.project).toBe('testwiki');
    expect(evidence.harness).toBe(HARNESS_LABEL);
  });

  it('rejects a non-testwiki project and a missing sign-off before any call', async () => {
    const calls: Call[] = [];
    const deps = { invoke: fixtureInvoker(calls, true), ...chainDeps() };
    await expect(runRollbackHarness(
      { project: 'enwiki', tool: 'edit_page', args: {}, mode: 'dry-run' }, deps,
    )).rejects.toThrow(/testwiki/);
    expect(calls).toHaveLength(0);
    expect(() => guardProject('commonswiki')).toThrow(/testwiki/);

    await expect(runRollbackHarness(
      { project: 'testwiki', tool: 'edit_page', args: {}, mode: 'execute' }, deps,
    )).rejects.toThrow(/i-have-signoff/);
    expect(calls).toHaveLength(0);
    expect(() => guardExecuteAuthorisation({ project: 'testwiki', tool: 'edit_page', args: {}, mode: 'execute' })).toThrow();
  });

  it('CLI plan exits non-zero without --i-have-signoff and defaults to dry-run', () => {
    expect(() => buildHarnessPlan(parseHarnessFlags(['--project', 'enwiki']))).toThrow(/testwiki/);
    expect(() => buildHarnessPlan(parseHarnessFlags(['--project', 'testwiki', '--execute']))).toThrow(/i-have-signoff/);
    const plan = buildHarnessPlan(parseHarnessFlags(['--project', 'testwiki', '--tool', 'edit_page']));
    expect(plan.mode).toBe('dry-run');
    expect(plan.executed).toBe(false);
    expect(plan.chain_export).toContain('NOT EVIDENCED');
    expect(HARNESS_LABEL).toContain('NO REAL WIKI WRITE');
  });

  it('evidence contains exported events + anchors, chain verified, and licence fail-closed', async () => {
    const calls: Call[] = [];
    const evidence = await runRollbackHarness(
      { project: 'testwiki', tool: 'edit_page', args: {}, mode: 'dry-run' },
      { invoke: fixtureInvoker(calls, false), ...chainDeps() },
    );
    expect(typeof evidence.chain).toBe('object');
    if (typeof evidence.chain === 'string') throw new Error('chain not exported');
    expect(evidence.chain.events.length).toBeGreaterThan(0);
    expect(evidence.chain.anchors.length).toBeGreaterThan(0);
    expect(evidence.chain_verified).toBe(true);
    expect(evidence.fail_closed_checks.testwiki_only).toBe(true);

    const upload = buildRollbackEvidence({
      request: { project: 'testwiki', tool: 'upload_file', args: {}, mode: 'execute', operatorRef: 'role:Operator', witnessRef: 'role:Witness', iHaveSignoff: true },
      preview: null, result: null, chain: 'NOT EVIDENCED', chainVerified: false, licenceSignedOff: false,
    });
    expect(upload.fail_closed_checks.upload_licence_not_signed_off).toBe(true);

    // The underlying upload handler still fails closed without a G8 sign-off record.
    const h = writeHarness();
    const { result: outcome } = await h.fullFlow('upload_file', {
      project: 'testwiki', filename: 'Example.png', mime: 'image/png',
      content_base64: Buffer.from('png').toString('base64'), license: 'CC0-1.0', attribution: 'x',
      author: 'x', source_url: 'https://example.org', description: 'd', summary: 's',
    });
    expect(((outcome.structuredContent as Record<string, unknown>)['error'] as Record<string, unknown>)?.['code']).toBe('licence_not_signed_off');
    expect(h.transport.mutations).toHaveLength(0);
  });

  it('writes pretty, newline-terminated evidence artefacts', () => {
    const evidence = buildRollbackEvidence({
      request: { project: 'testwiki', tool: 'edit_page', args: {}, mode: 'dry-run' },
      preview: null, result: null, chain: 'NOT EVIDENCED', chainVerified: false, licenceSignedOff: true,
    });
    const out = writeRollbackEvidence(evidence, join(dir, 'evidence', 'rollback-plan.json'));
    const text = readFileSync(out, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ schema_version: 1, project: 'testwiki', executed: false });
  });
});
