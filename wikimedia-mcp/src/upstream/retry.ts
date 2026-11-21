import pRetry from 'p-retry';

export type RetryConfig = {
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
  retryAfterFallbackMs: number;
};

/**
 * Error carrying an upstream status and parsed Retry-After (milliseconds).
 * `status === 0` denotes a network/DNS/TLS-level failure (no HTTP response);
 * `host` names the failed upstream so callers can give an actionable hint.
 */
export class UpstreamError extends Error {
  readonly host: string | undefined;

  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null = null,
    host?: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
    this.host = host;
  }
}

/**
 * Parse a Retry-After header (seconds or HTTP-date) into milliseconds.
 * Missing/invalid values fall back to the configured minimum (≥5 s per
 * report 09 §2.6 / AC-27).
 */
export function parseRetryAfter(header: string | null | undefined, fallbackMs: number, now = Date.now()): number {
  if (header === null || header === undefined || header.trim() === '') return fallbackMs;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(0, Math.floor(seconds * 1000));
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return fallbackMs;
}

/** Full-jitter exponential backoff, bounded by maxMs (report 09 §2.6). */
export function jitteredBackoff(attempt: number, baseMs: number, maxMs: number, random = Math.random): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

export type RetryOutcome<T> = { value: T; attempts: number };

/**
 * Run an operation with bounded, jittered retries. On a 429 the caller's
 * `retryAfterMs` is honoured in full; otherwise jittered backoff is used.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  config: RetryConfig,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<RetryOutcome<T>> {
  let attempts = 0;
  const value = await pRetry(
    async () => {
      attempts += 1;
      return operation(attempts);
    },
    {
      retries: Math.max(0, config.maxAttempts - 1),
      // We perform the wait ourselves in onFailedAttempt so Retry-After is exact.
      minTimeout: 0,
      maxTimeout: 0,
      randomize: false,
      onFailedAttempt: async ({ error, attemptNumber }) => {
        if (!(error instanceof UpstreamError)) return;
        if (error.status !== 429 && error.status !== 503 && error.status !== 0) return;
        const delay = error.status === 429
          ? (error.retryAfterMs ?? config.retryAfterFallbackMs)
          : jitteredBackoff(attemptNumber, config.baseMs, config.maxMs);
        await sleep(delay);
      },
    },
  );
  return { value, attempts };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
