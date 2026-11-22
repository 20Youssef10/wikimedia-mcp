import type { ZodType } from 'zod';
import type { Config } from '../config.js';
import type { ResolveResult, ToolErrorCode, ToolPayload, ToolResponse } from '../types.js';
import { resolveTarget, ResolverError } from '../resolver.js';
import { WikimediaClient, asRecord } from '../upstream/client.js';
import { UpstreamError } from '../upstream/retry.js';
import { toolError } from '../protocol/errors.js';
import { errorToolResult, okToolResult } from '../protocol/result.js';
import { enforceResultLimit } from '../protocol/limits.js';
import { createPacedLane, REAL_CLOCK, type PacingClock } from '../upstream/pacing.js';
import {
  GEO_LIMITS, WARN, geoSearchProvenance, tableProvenance,
  revisionFromEtag, timestampFromLastModified, groupArticleUrl,
} from './constants.js';
import { parseTables } from './html-tables.js';
import {
  geoSearchSchema, getTablesSchema,
  type GeoSearchInput, type GetTablesInput,
} from './schemas.js';

type G5Handler = (raw: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResponse>;

const FORBIDDEN_HOST_KEYS = ['host', 'api_url', 'endpoint', 'base_url', 'url'];

/** Group G lane derived from the single global CONCURRENCY_LIMIT (no new keys). */
function groupGPacing(config: Config, clock: PacingClock) {
  return createPacedLane(Math.min(3, config.concurrencyLimit), 3, 3, clock);
}

/** Every Group G error carries a non-empty, actionable hint (AC-115). */
function gError(
  code: ToolErrorCode,
  message: string,
  options: Parameters<typeof toolError>[2] = {},
): ReturnType<typeof toolError> {
  return toolError(code, message, {
    hint: 'Review the arguments and retry the call.',
    ...options,
  });
}

function throwG(code: ToolErrorCode, message: string, options: Parameters<typeof toolError>[2] = {}): never {
  throw Object.assign(new Error(message), { toolError: gError(code, message, options) });
}

function validationResponse(name: string, detail: string): ToolResponse {
  return errorToolResult('validation_error', `Invalid arguments for ${name}: ${detail}`, {
    retryable: false,
    hint: 'Correct the invalid arguments and retry the call.',
    details: { tool: name },
  });
}

/** finite-type then WGS84-bounds validation, before any outbound request. */
function geoPreValidate(raw: Record<string, unknown>): ToolResponse | undefined {
  for (const key of ['latitude', 'longitude'] as const) {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return validationResponse('geo_search', `${key} must be a finite JSON number.`);
    }
  }
  const latitude = raw['latitude'] as number;
  const longitude = raw['longitude'] as number;
  const outOfBounds = latitude < GEO_LIMITS.latitude[0] || latitude > GEO_LIMITS.latitude[1]
    || longitude < GEO_LIMITS.longitude[0] || longitude > GEO_LIMITS.longitude[1];
  if (outOfBounds) {
    const parameter = latitude < GEO_LIMITS.latitude[0] || latitude > GEO_LIMITS.latitude[1]
      ? 'latitude' : 'longitude';
    return errorToolResult(
      'invalid_coordinates',
      `latitude must be between -90 and 90 and longitude between -180 and 180; received ${parameter} ${parameter === 'latitude' ? latitude : longitude}.`,
      {
        retryable: false,
        hint: 'Supply finite WGS84 decimal degrees: latitude in [-90, 90], longitude in [-180, 180].',
        details: {
          tool: 'geo_search',
          parameter,
          limits: { latitude: [...GEO_LIMITS.latitude], longitude: [...GEO_LIMITS.longitude] },
        },
      },
    );
  }
  return undefined;
}

/** Title encoding guard from contract §3.1 (zero outbound on failure). */
function tablePreValidate(raw: Record<string, unknown>): ToolResponse | undefined {
  const title = raw['title'];
  if (typeof title !== 'string') return validationResponse('get_tables', 'title must be a string.');
  if (/[\u0000-\u001F\u007F]/.test(title) || title.includes('\\') || title.includes('..')) {
    return validationResponse('get_tables', 'title contains a rejected encoding character (control character, backslash or ".." segment).');
  }
  return undefined;
}

