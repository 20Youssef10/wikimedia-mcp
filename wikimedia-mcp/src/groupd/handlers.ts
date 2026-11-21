import type { Config } from '../config.js';
import { resolveTarget } from '../resolver.js';
import type { ResolveResult, ToolResponse } from '../types.js';
import { WikimediaClient, asRecord } from '../upstream/client.js';
import { errorToolResult, okToolResult } from '../protocol/result.js';
import { enforceResultLimit } from '../protocol/limits.js';
import { RecentChangesCache, buildCacheKey } from './cache.js';
import {
  BACKEND_NAME,
  GROUP_D_TOOL_NAMES,
  LIMIT_CLAMPED_WARNING,
  RECENT_CHANGES_CACHE_TTL_MS,
  RECENT_CHANGES_FRESH_WARN_MS,
  RECENT_CHANGES_MAX_CACHE_AGE_MS,
  RECENT_CHANGES_MAX_HOPS,
  RECENT_CHANGES_MAX_LIMIT,
  RECENT_CHANGES_MAX_WINDOW_S,
  TRUNCATION_WARNING,
  UNTRUSTED_CONTENT_WARNING,
  WINDOW_CLAMPED_WARNING,
  isoSecond,
  recentChangesProvenance,
} from './constants.js';
import { decodeCursor, encodeCursor, queryHash, type CursorPayload } from './cursor.js';
import { mapGroupDError, throwGroupD } from './errors.js';
import {
  getRecentChangesSchema,
  type GetRecentChangesInput,
} from './schemas.js';

const TOOL = GROUP_D_TOOL_NAMES[0];

