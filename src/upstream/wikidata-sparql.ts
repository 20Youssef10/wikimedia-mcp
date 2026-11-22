import pLimit from 'p-limit';
import type { Config } from '../config.js';
import type { WikimediaClient } from './client.js';
import { UpstreamError, parseRetryAfter } from './retry.js';

/**
 * WDQS configuration, endpoint chain and the full SPARQL safety pipeline
 * (Phase 2 contract §3.5 / §4). Phase 1 defined the configuration keys; this
 * file completes the day-1 stub rather than duplicating it.
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
  // Contract §4.7: [PRIMARY, V2, ...FALLBACKS] (or V2 first when PREFER_V2).
  const endpoints = [primary, secondary, ...config.wikidataSparql.fallbacks]
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

/**
 * Absolute WDQS deadline hard cap (§4.5). Label-service queries are the one
 * known slow path: the server may *use* the full cap for them, but it must
 * never accept a `timeout_ms` above it or raise the cap itself.
 */
export const LABEL_SERVICE_TIMEOUT_MS = 60_000;

/** §4.3 hard complexity caps — code constants (SR-12), never env keys. */
export const COMPLEXITY_LIMITS = Object.freeze({
  queryLength: 10_000,
  triplePatterns: 50,
  unionClauses: 5,
  optionalDepth: 3,
  propertyPaths: 3,
  filters: 20,
  subqueryDepth: 2,
  complexityScore: 40,
});

export type GuardErrorCode = 'validation_error' | 'invalid_query' | 'query_limit_required' | 'query_too_complex';

export class SparqlGuardError extends Error {
  constructor(
    readonly code: GuardErrorCode,
    message: string,
    readonly limits?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SparqlGuardError';
  }
}

export class SparqlParseError extends Error {
  constructor(readonly detail: string) {
    super('The SPARQL endpoint returned a malformed result document.');
    this.name = 'SparqlParseError';
  }
}

export type SparqlExecutionErrorCode = 'query_timeout' | 'rate_limited' | 'upstream_unavailable';

export class SparqlExecutionError extends Error {
  constructor(
    readonly code: SparqlExecutionErrorCode,
    message: string,
    readonly options: {
      retryable?: boolean;
      retryAfterSeconds?: number | null;
      details?: Record<string, unknown>;
      action?: string;
      hint?: string;
    } = {},
  ) {
    super(message);
    this.name = 'SparqlExecutionError';
  }
}

export type SparqlSuccess = {
  vars: string[];
  bindings: Array<Record<string, { type: string; value: string; datatype: string | null; lang: string | null }>>;
  row_count: number;
  truncated: boolean;
  warnings: string[];
  endpoint: string;
  effective_limit: number;
  effective_query: string;
  timestamp: string;
};

type Token = {
  kind: 'word' | 'sym' | 'number';
  text: string;
  start: number;
  end: number;
  braceDepth: number;
};

/**
 * Replace comments, string literals and absolute IRIs with equal-length
 * spaces so keyword detection is token-based and offsets stay stable (§4.2).
 */
function maskQuery(input: string): string {
  const out = input.split('');
  let index = 0;
  const blank = (end: number): void => {
    for (let i = index; i < end && i < out.length; i += 1) {
      if (out[i] !== '\n') out[i] = ' ';
    }
    index = end;
  };
  while (index < input.length) {
    const ch = input[index] as string;
    if (ch === '#') {
      let end = index;
      while (end < input.length && input[end] !== '\n') end += 1;
      blank(end);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const triple = input.slice(index, index + 3) === ch.repeat(3);
      const delimiter = triple ? ch.repeat(3) : ch;
      let end = index + delimiter.length;
      while (end < input.length) {
        if (input.slice(end, end + delimiter.length) === delimiter) { end += delimiter.length; break; }
        if (input[end] === '\\') { end += 2; continue; }
        end += 1;
      }
      blank(Math.min(end, input.length));
      continue;
    }
    if (ch === '<' && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input.slice(index + 1))) {
      const close = input.indexOf('>', index + 1);
      blank(close < 0 ? input.length : close + 1);
      continue;
    }
    index += 1;
  }
  return out.join('');
}