function mapGroupGError(name: string, error: unknown): ToolResponse {
  if (error !== null && typeof error === 'object' && 'toolError' in error) {
    const mapped = (error as { toolError: unknown }).toolError;
    if (mapped !== null && typeof mapped === 'object' && 'code' in mapped && 'message' in mapped) {
      const t = mapped as import('../types.js').ToolError;
      return errorToolResult(t.code, t.message, {
        retryable: t.retryable,
        retryAfterSeconds: t.retry_after_seconds,
        hint: t.hint,
        details: { ...t.details, tool: name },
        ...(t.limits === undefined ? {} : { limits: t.limits }),
      });
    }
  }
  if (error instanceof ResolverError) {
    const code: ToolErrorCode = error.kind === 'invalid_language' ? 'invalid_language' : 'invalid_project';
    return errorToolResult(code, error.message, {
      retryable: false,
      hint: code === 'invalid_language'
        ? 'Use a 2-12 character Wikimedia language code.'
        : 'Use a supported project name or Wikimedia project code such as enwiki or commonswiki.',
      details: { tool: name, kind: error.kind },
    });
  }
  if (error instanceof UpstreamError) {
    if (error.status === 0) {
      const host = error.host ?? 'the upstream host';
      return errorToolResult('upstream_unavailable', `Could not reach the upstream wiki at ${host}.`, {
        retryable: true,
        hint: `Check DNS/network access to ${host} and retry the call.`,
        details: { tool: name, host, network: true, backend: 'wikimedia' },
      });
    }
    if (error.status === 429) {
      return errorToolResult('rate_limited', 'Upstream rate limit reached after bounded retries.', {
        retryable: true,
        retryAfterSeconds: Math.ceil((error.retryAfterMs ?? 5000) / 1000),
        hint: 'Wait for retry_after_seconds (or the indicated backoff) and retry the call.',
        details: { tool: name, http_status: 429, backend: 'wikimedia' },
      });
    }
    return errorToolResult('upstream_unavailable', 'The upstream service is temporarily unavailable. Retry shortly.', {
      retryable: error.status >= 500,
      hint: 'Retry the call shortly; if it persists, narrow the query.',
      details: { tool: name, http_status: error.status, backend: 'wikimedia' },
    });
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return errorToolResult('timeout', 'The upstream request was cancelled or timed out. Retry the call.', {
      retryable: true,
      hint: 'Retry the call; consider a smaller limit or narrower query.',
      details: { tool: name },
    });
  }
  return errorToolResult('internal_error', `An internal error occurred in ${name}. Retry with the correlation ID.`, {
    retryable: true,
    hint: 'Retry once; if the error persists, report it with the correlation ID.',
    details: { tool: name, error_type: error instanceof Error ? error.name : 'unknown' },
  });
}

/**
 * Final serialised-result cap (§4.4.3 `max_result_bytes`). Clip emitted arrays
 * in document order, keep provenance, set `truncated` and add the named warning
 * before the shared enforceResultLimit safety net runs.
 */
function applyByteCap(payload: ToolPayload, maxBytes: number): ToolPayload {
  const size = () => Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (size() <= maxBytes) return payload;
  const result: ToolPayload = { ...payload };
  const resultSize = () => Buffer.byteLength(JSON.stringify(result), 'utf8');
  let clipped = false;
  for (const key of ['tables', 'pages'] as const) {
    const value = result[key];
    if (!Array.isArray(value)) continue;
    while (value.length > 0 && resultSize() > maxBytes) {
      value.pop();
      clipped = true;
    }
    if (resultSize() <= maxBytes) break;
  }
  if (!clipped) return payload;
  result['truncated'] = true;
  for (const key of ['tables', 'pages'] as const) {
    const value = result[key];
    if (Array.isArray(value)) result['count'] = value.length;
  }
  const warnings = Array.isArray(result['warnings']) ? [...(result['warnings'] as string[])] : [];
  if (!warnings.includes(WARN.maxBytes)) warnings.push(WARN.maxBytes);
  result['warnings'] = warnings;
  return result;
}

