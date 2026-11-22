import type { ToolError, ToolErrorCode } from '../types.js';

/** JSON-RPC error codes used by the 2026-07-28 surface (report 09 §2.5). */
export const JSONRPC_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  INVALID_PARAMS: -32602,
  METHOD_NOT_FOUND: -32601,
  INTERNAL_ERROR: -32603,
  HEADER_MISMATCH: -32020,
  MISSING_CAPABILITY: -32021,
  UNSUPPORTED_VERSION: -32022,
} as const;

const DEFAULT_ACTIONS: Partial<Record<ToolErrorCode, string>> = {
  invalid_coordinates: 'Supply finite WGS84 decimal degrees: latitude in [-90, 90], longitude in [-180, 180].',
  // Group D — bounded recent-change cursor and freshness.
  invalid_cursor: 'Start a fresh bounded window without `continue`, then pass back the returned cursor unchanged.',
  stale_window: 'Retry with a larger time_window_seconds or a fresh call; do not conclude that no changes occurred.',
  rate_limited: 'Wait for retry_after_seconds (or the indicated backoff) and retry the call.',
  quota_exhausted: 'Reduce call volume or wait for the quota reset window before retrying.',
  upstream_unavailable: 'Retry shortly; the upstream service is temporarily unavailable.',
  timeout: 'Retry the call; consider a smaller limit or narrower query.',
  internal_error: 'Retry once; if the error persists, report it with the correlation ID.',
  page_not_found: 'Check the title or call search with the same lang/project.',
  invalid_section: 'Call get_sections without a section argument to list valid section indices.',
  // Phase 3 (Group C/F) — every terminal code has an actionable next step.
  invalid_article: 'Use a page title without control characters, backslashes or ".." segments; spaces or underscores are accepted.',
  invalid_date_range: 'Use a completed UTC date range within the documented bounds and granularity alignment.',
  file_not_found: "Confirm the exact filename on Commons (including the 'File:' prefix), then retry.",
  attribution_unavailable: 'Retry with the same filename; if it persists, verify the licence on the file page before reuse.',
  unsupported_project: 'Use a supported project name or Wikimedia project code.',
  host_not_allowed: 'Do not supply host/api_url parameters; hosts are fixed by the server allowlist.',
  // Phase 2 (Group B) — every terminal code has an actionable next step (AC-24/M6).
  invalid_qid: 'Use a QID matching ^Q[1-9][0-9]{0,9}$; call wikidata_search_entities to find one.',
  invalid_property: 'Use a PID matching ^P[1-9][0-9]{0,9}$.',
  invalid_site: 'Use an allowlisted Wikimedia site code such as enwiki, dewiki or commonswiki.',
  invalid_external_id: 'Check the identifier format for the chosen scheme and retry.',
  unsupported_scheme: 'Use one of: doi, pmid, orcid, openalex, imdb.',
  entity_not_found: 'Check the QID, or call wikidata_search_entities to find one.',
  external_id_not_found: 'Check the identifier and scheme, or call wikidata_search_entities instead.',
  invalid_query: 'Use a single portable SPARQL 1.1 SELECT with only the wikibase:label service.',
  query_limit_required: 'Supply a positive inline LIMIT or a positive `limit` argument.',
  query_too_complex: 'Simplify the query: fewer UNION/OPTIONAL/property paths, or a shorter query.',
  query_timeout: 'Simplify the query, add a LIMIT, or raise timeout_ms (maximum 60000).',
};

/**
 * WP14 — deterministic recovery hints. A static, closed map: a hint is emitted
 * only when the code has one unambiguous next step and (where applicable) one
 * registered tool that performs it. No entry interpolates `message`, `details`,
 * upstream status text, titles or credentials.
 */
