import { createHash } from 'node:crypto';
import {
  RECENT_CHANGES_CURSOR_GRACE_MS,
  RECENT_CHANGES_MAX_HOPS,
} from './constants.js';
import { throwGroupD } from './errors.js';

export type CursorPayload = {
  v: 1;
  end: string;
  rc: string;
  h: number;
  q: string;
};

/**
 * Filter/window hash: first 16 hex chars of SHA-256 over the canonical JSON of
 * {source, namespace, applied_limit, requested_seconds, include_bots, change_types}.
 * Keys are sorted; absent change_types is represented as null. This is a
 * correctness guard against filter mixing, not a security boundary.
 */
export function queryHash(query: {
  source: string;
  namespace: number;
  applied_limit: number;
  requested_seconds: number;
  include_bots: boolean;
  change_types: readonly string[] | null;
}): string {
  const canonical = JSON.stringify({
    applied_limit: query.applied_limit,
    change_types: query.change_types,
    include_bots: query.include_bots,
    namespace: query.namespace,
    requested_seconds: query.requested_seconds,
    source: query.source,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function encodeCursor(payload: CursorPayload): string {
  return `~${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Decode + fully validate a cursor BEFORE any outbound request. */
export function decodeCursor(
  raw: string,
  context: { now: number; requested_seconds: number; expected_q: string },
): CursorPayload {
  if (raw.length < 2 || raw.length > 512 || !raw.startsWith('~')) {
    throwGroupD('invalid_cursor', 'The continuation cursor is malformed.', { details: { reason: 'format' } });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.slice(1), 'base64url').toString('utf8'));
  } catch {
    throwGroupD('invalid_cursor', 'The continuation cursor is malformed.', { details: { reason: 'parse' } });
  }
  if (!isPlainObject(parsed)) {
    throwGroupD('invalid_cursor', 'The continuation cursor is malformed.', { details: { reason: 'shape' } });
  }
  const { v, end, rc, h, q } = parsed;
  if (v !== 1 || typeof end !== 'string' || typeof rc !== 'string' || rc.length === 0 || rc.length > 512
      || typeof h !== 'number' || !Number.isInteger(h) || typeof q !== 'string' || !/^[0-9a-f]{16}$/.test(q)) {
    throwGroupD('invalid_cursor', 'The continuation cursor has an unsupported version or payload.', {
      details: { reason: 'fields' },
    });
  }
  const endMs = Date.parse(end);
  if (!Number.isFinite(endMs) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(end)) {
    throwGroupD('invalid_cursor', 'The continuation cursor has an invalid frozen window end.', {
      details: { reason: 'end' },
    });
  }
  if (h < 1 || h > RECENT_CHANGES_MAX_HOPS) {
    throwGroupD('invalid_cursor', 'The continuation cursor exceeds the hop limit.', {
      details: { reason: 'hops', hops: h, max_hops: RECENT_CHANGES_MAX_HOPS },
    });
  }
  if (context.now - endMs > context.requested_seconds * 1000 + RECENT_CHANGES_CURSOR_GRACE_MS) {
    throwGroupD('invalid_cursor', 'The continuation cursor has expired.', { details: { reason: 'expired' } });
  }
  if (q !== context.expected_q) {
    throwGroupD('invalid_cursor', 'The continuation cursor does not match the supplied filters.', {
      details: { reason: 'filter_mismatch' },
    });
  }
  return { v: 1, end, rc, h, q };
}
