import pLimit from 'p-limit';

/** Injectable clock so CI can assert pacing with fake time and no real sleep. */
export type PacingClock = {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
};

export const REAL_CLOCK: PacingClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
};

/**
 * Token bucket with a fractional refill. `ratePerSecond` tokens per second,
 * `burst` maximum tokens. Consuming a token waits (via the injectable clock)
 * until one is available (contract 11 §6.2).
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    readonly ratePerSecond: number,
    readonly burst: number,
    private readonly clock: PacingClock = REAL_CLOCK,
  ) {
    if (ratePerSecond <= 0 || burst < 1) throw new RangeError('Invalid token bucket configuration');
    this.tokens = burst;
    this.lastRefill = clock.now();
  }

  async take(): Promise<void> {
    this.refill(this.clock.now());
    if (this.tokens < 1) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSecond) * 1000);
      await this.clock.sleep(waitMs);
      this.refill(this.clock.now());
    }
    this.tokens -= 1;
  }

  private refill(now: number): void {
    const elapsedMs = Math.max(0, now - this.lastRefill);
    this.tokens = Math.min(this.burst, this.tokens + (elapsedMs * this.ratePerSecond) / 1000);
    this.lastRefill = now;
  }
}

export type PacedLane = {
  readonly ceiling: number;
  readonly ratePerSecond: number;
  readonly burst: number;
  run<T>(task: () => Promise<T>): Promise<T>;
};

/**
 * One class lane: a dedicated semaphore nested inside the client's global
 * p-limit(3), combined with the class token bucket. Class M/T use ceiling
 * min(2, CONCURRENCY_LIMIT) and 1 req/s burst 2; Class I uses the global
 * ceiling with 2 req/s burst 3 (§6.2).
 */
export function createPacedLane(
  ceiling: number,
  ratePerSecond: number,
  burst: number,
  clock: PacingClock = REAL_CLOCK,
): PacedLane {
  const limit = pLimit(Math.max(1, ceiling));
  const bucket = new TokenBucket(ratePerSecond, burst, clock);
  return {
    ceiling,
    ratePerSecond,
    burst,
    async run<T>(task: () => Promise<T>): Promise<T> {
      return limit(async () => {
        await bucket.take();
        return task();
      });
    },
  };
}
