import { describe, expect, it } from 'vitest';
import { parseRetryAfter, jitteredBackoff, withRetry, UpstreamError } from '../../src/upstream/retry.js';
import { ConcurrencyLimiter } from '../../src/upstream/limiter.js';

describe('retry and politeness mechanisms (AC-26/AC-27)', () => {
  it('parses Retry-After seconds, HTTP dates and the fallback', () => {
    const now = Date.parse('2026-11-21T00:00:00Z');
    expect(parseRetryAfter('1', 5000, now)).toBe(1000);
    expect(parseRetryAfter('0.5', 5000, now)).toBe(500);
    expect(parseRetryAfter('Wed, 21 Nov 2026 00:00:05 GMT', 5000, now)).toBe(5000);
    expect(parseRetryAfter(undefined, 5000, now)).toBe(5000);
    expect(parseRetryAfter('garbage', 5000, now)).toBe(5000);
  });

  it('computes bounded full-jitter backoff', () => {
    expect(jitteredBackoff(1, 250, 5000, () => 0)).toBe(0);
    expect(jitteredBackoff(1, 250, 5000, () => 0.999)).toBeLessThanOrEqual(250);
    expect(jitteredBackoff(20, 250, 5000, () => 1)).toBeLessThanOrEqual(5000);
  });

  it('honours Retry-After exactly and retries until success (AC-27)', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const outcome = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new UpstreamError('429', 429, 1000);
        return 'ok';
      },
      { maxAttempts: 4, baseMs: 10, maxMs: 50, retryAfterFallbackMs: 5000 },
      async (ms) => { sleeps.push(ms); },
    );
    expect(outcome.value).toBe('ok');
    expect(outcome.attempts).toBe(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('uses >= 5s fallback when Retry-After is absent (AC-27)', async () => {
    const sleeps: number[] = [];
    await expect(withRetry(
      async () => { throw new UpstreamError('429', 429); },
      { maxAttempts: 2, baseMs: 10, maxMs: 50, retryAfterFallbackMs: 5000 },
      async (ms) => { sleeps.push(ms); },
    )).rejects.toBeInstanceOf(UpstreamError);
    expect(sleeps[0]).toBeGreaterThanOrEqual(5000);
  });

  it('enforces a global concurrency ceiling of 3 (AC-26)', async () => {
    const limiter = new ConcurrencyLimiter(3);
    let active = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 12 }, () => limiter.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
    })));
    expect(peak).toBeLessThanOrEqual(3);
    expect(limiter.peakCount).toBeLessThanOrEqual(3);
    expect(() => new ConcurrencyLimiter(4)).toThrow();
  });

  it('frees a concurrency slot when the task aborts (AC-20)', async () => {
    const limiter = new ConcurrencyLimiter(3);
    const controller = new AbortController();
    const task = limiter.run(() => new Promise<void>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await Promise.resolve();
    expect(limiter.activeCount).toBe(1);
    controller.abort();
    await expect(task).rejects.toThrow('aborted');
    expect(limiter.activeCount).toBe(0);
  });
});

describe('WP17 — adaptive concurrency (temporary reduction, never above 3)', () => {
  it('reduces on 429/503, floors at 1 and recovers to the configured ceiling', () => {
    let now = 1000;
    const limiter = new ConcurrencyLimiter(3, { clock: () => now, cooldownMs: 100 });
    expect(limiter.ceiling).toBe(3);
    expect(limiter.effectiveCeiling).toBe(3);
    expect(limiter.isReduced).toBe(false);

    expect(limiter.reduce('429')).toBe(true);
    expect(limiter.effectiveCeiling).toBe(2);
    expect(limiter.isReduced).toBe(true);
    expect(limiter.lastReductionReason).toBe('429');
    expect(limiter.reductionCount).toBe(1);
    expect(limiter.cooldownRemainingMs).toBe(100);

    expect(limiter.reduce('503')).toBe(true);
    expect(limiter.effectiveCeiling).toBe(1);
    expect(limiter.reduce('429')).toBe(false);
    expect(limiter.effectiveCeiling).toBe(1);
    expect(limiter.reductionCount).toBe(2);

    now += 99;
    limiter.recoverIfDue();
    expect(limiter.effectiveCeiling).toBe(1);
    now += 1;
    limiter.recoverIfDue();
    expect(limiter.effectiveCeiling).toBe(3);
    expect(limiter.isReduced).toBe(false);
    expect(limiter.cooldownRemainingMs).toBe(0);
  });

  it('can never exceed CONCURRENCY_LIMIT, even after repeated reductions/recoveries', () => {
    let now = 0;
    const limiter = new ConcurrencyLimiter(3, { clock: () => now, cooldownMs: 10 });
    for (let cycle = 0; cycle < 5; cycle += 1) {
      limiter.reduce('429');
      limiter.reduce('503');
      expect(limiter.effectiveCeiling).toBeGreaterThanOrEqual(1);
      expect(limiter.effectiveCeiling).toBeLessThanOrEqual(3);
      now += 10;
      limiter.recoverIfDue();
      expect(limiter.effectiveCeiling).toBe(3);
    }
    // A configured ceiling of 1 cannot be reduced further.
    const single = new ConcurrencyLimiter(1, { clock: () => now, cooldownMs: 10 });
    expect(single.reduce('429')).toBe(false);
    expect(single.effectiveCeiling).toBe(1);
    expect(() => new ConcurrencyLimiter(4)).toThrow(/between 1 and 3/);
  });

  it('recovers automatically on the next run() after the cooldown elapses', async () => {
    let now = 0;
    const limiter = new ConcurrencyLimiter(3, { clock: () => now, cooldownMs: 50 });
    limiter.reduce('503');
    expect(limiter.effectiveCeiling).toBe(2);
    now = 50;
    await limiter.run(async () => { /* no-op */ });
    expect(limiter.effectiveCeiling).toBe(3);
  });

  it('simulation: peak in-flight never breaches 3 while a reduction is active', async () => {
    const now = 0;
    const limiter = new ConcurrencyLimiter(3, { clock: () => now, cooldownMs: 1000 });
    let active = 0;
    let peak = 0;
    const jobs = Array.from({ length: 12 }, () => limiter.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
    }));
    // Backpressure arrives while jobs are queued; the effective ceiling drops.
    limiter.reduce('429');
    expect(limiter.effectiveCeiling).toBe(2);
    await Promise.all(jobs);
    expect(peak).toBeLessThanOrEqual(3);
    expect(limiter.peakCount).toBeLessThanOrEqual(3);
    expect(limiter.reductionCount).toBe(1);
  });
});
