import { createHmac, randomUUID } from 'node:crypto';
import type { WriteConfig } from './config.js';
import { AUDIT_OUTCOMES } from './constants.js';

export type AuditActor = {
  issuer: string;
  sub_hash: string;
  tenant: string;
  client_id_hash: string;
};

export type AuditEvent = {
  event_id: string;
  timestamp: string;
  actor: AuditActor;
  tool: string;
  action: string;
  target: { source: string; namespace: number | null; title: string };
  base_revision: number | null;
  new_revision: number | null;
  diff_hash: string | null;
  content_hash: string | null;
  confirmation_id: string | null;
  capability_id: string | null;
  approvals: string[];
  outcome: string;
  error_code: string | null;
  correlation_id: string;
  token_id: string;
  origin: string;
  prev_hash: string;
  record_hash: string;
};

/** Fields that must be present on every event; `null` when inapplicable. */
export const MANDATED_AUDIT_FIELDS = [
  'event_id', 'timestamp', 'actor', 'tool', 'action', 'target', 'base_revision',
  'new_revision', 'diff_hash', 'content_hash', 'confirmation_id', 'capability_id',
  'approvals', 'outcome', 'error_code', 'correlation_id', 'token_id', 'origin',
  'prev_hash', 'record_hash',
] as const;

export type AuditEventInput = Omit<AuditEvent, 'event_id' | 'timestamp' | 'prev_hash' | 'record_hash'> & {
  event_id?: string;
  timestamp?: string;
};

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export type AuditAnchor = { date: string; head: string; anchored_at: string };

/**
 * Append-only, tamper-evident HMAC hash chain. Records are never mutated in
 * place; verification detects alteration, deletion and reordering. The daily
 * anchor models the external WORM sink (injected in production deployment).
 */
export class AuditStore {
  private readonly records: AuditEvent[] = [];
  readonly anchors: AuditAnchor[] = [];

  constructor(
    private readonly config: Pick<WriteConfig, 'auditHmacSecret' | 'auditRetentionDays'>,
    private readonly clock: () => number = Date.now,
    private readonly anchorSink: (anchor: AuditAnchor) => void = () => {},
  ) {}

  append(input: AuditEventInput): AuditEvent {
    if (!AUDIT_OUTCOMES.has(input.outcome as never)) throw new Error(`invalid audit outcome ${input.outcome}`);
    const prev = this.records.at(-1);
    const partial: AuditEvent = {
      event_id: input.event_id ?? randomUUID(),
      timestamp: input.timestamp ?? new Date(this.clock()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      actor: input.actor,
      tool: input.tool,
      action: input.action,
      target: input.target,
      base_revision: input.base_revision,
      new_revision: input.new_revision,
      diff_hash: input.diff_hash,
      content_hash: input.content_hash,
      confirmation_id: input.confirmation_id,
      capability_id: input.capability_id,
      approvals: [...input.approvals],
      outcome: input.outcome,
      error_code: input.error_code,
      correlation_id: input.correlation_id,
      token_id: input.token_id,
      origin: input.origin,
      prev_hash: prev?.record_hash ?? 'genesis',
      record_hash: '',
    };
    const recordHash = hmac(this.config.auditHmacSecret, canonical({ ...partial, record_hash: null }));
    const record: AuditEvent = { ...partial, record_hash: recordHash };
    this.records.push(record);
    return record;
  }

  /** Verify chain integrity; returns the first broken index or null. */
  verify(): number | null {
    let prev = 'genesis';
    for (let index = 0; index < this.records.length; index += 1) {
      const record = this.records[index]!;
      if (record.prev_hash !== prev) return index;
      const expected = hmac(this.config.auditHmacSecret, canonical({ ...record, record_hash: null }));
      if (expected !== record.record_hash) return index;
      prev = record.record_hash;
    }
    return null;
  }

  /** Detect deletion/truncation by comparing the current head with an anchored head. */
  verifyHead(expectedHead: string): boolean { return this.head === expectedHead; }

  /** Daily WORM anchor — called once per UTC day by the deployment scheduler. */
  anchorDaily(now = this.clock()): AuditAnchor | null {
    const last = this.records.at(-1);
    if (last === undefined) return null;
    const date = new Date(now).toISOString().slice(0, 10);
    if (this.anchors.some((entry) => entry.date === date)) return null;
    const anchor: AuditAnchor = {
      date,
      head: last.record_hash,
      anchored_at: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    this.anchors.push(anchor);
    this.anchorSink(anchor);
    return anchor;
  }

  get retentionDays(): number { return this.config.auditRetentionDays; }
  get all(): readonly AuditEvent[] { return this.records; }
  /** Test-only view used by integrity-negative tests; production never mutates. */
  get mutable(): AuditEvent[] { return this.records; }
  get head(): string { return this.records.at(-1)?.record_hash ?? 'genesis'; }
}
