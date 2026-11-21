import type { ZodType } from 'zod';
import type { Config } from '../../config.js';
import { resolveTarget, ResolverError } from '../../resolver.js';
import type { ResolveResult } from '../../types.js';
import { WikimediaClient, asRecord } from '../../upstream/client.js';
import { UpstreamError } from '../../upstream/retry.js';
import { toolError, mapHttpStatus } from '../../protocol/errors.js';
import { errorToolResult, okToolResult } from '../../protocol/result.js';
import { enforceResultLimit } from '../../protocol/limits.js';
import {
  assembleAttribution, DEFAULT_LICENSE, escapeContent, licenceHint,
  licenseFromExtMetadata, stripHtml, withListProvenance, withProvenance,
} from '../../attribution/assemble.js';
import type { ToolResponse, ToolPayload } from '../../types.js';
import {
  searchSchema, getSummarySchema, getPageSchema, getSectionsSchema, getRelatedPagesSchema,
  getMediaSchema, getLanguagesSchema, getRandomPageSchema, getFeedSchema, isValidFeedDate,
  type SearchInput, type GetSummaryInput, type GetPageInput, type GetSectionsInput,
  type GetRelatedPagesInput, type GetMediaInput, type GetLanguagesInput,
  type GetRandomPageInput, type GetFeedInput,
} from './schemas.js';

const FORBIDDEN_HOST_KEYS = ['host', 'api_url', 'endpoint', 'base_url', 'url'];

function actionUrl(target: ResolveResult, params: Record<string, string | number>): string {
  const query = new URLSearchParams({ format: 'json', ...Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ) });
  return `${target.actionUrl}?${query.toString()}`;
}

function encodedTitle(title: string): string {
  return encodeURIComponent(title);
}

/** exactOptionalPropertyTypes-safe construction of upstream call options. */
function fetchOptions(
  signal: AbortSignal | undefined,
  backend: string,
  accept?: string,
): { signal?: AbortSignal; backend: string; accept?: string } {
  return {
    backend,
    ...(signal === undefined ? {} : { signal }),
    ...(accept === undefined ? {} : { accept }),
  };
}

function pagesOf(json: unknown): Record<string, unknown>[] {
  const root = asRecord(json);
  const query = root === null ? null : asRecord(root['query']);
  const pages = query === null ? null : query['pages'];
  if (Array.isArray(pages)) {
    return pages.filter((page): page is Record<string, unknown> => asRecord(page) !== null);
  }
  if (isRecord(pages)) {
    return Object.values(pages).filter((page): page is Record<string, unknown> => asRecord(page) !== null);
  }
  return [];
}

/** MediaWiki Action API missing-page signals (finding H1). */
function isMissingError(json: unknown): boolean {
  const root = asRecord(json);
  const error = root === null ? null : asRecord(root['error']);
  if (error === null) return false;
  const code = error['code'];
  return typeof code === 'string' && /missing|nosuch|notfound|not_found/i.test(code);
}

function firstPageMissing(json: unknown): boolean {
  const first = pagesOf(json)[0];
  return first !== undefined && first['missing'] !== undefined;
}

function pageNotFound(target: ResolveResult, title: string, backend: string): never {
  const error = mapHttpStatus(404, { title, source: target.source, backend });
  throw Object.assign(new Error(error.message), { toolError: error });
}

/**
 * Centralised HTTP + Action-API-body validation. Action API returns HTTP 200
 * with `{query:{pages:{"-1":{missing:""}}}}` or `{error:{code:"missingtitle"}}`
 * for missing pages; these must not be reported as empty successes.
 */
function requireOk(status: number, target: ResolveResult, title: string, backend: string, json?: unknown): void {
  if (status === 404) pageNotFound(target, title, backend);
  if (json !== undefined && (isMissingError(json) || firstPageMissing(json))) {
    pageNotFound(target, title, backend);
  }
}

/**
 * Create all nine read-only tool handlers. Each call is validated, routed
 * through the shared client, enriched with provenance, and capped by
 * MAX_RESULT_BYTES. `signal` is the inbound cancellation signal (H2).
 */