function tokenize(masked: string): Token[] {
  const tokens: Token[] = [];
  let braceDepth = 0;
  const re = /[A-Za-z_][A-Za-z0-9_]*|\d+|[{}()[\];.+*+=<>]/gi;
  for (const match of masked.matchAll(re)) {
    const text = match[0] as string;
    const start = match.index as number;
    const kind: Token['kind'] = /^[A-Za-z_]/.test(text) ? 'word' : /^\d/.test(text) ? 'number' : 'sym';
    tokens.push({ kind, text, start, end: start + text.length, braceDepth });
    if (text === '{' || text === '[' || text === '(') braceDepth += 1;
    else if (text === '}' || text === ']' || text === ')') braceDepth = Math.max(0, braceDepth - 1);
  }
  return tokens;
}

function countWord(tokens: Token[], word: string): number {
  const upper = word.toUpperCase();
  return tokens.filter((token) => token.kind === 'word' && token.text.toUpperCase() === upper).length;
}

/**
 * Detect the (only permitted) label SERVICE on tokenised, masked text so
 * mentions inside comments or string literals do not count. Offsets are
 * stable because masking preserves length (see maskQuery).
 */
export function usesLabelService(query: string): boolean {
  const masked = maskQuery(query);
  return tokenize(masked).some((token) => token.kind === 'word'
    && token.text.toUpperCase() === 'SERVICE'
    && /^wikibase:label\b/i.test(query.slice(token.end).replace(/^\s+/, '')));
}

function limitsFor(maxQueryLength: number, observed: Record<string, number>): Record<string, unknown> {
  const offending = Object.keys(observed).filter((key) => {
    const value = observed[key];
    const threshold = key === 'queryLength'
      ? maxQueryLength
      : (COMPLEXITY_LIMITS[key as keyof typeof COMPLEXITY_LIMITS] ?? Number.MAX_SAFE_INTEGER);
    return value !== undefined && value > threshold;
  });
  return {
    thresholds: { ...COMPLEXITY_LIMITS, queryLength: maxQueryLength },
    observed: { ...observed },
    offending,
  };
}

/** Strip leading PREFIX / BASE declarations so the first verb can be checked. */
function queryAfterPrologue(query: string): { remainder: string; offset: number } {
  let remainder = query;
  const prefixRe = /^\s*(?:PREFIX\s+[A-Za-z][\w.-]*:?\s*<[^>]*>|BASE\s*<[^>]*>)/i;
  for (;;) {
    const match = prefixRe.exec(remainder);
    if (match === null) break;
    remainder = remainder.slice(match[0].length);
  }
  return { remainder, offset: query.length - remainder.length };
}

export type GuardedQuery = {
  effectiveQuery: string;
  effectiveLimit: number;
  warnings: string[];
};

/**
 * Stages 1–4 of §4, executed entirely locally before any outbound request.
 * A failure at any stage returns immediately; no partial query is ever sent.
 */
