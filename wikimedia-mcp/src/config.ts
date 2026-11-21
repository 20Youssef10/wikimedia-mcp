import { z } from 'zod';

/** True for loopback bind addresses (DNS-rebinding defence baseline). */
export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

function csv(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [];
  return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const rawSchema = z.object({
  USER_AGENT: z.string().min(1, 'USER_AGENT is required and must be contactable'),
  CONCURRENCY_LIMIT: z.coerce.number().int().positive().max(3, 'CONCURRENCY_LIMIT may not exceed 3').default(3),
  HTTP_TIMEOUT_MS: positiveInt(15000),
  RETRY_MAX_ATTEMPTS: positiveInt(3),
  RETRY_BACKOFF_BASE_MS: positiveInt(250),
  RETRY_BACKOFF_MAX_MS: positiveInt(5000),
  RETRY_AFTER_FALLBACK_MS: positiveInt(5000),
  MCP_TRANSPORT: z.enum(['stdio', 'streamable-http']).default('stdio'),
  MCP_HTTP_HOST: z.string().min(1).default('127.0.0.1'),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_HTTP_PATH: z.string().startsWith('/').default('/mcp'),
  MCP_ALLOWED_ORIGINS: z.string().default(''),
  MCP_ALLOWED_HOSTS: z.string().default('127.0.0.1,localhost'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  METADATA_CACHE_TTL_MS: positiveInt(3600000),
  MAX_RESULT_BYTES: positiveInt(65536),

  WIKIDATA_SPARQL_ENDPOINT: z.string().url().default('https://query.wikidata.org/sparql'),
  WIKIDATA_SPARQL_ENDPOINT_V2: z.string().url().default('https://query-next.wikidata.org/sparql'),
  WIKIDATA_SPARQL_FALLBACKS: z.string().default('https://query-main.wikidata.org/sparql'),
  WIKIDATA_SPARQL_PREFER_V2: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  WIKIDATA_SPARQL_ACCEPT: z.string().min(1).default('application/sparql-results+json'),
  WIKIDATA_SPARQL_TIMEOUT_MS: z.coerce.number().int().positive().max(60000).default(60000),
  WIKIDATA_SPARQL_MAX_ROWS: positiveInt(1000),
  WIKIDATA_SPARQL_MAX_QUERY_LENGTH: positiveInt(10000),

  ATTRIBUTION_API_VERSION: z.string().min(1).default('v0-beta'),
  ATTRIBUTION_FALLBACKS: z.string().default('rest-bare,action-rightsinfo,action-imageinfo'),
  ATTRIBUTION_DISCLAIMER: z.string().min(1).default('You remain responsible for licence compliance.'),
});

export type Config = {
  readonly userAgent: string;
  readonly concurrencyLimit: number;
  readonly httpTimeoutMs: number;
  readonly retryMaxAttempts: number;
  readonly retryBackoffBaseMs: number;
  readonly retryBackoffMaxMs: number;
  readonly retryAfterFallbackMs: number;
  readonly transport: 'stdio' | 'streamable-http';
  readonly httpHost: string;
  readonly httpPort: number;
  readonly httpPath: string;
  readonly allowedOrigins: readonly string[];
  readonly allowedHosts: readonly string[];
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly metadataCacheTtlMs: number;
  readonly maxResultBytes: number;
  readonly wikidataSparql: {
    readonly endpoint: string;
    readonly endpointV2: string;
    readonly fallbacks: readonly string[];
    readonly preferV2: boolean;
    readonly accept: string;
    readonly timeoutMs: number;
    readonly maxRows: number;
    readonly maxQueryLength: number;
  };
  readonly attribution: {
    readonly apiVersion: string;
    readonly fallbacks: readonly string[];
    readonly disclaimer: string;
  };
};

/**
 * Validate all configuration at boot. Invalid values terminate startup rather
 * than being silently defaulted (report 09 §2.6).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = rawSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const raw = parsed.data;
  const allowedOrigins = csv(raw.MCP_ALLOWED_ORIGINS);
  const allowedHosts = csv(raw.MCP_ALLOWED_HOSTS);
  const publicBind = !isLoopbackHost(raw.MCP_HTTP_HOST);

  if (publicBind && (allowedOrigins.length === 0 || allowedHosts.length === 0)) {
    throw new Error(
      'Public bind requires both MCP_ALLOWED_ORIGINS and MCP_ALLOWED_HOSTS to be configured',
    );
  }
  if (raw.RETRY_BACKOFF_MAX_MS < raw.RETRY_BACKOFF_BASE_MS) {
    throw new Error('RETRY_BACKOFF_MAX_MS must be >= RETRY_BACKOFF_BASE_MS');
  }
  // Phase 2 §3.5 / §4.7: every SPARQL endpoint in the fallback chain must be
  // https (SR-3 SSRF defence). Reject at boot, never at request time.
  const sparqlUrls: Array<{ name: string; value: string }> = [
    { name: 'WIKIDATA_SPARQL_ENDPOINT', value: raw.WIKIDATA_SPARQL_ENDPOINT },
    { name: 'WIKIDATA_SPARQL_ENDPOINT_V2', value: raw.WIKIDATA_SPARQL_ENDPOINT_V2 },
    ...raw.WIKIDATA_SPARQL_FALLBACKS.split(',').map((value, index) =>
      ({ name: `WIKIDATA_SPARQL_FALLBACKS[${index}]`, value: value.trim() })),
  ];
  for (const entry of sparqlUrls) {
    if (!entry.value.toLowerCase().startsWith('https://')) {
      throw new Error(`${entry.name} must be an https: URL`);
    }
  }

  // Phase 3 §1.4 / AC-62: the three Attribution keys are reused as-is, but an
  // empty/malformed version or an unknown fallback token must terminate boot.
  // No new key is introduced. `v1` is accepted but still falls back at runtime
  // because the live v1 path returns 404 rest-no-match.
  if (!/^v[0-9]+(?:-[a-z0-9]+)?$/.test(raw.ATTRIBUTION_API_VERSION)) {
    throw new Error('ATTRIBUTION_API_VERSION must match ^v[0-9]+(?:-[a-z0-9]+)?$');
  }
  const allowedAttributionFallbacks = new Set(['rest-bare', 'action-rightsinfo', 'action-imageinfo']);
  const attributionFallbacks = csv(raw.ATTRIBUTION_FALLBACKS);
  if (attributionFallbacks.length === 0
      || attributionFallbacks.some((token) => !allowedAttributionFallbacks.has(token))) {
    throw new Error(
      'ATTRIBUTION_FALLBACKS must be a non-empty ordered list of rest-bare, action-rightsinfo, action-imageinfo',
    );
  }

  return {
    userAgent: raw.USER_AGENT,
    concurrencyLimit: raw.CONCURRENCY_LIMIT,
    httpTimeoutMs: raw.HTTP_TIMEOUT_MS,
    retryMaxAttempts: raw.RETRY_MAX_ATTEMPTS,
    retryBackoffBaseMs: raw.RETRY_BACKOFF_BASE_MS,
    retryBackoffMaxMs: raw.RETRY_BACKOFF_MAX_MS,
    retryAfterFallbackMs: raw.RETRY_AFTER_FALLBACK_MS,
    transport: raw.MCP_TRANSPORT,
    httpHost: raw.MCP_HTTP_HOST,
    httpPort: raw.MCP_HTTP_PORT,
    httpPath: raw.MCP_HTTP_PATH,
    allowedOrigins,
    allowedHosts,
    logLevel: raw.LOG_LEVEL,
    metadataCacheTtlMs: raw.METADATA_CACHE_TTL_MS,
    maxResultBytes: raw.MAX_RESULT_BYTES,
    wikidataSparql: {
      endpoint: raw.WIKIDATA_SPARQL_ENDPOINT,
      endpointV2: raw.WIKIDATA_SPARQL_ENDPOINT_V2,
      fallbacks: csv(raw.WIKIDATA_SPARQL_FALLBACKS),
      preferV2: raw.WIKIDATA_SPARQL_PREFER_V2,
      accept: raw.WIKIDATA_SPARQL_ACCEPT,
      timeoutMs: raw.WIKIDATA_SPARQL_TIMEOUT_MS,
      maxRows: raw.WIKIDATA_SPARQL_MAX_ROWS,
      maxQueryLength: raw.WIKIDATA_SPARQL_MAX_QUERY_LENGTH,
    },
    attribution: {
      apiVersion: raw.ATTRIBUTION_API_VERSION,
      fallbacks: csv(raw.ATTRIBUTION_FALLBACKS),
      disclaimer: raw.ATTRIBUTION_DISCLAIMER,
    },
  };
}

/** All WDQS and Attribution keys, for the AC-31 config smoke test. */
export const DAY_ONE_CONFIG_KEYS = [
  'WIKIDATA_SPARQL_ENDPOINT',
  'WIKIDATA_SPARQL_ENDPOINT_V2',
  'WIKIDATA_SPARQL_FALLBACKS',
  'WIKIDATA_SPARQL_PREFER_V2',
  'WIKIDATA_SPARQL_ACCEPT',
  'WIKIDATA_SPARQL_TIMEOUT_MS',
  'WIKIDATA_SPARQL_MAX_ROWS',
  'WIKIDATA_SPARQL_MAX_QUERY_LENGTH',
  'ATTRIBUTION_API_VERSION',
  'ATTRIBUTION_FALLBACKS',
  'ATTRIBUTION_DISCLAIMER',
] as const;
