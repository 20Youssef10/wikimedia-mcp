import type { Config } from '../config.js';
import type { WikimediaClient } from './client.js';
import { asRecord } from './client.js';
import { UpstreamError, parseRetryAfter, withRetry, type RetryConfig } from './retry.js';

/**
 * Phase 3 §3.7 — complete the day-1 Attribution API stub. The beta API is the
 * primary signal source; `v1` must NOT be assumed (live v1 path returns 404
 * rest-no-match). The three knobs are the existing frozen config keys: no new
 * key is introduced.
 */
export type AttributionPlan = {
  apiVersion: string;
  fallbacks: readonly string[];
  disclaimer: string;
  signalUrl: (host: string, encodedTitle: string) => string;
};

export function attributionPlan(config: Config): AttributionPlan {
  return {
    apiVersion: config.attribution.apiVersion,
    fallbacks: config.attribution.fallbacks,
    disclaimer: config.attribution.disclaimer,
    signalUrl: (host: string, encodedTitle: string) =>
      `https://${host}/w/rest.php/attribution/${config.attribution.apiVersion}/pages/${encodedTitle}/signals`,
  };
}

/** 404 `rest-no-match` triggers the documented fallback chain. */
export function isBetaMiss(status: number, body: string): boolean {
  return status === 404 && body.includes('rest-no-match');
}

/** A cross-origin redirect is an SSRF violation (SR-3), never followed. */
export class AttributionRedirectError extends Error {
  constructor() {
    super('Attribution API returned a cross-origin redirect.');
    this.name = 'AttributionRedirectError';
  }
}

export type SignalsResult = {
  readonly url: string;
  readonly status: number;
  readonly body: string;
  readonly essential: Record<string, unknown> | null;
  readonly retryAfterMs: number | null;
};

function parseSignals(status: number, body: string, url: string, retryAfterMs: number | null): SignalsResult {
  let essential: Record<string, unknown> | null = null;
  try {
    const root = body.length > 0 ? (JSON.parse(body) as unknown) : null;
    const record = asRecord(root);
    essential = record === null ? null : asRecord(record['essential']);
  } catch {
    essential = null;
  }
  return { url, status, body, essential, retryAfterMs };
}

/**
 * GET the Attribution signals endpoint. Uses `redirect: 'manual'` for the
 * first hop so a same-origin 301 (unencoded `File:` colon) can be followed
 * safely while a cross-origin redirect is rejected without leaking a host.
 * 429/503 stay on this source and honour Retry-After via the shared bounded
 * jittered retry policy (§6.4).
 */
export async function fetchSignals(
  client: WikimediaClient,
  plan: AttributionPlan,
  host: string,
  encodedTitle: string,
  retry: RetryConfig,
  signal?: AbortSignal,
): Promise<SignalsResult> {
  const url = plan.signalUrl(host, encodedTitle);
  const expectedOrigin = `https://${host}`;
  const outcome = await withRetry(
    async () => {
      const raw = await client.rawRequest(url, {
        redirect: 'manual',
        headers: { Accept: 'application/json' },
        ...(signal === undefined ? {} : { signal }),
      });

      if (raw.status >= 300 && raw.status < 400) {
        const location = raw.headers['location'] ?? raw.headers['Location'];
        if (location === undefined || location.trim() === '') {
          throw new UpstreamError('Attribution API redirect without Location', raw.status);
        }
        let destination: URL;
        try {
          destination = new URL(location, url);
        } catch {
          throw new UpstreamError('Attribution API redirect has an invalid Location', raw.status);
        }
        if (destination.origin !== expectedOrigin) {
          throw new AttributionRedirectError();
        }
        const followed = await client.rawRequest(destination.href, {
          redirect: 'follow',
          headers: { Accept: 'application/json' },
          ...(signal === undefined ? {} : { signal }),
        });
        return parseSignals(followed.status, followed.text, destination.href, null);
      }

      if (raw.status === 429) {
        throw new UpstreamError('Attribution API returned 429', 429,
          parseRetryAfter(raw.headers['retry-after'] ?? raw.headers['Retry-After'] ?? null, retry.retryAfterFallbackMs));
      }
      if (raw.status >= 500) {
        throw new UpstreamError(`Attribution API returned ${raw.status}`, raw.status);
      }
      return parseSignals(raw.status, raw.text, url, null);
    },
    retry,
  );
  return outcome.value;
}
