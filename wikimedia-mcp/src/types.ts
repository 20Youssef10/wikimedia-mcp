/** Shared domain types for the read-only Wikimedia MCP server. */

export type License = {
  title: string;
  short: string;
  /** null when the upstream did not state a licence URL (finding M7). */
  url: string | null;
};

export type Attribution = {
  required: boolean;
  text: string;
  link: string;
  disclaimer: string;
  /** Present when the upstream licence is incomplete or unverified. */
  hint?: string;
};

export type Provenance = {
  source: string;
  license: License;
  attribution: Attribution;
  revision: number | null;
  timestamp: string | null;
};

export type ToolErrorCode =
  | 'validation_error'
  // Phase 5 (Group G) additive code — finite WGS84 coordinate outside bounds.
  | 'invalid_coordinates'
  | 'invalid_language'
  | 'invalid_project'
  | 'unsupported_project'
  | 'host_not_allowed'
  | 'page_not_found'
  | 'file_not_found'
  | 'invalid_title'
  | 'invalid_section'
  // Phase 3 (Groups C/F) additive codes.
  | 'invalid_article'
  | 'invalid_date_range'
  | 'attribution_unavailable'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'upstream_unavailable'
  | 'timeout'
  | 'internal_error'
  // Phase 2 (Group B — Wikidata) additive codes.
  | 'invalid_qid'
  | 'invalid_property'
  | 'invalid_site'
  | 'invalid_external_id'
  | 'unsupported_scheme'
  | 'entity_not_found'
  | 'external_id_not_found'
  | 'invalid_query'
  | 'query_limit_required'
  | 'query_too_complex'
  | 'query_timeout';

export type ToolError = {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  retry_after_seconds: number | null;
  hint: string | null;
  action: string;
  details: Record<string, unknown>;
  /** Additive field used by SPARQL guard errors (TC-B-006 / AC-48). */
  limits?: Record<string, unknown>;
};

export type ToolPayload = Record<string, unknown> & Partial<Provenance>;

export type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

export type ResolveResult = {
  /** Stable source identifier, e.g. `wikipedia:en`. */
  source: string;
  lang: string;
  project: string;
  host: string;
  restBase: string;
  actionUrl: string;
  articleUrl: (title: string) => string;
};
