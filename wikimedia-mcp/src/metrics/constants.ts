/**
 * Phase 3 Group C frozen constants (contract 11 §3.3 / §4.4). These are
 * version-controlled code constants reviewed under SR-1/SR-12 — deliberately
 * NOT configuration keys (§1.4: zero new keys in Phase 3).
 */

export const ANALYTICS_BASE = 'https://wikimedia.org/api/rest_v1/metrics';

/** Aggregate pageview/device numbers are CC0 1.0 (frozen engineering decision). */
export const CC0_LICENSE = Object.freeze({
  title: 'Creative Commons CC0 1.0 Universal Public Domain Dedication',
  short: 'CC0 1.0',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
});

export const ANALYTICS_ATTRIBUTION = Object.freeze({
  required: false,
  text: 'Wikimedia Analytics API — aggregate statistics, CC0 1.0',
  link: 'https://wikitech.wikimedia.org/wiki/Analytics/AQS',
  disclaimer: 'Aggregate statistics are CC0 1.0; linked article titles and content retain their own licences (typically CC BY-SA 4.0).',
});

export const UNIQUE_DEVICES_MEANING = 'Estimated distinct devices (cookie-based) that accessed the whole project at least once in the period; a project-scope reach estimate, not a page view count and not an exact device census.';

/** Earliest accepted pageview date (§4.4). Top-articles starts a year later. */
export const MIN_DATE_PAGEVIEWS = 20150101;
export const MIN_DATE_MOST_READ = 20160101;

/** Inclusive span caps (§4.4) in days (hourly in hours). */
export const MAX_SPAN = Object.freeze({
  hourly: 24,
  daily: 366,
  weekly: 730,
  monthly: 3650,
});

/** Class M pacing: 1 req/s (60 req/min), burst 2 (§6.2). */
export const METRICS_RATE_PER_SECOND = 1;
export const METRICS_BURST = 2;

/** Metrics cache TTL is capped at 5 minutes regardless of METADATA_CACHE_TTL_MS (§6.2). */
export const METRICS_CACHE_TTL_CAP_MS = 300_000;

export function analyticsProvenance(endpoint: string): Record<string, unknown> {
  return {
    source: 'wikimedia:analytics',
    endpoint,
    revision: null,
    timestamp: null,
    license: { ...CC0_LICENSE },
    attribution: { ...ANALYTICS_ATTRIBUTION },
    resultType: 'complete',
  };
}
