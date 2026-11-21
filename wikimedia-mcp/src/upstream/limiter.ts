import pLimit from 'p-limit';

/**
 * One global semaphore, ceiling 3 (report 09 §4.1 / AC-26). A single instance
 * is shared by every outbound call in the process.
 */
export class ConcurrencyLimiter {
  private readonly limit: ReturnType<typeof pLimit>;
  private active = 0;
  private peak = 0;

  constructor(readonly ceiling: number) {
    if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > 3) {
      throw new RangeError('CONCURRENCY_LIMIT must be an integer between 1 and 3');
    }
    this.limit = pLimit(ceiling);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
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