export function guardQuery(
  rawQuery: string,
  maxQueryLength: number,
  maxRows: number,
  paramLimit?: number,
): GuardedQuery {
  // Stage 1 — schema/length.
  const query = rawQuery.trim();
  if (query.length === 0) {
    throw new SparqlGuardError('validation_error', 'The SPARQL query must not be empty.');
  }
  if (query.length > maxQueryLength) {
    throw new SparqlGuardError('query_too_complex',
      `The SPARQL query is ${query.length} characters; the maximum is ${maxQueryLength}.`,
      limitsFor(maxQueryLength, { queryLength: query.length }));
  }

  const masked = maskQuery(query);
  const tokens = tokenize(masked);

  // Stage 2 — SELECT-only, single statement, restricted SERVICE.
  const { remainder } = queryAfterPrologue(query);
  const remainderTokens = tokenize(maskQuery(remainder));
  const firstVerb = remainderTokens.find((token) => token.kind === 'word');
  if (firstVerb === undefined || firstVerb.text.toUpperCase() !== 'SELECT') {
    throw new SparqlGuardError('invalid_query',
      'Only a single portable SPARQL 1.1 SELECT is allowed; DESCRIBE, ASK, CONSTRUCT and update forms are rejected.');
  }
  const verbs = new Set(['SELECT', 'DESCRIBE', 'ASK', 'CONSTRUCT', 'INSERT', 'DELETE', 'LOAD',
    'CLEAR', 'CREATE', 'DROP', 'COPY', 'MOVE', 'ADD', 'WITH']);
  const topLevelVerbs = tokens.filter((token) => token.kind === 'word' && verbs.has(token.text.toUpperCase())
    && token.braceDepth === 0);
  if (topLevelVerbs.some((token) => token.text.toUpperCase() !== 'SELECT') || topLevelVerbs.length > 1) {
    throw new SparqlGuardError('invalid_query',
      'Exactly one SELECT statement is allowed; a second statement or an update form was detected.');
  }
  for (const token of tokens) {
    if (token.kind !== 'word' || token.text.toUpperCase() !== 'SERVICE') continue;
    const following = query.slice(token.end).replace(/^\s+/, '');
    if (!/^wikibase:label\b/i.test(following)) {
      throw new SparqlGuardError('invalid_query',
        'The only permitted SERVICE is wikibase:label; remote SERVICE IRIs and variables are rejected.');
    }
  }

  // Stage 3 — complexity heuristic.
  const triplePatterns = (masked.match(/(?<![.\d])\.(?![.\d])/g) ?? []).length;
  const unionClauses = countWord(tokens, 'UNION');
  const optionalTokens = tokens.filter((token) => token.kind === 'word' && token.text.toUpperCase() === 'OPTIONAL');
  const optionalDepth = optionalTokens.reduce((max, token) => Math.max(max, token.braceDepth + 1), 0);
  const pathBraces = (masked.match(/\{\s*\d+(?:\s*,\s*\d*)?\s*\}/g) ?? []).length;
  let propertyPaths = pathBraces + tokens.filter((token) => token.text === '+').length;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as Token;
    if (token.text !== '*') continue;
    const previous = i > 0 ? tokens[i - 1] as Token : undefined;
    if (previous === undefined || previous.text.toUpperCase() !== 'SELECT') propertyPaths += 1;
  }
  const filters = countWord(tokens, 'FILTER');
  const subqueryDepth = tokens
    .filter((token) => token.kind === 'word' && token.text.toUpperCase() === 'SELECT')
    .reduce((max, token) => Math.max(max, token.braceDepth), 0);
  const score = triplePatterns + 3 * unionClauses + 2 * optionalTokens.length + 2 * propertyPaths + filters;
  const observed = {
    triplePatterns, unionClauses, optionalDepth, propertyPaths, filters, subqueryDepth, complexityScore: score,
  };
  const breaches = (Object.keys(observed) as Array<keyof typeof observed>)
    .filter((key) => observed[key] > COMPLEXITY_LIMITS[key])
    .concat(optionalDepth > COMPLEXITY_LIMITS.optionalDepth ? ['optionalDepth'] as const : []);
  if (breaches.length > 0 || query.length > maxQueryLength) {
    throw new SparqlGuardError('query_too_complex',
      `The SPARQL query exceeds the local complexity budget (${[...new Set(breaches)].join(', ')}).`,
      limitsFor(maxQueryLength, { ...observed, queryLength: query.length }));
  }

  // Stage 4 — mandatory terminal LIMIT injection / clamping.
  const limitTokens = tokens.filter((token) => token.kind === 'word'
    && token.text.toUpperCase() === 'LIMIT' && token.braceDepth === 0);
  let effectiveQuery = query;
  const warnings: string[] = [];
  let effectiveLimit: number;
  if (limitTokens.length > 0) {
    const limitToken = limitTokens[limitTokens.length - 1] as Token;
    const numberMatch = new RegExp(`^\\s+(\\d+)\\b`).exec(query.slice(limitToken.end));
    if (numberMatch === null || !Number.isSafeInteger(Number(numberMatch[1]))) {
      throw new SparqlGuardError('query_limit_required',
        'The inline LIMIT is missing or malformed; supply a positive integer LIMIT.');
    }
    const inline = Number(numberMatch[1]);
    if (inline <= 0) {
      throw new SparqlGuardError('query_limit_required', 'The inline LIMIT must be a positive integer.');
    }
    const desired = paramLimit === undefined ? inline : paramLimit;
    if (desired <= 0) {
      throw new SparqlGuardError('query_limit_required', '`limit` must be a positive integer.');
    }
    effectiveLimit = Math.min(desired, maxRows);
    if (effectiveLimit !== inline) {
      const valueStart = limitToken.end + (numberMatch[0] as string).indexOf(numberMatch[1] as string);
      const valueEnd = valueStart + (numberMatch[1] as string).length;
      effectiveQuery = `${query.slice(0, valueStart)}${effectiveLimit}${query.slice(valueEnd)}`;
      if (paramLimit === undefined && inline > maxRows) {
        warnings.push(`inline LIMIT clamped to ${effectiveLimit}`);
      }
    }
  } else {
    if (paramLimit !== undefined && paramLimit <= 0) {
      throw new SparqlGuardError('query_limit_required', '`limit` must be a positive integer.');
    }
    effectiveLimit = Math.min(paramLimit ?? Math.min(100, maxRows), maxRows);
    effectiveQuery = `${query.replace(/\s+$/, '')} LIMIT ${effectiveLimit}`;
  }
  return { effectiveQuery, effectiveLimit, warnings };
}

