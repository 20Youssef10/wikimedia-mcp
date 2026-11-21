import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeMetrics, toolClass, type Observation,
} from '../../src/observability/live-gate.js';
import {
  buildNightlyReport, writeNightlyReport, type NightlyReport,
} from '../../src/observability/nightly-report.js';

const REQUIRED_KEYS = [
  'schema_version', 'timestamp', 'total', 'warmup', 'measured', 'peak_concurrency',
  'per_tool_success', 'per_tool_p95_ms',
  'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm4_429_count', 'overallPass', 'failures',
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
