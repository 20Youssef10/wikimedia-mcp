import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeMetrics, toolClass, type Observation,
} from '../../src/observability/live-gate.js';
import {
  buildNightlyReport, writeNightlyReport, type NightlyReport,
} from '../../src/observability/nightly-report.js';
import {
  PolitenessTelemetry, emptyPolitenessSnapshot, type PolitenessSnapshot,
} from '../../src/observability/politeness.js';
import { startTelemetrySnapshotWriter } from '../../src/observability/telemetry-transport.js';
import { WikimediaClient } from '../../src/upstream/client.js';
import { testConfig } from '../helpers/test-env.js';

const REQUIRED_KEYS = [
  'schema_version', 'timestamp', 'total', 'warmup', 'measured', 'peak_concurrency',
  'per_tool_success', 'per_tool_p95_ms',
  'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm4_429_count', 'politeness', 'telemetry_source', 'overallPass', 'failures',
] as const;

function observation(tool: string, durationMs: number, overrides: Partial<Observation> = {}): Observation {
  return {
    id: 'fixture', tool, toolClass: toolClass(tool), durationMs, ok: true,
    singleCall: true, hasProvenance: true, isContent: true,
    errorActionable: true, upstream429: false, ...overrides,
  };
}

function healthy(): Observation[] {
  return [
    ...Array.from({ length: 150 }, () => observation('get_summary', 800)),
    ...Array.from({ length: 150 }, () => observation('search', 1200)),
  ];
}

function expectRequiredKeys(report: Record<string, unknown>): void {
  for (const key of REQUIRED_KEYS) expect(report, `missing ${key}`).toHaveProperty(key);
  for (const key of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) {
    const metric = report[key] as Record<string, unknown>;
    expect(metric, `${key}.pass missing`).toHaveProperty('pass');
  }
}