/** §4.6 — portable SPARQL 1.1 JSON parsing, normalisation and result caps. */
export function parseSparqlResults(
  json: unknown,
  effectiveLimit: number,
  maxBytes: number,
): { vars: string[]; bindings: SparqlSuccess['bindings']; truncated: boolean; warnings: string[] } {
  const root = json !== null && typeof json === 'object' && !Array.isArray(json)
    ? json as Record<string, unknown> : null;
  const head = root === null ? null : root['head'] as Record<string, unknown> | undefined;
  const rawVars = head === null || head === undefined || !Array.isArray(head['vars']) ? null : head['vars'];
  const results = root === null ? null : root['results'] as Record<string, unknown> | undefined;
  const rawBindings = results === null || results === undefined || !Array.isArray(results['bindings'])
    ? null : results['bindings'];
  if (rawVars === null || rawBindings === null) {
    throw new SparqlParseError('expected head.vars[] and results.bindings[]');
  }
  const vars = rawVars.filter((value): value is string => typeof value === 'string');
  const bindings: SparqlSuccess['bindings'] = [];
  for (const rawBinding of rawBindings) {
    if (rawBinding === null || typeof rawBinding !== 'object' || Array.isArray(rawBinding)) {
      throw new SparqlParseError('a binding was not an object');
    }
    const binding: SparqlSuccess['bindings'][number] = {};
    for (const [key, rawValue] of Object.entries(rawBinding as Record<string, unknown>)) {
      if (rawValue === null || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        throw new SparqlParseError(`binding ${key} was not an object`);
      }
      const value = rawValue as Record<string, unknown>;
      if (typeof value['value'] !== 'string' || typeof value['type'] !== 'string') {
        throw new SparqlParseError(`binding ${key} lacked type/value`);
      }
      binding[key] = {
        type: ['uri', 'literal', 'bnode', 'typed-literal'].includes(value['type']) ? value['type'] : 'literal',
        value: value['value'],
        datatype: typeof value['datatype'] === 'string' ? value['datatype'] : null,
        lang: typeof value['xml:lang'] === 'string' ? value['xml:lang']
          : typeof value['lang'] === 'string' ? value['lang'] : null,
      };
    }
    bindings.push(binding);
  }
  let truncated = false;
  const warnings: string[] = [];
  if (bindings.length > effectiveLimit) {
    bindings.length = effectiveLimit;
    truncated = true;
    warnings.push(`result rows truncated to effective LIMIT ${effectiveLimit}`);
  }
  const fits = (): boolean => Buffer.byteLength(JSON.stringify({ vars, results: { bindings } }), 'utf8') <= Math.max(512, maxBytes - 1024);
  while (bindings.length > 0 && !fits()) {
    bindings.pop();
    truncated = true;
  }
  if (truncated && !warnings.some((warning) => warning.includes('MAX_RESULT_BYTES'))) {
    warnings.push('result truncated at MAX_RESULT_BYTES (binding boundary)');
  }
  return { vars, bindings, truncated, warnings };
}

/** Cache with TTL = min(300000, METADATA_CACHE_TTL_MS) (§4.5). */
class SparqlCache {
  private readonly entries = new Map<string, { value: SparqlSuccess; expiresAt: number }>();
  constructor(private readonly ttlMs: number) {}