function fetchOptions(signal: AbortSignal | undefined, backend: string, accept?: string) {
  return {
    backend,
    ...(signal === undefined ? {} : { signal }),
    ...(accept === undefined ? {} : { accept }),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createGroupGHandlers(
  client: WikimediaClient,
  config: Config,
  options: { clock?: PacingClock } = {},
): Record<string, G5Handler> {
  const clock = options.clock ?? REAL_CLOCK;
  const lane = groupGPacing(config, clock);

  async function run<TInput>(
    name: string,
    schema: ZodType<TInput>,
    raw: Record<string, unknown>,
    fn: (input: TInput, target: ResolveResult, signal?: AbortSignal) => Promise<ToolPayload>,
    signal?: AbortSignal,
    preValidate?: (raw: Record<string, unknown>) => ToolResponse | undefined,
  ): Promise<ToolResponse> {
    const forbidden = FORBIDDEN_HOST_KEYS.find((key) => key in raw);
    if (forbidden !== undefined) {
      return errorToolResult('host_not_allowed',
        `Parameter '${forbidden}' is not accepted. Hosts are fixed by the server allowlist; no outbound request was made.`,
        {
          retryable: false,
          hint: 'Remove the host parameter and use lang/project only.',
          details: { tool: name, rejected_key: forbidden },
        });
    }
    if (preValidate !== undefined) {
      const rejected = preValidate(raw);
      if (rejected !== undefined) return rejected;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return validationResponse(name, detail);
    }
    try {
      const input = parsed.data as { lang?: string; project?: string };
      const target = resolveTarget({
        ...(input.lang === undefined ? {} : { lang: input.lang }),
        ...(input.project === undefined ? {} : { project: input.project }),
      });
      const output = await fn(parsed.data, target, signal);
      const byteCapped = applyByteCap(output, config.maxResultBytes);
      return okToolResult(enforceResultLimit(byteCapped, config.maxResultBytes));
    } catch (error) {
      return mapGroupGError(name, error);
    }
  }

  return {
    async geo_search(raw, signal) {
      return run<GeoSearchInput>('geo_search', geoSearchSchema, raw, async (input, target, childSignal) => {
        // Exact Action API URL from contract §3.1 (pipe encoded as %7C).
        const params = new URLSearchParams();
        params.set('action', 'query');
        params.set('format', 'json');
        params.set('list', 'geosearch');
        params.set('gscoord', `${input.latitude}|${input.longitude}`);
        params.set('gsradius', String(input.radius_m));
        params.set('gsnamespace', String(input.namespace));
        params.set('gslimit', String(input.limit));
        const url = `${target.actionUrl}?${params.toString()}`;

        const response = await lane.run(() => client.getJson(url, fetchOptions(childSignal, 'wikimedia-action')));
        const root = asRecord(response.json);
        const query = root === null ? null : asRecord(root['query']);
        const hits = query !== null && Array.isArray(query['geosearch']) ? query['geosearch'] : [];
        const pages = hits.slice(0, input.limit).map((item) => {
          const hit = asRecord(item) ?? {};
          const title = typeof hit['title'] === 'string' ? hit['title'] : '';
          return {
            pageid: hit['pageid'] ?? null,
            ns: hit['ns'] ?? 0,
            title,
            coordinates: { lat: numberOrNull(hit['lat']), lon: numberOrNull(hit['lon']) },
            distance_m: typeof hit['dist'] === 'number' ? Math.round(hit['dist']) : 0,
            url: groupArticleUrl(target, title),
          };
        });
        const truncated = pages.length === input.limit;
        const warnings = truncated ? [WARN.resultCap] : [];
        return {
          centre: { latitude: input.latitude, longitude: input.longitude },
          radius_m: input.radius_m,
          namespace: input.namespace,
          limit: input.limit,
          pages,
          count: pages.length,
          truncated,
          warnings,
          ...geoSearchProvenance(target),
        };
      }, signal, geoPreValidate);
    },

    async get_tables(raw, signal) {
      return run<GetTablesInput>('get_tables', getTablesSchema, raw, async (input, target, childSignal) => {
        // Parsoid HTML is the sole accepted table source (D8); no wikitext call.
        const url = `${target.restBase}/page/html/${encodeURIComponent(input.title)}`;
        const response = await lane.run(() => client.getJson(url, fetchOptions(childSignal, 'wikimedia-rest-v1', 'text/html')));
        if (response.status === 404) {
          throwG('page_not_found', `No page titled '${input.title}' exists on ${target.source}.`, {
            retryable: false,
            hint: `Call search({ q: '${input.title}' }) with the same lang/project to find the correct title.`,
            details: { http_status: 404, backend: 'wikimedia-rest-v1', title: input.title },
          });
        }

        const revision = revisionFromEtag(response.headers['etag']);
        const timestamp = timestampFromLastModified(response.headers['last-modified']);
        const parsed = parseTables(typeof response.text === 'string' ? response.text : '');

        const select = <T extends { index: number }>(all: T[]): T[] => {
          if (input.table_index === undefined) return all;
          const chosen = all[input.table_index];
          return chosen === undefined ? [] : [{ ...chosen, index: input.table_index }];
        };
        const structured = select(parsed.structured);
        const htmlTables = select(parsed.html);

        const common = {
          title: input.title,
          count: (input.output === 'html' ? htmlTables : structured).length,
          untrusted_content: true,
          ...tableProvenance(target, input.title, revision, timestamp, input.output),
        };

        if (input.output === 'html') {
          const warnings = [WARN.untrustedHtml, ...parsed.htmlWarnings];
          return {
            ...common,
            output: 'html',
            tables: htmlTables,
            truncated: parsed.htmlCapped,
            warnings: [...new Set(warnings)],
          };
        }
        return {
          ...common,
          output: 'structured',
          tables: structured,
          truncated: parsed.structuredCapped,
          warnings: [...new Set(parsed.structuredWarnings)],
        };
      }, signal, tablePreValidate);
    },
  };
}

export type GroupGHandlers = ReturnType<typeof createGroupGHandlers>;
