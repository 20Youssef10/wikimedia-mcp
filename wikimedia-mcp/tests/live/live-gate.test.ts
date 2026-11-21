import { describe, expect, it } from 'vitest';
import {
  LiveGateRunner, STANDARD_LIVE_CONFIG, TokenBucket, computeMetrics,
  nearestRankP95, toolClass, type Observation,
} from '../../src/observability/live-gate.js';

function observation(tool: string, durationMs: number, overrides: Partial<Observation> = {}): Observation {
  return {
    id: 'synthetic',
    tool,
    toolClass: toolClass(tool),
    durationMs,
    ok: true,
    singleCall: true,
    hasProvenance: true,
    isContent: true,
    errorActionable: true,
    upstream429: false,
    ...overrides,
  };
}

function balanced(overrides: (tool: string) => Partial<Observation> = () => ({})): Observation[] {
  const cases: Observation[] = [];
  for (let i = 0; i < 150; i += 1) cases.push(observation('get_summary', 800, overrides('get_summary')));
  for (let i = 0; i < 150; i += 1) cases.push(observation('search', 1200, overrides('search')));
  return cases;
}

describe('H3 — nightly gate metric computation (fixture-backed, no live network)', () => {
  it('nearest-rank p95 uses ceil(0.95n) without trimming', () => {
    expect(nearestRankP95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
    expect(nearestRankP95([])).toBe(0);
    expect(nearestRankP95([10, 1, 5, 3])).toBe(10);
  });

  it('classifies REST and Action tools into the correct latency classes', () => {
    expect(toolClass('get_summary')).toBe('R');
    expect(toolClass('get_feed')).toBe('R');
    expect(toolClass('search')).toBe('A');
    expect(toolClass('get_media')).toBe('A');
  });

  it('M1/M2/M3/M4/M5/M6 all pass for a healthy 300-call run', () => {
    const report = computeMetrics(balanced());
    expect(report.measured).toBe(300);
    expect(report.m1.rate).toBe(1);
    expect(report.m2.rate).toBe(1);
    expect(report.m3.samplesR).toBe(150);
    expect(report.m3.samplesA).toBe(150);
    expect(report.m3.p95R).toBeLessThanOrEqual(STANDARD_LIVE_CONFIG.budgets.R);
    expect(report.m3.p95A).toBeLessThanOrEqual(STANDARD_LIVE_CONFIG.budgets.A);
    expect(report.m3.p95Global).toBeLessThan(STANDARD_LIVE_CONFIG.budgets.global);
    expect(report.m4.count429).toBe(0);
    expect(report.m5.coverage).toBe(1);
    expect(report.m6.coverage).toBe(1);
    expect(report.overallPass).toBe(true);
  });

  it('a single upstream 429 fails M4 and the overall gate', () => {
    const cases = balanced();
    cases[10] = observation('get_summary', 800, { upstream429: true, ok: false, errorActionable: true });
    const report = computeMetrics(cases);
    expect(report.m4.count429).toBe(1);
    expect(report.m4.pass).toBe(false);
    expect(report.overallPass).toBe(false);
  });

  it('latency above the per-class budget fails M3', () => {
    const cases: Observation[] = [];
    for (let i = 0; i < 150; i += 1) cases.push(observation('get_summary', 1400));
    for (let i = 0; i < 150; i += 1) cases.push(observation('search', 1200));
    const report = computeMetrics(cases);
    expect(report.m3.p95R).toBe(1400);
    expect(report.m3.pass).toBe(false);
  });

  it('token bucket paces at 2 req/s with burst 3', () => {
    const now = 0;
    const bucket = new TokenBucket(2, 3, () => now);
    expect(bucket.waitMs()).toBe(0);
    expect(bucket.waitMs()).toBe(0);
    expect(bucket.waitMs()).toBe(0);
    expect(bucket.waitMs()).toBe(500);
  });

  it('runner applies pacing and never exceeds the concurrency ceiling', async () => {
    const sleeps: number[] = [];
    let now = 0;
    const runner = new LiveGateRunner(
      { ...STANDARD_LIVE_CONFIG, totalCalls: 5, warmupCalls: 1 },
      { sleep: async (ms) => { sleeps.push(ms); now += ms; }, now: () => now },
    );
    const jobs = Array.from({ length: 5 }, (_, index) => async () => {
      now += 1;
      return observation(index % 2 === 0 ? 'get_summary' : 'search', 5, { id: `job-${index}` });
    });
    const results = await runner.run(jobs);
    expect(results).toHaveLength(5);
    expect(results[0]?.warmup).toBe(true);
    expect(results[4]?.warmup).toBe(false);
    expect(sleeps).toHaveLength(2);
    expect(sleeps.every((ms) => ms > 0 && ms <= 500)).toBe(true);
    expect(runner.peakConcurrency).toBeLessThanOrEqual(3);
  });
});