  get(key: string): SparqlSuccess | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) { this.entries.delete(key); return undefined; }
    // Refresh insertion order for LRU behaviour.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: SparqlSuccess): void {
    if (this.entries.size >= 100) {
      const oldest = this.entries.keys().next();
      if (oldest.done !== true) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void { this.entries.clear(); }
}

/** Runners are tracked per client so tests can reset identical-query caches. */
const runnersByClient = new WeakMap<WikimediaClient, SparqlRunner>();

export function clearSparqlCaches(client: WikimediaClient): void {
  runnersByClient.get(client)?.clearCache();
}

/**
 * Executes guarded SPARQL queries with the WDQS budget, fallback chain,
 * stay-and-retry 429/503 policy and abort handling (§4.5–§4.7).
 */
export class SparqlRunner {
  private readonly plan: SparqlEndpointPlan;
  private readonly wdqs: ReturnType<typeof pLimit>;
  private readonly cache: SparqlCache;

  constructor(
    private readonly config: Config,
    private readonly client: WikimediaClient,
    private readonly options: {
      sleep?: (ms: number) => Promise<void>;
      now?: () => number;
    } = {},
  ) {
    this.plan = sparqlEndpointPlan(config);
    this.wdqs = pLimit(Math.min(2, config.concurrencyLimit));
    this.cache = new SparqlCache(Math.min(300_000, config.metadataCacheTtlMs));
    runnersByClient.set(client, this);
  }

  get endpointChain(): readonly string[] { return this.plan.endpoints; }

  clearCache(): void { this.cache.clear(); }