describe('nightly JSON report (fixture-backed, no live network)', () => {
  it('builds all required keys from a passing run', () => {
    const observations = healthy();
    const metrics = computeMetrics(observations);
    const report = buildNightlyReport({
      observations, metrics, peakConcurrency: 3, now: () => Date.parse('2026-11-21T12:00:00Z'),
    });
    expectRequiredKeys(report as unknown as Record<string, unknown>);
    expect(report.timestamp).toBe('2026-11-21T12:00:00.000Z');
    expect([report.total, report.warmup, report.measured]).toEqual([300, 0, 300]);
    expect(report.per_tool_success['get_summary']).toEqual({ ok: 150, total: 150 });
    expect(report.per_tool_success['search']).toEqual({ ok: 150, total: 150 });
    expect(report.per_tool_p95_ms['get_summary']).toBe(800);
    expect(report.per_tool_p95_ms['search']).toBe(1200);
    expect(report.m4_429_count).toBe(0);
    expect(report.peak_concurrency).toBe(3);
    expect(report.overallPass).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('persists a failing run with 429 count and failure details', () => {
    const observations = healthy();
    const failing = observations[4] as Observation;
    observations[4] = { ...failing, ok: false, upstream429: true, errorActionable: true };
    const report = buildNightlyReport({
      observations,
      metrics: computeMetrics(observations),
      peakConcurrency: 2,
      failures: [{ id: 'get_summary-live-4', detail: 'status=429 rate_limited' }],
      now: () => Date.parse('2026-11-21T12:05:00Z'),
    });
    expectRequiredKeys(report as unknown as Record<string, unknown>);
    expect(report.m4_429_count).toBe(1);
    expect(report.m4.count429).toBe(1);
    expect(report.m4.pass).toBe(false);
    expect(report.overallPass).toBe(false);
    expect(report.failures).toEqual([{ id: 'get_summary-live-4', detail: 'status=429 rate_limited' }]);
    expect(report.per_tool_success['get_summary']).toEqual({ ok: 149, total: 150 });
  });

  it('writes valid JSON to a deterministic path that the writer creates', () => {
    mkdirSync(path.join(process.cwd(), 'reports'), { recursive: true });
    const dir = mkdtempSync(path.join(process.cwd(), 'reports', 'fixture-'));
    const target = path.join(dir, 'nightly-live.json');
    let written: NightlyReport | undefined;
    try {
      const observations = healthy();
      written = buildNightlyReport({
        observations, metrics: computeMetrics(observations), peakConcurrency: 3,
        failures: [{ id: 'fixture', detail: 'diagnostic' }],
      });
      expect(writeNightlyReport(written, target)).toBe(target);
      expect(existsSync(target)).toBe(true);
      const parsed = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
      expectRequiredKeys(parsed);
      expect(parsed['schema_version']).toBe(1);
      expect(parsed['timestamp']).toBe(written.timestamp);
      expect(parsed['overallPass']).toBe(true);
      expect(parsed['failures']).toEqual([{ id: 'fixture', detail: 'diagnostic' }]);
      expect(readFileSync(target, 'utf8').endsWith('\n')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(written).toBeDefined();
  });
});

describe('WP16 — politeness telemetry in the nightly report (fixture-backed)', () => {
  it('emits an additive politeness block derived from observations by default', () => {
    const observations = healthy();
    const report = buildNightlyReport({
      observations,
      metrics: computeMetrics(observations),
      peakConcurrency: 3,
      now: () => Date.parse('2026-11-21T12:00:00Z'),
    });
    expect(report.politeness.upstream_calls_total).toBe(300);
    expect(report.politeness.upstream_calls_by_tool['get_summary']).toBe(150);
    expect(report.politeness.upstream_calls_by_tool['search']).toBe(150);
    expect(report.politeness.retry_after.rate_limited).toBe(0);
    expect(report.politeness.retry_after.proximity_ratio).toBe(0);
    expect(report.politeness.cache_hit_rate).toBe(0);
    // Backward compatibility: the pre-existing alert snippet fields are untouched.
    expect(report.schema_version).toBe(1);
    expect(report.total).toBe(300);
    expect(report.measured).toBe(300);
    expect(report.m4_429_count).toBe(0);
    expect(report.overallPass).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('keeps an explicit in-process snapshot and stays counts/ratios only', () => {
    const telemetry = new PolitenessTelemetry();
    telemetry.recordUpstreamCall('get_summary', 200, 1500);
    telemetry.recordCacheHit();
    telemetry.recordCacheMiss();
    telemetry.recordConcurrencyReduction();
    telemetry.recordCoalescing(2);
    const snapshot = telemetry.snapshot();
    const observations = healthy();
    const report = buildNightlyReport({
      observations,
      metrics: computeMetrics(observations),
      peakConcurrency: 3,
      politeness: snapshot,
      now: () => Date.parse('2026-11-21T12:00:00Z'),
    });
    expect(report.politeness).toEqual(snapshot);
    expect(report.politeness.cache_hit_rate).toBeCloseTo(0.5);
    expect(report.politeness.retry_after.observed).toBe(1);
    expect(report.politeness.retry_after.honored).toBe(1);
    expect(report.politeness.retry_after.max_observed_ms).toBe(1500);
    expect(report.politeness.concurrency_reductions).toBe(1);
    expect(report.politeness.coalesced_waiters).toBe(2);
    // No token, title, raw subject or secret leaks into the exported block.
    const serialised = JSON.stringify(report.politeness);
    for (const forbidden of ['Bearer', 'secret', 'Earth', 'getaddrinfo', '127.0.0.1']) {
      expect(serialised, `politeness leaked ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('starts from a stable empty snapshot for a failed/incomplete run', () => {
    const report = buildNightlyReport({
      observations: [],
      metrics: computeMetrics([]),
      peakConcurrency: 0,
      failures: [{ id: 'nightly-startup', detail: 'no run' }],
      politeness: emptyPolitenessSnapshot(),
    });
    expect(report.politeness.upstream_calls_total).toBe(0);
    expect(report.politeness.coalesced_calls).toBe(0);
    expect(report.failures).toHaveLength(1);
  });

  it('records per-tool counts, cache hits/misses and Retry-After from a fixture client', async () => {
    const client = new WikimediaClient(testConfig(), {
      useDispatcher: false,
      fetchImpl: async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Retry-After': '0' },
      }),
    });
    try {
      await client.cached('fixture-key', () => client.getJson(
        'https://en.wikipedia.org/api/rest_v1/page/summary/Earth',
        { backend: 'wikimedia-rest-v1', coalesce: false },
      ));
      await client.cached('fixture-key', () => Promise.resolve('from-cache'));
      const snapshot = client.politenessSnapshot;
      expect(snapshot.upstream_calls_total).toBe(1);
      expect(snapshot.upstream_calls_by_tool['wikimedia-rest-v1']).toBe(1);
      expect(snapshot.cache_hits).toBe(1);
      expect(snapshot.cache_misses).toBe(1);
      expect(snapshot.cache_hit_rate).toBeCloseTo(0.5);
      expect(snapshot.retry_after.observed).toBe(1);
      expect(snapshot.retry_after.honored).toBe(1);
      expect(snapshot.retry_after.rate_limited).toBe(0);
    } finally {
      client.close();
    }
  });
});

/** Write a child snapshot through the exact transport the live child uses. */
function injectChildSnapshot(dir: string, snapshot: PolitenessSnapshot): string {
  const filePath = path.join(dir, 'child-telemetry.json');
  const writer = startTelemetrySnapshotWriter(() => snapshot, { filePath, intervalMs: 60000 });
  try {
    expect(writer.writeNow()).toBe(true);
  } finally {
    writer.stop();
  }
  return filePath;
}

describe('WP19 — child telemetry merge into the nightly report (fixture-backed)', () => {
  function childCounters(): PolitenessSnapshot {
    const telemetry = new PolitenessTelemetry();
    telemetry.recordUpstreamCall('wikimedia-rest-v1', 200, 1200);
    telemetry.recordUpstreamCall('wikimedia-rest-v1');
    telemetry.recordCacheHit();
    telemetry.recordCacheMiss();
    telemetry.recordConcurrencyReduction();
    telemetry.recordCoalescing(3);
    return telemetry.snapshot();
  }

  it('merges a valid child snapshot and marks telemetry_source=child', () => {
    const dir = mkdtempSync(path.join(process.cwd(), 'reports', 'nightly-merge-'));
    try {
      const snapshot = childCounters();
      const filePath = injectChildSnapshot(dir, snapshot);
      const observations = healthy();
      const report = buildNightlyReport({
        observations,
        metrics: computeMetrics(observations),
        peakConcurrency: 3,
        telemetrySnapshotPath: filePath,
        now: () => Date.parse('2026-11-22T12:00:00Z'),
      });
      expectRequiredKeys(report as unknown as Record<string, unknown>);
      expect(report.telemetry_source).toBe('child');
      expect(report.politeness).toEqual(snapshot);
      // Real child counters replace the observation-derived label space.
      expect(report.politeness.upstream_calls_by_tool['wikimedia-rest-v1']).toBe(2);
      expect(report.politeness.upstream_calls_by_tool['get_summary']).toBeUndefined();
      expect(report.politeness.upstream_calls_total).toBe(2);
      expect(report.politeness.cache_hits).toBe(1);
      expect(report.politeness.cache_misses).toBe(1);
      expect(report.politeness.retry_after.observed).toBe(1);
      expect(report.politeness.retry_after.max_observed_ms).toBe(1200);
      expect(report.politeness.concurrency_reductions).toBe(1);
      expect(report.politeness.coalesced_calls).toBe(1);
      expect(report.politeness.coalesced_waiters).toBe(3);
      // Every pre-existing field is unchanged by the merge.
      expect(report.schema_version).toBe(1);
      expect([report.total, report.warmup, report.measured]).toEqual([300, 0, 300]);
      expect(report.per_tool_success['get_summary']).toEqual({ ok: 150, total: 150 });
      expect(report.m4_429_count).toBe(0);
      expect(report.overallPass).toBe(true);
      expect(report.failures).toEqual([]);
      expect(JSON.stringify(report)).not.toContain('Bearer');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to observation-derived counters for a broken snapshot', () => {
    const dir = mkdtempSync(path.join(process.cwd(), 'reports', 'nightly-broken-'));
    try {
      const filePath = path.join(dir, 'child-telemetry.json');
      writeFileSync(filePath, '{ "upstream_calls_total": 3, truncated');
      const observations = healthy();
      const report = buildNightlyReport({
        observations,
        metrics: computeMetrics(observations),
        peakConcurrency: 3,
        telemetrySnapshotPath: filePath,
      });
      expect(report.telemetry_source).toBe('observation-derived');
      expect(report.politeness.upstream_calls_total).toBe(300);
      expect(report.politeness.upstream_calls_by_tool['get_summary']).toBe(150);
      expect(report.politeness.cache_hits).toBe(0);
      expect(report.politeness.coalesced_calls).toBe(0);
      expect(report.overallPass).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back for a missing snapshot and for a tampered one with a secret label', () => {
    const dir = mkdtempSync(path.join(process.cwd(), 'reports', 'nightly-missing-'));
    try {
      const observations = healthy();
      const missing = buildNightlyReport({
        observations,
        metrics: computeMetrics(observations),
        peakConcurrency: 3,
        telemetrySnapshotPath: path.join(dir, 'never-written.json'),
      });
      expect(missing.telemetry_source).toBe('observation-derived');
      expect(missing.politeness.upstream_calls_total).toBe(300);

      const tampered = path.join(dir, 'tampered.json');
      writeFileSync(tampered, JSON.stringify({
        ...emptyPolitenessSnapshot(),
        upstream_calls_total: 999,
        upstream_calls_by_tool: { 'get_summary/Earth?token=SUPERSECRET': 999 },
        leaked_token: 'SUPERSECRET',
      }));
      const report = buildNightlyReport({
        observations,
        metrics: computeMetrics(observations),
        peakConcurrency: 3,
        telemetrySnapshotPath: tampered,
      });
      expect(report.telemetry_source).toBe('observation-derived');
      expect(report.politeness.upstream_calls_total).toBe(300);
      expect(JSON.stringify(report)).not.toContain('SUPERSECRET');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks an explicitly injected in-process snapshot as child-sourced', () => {
    const snapshot = childCounters();
    const observations = healthy();
    const report = buildNightlyReport({
      observations,
      metrics: computeMetrics(observations),
      peakConcurrency: 3,
      politeness: snapshot,
    });
    expect(report.telemetry_source).toBe('child');
    expect(report.politeness).toEqual(snapshot);
  });
});
