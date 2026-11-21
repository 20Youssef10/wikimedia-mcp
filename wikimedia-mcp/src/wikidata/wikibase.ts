import type { WikimediaClient } from '../upstream/client.js';
import { WIKIBASE_REST_BASE } from './constants.js';
import { revisionFromETag, timestampFromHeader } from './provenance.js';

export type WikibaseResponse = {
  status: number;
  json: unknown;
  revision: number | null;
  timestamp: string | null;
  fromCache: boolean;
};

/**
 * Thin Wikibase REST v1.6 GET layer. It adds ETag/If-None-Match caching and
 * maps revision/timestamp from response headers; all validation and mapping
 * stays in the tool handlers (§3.1).
 */
export class WikibaseClient {
  private readonly etags = new Map<string, string>();
  private readonly bodies = new Map<string, unknown>();

  constructor(private readonly client: WikimediaClient) {}

  async get(
    path: string,
    options: { signal?: AbortSignal; cacheKey?: string } = {},
  ): Promise<WikibaseResponse> {
    const cacheKey = options.cacheKey;
    const knownEtag = cacheKey === undefined ? undefined : this.etags.get(cacheKey);
    const headers: Record<string, string> = knownEtag === undefined ? {} : { 'If-None-Match': knownEtag };
    const response = await this.client.getJson(`${WIKIBASE_REST_BASE}${path}`, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      backend: 'wikibase-rest-v1',
      headers,
    });
    const etag = response.headers['etag'] ?? response.headers['ETag'];
    if (response.status === 304 && cacheKey !== undefined && this.bodies.has(cacheKey)) {
      return {
        status: 304,
        json: this.bodies.get(cacheKey),
        revision: revisionFromETag(knownEtag),
        timestamp: timestampFromHeader(response.headers['last-modified'] ?? response.headers['Last-Modified']),
        fromCache: true,
      };
    }
    if (response.status >= 200 && response.status < 300 && cacheKey !== undefined) {
      if (etag !== undefined) this.etags.set(cacheKey, etag);
      this.bodies.set(cacheKey, response.json);
    }
    return {
      status: response.status,
      json: response.json,
      revision: revisionFromETag(etag),
      timestamp: timestampFromHeader(response.headers['last-modified'] ?? response.headers['Last-Modified']),
      fromCache: false,
    };
  }

  resetCache(): void {
    this.etags.clear();
    this.bodies.clear();
  }
}