export type GroupDHandler = (
  raw: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<ToolResponse>;

function fetchOptions(signal: AbortSignal | undefined, headers?: Record<string, string>) {
  return {
    backend: BACKEND_NAME,
    ...(signal === undefined ? {} : { signal }),
    ...(headers === undefined ? {} : { headers }),
  };
}

/**
 * Action API URL from contract §3.1 (parameter order is part of the fixture).
 * BUG FIX (contract v6.1.0): MediaWiki enumerates recent changes backwards in
 * time, so `rcstart` must be the NEWER timestamp (window end) and `rcend` the
 * OLDER one (window start). v6.0.0 had them reversed, which produced an empty
 * live feed. The caller still supplies `start`/`end` in chronological order;
 * the swap happens here, at the wire boundary only.
 */
export function buildRecentChangesUrl(
  target: ResolveResult,
  input: {
    namespace: number;
    applied_limit: number;
    start: string;
    end: string;
    include_bots: boolean;
    rccontinue: string | null;
    change_types: readonly string[] | null;
  },
): string {
  const query = new URLSearchParams();
  query.set('action', 'query');
  query.set('format', 'json');
  query.set('list', 'recentchanges');
  query.set('rcprop', 'title|ids|user|timestamp|comment|sizes|flags');
  query.set('rcnamespace', String(input.namespace));
  query.set('rclimit', String(input.applied_limit));
  query.set('rcstart', input.end);
  query.set('rcend', input.start);
  if (!input.include_bots) query.set('rcshow', '!bot');
  if (input.rccontinue !== null) query.set('rccontinue', input.rccontinue);
  if (input.change_types !== null) query.set('rctype', input.change_types.join('|'));
  return `${target.actionUrl}?${query.toString()}`;
}

function normaliseTimestamp(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? isoSecond(ms) : null;
}

/**
 * Upstream recentchange item -> contract §3.3 change object. Title, user and
 * comment are attacker-influenceable: returned verbatim as data, never parsed
 * as instructions.
 */
function mapChange(item: Record<string, unknown>, target: ResolveResult) {
  const title = typeof item['title'] === 'string' ? item['title'] : '';
  const oldRev = typeof item['old_revid'] === 'number' ? item['old_revid'] : 0;
  const type = typeof item['type'] === 'string' && item['type'].length > 0
    ? item['type']
    : oldRev === 0 ? 'new' : 'edit';
  const oldLen = typeof item['oldlen'] === 'number' ? item['oldlen'] : 0;
  const newLen = typeof item['newlen'] === 'number' ? item['newlen'] : 0;
  return {
    rcid: typeof item['rcid'] === 'number' ? item['rcid'] : null,
    rev_id: typeof item['revid'] === 'number' ? item['revid'] : null,
    parent_rev_id: oldRev === 0 ? null : oldRev,
    title,
    namespace: typeof item['ns'] === 'number' ? item['ns'] : 0,
    type,
    timestamp: typeof item['timestamp'] === 'string' ? normaliseTimestamp(item['timestamp']) : null,
    user: typeof item['user'] === 'string' ? item['user'] : '',
    comment: typeof item['comment'] === 'string' ? item['comment'] : '',
    bot: item['bot'] === true,
    minor: item['minor'] === true,
    sizes: { old: oldLen, new: newLen, delta: newLen - oldLen },
    url: target.articleUrl(title),
    untrusted_content: true,
  };
}

function parseUpstream(json: unknown): { items: Record<string, unknown>[]; next: string | null } {
  const root = asRecord(json);
  if (root !== null) {
    const error = asRecord(root['error']);
    if (error !== null) {
      // Recent changes has no `page_not_found`/`no_changes` outcome; an
      // upstream error object is an unavailable backend, never an empty result.
      throwGroupD('upstream_unavailable', 'The upstream wiki rejected the recent-changes query.', {
        retryable: true,
        details: { reason: 'upstream_error' },
      });
    }
  }
  const query = root === null ? null : asRecord(root['query']);
  const raw = query === null ? null : query['recentchanges'];
  const items = Array.isArray(raw)
    ? raw.filter((item): item is Record<string, unknown> => asRecord(item) !== null)
    : [];
  const continuation = root === null ? null : asRecord(root['continue']);
  const rc = continuation === null ? null : continuation['rccontinue'];
  const next = typeof rc === 'string' && rc.length > 0 ? rc : null;
  return { items, next };
}

export function createGroupDHandlers(
  client: WikimediaClient,
  _config: Config,
  options: { now?: () => number; cacheClock?: () => number; cache?: RecentChangesCache } = {},
): { get_recent_changes: GroupDHandler } {
  const now = options.now ?? Date.now;
  // One clock in production; a separate injectable age clock keeps freshness
  // and window-end deterministic in fixture tests.
  const clock = options.cacheClock ?? now;
  const cache = options.cache ?? new RecentChangesCache(clock);

  async function get_recent_changes(raw: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResponse> {
    try {
      const parsed = getRecentChangesSchema.safeParse(raw);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        return errorToolResult('validation_error', `Invalid arguments for ${TOOL}: ${detail}`, {
          retryable: false,
          hint: 'Correct the invalid arguments and retry the call; no outbound request was made.',
          details: { tool: TOOL },
        });
      }
      const input: GetRecentChangesInput = parsed.data;

      // Resolver reuse: no caller-supplied host is ever interpolated.
      const target = resolveTarget({ lang: input.lang, project: input.project });

      // Documented clamping (contract §3.2) — absolute ceilings already
      // rejected by the strict schema above.
      const appliedLimit = Math.min(input.limit, RECENT_CHANGES_MAX_LIMIT);
      const seconds = Math.min(input.time_window_seconds, RECENT_CHANGES_MAX_WINDOW_S);
      const changeTypes = input.change_types ?? null;
      const warnings: string[] = [UNTRUSTED_CONTENT_WARNING];
      if (input.limit > RECENT_CHANGES_MAX_LIMIT) warnings.push(LIMIT_CLAMPED_WARNING);
      if (input.time_window_seconds > RECENT_CHANGES_MAX_WINDOW_S) warnings.push(WINDOW_CLAMPED_WARNING);

      const hashQuery = {
        source: target.source,
        namespace: input.namespace,
        applied_limit: appliedLimit,
        requested_seconds: input.time_window_seconds,
        include_bots: input.include_bots,
        change_types: changeTypes,
      };
      const expectedQ = queryHash(hashQuery);

      let cursor: CursorPayload | null = null;
      let windowEnd: string;
      let rccontinue: string | null = null;
      if (input.continue !== undefined) {
        cursor = decodeCursor(input.continue, {
          now: now(), requested_seconds: input.time_window_seconds, expected_q: expectedQ,
        });
        windowEnd = cursor.end;
        rccontinue = cursor.rc;
      } else {
        windowEnd = isoSecond(now());
      }
      const windowStart = isoSecond(Date.parse(windowEnd) - seconds * 1000);
      const url = buildRecentChangesUrl(target, {
        namespace: input.namespace,
        applied_limit: appliedLimit,
        start: windowStart,
        end: windowEnd,
        include_bots: input.include_bots,
        rccontinue,
        change_types: changeTypes,
      });

      let upstream: unknown;
      let etag: string | null = null;
      let fetchedAt = now();
      let cacheAgeMs = 0;

      if (rccontinue !== null) {
        // Each continuation hop is exactly one bounded GET and bypasses the
        // window cache so the frozen `end` cannot drift.
        const response = await client.getJson(url, fetchOptions(signal));
        upstream = response.json;
      } else {
        const key = buildCacheKey({ ...hashQuery, end: windowEnd });
        const entry = cache.get(key);
        if (entry !== undefined) {
          const age = clock() - entry.fetchedAt;
          if (age > RECENT_CHANGES_MAX_CACHE_AGE_MS) {
            throwGroupD('stale_window',
              'The cached recent-changes window is older than the freshness limit; it was not served as an empty result.', {
                retryable: true,
                retryAfterSeconds: 1,
                details: {
                  cache_age_ms: age,
                  max_cache_age_ms: RECENT_CHANGES_MAX_CACHE_AGE_MS,
                },
              });
          }
          if (age <= RECENT_CHANGES_CACHE_TTL_MS) {
            // One conditional revalidation on a cache hit (ETag/If-None-Match).
            const headers = entry.etag === null ? undefined : { 'If-None-Match': entry.etag };
            const response = await client.getJson(url, fetchOptions(signal, headers));
            if (response.status === 304) {
              upstream = entry.body;
              etag = entry.etag;
              fetchedAt = entry.fetchedAt;
              cacheAgeMs = age;
            } else {
              upstream = response.json;
              etag = response.headers['etag'] ?? null;
              fetchedAt = now();
              cache.put({ key, etag, body: upstream, fetchedAt });
            }
          } else {
            // Between TTL and the hard freshness ceiling: refetch unconditionally.
            const response = await client.getJson(url, fetchOptions(signal));
            upstream = response.json;
            etag = response.headers['etag'] ?? null;
            fetchedAt = now();
            cache.put({ key, etag, body: upstream, fetchedAt });
          }
        } else {
          const response = await client.getJson(url, fetchOptions(signal));
          upstream = response.json;
          etag = response.headers['etag'] ?? null;
          fetchedAt = now();
          cache.put({ key, etag, body: upstream, fetchedAt });
        }
      }

      if (cacheAgeMs > RECENT_CHANGES_FRESH_WARN_MS) {
        warnings.push(`freshness_warning:cached_window_age_ms=${cacheAgeMs}`);
      }

      const { items, next } = parseUpstream(upstream);
      const changes = items.slice(0, appliedLimit).map((item) => mapChange(item, target));
      const truncated = next !== null || items.length >= appliedLimit;
      if (truncated) warnings.push(TRUNCATION_WARNING);

      let continuation: Record<string, unknown> | null = null;
      if (next !== null) {
        const hops = cursor === null ? 1 : cursor.h + 1;
        if (hops <= RECENT_CHANGES_MAX_HOPS) {
          continuation = {
            cursor: encodeCursor({
              v: 1, end: windowEnd, rc: next, h: hops, q: expectedQ,
            }),
            expires_at: isoSecond(Date.parse(windowEnd) + input.time_window_seconds * 1000 + 300_000),
            hops,
          };
        }
      }

      const payload = {
        changes,
        count: changes.length,
        truncated,
        continuation,
        window: {
          requested_seconds: input.time_window_seconds,
          seconds,
          start: windowStart,
          end: windowEnd,
          fetched_at: isoSecond(fetchedAt),
          cache_age_ms: cacheAgeMs,
        },
        applied_limit: appliedLimit,
        warnings,
        ...recentChangesProvenance(target),
      };
      return okToolResult(enforceResultLimit(payload, _config.maxResultBytes));
    } catch (error) {
      return mapGroupDError(TOOL, error);
    }
  }

  return { get_recent_changes };
}
