import { ConcurrencyLimiter } from '../upstream/limiter.js';

/** Nightly load profile (contract 09 §4.1–§4.5). */
export type ToolClass = 'R' | 'A';

export const REST_TOOLS = new Set(['get_summary', 'get_feed', 'get_related_pages', 'get_languages']);

export function toolClass(tool: string): ToolClass {
  return REST_TOOLS.has(tool) ? 'R' : 'A';
}

export type Observation = {
  id: string;
  tool: string;
  toolClass: ToolClass;
  durationMs: number;
  ok: boolean;
  /** Task resolved with exactly one tools/call. */
  singleCall: boolean;
  /** Content result carried both license and attribution. */
  hasProvenance: boolean;
  /** True when the result was content-bearing (counts toward M5). */
  isContent: boolean;
  /** Error result carried code/message/retryable/action. */
  errorActionable: boolean;
  /** Upstream returned HTTP 429 (mapped to rate_limited by the server). */
  upstream429: boolean;
  warmup?: boolean;
};

export type LiveGateConfig = {
  totalCalls: number;
  warmupCalls: number;
  ratePerSecond: number;
  burst: number;
  concurrency: number;
  budgets: { R: number; A: number; global: number };
  minSamplesPerClass: number;
};

export const STANDARD_LIVE_CONFIG: LiveGateConfig = {
  totalCalls: 330,
  warmupCalls: 30,
  ratePerSecond: 2,
  burst: 3,
  concurrency: 3,
  budgets: { R: 1000, A: 1500, global: 2000 },
  minSamplesPerClass: 150,
};

export type LiveGateReport = {
  total: number;
  warmup: number;
  measured: number;
  m1: { rate: number; pass: boolean };
  m2: { rate: number; pass: boolean };
  m3: { p95R: number; p95A: number; p95Global: number; samplesR: number; samplesA: number; pass: boolean };
  m4: { count429: number; pass: boolean };
  m5: { coverage: number; pass: boolean };
  m6: { coverage: number; pass: boolean };
  overallPass: boolean;
};

/** Nearest-rank percentile (report 09 §4.5), no winsorisation. */
export function nearestRankP95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(0.95 * sorted.length));
  return sorted[rank - 1] ?? 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

/** Compute M1–M4 (plus M5/M6 enforcement) from observations. Pure function. */
export function computeMetrics(
  observations: readonly Observation[],
  config: LiveGateConfig = STANDARD_LIVE_CONFIG,
): LiveGateReport {
  const measured = observations.filter((item) => item.warmup !== true);
  const ok = measured.filter((item) => item.ok);
  const durationsR = ok.filter((item) => item.toolClass === 'R').map((item) => item.durationMs);
  const durationsA = ok.filter((item) => item.toolClass === 'A').map((item) => item.durationMs);
  const contents = measured.filter((item) => item.isContent);
  const errors = measured.filter((item) => !item.ok);

  const p95R = nearestRankP95(durationsR);
  const p95A = nearestRankP95(durationsA);
  const p95Global = nearestRankP95(ok.map((item) => item.durationMs));
  const enoughSamples = durationsR.length >= config.minSamplesPerClass
    && durationsA.length >= config.minSamplesPerClass;

  const m1Rate = ratio(ok.length, measured.length);
  const m2Rate = ratio(measured.filter((item) => item.singleCall).length, measured.length);
  const m5Coverage = ratio(contents.filter((item) => item.hasProvenance).length, contents.length);
  const m6Coverage = ratio(errors.filter((item) => item.errorActionable).length, errors.length);
  const count429 = measured.filter((item) => item.upstream429).length + ok.filter((item) => item.upstream429).length;

  const report: LiveGateReport = {
    overallPass: false,
    total: observations.length,
    warmup: observations.length - measured.length,
    measured: measured.length,
    m1: { rate: m1Rate, pass: m1Rate >= 0.95 },
    m2: { rate: m2Rate, pass: m2Rate >= 0.70 },
    m3: {
      p95R, p95A, p95Global,
      samplesR: durationsR.length, samplesA: durationsA.length,
      pass: enoughSamples && p95R <= config.budgets.R && p95A <= config.budgets.A && p95Global < config.budgets.global,
    },
    m4: { count429, pass: count429 === 0 },
    m5: { coverage: m5Coverage, pass: m5Coverage === 1 },
    m6: { coverage: m6Coverage, pass: m6Coverage === 1 },
  };
  report.overallPass = report.m1.pass && report.m2.pass && report.m3.pass
    && report.m4.pass && report.m5.pass && report.m6.pass;
  return report;
}

/** 2 req/s token bucket with burst 3 (contract 09 §4.1). */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = burst;
    this.lastRefill = now();
  }

  /** Milliseconds to wait before one token is available; consumes it. */
  waitMs(): number {
    const current = this.now();
    const elapsed = Math.max(0, current - this.lastRefill);
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSecond / 1000);
    this.lastRefill = current;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    const delay = Math.ceil((1 - this.tokens) * 1000 / this.ratePerSecond);
    this.tokens = 0;
    this.lastRefill = current + delay;
    return delay;
  }
}

export type RunnerOptions = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Executes nightly jobs with a global concurrency semaphore and a pacing
 * governor, producing observations for computeMetrics(). The jobs themselves
 * are transport calls supplied by the caller, so the same runner is used by
 * the live gate and by fixture-backed tests.
 */
export class LiveGateRunner {
  private readonly limiter: ConcurrencyLimiter;
  private readonly bucket: TokenBucket;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    readonly config: LiveGateConfig = STANDARD_LIVE_CONFIG,
    options: RunnerOptions = {},
  ) {
    this.limiter = new ConcurrencyLimiter(config.concurrency);
    this.bucket = new TokenBucket(config.ratePerSecond, config.burst, options.now);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  async run(jobs: ReadonlyArray<() => Promise<Observation>>): Promise<Observation[]> {
    const results: Observation[] = [];
    for (const [index, job] of jobs.entries()) {
      const wait = this.bucket.waitMs();
      if (wait > 0) await this.sleep(wait);
      const observation = await this.limiter.run(async () => {
        const start = this.now();
        const value = await job();
        return { ...value, durationMs: value.durationMs || this.now() - start, warmup: index < this.config.warmupCalls };
      });
      results.push(observation);
    }
    return results;
  }

  get peakConcurrency(): number { return this.limiter.peakCount; }
}
