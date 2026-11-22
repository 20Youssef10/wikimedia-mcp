import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emptyPolitenessSnapshot, PolitenessTelemetry, type PolitenessSnapshot,
} from '../../src/observability/politeness.js';
import {
  parseTelemetrySnapshot, readTelemetrySnapshot, resolveTelemetrySnapshotPath,
  startTelemetrySnapshotWriter, TELEMETRY_PATH_ENV,
} from '../../src/observability/telemetry-transport.js';

function tempDir(): string {
  const base = path.join(process.cwd(), 'reports');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(path.join(base, 'telemetry-fixture-'));
}

function populatedSnapshot(): PolitenessSnapshot {
  const telemetry = new PolitenessTelemetry();
  telemetry.recordUpstreamCall('wikimedia-rest-v1', 200, 1500);
  telemetry.recordUpstreamCall('wikimedia-rest-v1');
  telemetry.recordCacheHit();
  telemetry.recordCacheMiss();
  telemetry.recordConcurrencyReduction();
  telemetry.recordCoalescing(2);
  return telemetry.snapshot();
}

describe('WP19 — child→parent telemetry transport', () => {
  it('resolves the env path only when configured', () => {
    expect(resolveTelemetrySnapshotPath({})).toBeUndefined();
    expect(resolveTelemetrySnapshotPath({ [TELEMETRY_PATH_ENV]: '   ' })).toBeUndefined();
    expect(resolveTelemetrySnapshotPath({ [TELEMETRY_PATH_ENV]: 'reports/x.json' }))
      .toBe(path.resolve(process.cwd(), 'reports/x.json'));
    expect(resolveTelemetrySnapshotPath({ [TELEMETRY_PATH_ENV]: '/tmp/x.json' })).toBe('/tmp/x.json');
  });

  it('round-trips a child snapshot through an atomic file write', () => {
    const dir = tempDir();
    const target = path.join(dir, 'child.json');
    try {
      const source = populatedSnapshot();
      const writer = startTelemetrySnapshotWriter(() => source, { filePath: target, intervalMs: 60000 });
      expect(writer.enabled).toBe(true);
      try {
        expect(writer.writeNow()).toBe(true);
      } finally {
        writer.stop();
      }
      expect(existsSync(target)).toBe(true);
      const text = readFileSync(target, 'utf8');
      expect(text.endsWith('\n')).toBe(true);
      // Atomic rename leaves no half-written temp file behind.
      expect(existsSync(`${target}.${process.pid}.tmp`)).toBe(false);
      const loaded = readTelemetrySnapshot(target);
      expect(loaded.outcome).toBe('loaded');
      expect(loaded.snapshot).toEqual(source);
      expect(loaded.snapshot?.coalesced_waiters).toBe(2);
      expect(loaded.snapshot?.cache_hit_rate).toBeCloseTo(0.5);
      // Counts/ratios only: no token, title, host or secret in the file.
      for (const forbidden of ['Bearer', 'secret', 'Earth', '127.0.0.1', 'https://']) {
        expect(text, `snapshot leaked ${forbidden}`).not.toContain(forbidden);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when no path is configured', () => {
    const writer = startTelemetrySnapshotWriter(() => populatedSnapshot(), { env: {} });
    expect(writer.enabled).toBe(false);
    expect(writer.writeNow()).toBe(false);
    expect(() => writer.stop()).not.toThrow();
  });

  it('refuses to write a snapshot carrying an unsafe label', () => {
    const dir = tempDir();
    const target = path.join(dir, 'leak.json');
    try {
      const poisoned: PolitenessSnapshot = {
        ...emptyPolitenessSnapshot(),
        upstream_calls_by_tool: { 'Bearer secret-for-Earth': 1 },
      };
      const writer = startTelemetrySnapshotWriter(() => poisoned, { filePath: target, intervalMs: 60000 });
      try {
        expect(writer.writeNow()).toBe(false);
      } finally {
        writer.stop();
      }
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates strictly and drops unknown keys when parsing', () => {
    const base = emptyPolitenessSnapshot();
    expect(parseTelemetrySnapshot(base)).toEqual(base);
    expect(parseTelemetrySnapshot(null)).toBeUndefined();
    expect(parseTelemetrySnapshot([])).toBeUndefined();
    expect(parseTelemetrySnapshot({ ...base, cache_hits: -1 })).toBeUndefined();
    expect(parseTelemetrySnapshot({ ...base, upstream_calls_total: Number.NaN })).toBeUndefined();
    expect(parseTelemetrySnapshot({ ...base, cache_hit_rate: 1.5 })).toBeUndefined();
    expect(parseTelemetrySnapshot({ ...base, retry_after: { ...base.retry_after, honored: '1' } })).toBeUndefined();
    expect(parseTelemetrySnapshot({
      ...base,
      upstream_calls_by_tool: { 'get_summary/Earth?token=abc': 1 },
    })).toBeUndefined();
    const withExtra = parseTelemetrySnapshot({ ...base, api_token: 'do-not-export' });
    expect(withExtra).toEqual(base);
    expect(JSON.stringify(withExtra)).not.toContain('do-not-export');
  });

  it('falls back on missing, truncated and malformed snapshots', () => {
    const dir = tempDir();
    try {
      expect(readTelemetrySnapshot(undefined).outcome).toBe('missing');
      expect(readTelemetrySnapshot('').outcome).toBe('missing');
      expect(readTelemetrySnapshot(path.join(dir, 'absent.json')).outcome).toBe('missing');
      const truncated = path.join(dir, 'truncated.json');
      writeFileSync(truncated, '{"upstream_calls_total": 3');
      expect(readTelemetrySnapshot(truncated).outcome).toBe('invalid');
      const wrongShape = path.join(dir, 'wrong.json');
      writeFileSync(wrongShape, '{"cache_hits": 7}');
      const result = readTelemetrySnapshot(wrongShape);
      expect(result.outcome).toBe('invalid');
      expect(result.snapshot).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
