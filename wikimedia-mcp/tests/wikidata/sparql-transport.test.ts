import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import {
  createWikidataHarness, sparqlJson, qidBinding,
  WDQS, WDQS_V2, type Harness,
} from './helpers.js';
import {
  sparqlEndpointPlan, shouldSwitchEndpoint, SparqlExecutionError, SparqlRunner,
} from '../../src/upstream/wikidata-sparql.js';
import type { ToolResponse } from '../../src/types.js';

let harness: Harness;
beforeAll(() => { harness = createWikidataHarness(); harness.server.listen({ onUnhandledRequest: 'bypass' }); });
afterEach(() => { harness.server.resetHandlers(); harness.reset(); });

const QUERY = 'SELECT ?item WHERE { ?item ?p ?o } LIMIT 5';
const LABEL_QUERY = [
  'PREFIX wikibase: <http://wikiba.se/ontology#>',
  'PREFIX bd: <http://www.bigdata.com/rdf#>',
  'SELECT ?item ?itemLabel WHERE { ?item wdt:P31 wd:Q5 . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 5',
].join('\n');

async function call(h: Harness = harness): Promise<Record<string, unknown>> {
  const result = await h.handlers['wikidata_sparql_query']?.({ query: QUERY }) as ToolResponse;
  return result.structuredContent as Record<string, unknown>;
}

function answerAt(url: string, h: Harness = harness): void {
  h.server.use(http.get(`${url}*`, ({ request }) => {
    h.calls.push({ url: request.url, endpoint: url });
    return HttpResponse.json(sparqlJson(['item'], [qidBinding('Q42')]));
  }));
}

describe('AC-37 — endpoint chain and fallback order', () => {
  it('uses PRIMARY then V2 by default, and names the endpoint that answered', async () => {
    const plan = sparqlEndpointPlan(harness.config);
    expect(plan.endpoints[0]).toBe(WDQS);
    expect(plan.endpoints[1]).toBe(WDQS_V2);
    harness.server.use(http.get(`${WDQS}*`, ({ request }) => {
      harness.calls.push({ url: request.url, endpoint: 'v1' });
      return new HttpResponse('Unauthorized User-Agent', { status: 403 });
    }));
    answerAt(WDQS_V2);
    const payload = await call();
    expect(payload['endpoint']).toBe(WDQS_V2);
    expect(payload['error']).toBeUndefined();
    expect(harness.calls).toHaveLength(2);
  });

  it('PREFER_V2=true sends the first request to the v2 endpoint', async () => {
    harness.server.close();
    const h = createWikidataHarness({ WIKIDATA_SPARQL_PREFER_V2: 'true' });
    h.server.listen({ onUnhandledRequest: 'bypass' });
    expect(sparqlEndpointPlan(h.config).endpoints[0]).toBe(WDQS_V2);
    h.server.use(http.get(`${WDQS_V2}*`, ({ request }) => {
      h.calls.push({ url: request.url, endpoint: 'v2' });
      return HttpResponse.json(sparqlJson(['item'], [qidBinding('Q42')]));
    }));
    try {
      const payload = await call(h);
      expect(payload['endpoint']).toBe(WDQS_V2);
      expect(h.calls).toHaveLength(1);
    } finally {
      h.close();
      harness.server.listen({ onUnhandledRequest: 'bypass' });
    }
  });
});

describe('AC-38 — switch endpoint on 401/403/404/other-5xx', () => {
  it('switches and never leaks the raw 403 body or credentials in the final error', async () => {
    expect(shouldSwitchEndpoint(403, 'Unauthorized User-Agent')).toBe(true);
    for (const endpoint of [WDQS, WDQS_V2, 'https://query-main.wikidata.org/sparql']) {
      harness.server.use(http.get(`${endpoint}*`, ({ request }) => {
        harness.calls.push({ url: request.url, endpoint });
        return new HttpResponse('Unauthorized User-Agent secret-token', { status: 403 });
      }));
    }
    const payload = await call();
    const error = payload['error'] as Record<string, unknown>;
    expect(error['code']).toBe('upstream_unavailable');
    expect(error['message']).not.toContain('secret-token');
    expect(JSON.stringify(payload)).not.toContain('Unauthorized User-Agent');
    expect(harness.calls).toHaveLength(3);
  });

  for (const status of [401, 404, 502]) {
    it(`advances to the next endpoint on ${status}`, async () => {
      harness.server.use(http.get(`${WDQS}*`, ({ request }) => {
        harness.calls.push({ url: request.url, endpoint: 'v1' });
        return new HttpResponse('raw failure body with token', { status });
      }));
      answerAt(WDQS_V2);
      const payload = await call();
      expect(payload['error']).toBeUndefined();
      expect(payload['endpoint']).toBe(WDQS_V2);
      expect(harness.calls).toHaveLength(2);
    });
  }
});

