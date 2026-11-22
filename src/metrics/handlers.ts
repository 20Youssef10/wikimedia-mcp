import type { ZodType } from 'zod';
import type { Config } from '../config.js';
import type { ToolResponse, ToolPayload } from '../types.js';
import { WikimediaClient, asRecord } from '../upstream/client.js';
import { UpstreamError } from '../upstream/retry.js';
import { createPacedLane, REAL_CLOCK, type PacingClock } from '../upstream/pacing.js';
import { errorToolResult, okToolResult } from '../protocol/result.js';
import { enforceResultLimit } from '../protocol/limits.js';
import {
  ANALYTICS_BASE, METRICS_BURST, METRICS_CACHE_TTL_CAP_MS, METRICS_RATE_PER_SECOND,
  UNIQUE_DEVICES_MEANING, analyticsProvenance,
} from './constants.js';
import { resolveAnalyticsProject, AnalyticsProjectError } from './project.js';
import { DateGuardError, guardCompactRange, guardIsoDate } from './guards.js';
import {
  getPageviewsSchema, getMostReadSchema, getUniqueDevicesSchema,
  type GetPageviewsInput, type GetMostReadInput, type GetUniqueDevicesInput,
} from './schemas.js';

type GroupCHandler = (raw: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResponse>;

const FORBIDDEN_HOST_KEYS = ['host', 'api_url', 'endpoint', 'base_url', 'url'];

function assertSafeTitle(title: string): void {
  if (/[\u0000-\u001F\u007F]/.test(title) || title.includes('\\') || title.includes('..')) {
    throw new DateGuardError('invalid_article', `Article '${title}' contains a rejected encoding character.`, { field: 'article' });
  }
}

function encodedArticle(title: string): string {
  return encodeURIComponent(title.replace(/ /g, '_'));
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function createMetricsHandlers(
  client: WikimediaClient,
  config: Config,
  options: { now?: () => number; clock?: PacingClock } = {},
): Record<string, GroupCHandler> {
  const now = options.now ?? (() => Date.now());
  const clock = options.clock ?? REAL_CLOCK;
  const lane = createPacedLane(
    Math.min(2, config.concurrencyLimit),
    METRICS_RATE_PER_SECOND,
    METRICS_BURST,
    clock,
  );
  const ttl = Math.min(METRICS_CACHE_TTL_CAP_MS, config.metadataCacheTtlMs);

  function mapError(name: string, error: unknown): ToolResponse {
    if (error instanceof DateGuardError) {
      return errorToolResult(error.code, error.message, {
        retryable: false,
        details: { tool: name, ...error.details },
        ...(Object.keys(error.details).includes('limits') ? { limits: error.details['limits'] as Record<string, unknown> } : {}),
      });
    }
    if (error instanceof AnalyticsProjectError) {
      return errorToolResult('invalid_project', error.message, {
        retryable: false,
        hint: 'Use a dotted Analytics code such as en.wikipedia or a Phase 1 alias such as enwiki/commonswiki.',
        details: { tool: name },
      });
    }
    if (error instanceof UpstreamError) {
      if (error.status === 429) {
        return errorToolResult('rate_limited', 'Analytics API rate limit reached after bounded retries.', {
          retryable: true,
          retryAfterSeconds: Math.ceil((error.retryAfterMs ?? config.retryAfterFallbackMs) / 1000),
          details: { tool: name, http_status: 429, backend: 'wikimedia-analytics' },
        });
      }
      if (error.status === 0) {
        return errorToolResult('upstream_unavailable', 'Could not reach the Wikimedia Analytics API.', {
          retryable: true,
          hint: 'Check DNS/network access to wikimedia.org and retry.',
          details: { tool: name, host: error.host ?? 'wikimedia.org', network: true },
        });
      }
      return errorToolResult('upstream_unavailable', 'The Analytics API is temporarily unavailable. Retry shortly.', {
        retryable: error.status >= 500,
        details: { tool: name, http_status: error.status, backend: 'wikimedia-analytics' },
      });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return errorToolResult('timeout', 'The Analytics request was cancelled or timed out. Retry the call.', {
        retryable: true, details: { tool: name },
      });
    }
    return errorToolResult('internal_error', `An internal error occurred in ${name}. Retry with the correlation ID.`, {
      retryable: true, details: { tool: name, error_type: error instanceof Error ? error.name : 'unknown' },
    });
  }

  async function run<TInput>(
    name: string,
    schema: ZodType<TInput>,
    raw: Record<string, unknown>,
    fn: (input: TInput, signal?: AbortSignal) => Promise<ToolPayload>,
    signal?: AbortSignal,
  ): Promise<ToolResponse> {
    const forbidden = FORBIDDEN_HOST_KEYS.find((key) => key in raw);
    if (forbidden !== undefined) {
      return errorToolResult('host_not_allowed',
        `Parameter '${forbidden}' is not accepted. Hosts are fixed by the server allowlist; no outbound request was made.`,
        { retryable: false, details: { tool: name, rejected_key: forbidden } });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return errorToolResult('validation_error', `Invalid arguments for ${name}: ${detail}`, {
        retryable: false, details: { tool: name },
      });
    }
    try {
      const output = await fn(parsed.data, signal);
      return okToolResult(enforceResultLimit(output, config.maxResultBytes));
    } catch (error) {
      return mapError(name, error);
    }
  }

  async function fetchAnalytics(url: string, signal?: AbortSignal) {
    return client.cached(url, () => lane.run(() => client.getJson(url, {
      ...(signal === undefined ? {} : { signal }),
      backend: 'wikimedia-analytics',
    })), ttl);
  }

  return {
    async get_pageviews(raw, signal) {
      return run<GetPageviewsInput>('get_pageviews', getPageviewsSchema, raw, async (input, childSignal) => {
        const project = resolveAnalyticsProject(input.project);
        assertSafeTitle(input.article);
        guardCompactRange(input.start, input.end, input.granularity, now());
        const url = `${ANALYTICS_BASE}/pageviews/per-article/${project.code}/${input.access}/${input.agent}/${encodedArticle(input.article)}/${input.granularity}/${input.start}/${input.end}`;
        const response = await fetchAnalytics(url, childSignal);
        const root = asRecord(response.json) ?? {};
        const items = Array.isArray(root['items']) ? root['items'] : [];
        const results = items.flatMap((item) => {
          const record = asRecord(item);
          if (record === null) return [];
          const rawTs = typeof record['timestamp'] === 'string' ? record['timestamp'] : '';
          const timestamp = input.granularity === 'hourly' ? rawTs : rawTs.slice(0, 8);
          return [{ timestamp, views: num(record['views']) }];
        });
        return {
          project: project.code,
          article: input.article,
          granularity: input.granularity,
          access: input.access,
          agent: input.agent,
          start: input.start,
          end: input.end,
          results,
          count: results.length,
          ...analyticsProvenance(url),
        };
      }, signal);
    },

    async get_most_read(raw, signal) {
      // AC-66 / TC-C-008: 'today' is a completed-period violation with zero
      // outbound requests. The advertised schema stays byte-for-byte frozen;
      // this local guard translates the special value to invalid_date_range.
      if (raw['date'] === 'today') {
        return errorToolResult('invalid_date_range', "'date' must be a completed UTC day (<= yesterday); 'today' is rejected.", {
          retryable: false, details: { tool: 'get_most_read', field: 'date', detail: 'future_or_today' },
        });
      }
      return run<GetMostReadInput>('get_most_read', getMostReadSchema, raw, async (input, childSignal) => {
        const project = resolveAnalyticsProject(input.project);
        const date = guardIsoDate(input.date, now());
        const url = `${ANALYTICS_BASE}/pageviews/top/${project.code}/${input.access}/${date.yyyy}/${date.mm}/${date.dd}`;
        const response = await fetchAnalytics(url, childSignal);
        const root = asRecord(response.json) ?? {};
        const items = Array.isArray(root['items']) ? root['items'] : [];
        const first = asRecord(items[0]) ?? {};
        const upstreamArticles = Array.isArray(first['articles']) ? first['articles'] : [];
        const articles = upstreamArticles.slice(0, input.limit).flatMap((item) => {
          const record = asRecord(item);
          if (record === null) return [];
          const upstreamTitle = typeof record['article'] === 'string' ? record['article'] : '';
          return [{
            title: upstreamTitle.replace(/_/g, ' '),
            views: num(record['views']),
            rank: num(record['rank']),
            url: `https://${project.host}/wiki/${encodeURIComponent(upstreamTitle)}`,
          }];
        });
        return {
          project: project.code,
          date: input.date,
          access: input.access,
          articles,
          count: articles.length,
          ...analyticsProvenance(url),
        };
      }, signal);
    },

    async get_unique_devices(raw, signal) {
      return run<GetUniqueDevicesInput>('get_unique_devices', getUniqueDevicesSchema, raw, async (input, childSignal) => {
        const project = resolveAnalyticsProject(input.project);
        guardCompactRange(input.start, input.end, input.granularity, now());
        const url = `${ANALYTICS_BASE}/unique-devices/${project.code}/${input.access_site}/${input.granularity}/${input.start}/${input.end}`;
        const response = await fetchAnalytics(url, childSignal);
        const root = asRecord(response.json) ?? {};
        const items = Array.isArray(root['items']) ? root['items'] : [];
        const results = items.flatMap((item) => {
          const record = asRecord(item);
          if (record === null) return [];
          return [{
            timestamp: typeof record['timestamp'] === 'string' ? record['timestamp'] : '',
            devices: num(record['devices']),
            offset: num(record['offset']),
            underestimate: num(record['underestimate']),
          }];
        });
        return {
          project: project.code,
          access_site: input.access_site,
          granularity: input.granularity,
          start: input.start,
          end: input.end,
          results,
          count: results.length,
          meaning: UNIQUE_DEVICES_MEANING,
          ...analyticsProvenance(url),
        };
      }, signal);
    },
  };
}
