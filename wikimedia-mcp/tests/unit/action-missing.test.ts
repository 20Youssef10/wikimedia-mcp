import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createHandlers, isMissingError, firstPageMissing } from '../../src/server/tools/handlers.js';
import { WikimediaClient } from '../../src/upstream/client.js';
import { createMswServer } from '../helpers/msw.js';
import { testConfig } from '../helpers/test-env.js';

const msw = createMswServer();
const config = testConfig();
const client = new WikimediaClient(config, { useDispatcher: false });
const handlers = createHandlers(client, config);

beforeAll(() => {
  msw.listen({ onUnhandledRequest: 'bypass' });
  // MediaWiki Action API returns HTTP 200 for missing pages (finding H1).
  msw.use(http.get('*/w/api.php', ({ request }) => {
    const url = new URL(request.url);
    const target = url.searchParams.get('titles') ?? url.searchParams.get('page') ?? '';
    if (target !== 'MissingActionPage') return HttpResponse.json({ query: { pages: {} } });
    if (url.searchParams.get('action') === 'parse') {
      return HttpResponse.json({ error: { code: 'missingtitle', info: 'The page you specified doesn\'t exist' } });
    }
    return HttpResponse.json({ query: { pages: { '-1': { missing: '', title: 'MissingActionPage' } } } });
  }));
});

afterAll(() => { client.close(); msw.close(); });

function errorOf(result: { isError?: boolean; structuredContent?: Record<string, unknown> }): Record<string, unknown> {
  expect(result.isError).toBe(true);
  const error = result.structuredContent?.['error'];
  expect(error).toBeDefined();
  return error as Record<string, unknown>;
}

describe('H1 — Action API HTTP-200 missing pages must be page_not_found', () => {
  it('detects both MediaWiki missing-page signals', () => {
    expect(isMissingError({ error: { code: 'missingtitle' } })).toBe(true);
    expect(firstPageMissing({ query: { pages: { '-1': { missing: '', title: 'X' } } } })).toBe(true);
    expect(firstPageMissing({ query: { pages: { 1: { title: 'X', extract: 'ok' } } } })).toBe(false);
    expect(isMissingError({ query: { search: [] } })).toBe(false);
  });

  it('get_page plaintext (prop=extracts) reports page_not_found', async () => {
    const result = await handlers.get_page({ title: 'MissingActionPage', format: 'plaintext' });
    expect(errorOf(result)).toMatchObject({ code: 'page_not_found', retryable: false });
  });

  it('get_page wikitext (prop=revisions) reports page_not_found', async () => {
    const result = await handlers.get_page({ title: 'MissingActionPage', format: 'wikitext' });
    expect(errorOf(result)).toMatchObject({ code: 'page_not_found', retryable: false });
  });

  it('get_sections (action=parse) reports page_not_found', async () => {
    const result = await handlers.get_sections({ title: 'MissingActionPage' });
    expect(errorOf(result)).toMatchObject({ code: 'page_not_found', retryable: false });
  });

  it('get_media (prop=images) reports page_not_found', async () => {
    const result = await handlers.get_media({ title: 'MissingActionPage' });
    expect(errorOf(result)).toMatchObject({ code: 'page_not_found', retryable: false });
  });

  it('get_languages (prop=langlinks) reports page_not_found', async () => {
    const result = await handlers.get_languages({ title: 'MissingActionPage' });
    expect(errorOf(result)).toMatchObject({ code: 'page_not_found', retryable: false });
  });
});
