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

/**
 * WP15 — compact provenance UX block. Additive only: the flat `source`,
 * `license` and `attribution` fields remain on the payload unchanged.
 */
export type ProvenanceBlock = {
  source: string;
  license: License;
  attribution: Attribution;
  /** Ready-to-render, single-line attribution including the disclaimer. */
  attribution_text: string;
  disclaimer: string;
  /** Carried over verbatim when the flat attribution carries a hint. */
  hint?: string;
};

export type ToolErrorCode =
  | 'validation_error'
  // Phase 5 (Group G) additive code — finite WGS84 coordinate outside bounds.
  | 'invalid_coordinates'
  // Write-tools contract 16 v7.0.0 additive codes (all gated off by default).
  | 'authentication_required'
  | 'invalid_issuer'
  | 'insufficient_scope'
  | 'confirmation_required'
  | 'confirmation_invalid'
  | 'capability_invalid'
  | 'blast_radius_exceeded'
  | 'write_halted'
  | 'target_changed'
  | 'approval_required'
  | 'licence_not_signed_off'
  // Group D additive codes — bounded recent-changes polling.
  | 'invalid_cursor'
  | 'stale_window'
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
  /**
   * WP14 — additive recovery guidance. Present only where a deterministic
   * recovery exists; never derived from raw upstream text, titles or tokens.
   */
  suggested_tool?: string;
  next_action?: string;
};

/**
 * WP12 — closed set of explainable relevance labels. These describe *why* an
 * item matched; they never reorder results or alter the upstream ranking.
 */
export type RelevanceReason =
  | 'title_exact'
  | 'title_prefix'
  | 'title_contains'
  | 'snippet_match'
  | 'description_match'
  | 'unspecified';

/**
 * WP13 — cache tiers. `metadata` is the pre-existing strict-TTL metadata cache;
 * `content` is the bounded ETag/Cache-Control revalidation tier. Both values are
 * closed; no caller-supplied tier is accepted.
 */
export type CacheTier = 'metadata' | 'content';

export type ToolPayload = Record<string, unknown> & Partial<Provenance> & {
  cache_tier?: CacheTier;
  provenance_block?: ProvenanceBlock;
};

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
