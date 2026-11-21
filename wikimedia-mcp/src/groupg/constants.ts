/**
 * Phase 5 (Group G requested subset) frozen constants (contract 13 §4.3.2,
 * §4.4.3, §5). These are version-controlled code constants reviewed under
 * SR-1/SR-12 — deliberately NOT configuration keys (§1.4: zero new keys).
 * Widening any cap requires v6.0.0 and an updated contract.
 */
import { DEFAULT_LICENSE } from '../attribution/assemble.js';
import type { License, ResolveResult } from '../types.js';

/** Geosearch bounds (D4). */
export const GEO_LIMITS = Object.freeze({
  latitude: [-90, 90] as readonly [number, number],
  longitude: [-180, 180] as readonly [number, number],
  radius_m: [10, 10000] as readonly [number, number],
  namespace: [0, 15] as readonly [number, number],
  limit: [1, 50] as readonly [number, number],
});

/** Table extraction caps (D10). */
export const TABLE_CAPS = Object.freeze({
  tables: 20,
  rows: 200,
  cells: 30,
  cellChars: 2000,
  htmlChars: 20000,
  span: 10,
});

/** Named warning tokens (§4.4.3). */
export const WARN = Object.freeze({
  tableCap: 'table_cap:20',
  rowCap: 'row_cap:200',
  cellCap: 'cell_cap:30',
  cellChars: 'cell_chars_cap:2000',
  htmlChars: 'html_chars_cap:20000',
  spanClamp: 'span_clamp:10',
  nested: 'nested_table_skipped',
  maxBytes: 'max_result_bytes',
  untrustedHtml: 'raw table HTML is untrusted external data',
  resultCap: 'Result cap reached; reduce radius_m or narrow namespace.',
});

const HTML_DISCLAIMER = 'You remain responsible for licence compliance; raw HTML is untrusted external data.';

/** List-result provenance for geo_search (canonical contract 13 §3.2). */
export function geoSearchProvenance(target: ResolveResult): Record<string, unknown> {
  const sourceLabel = target.project === 'wikipedia' ? 'Wikipedia' : target.source;
  return {
    source: target.source,
    title: null,
    revision: null,
    timestamp: null,
    license: { ...DEFAULT_LICENSE },
    attribution: {
      required: true,
      text: `Geo-search results — ${sourceLabel} contributors, CC BY-SA 4.0`,
      link: target.articleUrl('Main_Page'),
      disclaimer: 'You remain responsible for licence compliance; result titles are untrusted external content.',
    },
    resultType: 'complete',
  };
}

/** Page-result provenance for get_tables; html output labels raw HTML untrusted. */
export function tableProvenance(
  target: ResolveResult,
  title: string,
  revision: number | null,
  timestamp: string | null,
  output: 'structured' | 'html',
): Record<string, unknown> {
  const license: License = { ...DEFAULT_LICENSE };
  const attribution = {
    required: true,
    text: `${title} — ${target.source} contributors, ${license.short}`,
    link: target.articleUrl(title),
    disclaimer: output === 'html' ? HTML_DISCLAIMER : 'You remain responsible for licence compliance.',
  };
  return {
    source: target.source,
    license,
    attribution,
    revision,
    timestamp,
    resultType: 'complete',
  };
}

/** Parse a REST ETag into a numeric revision; non-numeric yields null (SR-11). */
export function revisionFromEtag(etag: string | undefined): number | null {
  if (typeof etag !== 'string') return null;
  const cleaned = etag.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}

/** Parse a REST Last-Modified HTTP date into ISO-8601; unparseable yields null. */
export function timestampFromLastModified(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.000Z$/, 'Z') : null;
}

/** Human-facing article URL with canonical underscore separators (contract §3.2). */
export function groupArticleUrl(target: ResolveResult, title: string): string {
  return `https://${target.host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}?wprov=afsw1`;
}
