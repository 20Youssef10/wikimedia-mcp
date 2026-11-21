import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * WP2 — append-only, tamper-evident decision record chain. This is a RECORD
 * of a human decision, not a signature: tamper-evidence is provided by a
 * fixed-domain HMAC constant, never by a real signer key. No personal name,
 * date or approval is fabricated. `records decisions, does not sign`.
 */

export const RECORD_CHAIN_LABEL = 'RECORDS DECISIONS — DOES NOT SIGN';

/** Deliberately not a secret: this chain detects accidental edits, it does not sign. */
export const RECORD_CHAIN_DOMAIN = 'wikimedia-mcp/gate-record-chain/v1';

export const DECISIONS = ['APPROVE_WITH_CONDITIONS', 'REJECT', 'ABSTAIN', 'NOTED'] as const;
export type Decision = (typeof DECISIONS)[number];

export const GATE_IDS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12'] as const;
export type GateId = (typeof GATE_IDS)[number];

export type GateDecisionInput = {
  role: string;
  decision: Decision;
  evidenceHash: string;
  gateId: GateId;
  /** Role reference such as `role:Security Architect`; never a personal name. */
  signatoryRef?: string;
  recordedAt?: string;
};

export type RecordEntry = {
  seq: number;
  prev_hash: string;
  record_hash: string;
  role: string;
  decision: Decision;
  evidence_hash: string;
  gate_id: GateId;
  signatory_ref: string;
  recorded_at: string;
};

export type RecordChain = {
  schema_version: 1;
  label: typeof RECORD_CHAIN_LABEL;
  head: string;
  records: RecordEntry[];
};

function hmac(value: string): string {
  return createHmac('sha256', RECORD_CHAIN_DOMAIN).update(value).digest('hex');
}

/**
 * Canonical JSON: sorted keys, arrays preserved, undefined omitted. Mirrors
 * the AuditStore canonical form so tamper detection is deterministic.
 */
export function canonicalRecord(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalRecord).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalRecord(entry)}`).join(',')}}`;
}

export function emptyChain(): RecordChain {
  return { schema_version: 1, label: RECORD_CHAIN_LABEL, head: 'genesis', records: [] };
}

export function isDecision(value: unknown): value is Decision {
  return typeof value === 'string' && (DECISIONS as readonly string[]).includes(value);
}

export function isGateId(value: unknown): value is GateId {
  return typeof value === 'string' && (GATE_IDS as readonly string[]).includes(value);
}

export function isValidEvidenceHash(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

/** Role-title reference only. Personal names and free-form signatures are rejected. */
export function isValidSignatoryRef(value: unknown): value is string {
  return typeof value === 'string'
    && /^role:[A-Za-z][A-Za-z /-]{1,60}$/.test(value)
    && !/\d{4}-\d{2}-\d{2}/.test(value);
}

export type AppendResult = { chain: RecordChain; entry: RecordEntry };

/** Append exactly one record. Rejects malformed input before touching the chain. */
export function appendRecord(chain: RecordChain, input: GateDecisionInput): AppendResult {
  if (input.role.trim().length === 0) throw new Error('record: role is required');
  if (!isDecision(input.decision)) throw new Error(`record: unsupported decision ${String(input.decision)}`);
  if (!isGateId(input.gateId)) throw new Error(`record: unsupported gate ${String(input.gateId)}`);
  if (!isValidEvidenceHash(input.evidenceHash)) throw new Error('record: evidence must be a sha256:<64 hex> hash');
  const signatoryRef = input.signatoryRef ?? `role:${input.role}`;
  if (!isValidSignatoryRef(signatoryRef)) {
    throw new Error('record: signatory ref must be a role reference (role:...) with no personal name or date');
  }
  const prev = chain.records.at(-1);
  const seq = chain.records.length + 1;
  const base: Omit<RecordEntry, 'record_hash'> = {
    seq,
    prev_hash: prev?.record_hash ?? 'genesis',
    role: input.role,
    decision: input.decision,
    evidence_hash: input.evidenceHash,
    gate_id: input.gateId,
    signatory_ref: signatoryRef,
    recorded_at: input.recordedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  const recordHash = hmac(canonicalRecord({ ...base, record_hash: null }));
  const entry: RecordEntry = { ...base, record_hash: recordHash };
  const next: RecordChain = {
    ...chain,
    head: recordHash,
    records: [...chain.records, entry],
  };
  return { chain: next, entry };
}

/**
 * Verify an intact chain. Returns `null` when intact, or the index of the
 * first broken record. The stored `head` also detects tail truncation.
 */
export function verifyChain(chain: RecordChain): number | null {
  let prev = 'genesis';
  for (let index = 0; index < chain.records.length; index += 1) {
    const record = chain.records[index]!;
    if (record.prev_hash !== prev) return index;
    const expected = hmac(canonicalRecord({ ...record, record_hash: null }));
    if (expected !== record.record_hash) return index;
    prev = record.record_hash;
  }
  if (chain.head !== prev) return chain.records.length;
  return null;
}

/** Read a chain from disk; an absent/invalid file yields an empty chain. */
export function readRecordChain(filePath: string): RecordChain {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as RecordChain;
    if (parsed?.schema_version !== 1 || !Array.isArray(parsed.records) || typeof parsed.head !== 'string') {
      return emptyChain();
    }
    return parsed;
  } catch {
    return emptyChain();
  }
}

/** Pretty, newline-terminated JSON (same convention as nightly reports). */
export function serialiseChain(chain: RecordChain): string {
  return `${JSON.stringify(chain, null, 2)}\n`;
}