  private sleep(ms: number): Promise<void> {
    return this.options.sleep !== undefined
      ? this.options.sleep(ms)
      : new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  async execute(
    effectiveQuery: string,
    effectiveLimit: number,
    options: { signal?: AbortSignal; timeoutMs?: number; cacheable?: boolean } = {},
  ): Promise<SparqlSuccess> {
    const accept = this.plan.accept;
    const key = `${this.plan.endpoints.join('|')}|${effectiveQuery}|${effectiveLimit}|${accept}`;
    if (options.cacheable !== false) {
      const cached = this.cache.get(key);
      if (cached !== undefined) return cached;
    }
    const timeoutMs = Math.min(options.timeoutMs ?? this.plan.timeoutMs, LABEL_SERVICE_TIMEOUT_MS);
    let timedOut = false;
    let inboundAborted = false;
    const endpointClasses = this.plan.endpoints.map((url) => {
      try { return new URL(url).hostname; } catch { return 'endpoint'; }
    });

    for (const endpoint of this.plan.endpoints) {
      let retryCount = 0;
      for (;;) {
        const controller = new AbortController();
        const onAbort = (): void => { inboundAborted = true; controller.abort(); };
        if (options.signal !== undefined) {
          if (options.signal.aborted) onAbort();
          else options.signal.addEventListener('abort', onAbort, { once: true });
        }
        let completed = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        try {
          const raw = await this.client.outbound(() => this.wdqs(() => this.client.rawRequest(
            `${endpoint}?query=${encodeURIComponent(effectiveQuery)}&format=json`,
            { headers: { Accept: accept }, signal: controller.signal, redirect: 'manual' },
          )));
          completed = true;
          if (raw.status >= 200 && raw.status < 300) {
            const parsed = parseSparqlResults(JSON.parse(raw.text) as unknown, effectiveLimit, this.config.maxResultBytes);
            const warnings = [...parsed.warnings];
            if (retryCount > 0) warnings.push(`endpoint returned a transient 429/503; retried ${retryCount} time(s) on the same endpoint`);
            const success: SparqlSuccess = {
              vars: parsed.vars,
              bindings: parsed.bindings,
              row_count: parsed.bindings.length,
              truncated: parsed.truncated,
              warnings,
              endpoint,
              effective_limit: effectiveLimit,
              effective_query: effectiveQuery,
              timestamp: new Date(this.options.now?.() ?? Date.now()).toISOString(),
            };
            if (options.cacheable !== false) this.cache.set(key, success);
            return success;
          }
          const retryAfterMs = parseRetryAfter(raw.headers['retry-after'], this.config.retryAfterFallbackMs);
          if (raw.status === 429 || raw.status === 503) {
            if (inboundAborted) throw new SparqlExecutionError('query_timeout', 'The request was cancelled before the SPARQL query completed.', {
              retryable: true, action: 'Retry the call; the query was cancelled.', hint: 'Client-side cancellation.',
            });
            if (retryCount + 1 >= this.config.retryMaxAttempts) {
              const code = raw.status === 429 ? 'rate_limited' : 'upstream_unavailable';
              throw new SparqlExecutionError(code,
                raw.status === 429
                  ? 'The SPARQL endpoint is rate-limiting requests after bounded retries.'
                  : 'The SPARQL endpoint is overloaded after bounded retries.', {
                retryable: true,
                retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
                details: { http_status: raw.status, backend: 'wdqs', endpoint_class: new URL(endpoint).hostname },
                action: raw.status === 429
                  ? 'Wait for retry_after_seconds and retry with a simpler or cached query.'
                  : 'Wait for retry_after_seconds, then retry or use another endpoint.',
              });
            }
            retryCount += 1;
            await this.sleep(retryAfterMs);
            continue;
          }
          // 401/403/404/other-5xx/3xx: advance to the next endpoint, never echo the body.
          break;
        } catch (error) {
          if (error instanceof SparqlExecutionError) throw error;
          if (inboundAborted) {
            throw new SparqlExecutionError('query_timeout', 'The request was cancelled before the SPARQL query completed.', {
              retryable: true, action: 'Retry the call; the query was cancelled.', hint: 'Client-side cancellation.',
            });
          }
          if (timedOut) {
            // Deadline reached: advance if another endpoint remains, otherwise
            // the loop ends with query_timeout below.
            break;
          }
          if (error instanceof SyntaxError || error instanceof SparqlParseError) {
            throw new SparqlExecutionError('upstream_unavailable',
              'The SPARQL endpoint returned a malformed result document.', {
              retryable: true,
              details: { backend: 'wdqs', parse_error: error instanceof SparqlParseError ? error.detail : 'non-JSON body' },
              action: 'Retry once; if it persists, use a simpler SPARQL 1.1 SELECT.',
            });
          }
          if (error instanceof UpstreamError && error.status === 0) break; // network fault: next endpoint
        } finally {
          clearTimeout(timer);
          if (!completed && options.signal !== undefined) options.signal.removeEventListener('abort', onAbort);
          if (completed) options.signal?.removeEventListener('abort', onAbort);
        }
      }
    }
    if (timedOut) {
      const labelService = usesLabelService(effectiveQuery);
      const atHardCap = timeoutMs >= LABEL_SERVICE_TIMEOUT_MS;
      throw new SparqlExecutionError('query_timeout', `The SPARQL query exceeded its ${timeoutMs} ms deadline.`, {
        retryable: true,
        details: {
          backend: 'wdqs', timeout_ms: timeoutMs, effective_timeout_ms: timeoutMs, label_service: labelService,
        },
        // Never suggest raising timeout_ms once the 60 s hard cap is already in
        // force; name the label service so the next action is concrete.
        action: atHardCap
          ? 'Simplify the query, add a LIMIT, or split label decoration into a bounded SELECT without the label service.'
          : 'Simplify the query, add a LIMIT, or raise timeout_ms (maximum 60000).',
        hint: labelService
          ? atHardCap
            ? 'The wikibase:label SERVICE is the likely cause of the slow query; timeout_ms is already at the 60000 ms hard cap.'
            : 'The wikibase:label SERVICE is the likely cause of the slow query; raise timeout_ms up to 60000.'
          : atHardCap
            ? 'The query deadline was reached at the 60000 ms hard cap; simplify the query.'
            : 'The query deadline was reached; timeout_ms may be raised up to 60000.',
      });
    }
    throw new SparqlExecutionError('upstream_unavailable',
      'All configured SPARQL endpoints were unavailable. No endpoint returned a usable result.', {
      retryable: true,
      details: { backend: 'wdqs', endpoints_tried: endpointClasses },
      action: 'Check WDQS availability and retry; configure an alternate WIKIDATA_SPARQL endpoint if needed.',
    });
  }
}