export function createHandlers(client: WikimediaClient, config: Config) {
  async function run<TInput, TOutput>(
    name: string,
    schema: ZodType<TInput>,
    raw: Record<string, unknown>,
    fn: (input: TInput, target: ResolveResult, signal?: AbortSignal) => Promise<TOutput>,
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
      const input = parsed.data as { lang?: string; project?: string };
      const targetParams: { lang?: string; project?: string } = {};
      if (input.lang !== undefined) targetParams.lang = input.lang;
      if (input.project !== undefined) targetParams.project = input.project;
      const target = resolveTarget(targetParams);
      const output = await fn(parsed.data, target, signal);
      const limited = enforceResultLimit(output as unknown as Record<string, unknown>, config.maxResultBytes);
      return okToolResult(limited);
    } catch (error) {
      return handleException(name, error);
    }
  }

  function handleException(name: string, error: unknown): ToolResponse {
    if (error !== null && typeof error === 'object' && 'toolError' in error) {
      const mapped = (error as { toolError: unknown }).toolError;
      if (mapped !== null && typeof mapped === 'object' && 'code' in mapped && 'message' in mapped) {
        const t = mapped as import('../../types.js').ToolError;
        return errorToolResult(t.code, t.message, {
          retryable: t.retryable,
          retryAfterSeconds: t.retry_after_seconds,
          hint: t.hint,
          details: { ...t.details, tool: name },
          action: t.action,
        });
      }
    }
    if (error instanceof ResolverError) {
      return errorToolResult(error.kind, error.message, { retryable: false, details: { tool: name } });
    }
    if (error instanceof UpstreamError) {
      if (error.status === 0) {
        // Network/DNS/TLS-level failure: never mislabel as a programming fault.
        const host = error.host ?? 'the upstream host';
        return errorToolResult('upstream_unavailable', `Could not reach the upstream wiki at ${host}.`, {
          retryable: true,
          hint: `Check DNS/network access to ${host} and retry the call.`,
          action: `Verify network access to ${host}, then retry.`,
          details: { tool: name, host, network: true },
        });
      }
      if (error.status === 429) {
        return errorToolResult('rate_limited', 'Upstream rate limit reached after bounded retries.', {
          retryable: true, retryAfterSeconds: Math.ceil((error.retryAfterMs ?? 5000) / 1000),
          details: { tool: name, http_status: 429 },
        });
      }
      return errorToolResult('upstream_unavailable', 'The upstream service is temporarily unavailable. Retry shortly.', {
        retryable: true, details: { tool: name, http_status: error.status },
      });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return errorToolResult('timeout', 'The upstream request was cancelled or timed out. Retry the call.', {
        retryable: true, details: { tool: name },
      });
    }
    return errorToolResult('internal_error', `An internal error occurred in ${name}. Retry with the correlation ID.`, {
      retryable: true, details: { tool: name, error_type: error instanceof Error ? error.name : 'unknown' },
    });
  }

  async function summaryPayload(
    target: ResolveResult,
    title: string,
    rawJson: unknown,
  ): Promise<ToolPayload> {
    const data = asRecord(rawJson) ?? {};
    const thumbnail = asRecord(data['thumbnail']);
    const contentUrls = asRecord(data['content_urls']);
    const canonical = typeof data['title'] === 'string' ? data['title'] : title;
    return withProvenance({
      title: canonical,
      displaytitle: typeof data['displaytitle'] === 'string' ? data['displaytitle'] : canonical,
      description: typeof data['description'] === 'string' ? data['description'] : '',
      extract: typeof data['extract'] === 'string' ? data['extract'] : '',
      thumbnail: thumbnail === null ? null : {
        source: thumbnail['source'],
        width: thumbnail['width'],
        height: thumbnail['height'],
      },
      pageid: data['pageid'] ?? null,
      wikibase_item: typeof data['wikibase_item'] === 'string' ? data['wikibase_item'] : null,
      url: contentUrls !== null
        ? (asRecord(contentUrls['desktop'])?.['page'] ?? target.articleUrl(canonical))
        : target.articleUrl(canonical),
      content_urls: data['content_urls'] ?? { desktop: { page: target.articleUrl(canonical) } },
      lang: target.lang,
      revision: typeof data['revision'] === 'number' ? data['revision'] : null,
      timestamp: typeof data['timestamp'] === 'string' ? data['timestamp'] : null,
      untrusted_content: true,
    }, target, canonical, {
      revision: typeof data['revision'] === 'number' ? data['revision'] : null,
      timestamp: typeof data['timestamp'] === 'string' ? data['timestamp'] : null,
    });
  }

  return {
    async search(raw: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResponse> {
      return run<SearchInput, ToolPayload>('search', searchSchema, raw, async (input, target, childSignal) => {
        const url = actionUrl(target, {
          action: 'query', list: 'search', srsearch: input.q, srnamespace: 0,
          srlimit: input.limit, sroffset: input.offset,
          srprop: 'snippet|titlesnippet|timestamp|wordcount',
        });
        const response = await client.getJson(url, fetchOptions(childSignal, 'wikimedia-action'));
        const root = asRecord(response.json);
        const query = root === null ? null : asRecord(root['query']);
        const search = query === null ? null : query['search'];
        const total = query === null ? null : asRecord(query['searchinfo']);
        const results = Array.isArray(search) ? search.slice(0, input.limit).map((item) => {
          const entry = asRecord(item) ?? {};
          const snippet = stripHtml(typeof entry['snippet'] === 'string' ? entry['snippet'] : '');
          return {
            pageid: entry['pageid'] ?? null,
            title: entry['title'] ?? '',
            snippet,
            timestamp: entry['timestamp'] ?? null,
            wordcount: entry['wordcount'] ?? 0,
            url: target.articleUrl(String(entry['title'] ?? '')),
            qid: null,
          };
        }) : [];
        const totalHits = typeof total?.['totalhits'] === 'number' ? total['totalhits'] : results.length;
        return withListProvenance({
          query: input.q,
          results,
          total_hits: totalHits,
          next_offset: results.length >= input.limit ? input.offset + results.length : null,
        }, target, 'search');
      }, signal);
    },

    async get_summary(raw: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResponse> {
      return run<GetSummaryInput, ToolPayload>('get_summary', getSummarySchema, raw, async (input, target, childSignal) => {
        const url = `${target.restBase}/page/summary/${encodedTitle(input.title)}`;
        const response = await client.getJson(url, fetchOptions(childSignal, 'wikimedia-rest-v1'));
        if (response.status === 404) {
          pageNotFound(target, input.title, 'wikimedia-rest-v1');
        }
        const data = asRecord(response.json);
        if (data !== null && (data['type'] === 'disambiguation' || Array.isArray(data['pages']))) {
          const candidates = Array.isArray(data['pages'])
            ? data['pages'].map((page) => ({ title: asRecord(page)?.['title'] ?? '' }))
            : [];
          return withListProvenance({
            title: input.title, candidates, disambiguation: true,
            hint: 'Call get_summary on a candidate title, or search to disambiguate.',
          }, target, input.title);
        }
        return summaryPayload(target, input.title, response.json);
      }, signal);
    },

    async get_page(raw: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResponse> {
      return run<GetPageInput, ToolPayload>('get_page', getPageSchema, raw, async (input, target, childSignal) => {
        let content: string;
        let revision: number | null = null;
        let timestamp: string | null = null;
        if (input.format === 'html') {
          const response = await client.getJson(`${target.restBase}/page/html/${encodedTitle(input.title)}`, {
            ...fetchOptions(childSignal, 'wikimedia-rest-v1', 'text/html'),
          });
          requireOk(response.status, target, input.title, 'wikimedia-rest-v1');
          content = escapeContent(response.text);
        } else if (input.format === 'wikitext') {
          const url = actionUrl(target, {
            action: 'query', prop: 'revisions', titles: input.title,
            rvprop: 'content|timestamp|ids', rvslots: 'main',
          });
          const response = await client.getJson(url, fetchOptions(childSignal, 'wikimedia-action'));
          requireOk(response.status, target, input.title, 'wikimedia-action', response.json);
          const page = pagesOf(response.json)[0];
          const revisionObj = asRecord(asRecord(Array.isArray(page?.['revisions']) ? page['revisions'][0] : undefined));
          const mainSlot = asRecord(asRecord(revisionObj?.['slots'])?.['main']);
          const rawContent = typeof mainSlot?.['*'] === 'string' ? mainSlot['*'] : '';
          content = rawContent;
          revision = typeof revisionObj?.['revid'] === 'number' ? revisionObj['revid'] : null;
          timestamp = typeof revisionObj?.['timestamp'] === 'string' ? revisionObj['timestamp'] : null;
        } else {
          const url = actionUrl(target, {
            action: 'query', prop: 'extracts', titles: input.title, explaintext: 1,
          });
          const response = await client.getJson(url, fetchOptions(childSignal, 'wikimedia-action'));
          requireOk(response.status, target, input.title, 'wikimedia-action', response.json);
          const page = pagesOf(response.json)[0];
          content = typeof page?.['extract'] === 'string' ? page['extract'] : '';
        }
        const truncated = content.length > input.max_chars;
        if (truncated) content = content.slice(0, input.max_chars);
        return withProvenance({
          title: input.title,
          format: input.format,
          content,
          truncated,
          untrusted_content: true,
        }, target, input.title, { revision, timestamp });
      }, signal);
    },

    async get_sections(raw: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResponse> {
      return run<GetSectionsInput, ToolPayload>('get_sections', getSectionsSchema, raw, async (input, target, childSignal) => {
        if (input.section === undefined) {
          const url = actionUrl(target, { action: 'parse', page: input.title, prop: 'sections' });
          const response = await client.getJson(url, fetchOptions(childSignal, 'wikimedia-action'));
          requireOk(response.status, target, input.title, 'wikimedia-action', response.json);
          const root = asRecord(response.json);
          const parse = root === null ? null : asRecord(root['parse']);
          const sections = Array.isArray(parse?.['sections']) ? parse['sections'] : [];
          return withListProvenance({
            title: input.title,
            mode: 'index',
            sections: sections.map((item) => {
              const section = asRecord(item) ?? {};
              return {
                index: section['index'], line: stripHtml(String(section['line'] ?? '')),
                level: section['level'], number: section['number'], anchor: section['anchor'],
              };
            }),
          }, target, input.title);
        }
        const prop = input.content_format === 'html' ? 'text' : 'wikitext';
        const url = actionUrl(target, {
          action: 'parse', page: input.title, section: input.section, prop,
        });
        const response = await client.getJson(url, fetchOptions(childSignal, 'wikimedia-action'));
        if (isMissingError(response.json)) pageNotFound(target, input.title, 'wikimedia-action');
        const errorObj = asRecord(asRecord(response.json)?.['error']);
        if (response.status === 404 || errorObj !== null) {
          throw Object.assign(
            new Error(`Section ${input.section} does not exist on '${input.title}'.`),
            {
              toolError: toolError('invalid_section', `Section ${input.section} does not exist on '${input.title}'.`, {
                retryable: false,
                hint: `Call get_sections({ title: '${input.title}' }) without section to list valid indices.`,
                details: { section: input.section },
              }),
            },
          );
        }
        const root = asRecord(response.json);
        const parse = root === null ? null : asRecord(root['parse']);
        const sectionObj = asRecord(parse?.['[wikitext]'] ?? parse?.['wikitext'] ?? parse?.['text']);
        const content = typeof sectionObj?.['*'] === 'string' ? sectionObj['*'] : '';
        return withListProvenance({
          title: input.title, mode: 'content', section: input.section,
          content_format: input.content_format, content, untrusted_content: true,
        }, target, input.title);
      }, signal);
    },

    async get_related_pages(raw: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResponse> {
      return run<GetRelatedPagesInput, ToolPayload>('get_related_pages', getRelatedPagesSchema, raw, async (input, target, childSignal) => {
        const url = `${target.restBase}/page/related/${encodedTitle(input.title)}`;
        const response = await client.getJson(url, fetchOptions(childSignal, 'wikimedia-rest-v1'));
        requireOk(response.status, target, input.title, 'wikimedia-rest-v1');
        const root = asRecord(response.json);
        const pages = Array.isArray(root?.['pages']) ? root['pages'] : [];
        const related = pages.slice(0, input.limit).map((item) => {
          const page = asRecord(item) ?? {};
          const thumb = asRecord(page['thumbnail']);
          return {
            title: page['title'] ?? '', description: page['description'] ?? '',
            extract: page['extract'] ?? '', url: page['url'] ?? target.articleUrl(String(page['title'] ?? '')),
            thumbnail: thumb === null ? null : { source: thumb['source'], width: thumb['width'], height: thumb['height'] },
          };
        });
        return withListProvenance({
          title: input.title, related,
          // `pages` is a compatibility alias used by the test corpus.
          pages: related,
          truncated: pages.length > input.limit,
        }, target, input.title);
      }, signal);
    },

    async get_media(raw: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResponse> {
      return run<GetMediaInput, ToolPayload>('get_media', getMediaSchema, raw, async (input, target, childSignal) => {
        const firstUrl = actionUrl(target, {
          action: 'query', prop: 'images', titles: input.title, imlimit: 50,
        });
        const first = await client.getJson(firstUrl, fetchOptions(childSignal, 'wikimedia-action'));
        requireOk(first.status, target, input.title, 'wikimedia-action', first.json);
        const titles = pagesOf(first.json).flatMap((page) => {
          const images = page['images'];
          if (!Array.isArray(images)) return [];
          return images.map((image) => String(asRecord(image)?.['title'] ?? '')).filter((title) => title.length > 0);
        });
        const warnings: string[] = [];
        let items: ToolPayload[] = [];
        if (titles.length > 0) {
          try {
            const secondUrl = actionUrl(target, {
              action: 'query', prop: 'imageinfo', titles: titles.slice(0, 50).join('|'),
              iiprop: 'url|size|mime|extmetadata|user', iiurlwidth: input.thumb_width,
            });
            const second = await client.getJson(secondUrl, fetchOptions(childSignal, 'wikimedia-action'));
            requireOk(second.status, target, input.title, 'wikimedia-action', second.json);
            items = pagesOf(second.json).flatMap((page) => {
              const infoArray = page['imageinfo'];
              const info = asRecord(Array.isArray(infoArray) ? infoArray[0] : undefined);
              if (info === null || info === undefined) return [];
              const ext = asRecord(info['extmetadata']) ?? {};
              const license = licenseFromExtMetadata(ext);
              const hint = licenceHint(license);
              const mediaTitle = String(page['title'] ?? '');
              const mime = typeof info['mime'] === 'string' ? info['mime'] : '';
              const family = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'other';
              if (input.type !== 'all' && family !== input.type) return [];
              const attribution = {
                required: true,
                text: license.url === null
                  ? `${mediaTitle} — licence not stated by upstream; verify at the file page`
                  : `${mediaTitle} — ${target.source} contributors, ${license.short}`,
                link: typeof info['descriptionurl'] === 'string' ? info['descriptionurl'] : target.articleUrl(mediaTitle),
                disclaimer: 'You remain responsible for licence compliance.',
                ...(hint === undefined ? {} : { hint }),
              };
              return [{
                title: mediaTitle,
                type: family,
                mime,
                width: info['width'] ?? null,
                height: info['height'] ?? null,
                size: info['size'] ?? null,
                url: info['url'] ?? '',
                thumb_url: info['thumburl'] ?? null,
                description_url: info['descriptionurl'] ?? null,
                artist: readMetadata(ext, 'Artist'),
                credit: readMetadata(ext, 'Credit'),
                license,
                attribution,
              }];
            });
          } catch (error) {
            // Finding M5: only per-item/detail failures degrade to warnings.
            // Rate limits, upstream faults and cancellation must reach the
            // shared error envelope so they stay actionable/retryable.
            if (error instanceof UpstreamError && (error.status === 429 || error.status >= 500)) throw error;
            if (error instanceof Error && error.name === 'AbortError') throw error;
            warnings.push('Media detail batch failed; returning partial results.');
          }
        }
        return withListProvenance({
          title: input.title,
          media: items.slice(0, input.limit),
          truncated: items.length > input.limit || warnings.length > 0,
          ...(warnings.length > 0 ? { warnings } : {}),
        }, target, input.title);
      }, signal);
    },

    async get_languages(raw: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResponse> {
      return run<GetLanguagesInput, ToolPayload>('get_languages', getLanguagesSchema, raw, async (input, target, childSignal) => {
        const url = actionUrl(target, {
          action: 'query', prop: 'langlinks', titles: input.title, lllimit: input.limit, llurl: 1,
        });
        const response = await client.getJson(url, fetchOptions(childSignal, 'wikimedia-action'));
        requireOk(response.status, target, input.title, 'wikimedia-action', response.json);
        const page = pagesOf(response.json)[0];
        const links = Array.isArray(page?.['langlinks']) ? page['langlinks'] : [];
        const languages = links.slice(0, input.limit).map((item) => {
          const link = asRecord(item) ?? {};
          return { lang: link['lang'] ?? '', title: link['title'] ?? '', url: link['url'] ?? '' };
        });
        const root = asRecord(response.json);
        const continuation = root === null ? null : asRecord(root['continue']);
        return withListProvenance({
          title: input.title, languages, count: languages.length,
          truncated: continuation !== null && Object.keys(continuation).length > 0,
        }, target, input.title);
      }, signal);
    },

    async get_random_page(raw: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResponse> {
      return run<GetRandomPageInput, ToolPayload>('get_random_page', getRandomPageSchema, raw, async (_input, target, childSignal) => {
        const response = await client.getJson(`${target.restBase}/page/random/summary`, fetchOptions(childSignal, 'wikimedia-rest-v1'));
        const title = typeof asRecord(response.json)?.['title'] === 'string'
          ? String(asRecord(response.json)?.['title']) : 'Unknown';
        return summaryPayload(target, title, response.json);
      }, signal);
    },

    async get_feed(raw: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResponse> {
      return run<GetFeedInput, ToolPayload>('get_feed', getFeedSchema, raw, async (input, target, childSignal) => {
        let date = input.date;
        if (date === 'today') date = new Date().toISOString().slice(0, 10);
        if (!isValidFeedDate(date)) {
          throw Object.assign(new Error(`Invalid or future date '${date}'.`), {
            toolError: toolError('validation_error', `Invalid or future date '${date}'.`, {
              retryable: false, details: { date },
            }),
          });
        }
        const yyyy = date.slice(0, 4);
        const mm = date.slice(5, 7);
        const dd = date.slice(8, 10);
        const path = input.kind === 'featured'
          ? `feed/featured/${yyyy}/${mm}/${dd}`
          : `feed/onthisday/${input.event_type}/${mm}/${dd}`;
        const response = await client.getJson(`${target.restBase}/${path}`, fetchOptions(childSignal, 'wikimedia-rest-v1'));
        const root = asRecord(response.json) ?? {};
        const groups = input.kind === 'featured'
          ? [root['mostread'], root['featured'], root['onthisday']]
          : [root[input.event_type]];
        const items = groups.flatMap((group) => {
          if (!Array.isArray(group)) return [];
          return group.slice(0, input.limit).map((item) => {
            const entry = asRecord(item) ?? {};
            const itemTitle = String(entry['title'] ?? '');
            return {
              title: itemTitle,
              description: typeof entry['description'] === 'string' ? entry['description'] : stripHtml(String(entry['extract'] ?? '')),
              url: typeof entry['content_urls'] === 'object'
                ? (asRecord(asRecord(entry['content_urls'])?.['desktop'])?.['page'] ?? '')
                : '',
              license: DEFAULT_LICENSE,
              attribution: assembleAttribution(target, itemTitle),
              untrusted_content: true,
            };
          });
        }).slice(0, input.limit);
        return withListProvenance({
          kind: input.kind, event_type: input.event_type, date,
          items, truncated: items.length >= input.limit,
        }, target, 'feed');
      }, signal);
    },
  };
}

function readMetadata(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  if (typeof value === 'string') return stripHtml(value);
  if (isRecord(value) && typeof value['value'] === 'string') return stripHtml(value['value']);
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type ToolName = keyof ReturnType<typeof createHandlers>;

/** Exported for unit tests of the Action API missing-page detector (H1). */
export { isMissingError, firstPageMissing };
