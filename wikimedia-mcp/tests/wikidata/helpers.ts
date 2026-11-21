import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { WikimediaClient } from '../../src/upstream/client.js';
import { createHandlers } from '../../src/server/tools/handlers.js';
import { testConfig } from '../helpers/test-env.js';
import { clearSparqlCaches } from '../../src/upstream/wikidata-sparql.js';

export const WDQS = 'https://query.wikidata.org/sparql';
export const WDQS_V2 = 'https://query-next.wikidata.org/sparql';
export const WB_REST = 'https://www.wikidata.org/w/rest.php/wikibase/v1';

export function qidBinding(qid: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { item: { type: 'uri', value: `http://www.wikidata.org/entity/${qid}` }, ...extra };
}

export function sparqlJson(vars: string[], bindings: Record<string, unknown>[]): Record<string, unknown> {
  return { head: { vars }, results: { bindings } };
}

export type Harness = {
  server: ReturnType<typeof setupServer>;
  client: WikimediaClient;
  handlers: ReturnType<typeof createHandlers>;
  config: ReturnType<typeof testConfig>;
  calls: Array<{ url: string; endpoint: string }>;
  sleepMs: number[];
  reset: () => void;
  close: () => void;
};

/** MSW-backed harness: no live network, fake sleeps, deterministic clock. */
export function createWikidataHarness(overrides: Record<string, string> = {}): Harness {
  const config = testConfig({
    RETRY_MAX_ATTEMPTS: '3',
    RETRY_AFTER_FALLBACK_MS: '5',
    WIKIDATA_SPARQL_FALLBACKS: 'https://query-main.wikidata.org/sparql',
    ...overrides,
  });
  const client = new WikimediaClient(config, { useDispatcher: false });
  const server = setupServer();
  const calls: Array<{ url: string; endpoint: string }> = [];
  const sleepMs: number[] = [];
  const sleep = async (ms: number): Promise<void> => { sleepMs.push(ms); };
  const now = () => Date.parse('2026-11-21T09:00:00Z');
  return {
    server, client, handlers: createHandlers(client, config, { sleep, now }), config, calls, sleepMs,
    reset: () => { clearSparqlCaches(client); calls.length = 0; sleepMs.length = 0; },
    close: () => { client.close(); server.close(); },
  };
}

/** Standard WDQS handler with a configurable sequence of responses. */
export function useWdqsSequence(
  harness: Harness,
  responses: Array<{ status: number; body?: unknown; rawText?: string; headers?: Record<string, string> }>,
): void {
  let index = 0;
  harness.server.use(http.get(`${WDQS}*`, ({ request }) => {
    harness.calls.push({ url: request.url, endpoint: 'v1' });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (response === undefined) return HttpResponse.json(sparqlJson([], []));
    if (response.rawText !== undefined) return new HttpResponse(response.rawText, { status: response.status, headers: response.headers });
    return HttpResponse.json(response.body ?? sparqlJson([], []), { status: response.status, headers: response.headers });
  }));
}

export const WIKIBASE_ENTITY = {
  type: 'item',
  id: 'Q42',
  labels: { en: { language: 'en', value: 'Douglas Adams' }, de: { language: 'de', value: 'Douglas Adams' }, fr: { language: 'fr', value: 'Douglas Adams' } },
  descriptions: { en: { language: 'en', value: 'English writer and humorist' } },
  aliases: { en: [{ language: 'en', value: 'Douglas Noel Adams' }] },
  statements: {
    P569: [
      { id: 'Q42$normal', rank: 'normal', mainsnak: { snaktype: 'value', property: 'P569', datavalue: { type: 'time', value: { time: '+1952-03-11T00:00:00Z', precision: 11 } } } },
      { id: 'Q42$preferred', rank: 'preferred', mainsnak: { snaktype: 'value', property: 'P569', datavalue: { type: 'time', value: { time: '+1952-03-11T00:00:00Z', precision: 11 } } } },
      { id: 'Q42$deprecated', rank: 'deprecated', mainsnak: { snaktype: 'value', property: 'P569', datavalue: { type: 'time', value: { time: '+1952-03-11T00:00:00Z', precision: 11 } } } },
    ],
  },
  sitelinks: {
    enwiki: { title: 'Douglas Adams', badges: [] },
    dewiki: { title: 'Douglas Adams', badges: [] },
    frwiki: { title: 'Douglas Adams', badges: [] },
  },
};
