import type { Config } from '../config.js';

/**
 * Day-1 WDQS configuration (report 06 §5.2). Group B tools ship later, but
 * the endpoint contract is wired from the first commit so the v2 migration is
 * not a retrofit.
 */
export type SparqlEndpointPlan = {
  endpoints: readonly string[];
  accept: string;
  timeoutMs: number;
  maxRows: number;
  maxQueryLength: number;
};

export function sparqlEndpointPlan(config: Config): SparqlEndpointPlan {
  const primary = config.wikidataSparql.preferV2
    ? config.wikidataSparql.endpointV2
    : config.wikidataSparql.endpoint;
  const secondary = config.wikidataSparql.preferV2
    ? config.wikidataSparql.endpoint
    : config.wikidataSparql.endpointV2;
  const endpoints = [primary, ...config.wikidataSparql.fallbacks, secondary]
    .filter((url, index, all) => all.indexOf(url) === index);
  return {
    endpoints,
    accept: config.wikidataSparql.accept,
    timeoutMs: Math.min(config.wikidataSparql.timeoutMs, 60_000),
    maxRows: config.wikidataSparql.maxRows,
    maxQueryLength: config.wikidataSparql.maxQueryLength,
  };
}

/** Fallback policy: 403/401/404/5xx/timeout switch endpoint; 429/503 do not. */
export function shouldSwitchEndpoint(status: number, body = ''): boolean {
  if (status === 429 || status === 503) return false;
  if (status === 403 && body.includes('Unauthorized User-Agent')) return true;
  return status === 401 || status === 404 || status >= 500;
}
