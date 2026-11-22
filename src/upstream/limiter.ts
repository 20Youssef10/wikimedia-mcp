import pLimit from 'p-limit';

/**
 * One global semaphore, ceiling 3 (report 09 §4.1 / AC-26). A single instance
 * is shared by every outbound call in the process.
 *
 * WP17: on an upstream 429/503 the *effective* ceiling is temporarily reduced
 * below the configured ceiling, then recovers after a cooldown. The configured
 * ceiling is immutable and validated to <= 3, so the effective ceiling can
 * never exceed 3 — it only ever decreases and returns to the configured value.
 */
export const ADAPTIVE_COOLDOWN_MS = 5000;

export type ConcurrencyReductionReason = '429' | '503' | 'manual';

export type ConcurrencyLimiterOptions = {
  /** Injectable clock for deterministic cooldown tests. Defaults to Date.now. */
  readonly clock?: () => number;
  /** Cooldown before the effective ceiling recovers. No new config key. */
  readonly cooldownMs?: number;
};

export class ConcurrencyLimiter {
  private readonly limit: ReturnType<typeof pLimit>;
  private active = 0;
  private peak = 0;
  private effective: number;
  private reductionUntil = 0;
  private reducedCount = 0;
  private lastReason: ConcurrencyReductionReason | undefined;
  private readonly clock: () => number;
  private readonly cooldownMs: number;

  constructor(readonly ceiling: number, options: ConcurrencyLimiterOptions = {}) {
    if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > 3) {
      throw new RangeError('CONCURRENCY_LIMIT must be an integer between 1 and 3');
    }
    this.clock = options.clock ?? (() => Date.now());
    this.cooldownMs = options.cooldownMs ?? ADAPTIVE_COOLDOWN_MS;
    if (!Number.isFinite(this.cooldownMs) || this.cooldownMs < 0) {
      throw new RangeError('adaptive cooldown must be a non-negative finite number');
    }
    this.effective = ceiling;
    this.limit = pLimit(ceiling);
  }

  /** Current temporary ceiling. Always in [1, ceiling]. */
  get effectiveCeiling(): number { return this.effective; }
  get isReduced(): boolean { return this.effective < this.ceiling; }
  get reductionCount(): number { return this.reducedCount; }
  get lastReductionReason(): ConcurrencyReductionReason | undefined { return this.lastReason; }
  get cooldownRemainingMs(): number { return Math.max(0, this.reductionUntil - this.clock()); }

  /**
   * Reduce the effective ceiling by one slot, bounded at 1. Returns true only
   * when a reduction actually happened (so callers can count it once).
   */
  reduce(reason: ConcurrencyReductionReason): boolean {
    this.recoverIfDue();
    if (this.effective <= 1) return false;
    this.effective -= 1;
    // p-limit validates the setter; effective is always an integer >= 1.
    this.limit.concurrency = this.effective;
    this.reductionUntil = this.clock() + this.cooldownMs;
    this.reducedCount += 1;
    this.lastReason = reason;
    return true;
  }

  /** Restore the configured ceiling once the cooldown has elapsed. */
  recoverIfDue(): void {
    if (this.reductionUntil > 0 && this.clock() >= this.reductionUntil) {
      this.effective = this.ceiling;
      this.limit.concurrency = this.effective;
      this.reductionUntil = 0;
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    this.recoverIfDue();
    return this.limit(async () => {
      this.active += 1;
      this.peak = Math.max(this.peak, this.active);
      try {
        return await task();
      } finally {
        this.active -= 1;
      }
    });
  }

  get activeCount(): number { return this.active; }
  get peakCount(): number { return this.peak; }
}
