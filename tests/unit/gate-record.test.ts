import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildGateStatus } from '../../src/cli/gate-status.js';
import {
  parseRecordFlags, recordFromFlags, recordGateDecision,
} from '../../src/cli/gate-record.js';
import {
  appendRecord, emptyChain, isGateId, readRecordChain, RECORD_CHAIN_LABEL,
  serialiseChain, verifyChain, type RecordChain,
} from '../../src/cli/record-chain.js';
import { hasGenuineSignedRecord, loadWriteConfig } from '../../src/write/config.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const INPUT = {
  role: 'Security Architect',
  decision: 'APPROVE_WITH_CONDITIONS' as const,
  evidenceHash: HASH_A,
  gateId: 'G6' as const,
  recordedAt: '2026-11-21T00:00:00Z',
};

let dir: string;
beforeEach(() => { dir = mkdtempSync('/tmp/opencode/wmcp-gate-record-'); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function chainWithTwo(): RecordChain {
  const first = appendRecord(emptyChain(), INPUT);
  return appendRecord(first.chain, { ...INPUT, gateId: 'G11', evidenceHash: HASH_B }).chain;
}

describe('WP2 — structured sign-off recorder', () => {
  it('appends records with a valid prev_hash/record_hash chain and an intact verify()', () => {
    const first = appendRecord(emptyChain(), INPUT);
    expect(first.entry.prev_hash).toBe('genesis');
    expect(first.entry.record_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.entry.signatory_ref).toBe('role:Security Architect');
    expect(verifyChain(first.chain)).toBeNull();
    const second = appendRecord(first.chain, { ...INPUT, gateId: 'G11', evidenceHash: HASH_B });
    expect(second.entry.prev_hash).toBe(first.entry.record_hash);
    expect(verifyChain(second.chain)).toBeNull();
    expect(second.chain.head).toBe(second.entry.record_hash);
  });

  it('verify() finds the first broken index for edit, deletion, reorder and truncation', () => {
    const intact = chainWithTwo();
    expect(verifyChain(intact)).toBeNull();

    const edited: RecordChain = structuredClone(intact);
    edited.records[0]!.role = 'Backend Lead';
    expect(verifyChain(edited)).toBe(0);

    const deleted: RecordChain = structuredClone(intact);
    deleted.records.splice(1, 1);
    expect(verifyChain(deleted)).toBe(1); // prev_hash break at the former second record

    const reordered: RecordChain = structuredClone(intact);
    reordered.records.reverse();
    expect(verifyChain(reordered)).toBe(0);

    const truncated: RecordChain = structuredClone(intact);
    truncated.records.pop();
    expect(verifyChain(truncated)).toBe(1); // stored head no longer matches
  });

  it('writes one record per invocation, with label, and reads it back for gate status', () => {
    const filePath = join(dir, 'records', 'gate-decisions.json');
    const result = recordGateDecision({ ...INPUT, filePath, baseDir: dir });
    expect(result.label).toBe(RECORD_CHAIN_LABEL);
    expect(result.chainIntact).toBe(true);
    expect(result.entry.seq).toBe(1);
    const text = readFileSync(filePath, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain(RECORD_CHAIN_LABEL);
    expect(text).toContain(INPUT.recordedAt);
    expect(text).toContain('role:Security Architect');
    expect(text).not.toMatch(/APPROVED|Ada Lovelace|Grace Hopper/);

    const chain = readRecordChain(filePath);
    expect(verifyChain(chain)).toBeNull();
    const report = buildGateStatus({ baseDir: dir, recordedGates: new Set(chain.records.map((r) => r.gate_id)) });
    expect(report.gates.find((gate) => gate.id === 'G6')!.status).toBe('RECORDED (not signed)');
    expect(report.gates.every((gate) => !gate.signed)).toBe(true);
    expect(serialiseChain(chain)).toBe(text);
  });

  it('parses `gate record` flags and always exposes the records-not-signs label', () => {
    const flags = parseRecordFlags([
      '--role', 'Product Owner', '--decision', 'NOTED', '--evidence', HASH_A, '--gate', 'G8',
    ]);
    const args = recordFromFlags(flags);
    expect(args.gateId).toBe('G8');
    expect(args.decision).toBe('NOTED');
    expect(() => recordFromFlags(parseRecordFlags(['--role', 'x']))).toThrow();
    expect(() => recordGateDecision({ ...INPUT, evidenceHash: 'not-a-hash', filePath: join(dir, 'x.json'), baseDir: dir })).toThrow();
    expect(RECORD_CHAIN_LABEL).toContain('DOES NOT SIGN');
    expect(isGateId('G6')).toBe(true);
    expect(isGateId('G99')).toBe(false);
  });

  it('does not let recorded decisions satisfy the boot gate (no signature bypass)', () => {
    const env = {
      MCP_WRITES_ENABLED: 'true', MCP_WRITE_GATES_SIGNED: 'true',
      MCP_WRITE_KILL_SWITCH: 'engaged',
      MCP_WRITE_OAUTH_ISSUER: 'https://issuer.example', MCP_WRITE_OAUTH_AUDIENCE: 'aud',
      MCP_WRITE_OAUTH_CIMD_URL: 'https://issuer.example/cimd', MCP_WRITE_OAUTH_CLIENT_ID: 'client',
      MCP_WRITE_OAUTH_TOKEN_ENDPOINT: 'https://issuer.example/token', MCP_WRITE_OAUTH_SCOPES: 'edit',
      MCP_WRITE_TOKEN_STORE: 'store', MCP_WRITE_TOKEN_REVOCATION_ENDPOINT: 'https://issuer.example/revoke',
      MCP_MRTR_SECRET: 'm'.repeat(40), MCP_CAPABILITY_SECRET: 'c'.repeat(40),
      MCP_WRITE_ALLOWED_PROJECTS: 'testwiki', MCP_WRITE_AUDIT_SINK: 'memory:test',
      MCP_WRITE_AUDIT_HMAC_SECRET: 'a'.repeat(40), MCP_WRITE_APPROVER_IDS: 'a,b',
      MCP_UPLOAD_TOU_SIGNED_BY: 'x', MCP_REQUIRE_ORIGIN: 'true', MCP_REQUIRE_CSRF: 'true',
      MCP_ALLOWED_ORIGINS: 'https://console.example', MCP_ALLOWED_HOSTS: '127.0.0.1',
      MCP_CSRF_SECRET: 's'.repeat(24),
    };
    // Existence of a record file is NOT a genuine signature.
    expect(() => loadWriteConfig(env, { signoffPresent: () => true, genuineSignedRecord: () => false })).toThrow(/signed gate record/);
    expect(hasGenuineSignedRecord('ignored', () => 'Signature: ____________\nDecision: ____________')).toBe(false);
    expect(hasGenuineSignedRecord('ignored', () => 'Signature: Ada Lovelace\n')).toBe(true);
  });
});
