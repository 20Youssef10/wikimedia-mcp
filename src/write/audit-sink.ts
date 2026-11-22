import { appendFileSync } from 'node:fs';
import path from 'node:path';
import type { AuditAnchor, AuditEvent } from './audit.js';

/**
 * WP3 — pluggable WORM anchoring adapter (handoff/WORM-AUDIT-SPEC.md §3-§7).
 * Anchors carry only `{date, head, anchored_at}` and an optional chain export;
 * they NEVER carry the HMAC secret, bearer token, raw subject or capability.
 * Sinks are opt-in; the default remains `local-noop` (in-process, no external
 * endpoint). External sinks are inert unless an operator injects a transport
 * or URL — this module makes no network call on its own and adds no paid
 * dependency (Node built-ins and `undici` only).
 */

export const ANCHOR_SINK_KINDS = ['local-noop', 'append-only-log', 's3-object-lock', 'webhook'] as const;
export type AnchorSinkKind = (typeof ANCHOR_SINK_KINDS)[number];

export type AnchorEnvelope = {
  schema_version: 1;
  sink: AnchorSinkKind;
  anchor: AuditAnchor;
  head_verified: boolean;
  /** Present only when the caller exports events for this anchor. */
  events?: readonly AuditEvent[];
};

export type AnchorSink = {
  readonly kind: AnchorSinkKind;
  /** Synchronous so the existing AuditStore.anchorDaily() contract is unchanged. */
  write(envelope: AnchorEnvelope): void;
};

export type AnchorSinkOptions = {
  /** append-only-log: destination file (NDJSON). */
  filePath?: string;
  /** s3-object-lock: object key builder; inject a real SDK-backed writer in deployment. */
  putObject?: (key: string, body: string) => void;
  keyPrefix?: string;
  /** webhook: destination URL and injectable POST (undici-compatible). */
  url?: string;
  post?: (url: string, body: string) => void;
};

function serialise(envelope: AnchorEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function localNoop(): AnchorSink {
  return { kind: 'local-noop', write: () => {} };
}

function appendOnlyLog(options: AnchorSinkOptions): AnchorSink {
  const filePath = options.filePath;
  if (filePath === undefined || filePath.trim().length === 0) {
    throw new Error('audit-sink: append-only-log requires filePath');
  }
  return {
    kind: 'append-only-log',
    write: (envelope) => {
      // One compact JSON line per anchor; an append-only file is the local WORM fallback.
      appendFileSync(path.resolve(filePath), `${JSON.stringify(envelope)}\n`, 'utf8');
    },
  };
}

function objectLock(options: AnchorSinkOptions): AnchorSink {
  if (typeof options.putObject !== 'function') {
    // Fail closed: an operator who selects this sink must inject a real writer.
    throw new Error('audit-sink: s3-object-lock requires an injected putObject transport');
  }
  const prefix = options.keyPrefix ?? 'audit/anchors';
  const putObject = options.putObject;
  return {
    kind: 's3-object-lock',
    write: (envelope) => {
      const key = `${prefix}/${envelope.anchor.date}.json`;
      putObject(key, serialise(envelope));
    },
  };
}

function webhook(options: AnchorSinkOptions): AnchorSink {
  if (typeof options.post !== 'function' || typeof options.url !== 'string' || options.url.length === 0) {
    throw new Error('audit-sink: webhook requires url and an injected post transport');
  }
  const post = options.post;
  const url = options.url;
  return {
    kind: 'webhook',
    write: (envelope) => { post(url, serialise(envelope)); },
  };
}

/** Factory used by the default runtime; no transport is contacted here. */
export function createAnchorSink(kind: AnchorSinkKind, options: AnchorSinkOptions = {}): AnchorSink {
  switch (kind) {
    case 'local-noop': return localNoop();
    case 'append-only-log': return appendOnlyLog(options);
    case 's3-object-lock': return objectLock(options);
    case 'webhook': return webhook(options);
    default: throw new Error(`audit-sink: unknown sink kind ${String(kind)}`);
  }
}

/** Map an existing config value to a sink kind; no new config key is introduced. */
export function sinkKindFromConfig(auditSink: string): AnchorSinkKind {
  const known = (ANCHOR_SINK_KINDS as readonly string[]);
  return known.includes(auditSink) ? (auditSink as AnchorSinkKind) : 'local-noop';
}
