import { CC0_DISCLAIMER, CC0_LICENSE, WIKIDATA_ENTITY_BASE } from './constants.js';

/** Shared CC0 provenance block (§3.2) emitted by every Group B tool. */
export function wikidataProvenance(options: {
  qid: string | null;
  revision?: number | null;
  timestamp?: string | null;
  endpoint?: string;
  effectiveQuery?: string;
  resultTime?: string;
}): Record<string, unknown> {
  const sparql = options.endpoint !== undefined;
  const link = sparql
    ? `${options.endpoint as string}?query=${encodeURIComponent(options.effectiveQuery ?? '')}`
    : options.qid === null ? 'https://www.wikidata.org/' : `${WIKIDATA_ENTITY_BASE}${options.qid}`;
  const now = options.resultTime ?? new Date().toISOString();
  return {
    source: sparql ? 'wikidata:sparql' : 'wikidata',
    qid: options.qid,
    revision: sparql ? null : (options.revision ?? null),
    timestamp: sparql ? now : (options.timestamp ?? null),
    license: { ...CC0_LICENSE },
    attribution: {
      required: false,
      text: 'Wikidata contributors — CC0 1.0',
      link,
      disclaimer: CC0_DISCLAIMER,
    },
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
  };
}

/** ETag → numeric entity revision; never fabricate a revision when absent. */
export function revisionFromETag(etag: string | undefined): number | null {
  if (etag === undefined) return null;
  const cleaned = etag.trim().replace(/^W\//i, '').replace(/^"|"$/g, '');
  const value = Number(cleaned);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Last-Modified → ISO-8601 timestamp; null when absent or malformed. */
export function timestampFromHeader(header: string | undefined): string | null {
  if (header === undefined) return null;
  const parsed = Date.parse(header);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().replace('.000Z', 'Z');
}