export const RECOVERY_HINTS: Partial<Record<ToolErrorCode, { suggested_tool?: string; next_action?: string }>> = Object.freeze({
  validation_error: { next_action: 'Correct the invalid arguments and retry; no outbound request was made.' },
  invalid_coordinates: { next_action: 'Supply finite WGS84 decimal degrees within the documented bounds.' },
  host_not_allowed: { next_action: 'Remove host/api_url parameters; hosts are fixed by the server allowlist.' },
  invalid_language: { next_action: 'Use a 2-12 letter lowercase Wikimedia language code and retry.' },
  invalid_project: { next_action: 'Use a supported Wikimedia project name or project code and retry.' },
  unsupported_project: { next_action: 'Use a supported Wikimedia project name or project code and retry.' },
  invalid_title: { next_action: 'Use a page title without control characters and retry, or search for the page.' },
  page_not_found: { suggested_tool: 'search', next_action: 'Call search with the same lang/project and a corrected title.' },
  invalid_section: { suggested_tool: 'get_sections', next_action: 'Call get_sections without a section argument to list valid indices.' },
  file_not_found: { suggested_tool: 'get_file_metadata', next_action: 'Retry with the exact Commons filename including the File: prefix.' },
  invalid_cursor: { next_action: 'Start a fresh bounded window and pass the returned cursor back unchanged.' },
  stale_window: { next_action: 'Retry with a larger time_window_seconds or a fresh bounded window.' },
  rate_limited: { next_action: 'Wait for retry_after_seconds (or the indicated backoff) and retry.' },
  timeout: { next_action: 'Retry the call with a smaller limit or narrower query.' },
  upstream_unavailable: { next_action: 'Retry shortly; the upstream service is temporarily unavailable.' },
  invalid_qid: { suggested_tool: 'wikidata_search_entities', next_action: 'Call wikidata_search_entities to find a valid QID.' },
  entity_not_found: { suggested_tool: 'wikidata_search_entities', next_action: 'Call wikidata_search_entities to find the correct entity.' },
  external_id_not_found: { suggested_tool: 'wikidata_search_entities', next_action: 'Check the identifier and scheme, or search Wikidata instead.' },
  invalid_site: { next_action: 'Use an allowlisted Wikimedia site code such as enwiki, dewiki or commonswiki.' },
  invalid_external_id: { next_action: 'Check the identifier format for the chosen scheme and retry.' },
  invalid_query: { next_action: 'Use a single portable SPARQL 1.1 SELECT with only the wikibase:label service.' },
  query_limit_required: { next_action: 'Supply a positive inline LIMIT or a positive limit argument.' },
  query_too_complex: { next_action: 'Simplify the query: fewer UNION/OPTIONAL/property paths, or a shorter query.' },
  query_timeout: { next_action: 'Simplify the query, add a LIMIT, or raise timeout_ms (maximum 60000).' },
});

export type ToolErrorOptions = {
  retryable?: boolean;
  retryAfterSeconds?: number | null;
  hint?: string | null;
  details?: Record<string, unknown>;
  action?: string;
  limits?: Record<string, unknown>;
  /** WP14 — additive overrides; static values only, never caller-supplied titles/tokens. */
  suggestedTool?: string;
  nextAction?: string;
};

export function toolError(
  code: ToolErrorCode,
  message: string,
  options: ToolErrorOptions = {},
): ToolError {
  const action = options.action ?? DEFAULT_ACTIONS[code] ?? 'Review the error message and retry with corrected arguments.';
  const recovery = RECOVERY_HINTS[code];
  const suggestedTool = options.suggestedTool ?? recovery?.suggested_tool;
  const nextAction = options.nextAction ?? recovery?.next_action;
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    retry_after_seconds: options.retryAfterSeconds ?? null,
    hint: options.hint ?? null,
    action,
    details: options.details ?? {},
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(suggestedTool === undefined ? {} : { suggested_tool: suggestedTool }),
    ...(nextAction === undefined ? {} : { next_action: nextAction }),
  };
}

/** Map an upstream HTTP status to a tool error, without leaking raw status text. */
export function mapHttpStatus(
  status: number,
  context: { title?: string; source?: string; backend?: string; retryAfterSeconds?: number | null },
): ToolError {
  if (status === 404) {
    const subject = context.title ?? 'resource';
    const source = context.source ?? 'the requested wiki';
    return toolError('page_not_found', `No page titled '${subject}' exists on ${source}. Check the spelling or call search with the same lang/project.`, {
      retryable: false,
      hint: `Call search({ q: '${subject}' }).`,
      details: { http_status: 404, backend: context.backend ?? 'wikimedia' },
    });
  }
  if (status === 400 || status === 422) {
    return toolError('validation_error', 'The upstream request was rejected as invalid. Check the supplied arguments.', {
      retryable: false,
      details: { http_status: status, backend: context.backend ?? 'wikimedia' },
    });
  }
  if (status === 429) {
    return toolError('rate_limited', 'The upstream service is rate-limiting requests. Backing off before retry.', {
      retryable: true,
      retryAfterSeconds: context.retryAfterSeconds ?? null,
      details: { http_status: 429, backend: context.backend ?? 'wikimedia' },
    });
  }
  if (status === 401 || status === 403) {
    return toolError('upstream_unavailable', 'The upstream service refused the request. Check configuration and try again.', {
      retryable: false,
      details: { http_status: status, backend: context.backend ?? 'wikimedia' },
    });
  }
  if (status >= 500) {
    return toolError('upstream_unavailable', 'The upstream service is temporarily unavailable. Retry shortly.', {
      retryable: true,
      details: { http_status: status, backend: context.backend ?? 'wikimedia' },
    });
  }
  return toolError('internal_error', 'The upstream request failed unexpectedly. Retry with the correlation ID.', {
    retryable: true,
    details: { http_status: status, backend: context.backend ?? 'wikimedia' },
  });
}

export function isToolError(value: unknown): value is ToolError {
  return typeof value === 'object' && value !== null
    && typeof (value as ToolError).code === 'string'
    && typeof (value as ToolError).message === 'string';
}