describe('AC-39 / AC-40 — stay-and-retry on 429 and 503', () => {
  it('429 with Retry-After: 1 stays on the same endpoint and succeeds after one retry', async () => {
    let attempts = 0;
    harness.server.use(http.get(`${WDQS}*`, ({ request }) => {
      harness.calls.push({ url: request.url, endpoint: 'v1' });
      attempts += 1;
      if (attempts === 1) return HttpResponse.json({ message: 'slow down' }, { status: 429, headers: { 'Retry-After': '1' } });
      return HttpResponse.json(sparqlJson(['item'], [qidBinding('Q42')]));
    }));
    const payload = await call();
    expect(payload['error']).toBeUndefined();
    expect(harness.calls.every((entry) => entry.endpoint === 'v1')).toBe(true);
    expect(harness.calls).toHaveLength(2);
    expect(harness.sleepMs).toContain(1000);
  });

  it('503 exhaustion stays on one endpoint and returns retryable upstream_unavailable', async () => {
    harness.server.use(http.get(`${WDQS}*`, ({ request }) => {
      harness.calls.push({ url: request.url, endpoint: 'v1' });
      return HttpResponse.json({}, { status: 503, headers: { 'Retry-After': '2' } });
    }));
    const payload = await call();
    const error = payload['error'] as Record<string, unknown>;
    expect(error['code']).toBe('upstream_unavailable');
    expect(error['retryable']).toBe(true);
    expect(error['retry_after_seconds']).toBe(2);
    expect(harness.calls.every((entry) => entry.endpoint === 'v1')).toBe(true);
    expect(harness.calls).toHaveLength(3);
  });

  it('429 without Retry-After waits at least RETRY_AFTER_FALLBACK_MS', async () => {
    harness.server.use(http.get(`${WDQS}*`, ({ request }) => {
      harness.calls.push({ url: request.url, endpoint: 'v1' });
      return HttpResponse.json({}, { status: 429 });
    }));
    const payload = await call();
    expect((payload['error'] as Record<string, unknown>)['code']).toBe('rate_limited');
    expect(harness.sleepMs.every((ms) => ms >= 5)).toBe(true);
    expect(harness.calls.every((entry) => entry.endpoint === 'v1')).toBe(true);
  });
});

describe('AC-52 — deadline abort releases the WDQS slot', () => {
  it('aborts at timeout_ms and a subsequent query still succeeds', async () => {
    for (const endpoint of [WDQS, WDQS_V2, 'https://query-main.wikidata.org/sparql']) {
      harness.server.use(http.get(`${endpoint}*`, async ({ request }) => {
        harness.calls.push({ url: request.url, endpoint });
        await delay(1300);
        return HttpResponse.json(sparqlJson(['item'], [qidBinding('Q42')]));
      }));
    }
    const timed = await harness.handlers['wikidata_sparql_query']?.({ query: QUERY, timeout_ms: 1000 }) as ToolResponse;
    const payload = timed.structuredContent as Record<string, unknown>;
    expect((payload['error'] as Record<string, unknown>)['code']).toBe('query_timeout');
    expect((payload['error'] as Record<string, unknown>)['action']).toBeTruthy();
    harness.server.resetHandlers();
    answerAt(WDQS);
    const next = await call();
    expect(next['error']).toBeUndefined();
  }, 20000);
});

describe('label-service deadline UX — effective_timeout_ms (non-fatal bump)', () => {
  it('label query with timeout_ms=30000 uses the full 60000 ms cap and warns', async () => {
    answerAt(WDQS);
    const result = await harness.handlers['wikidata_sparql_query']?.({ query: LABEL_QUERY, timeout_ms: 30000 }) as ToolResponse;
    const payload = result.structuredContent as Record<string, unknown>;
    expect(result.isError).toBeUndefined();
    expect(payload['error']).toBeUndefined();
    expect(payload['effective_timeout_ms']).toBe(60000);
    const warnings = payload['warnings'] as string[];
    expect(warnings.some((warning) => warning.includes('label-service') && warning.includes('60000'))).toBe(true);
    expect(harness.calls).toHaveLength(1);
  });

  it('non-label query keeps the requested timeout and emits no timeout warning', async () => {
    answerAt(WDQS);
    const result = await harness.handlers['wikidata_sparql_query']?.({ query: QUERY, timeout_ms: 30000 }) as ToolResponse;
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload['error']).toBeUndefined();
    expect(payload['effective_timeout_ms']).toBe(30000);
    expect(payload['warnings']).toEqual([]);
  });

  it('label query already at timeout_ms=60000 is not bumped again', async () => {
    answerAt(WDQS);
    const result = await harness.handlers['wikidata_sparql_query']?.({ query: LABEL_QUERY, timeout_ms: 60000 }) as ToolResponse;
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload['error']).toBeUndefined();
    expect(payload['effective_timeout_ms']).toBe(60000);
    expect((payload['warnings'] as string[]).some((warning) => warning.includes('timeout_ms raised'))).toBe(false);
  });

  it('a label SERVICE mentioned only inside a literal does not count', async () => {
    const query = 'SELECT ?item WHERE { ?item ?p "SERVICE wikibase:label" } LIMIT 5';
    answerAt(WDQS);
    const result = await harness.handlers['wikidata_sparql_query']?.({ query, timeout_ms: 30000 }) as ToolResponse;
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload['error']).toBeUndefined();
    expect(payload['effective_timeout_ms']).toBe(30000);
  });

  it('a timed-out label query names the label service in an actionable error', async () => {
    for (const endpoint of [WDQS, WDQS_V2, 'https://query-main.wikidata.org/sparql']) {
      harness.server.use(http.get(`${endpoint}*`, async ({ request }) => {
        harness.calls.push({ url: request.url, endpoint });
        await delay(1200);
        return HttpResponse.json(sparqlJson(['item'], [qidBinding('Q42')]));
      }));
    }
    // Exercise the runner directly: the tool handler intentionally raises a
    // label query's deadline to 60 s before reaching this error path.
    const runner = new SparqlRunner(harness.config, harness.client);
    let caught: unknown;
    try { await runner.execute(LABEL_QUERY, 5, { timeoutMs: 1000 }); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SparqlExecutionError);
    const error = caught as SparqlExecutionError;
    expect(error.code).toBe('query_timeout');
    expect(error.options.hint).toContain('wikibase:label');
    expect(error.options.action).toContain('60000');
    expect(error.options.details?.['label_service']).toBe(true);
  }, 20000);
});
