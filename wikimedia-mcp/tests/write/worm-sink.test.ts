import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditStore, type AuditEventInput } from '../../src/write/audit.js';
import {
  createAnchorSink, sinkKindFromConfig, type AnchorEnvelope, type AnchorSink,
} from '../../src/write/audit-sink.js';
import { testWriteConfig } from './harness.js';

const SECRET = 'audit-secret-that-is-at-least-32-characters';

const BASE: AuditEventInput = {
  actor: { issuer: 'https://issuer.example', sub_hash: 'x', tenant: 't', client_id_hash: 'y' },
  tool: 'edit_page', action: 'edit', target: { source: 'wikipedia:en', namespace: 0, title: 'Sandbox' },
  base_revision: null, new_revision: null, diff_hash: null, content_hash: null,
  confirmation_id: null, capability_id: null, approvals: [], outcome: 'executed',
  error_code: null, correlation_id: 'r', token_id: 't', origin: 'stdio',
};

let dir: string;
beforeEach(() => { dir = mkdtempSync('/tmp/opencode/wmcp-worm-sink-'); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function storeWith(sink: AnchorSink, config = testWriteConfig()): AuditStore {
  const store = new AuditStore(config, () => Date.parse('2026-11-21T12:00:00Z'), () => {}, sink);
  store.append(BASE);
  store.append({ ...BASE, correlation_id: 'r2' });
  return store;
}

function assertNoSecret(payload: string, secret: string): void {
  expect(payload).not.toContain(secret);
  expect(payload).not.toMatch(/bearer|access[_-]?token/i);
}

describe('WP3 — WORM anchoring adapter', () => {
  it('append-only-log sink: anchor written, head verified, no HMAC secret in payload', () => {
    const filePath = join(dir, 'anchors.ndjson');
    const store = storeWith(createAnchorSink('append-only-log', { filePath }));
    const anchor = store.anchorDaily()!;
    expect(store.verifyHead(anchor.head)).toBe(true);
    const line = readFileSync(filePath, 'utf8').trim();
    const envelope = JSON.parse(line) as AnchorEnvelope;
    expect(envelope.sink).toBe('append-only-log');
    expect(envelope.anchor.head).toBe(anchor.head);
    expect(envelope.head_verified).toBe(true);
    assertNoSecret(line, SECRET);
  });

  it('s3-object-lock sink: injected writer receives a keyed JSON anchor with no secret', () => {
    const captured: Array<{ key: string; body: string }> = [];
    const store = storeWith(createAnchorSink('s3-object-lock', {
      keyPrefix: 'audit/anchors',
      putObject: (key, body) => { captured.push({ key, body }); },
    }));
    const anchor = store.anchorDaily()!;
    expect(store.verifyHead(anchor.head)).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.key).toBe(`audit/anchors/${anchor.date}.json`);
    const envelope = JSON.parse(captured[0]!.body) as AnchorEnvelope;
    expect(envelope.head_verified).toBe(true);
    assertNoSecret(captured[0]!.body, SECRET);
  });

  it('webhook sink: injected POST receives a JSON anchor with no secret', () => {
    const captured: Array<{ url: string; body: string }> = [];
    const store = storeWith(createAnchorSink('webhook', {
      url: 'https://logs.example/anchors',
      post: (url, body) => { captured.push({ url, body }); },
    }));
    const anchor = store.anchorDaily()!;
    expect(store.verifyHead(anchor.head)).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe('https://logs.example/anchors');
    const envelope = JSON.parse(captured[0]!.body) as AnchorEnvelope;
    expect(envelope.sink).toBe('webhook');
    expect(envelope.head_verified).toBe(true);
    assertNoSecret(captured[0]!.body, SECRET);
  });

  it('export() emits events + anchors and refuses a broken chain or head mismatch', () => {
    const store = storeWith(createAnchorSink('local-noop'));
    const anchor = store.anchorDaily()!;
    const exported = store.export();
    expect(exported.schema_version).toBe(1);
    expect(exported.events).toHaveLength(2);
    expect(exported.anchors.map((a) => a.head)).toContain(anchor.head);
    expect(exported.head).toBe(store.head);
    expect(exported.exported_at.endsWith('Z')).toBe(true);
    assertNoSecret(JSON.stringify(exported), SECRET);

    const broken = storeWith(createAnchorSink('local-noop'));
    broken.anchorDaily();
    broken.mutable[0]!.tool = 'delete_page';
    expect(() => broken.export()).toThrow(/chain broken|refusing to export/);
    expect(() => broken.anchorDaily()).toThrow(/chain broken/);

    const advanced = storeWith(createAnchorSink('local-noop'));
    advanced.anchorDaily();
    advanced.append(BASE); // head moved past the last anchor
    expect(() => advanced.export()).toThrow(/head mismatch/);
  });

  it('default behaviour stays in-process with a no-op sink and a memory identifier', () => {
    const config = testWriteConfig();
    expect(sinkKindFromConfig(config.auditSink)).toBe('local-noop');
    expect(sinkKindFromConfig('s3-object-lock')).toBe('s3-object-lock');
    const store = new AuditStore(config);
    store.append(BASE);
    expect(store.anchorDaily()).not.toBeNull();
    expect(store.export().events).toHaveLength(1);
    expect(store.retentionDays).toBeGreaterThanOrEqual(365);
    // External sinks fail closed without a transport; no network call is made.
    expect(() => createAnchorSink('s3-object-lock')).toThrow(/putObject/);
    expect(() => createAnchorSink('webhook', { url: 'https://logs.example' })).toThrow(/post/);
    expect(() => createAnchorSink('unknown' as never)).toThrow();
  });
});
