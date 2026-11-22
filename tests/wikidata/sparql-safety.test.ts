import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createWikidataHarness, sparqlJson, qidBinding, WDQS, type Harness } from './helpers.js';
import type { ToolResponse } from '../../src/types.js';

let harness: Harness;

beforeAll(() => { harness = createWikidataHarness(); harness.server.listen({ onUnhandledRequest: 'bypass' }); });
afterEach(() => { harness.server.resetHandlers(); harness.reset(); });

async function runSparql(args: Record<string, unknown>): Promise<{ result: ToolResponse; payload: Record<string, unknown> }> {
  const result = await harness.handlers['wikidata_sparql_query']?.(args) as ToolResponse;
  return { result, payload: result.structuredContent as Record<string, unknown> };
}

function standardResponse(bindings: Record<string, unknown>[] = [qidBinding('Q42')]): void {
  harness.server.use(http.get(`${WDQS}*`, ({ request }) => {
    harness.calls.push({ url: request.url, endpoint: 'v1' });
    return HttpResponse.json(sparqlJson(['item'], bindings));
  }));
}

describe('AC-48 — TC-B-006 rejected before any outbound request', () => {
  it('returns query_too_complex with error.limits and zero requests', async () => {
    const query = 'SELECT * WHERE { ?s ?p ?o . UNION { ?s ?p ?o . ?s2 ?p2 ?o2 } UNION { ?s ?p ?o . ?s3 ?p3 ?o3 } UNION { ?s ?p ?o . ?s4 ?p4 ?o4 } UNION { ?s ?p ?o . ?s5 ?p5 ?o5 } UNION { ?s ?p ?o . ?s6 ?p6 ?o6 } UNION { ?s ?p ?o . ?s7 ?p7 ?o7 } UNION { ?s ?p ?o . ?s8 ?p8 ?o8 } UNION { ?s ?p ?o . ?s9 ?p9 ?o9 } UNION { ?s ?p ?o . ?s10 ?p10 ?o10 } FILTER(?o > 0) }';
    const { result, payload } = await runSparql({ query });
    expect(result.isError).toBe(true);
    const error = payload['error'] as Record<string, unknown>;
    expect(['query_too_complex', 'query_limit_required']).toContain(error['code']);
    expect(error['limits']).toBeTruthy();
    expect((error['limits'] as Record<string, unknown>)['thresholds']).toBeTruthy();
    expect((error['limits'] as Record<string, unknown>)['observed']).toBeTruthy();
    expect(harness.calls).toHaveLength(0);
  });
});

describe('AC-49 — SELECT-only single statement and restricted SERVICE', () => {
  const bad = [
    'DESCRIBE ?s WHERE { ?s ?p ?o } LIMIT 5',
    'ASK { ?s ?p ?o }',
    'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 5',
    'INSERT DATA { <http://x/> <http://y/> <http://z/> }',
    'DELETE WHERE { ?s ?p ?o }',
    'SELECT ?s WHERE { ?s ?p ?o } ; SELECT ?x WHERE { ?x ?y ?z }',
    'SELECT ?s WHERE { ?s ?p ?o . SERVICE <https://attacker.example/sparql> { ?s ?p ?o } } LIMIT 5',
  ];
  for (const query of bad) {
    it(`rejects: ${query.slice(0, 46)}`, async () => {
      const { result, payload } = await runSparql({ query });
      expect(result.isError).toBe(true);
      expect((payload['error'] as Record<string, unknown>)['code']).toBe('invalid_query');
      expect(harness.calls).toHaveLength(0);
    });
  }
  it('accepts SERVICE wikibase:label and a keyword inside a string literal', async () => {
    standardResponse();
    const { result } = await runSparql({
      query: 'SELECT ?s WHERE { ?s <http://www.w3.org/2000/01/rdf-schema#label> "DELETE INSERT DESCRIBE" . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 5',
    });
    expect(result.isError).toBeUndefined();
    expect(harness.calls).toHaveLength(1);
  });
});

describe('AC-50 — length and complexity caps', () => {
  it('rejects a query longer than WIKIDATA_SPARQL_MAX_QUERY_LENGTH with limits', async () => {
    const query = `SELECT ?s WHERE { ?s ?p "x${'y'.repeat(10001)}" } LIMIT 5`;
    const { result, payload } = await runSparql({ query });
    const error = payload['error'] as Record<string, unknown>;
    expect(result.isError).toBe(true);
    expect(error['code']).toBe('query_too_complex');
    expect(error['limits']).toBeTruthy();
    expect(harness.calls).toHaveLength(0);
  });

  const overCaps: Array<[string, string]> = [
    ['UNION > 5', 'SELECT * WHERE { ?s ?p ?o . UNION {?a ?b ?c} UNION {?a ?b ?c} UNION {?a ?b ?c} UNION {?a ?b ?c} UNION {?a ?b ?c} UNION {?a ?b ?c} } LIMIT 5'],
    ['property paths > 3', 'SELECT * WHERE { ?s <http://x/a>+ ?o . ?s <http://x/b>+ ?o . ?s <http://x/c>+ ?o . ?s <http://x/d>+ ?o } LIMIT 5'],
    ['FILTER > 20', `SELECT * WHERE { ?s ?p ?o ${Array.from({ length: 21 }, (_, i) => `FILTER(?o > ${i})`).join(' ')} } LIMIT 5`],
  ];
  for (const [label, query] of overCaps) {
    it(`rejects ${label} locally`, async () => {
      const { result, payload } = await runSparql({ query });
      expect(result.isError).toBe(true);
      expect((payload['error'] as Record<string, unknown>)['code']).toBe('query_too_complex');
      expect(harness.calls).toHaveLength(0);
    });
  }
});

describe('AC-51 — mandatory LIMIT injection and clamping', () => {
  it('injects LIMIT 100 when absent and records the effective query in provenance', async () => {
    standardResponse();
    const { result, payload } = await runSparql({ query: 'SELECT ?item WHERE { ?item ?p ?o }' });
    expect(result.isError).toBeUndefined();
    const sent = decodeURIComponent(new URL(harness.calls[0]?.url as string).searchParams.get('query') as string);
    expect(/\bLIMIT\s+100\b/i.test(sent)).toBe(true);
    expect(payload['effective_limit']).toBe(100);
    expect((payload['attribution'] as Record<string, unknown>)?.['link']).toContain(encodeURIComponent(sent));
  });

  it('preserves an inline LIMIT 5 (TC-B-005) and clamps oversized inline LIMIT with a warning', async () => {
    standardResponse();
    const small = await runSparql({ query: 'SELECT ?item WHERE { ?item ?p ?o } LIMIT 5' });
    expect(small.payload['effective_limit']).toBe(5);
    expect(decodeURIComponent(new URL(harness.calls[0]?.url as string).searchParams.get('query') as string)).toMatch(/LIMIT 5$/);
    harness.calls.length = 0;
    const big = await runSparql({ query: 'SELECT ?item WHERE { ?item ?p ?o } LIMIT 5000' });
    expect(big.payload['effective_limit']).toBe(1000);
    expect((big.payload['warnings'] as string[]).some((warning) => warning.includes('inline LIMIT clamped to 1000'))).toBe(true);
  });

  it('caller limit overrides inline LIMIT; malformed inline LIMIT is rejected', async () => {
    standardResponse();
    const overridden = await runSparql({ query: 'SELECT ?item WHERE { ?item ?p ?o } LIMIT 5', limit: 3 });
    expect(overridden.payload['effective_limit']).toBe(3);
    harness.calls.length = 0;
    const malformed = await runSparql({ query: 'SELECT ?item WHERE { ?item ?p ?o } LIMIT abc' });
    expect((malformed.payload['error'] as Record<string, unknown>)['code']).toBe('query_limit_required');
    expect(harness.calls).toHaveLength(0);
  });
});

describe('AC-53 / AC-54 / AC-55 — parsing, normalisation and caps', () => {
  it('normalises typed bindings (uri, literal, bnode, datatype, lang) with no Blazegraph-only fields', async () => {
    harness.server.use(http.get(`${WDQS}*`, () => HttpResponse.json({
      head: { vars: ['item', 'label', 'b', 'typed'] },
      results: { bindings: [{
        item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q42' },
        label: { type: 'literal', 'xml:lang': 'en', value: 'Douglas Adams' },
        b: { type: 'bnode', value: 'b0' },
        typed: { type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#integer', value: '42' },
      }] },
    })));
    const { payload } = await runSparql({ query: 'SELECT ?item WHERE { ?item ?p ?o } LIMIT 5' });
    expect(payload['vars']).toEqual(['item', 'label', 'b', 'typed']);
    const binding = ((payload['results'] as Record<string, unknown>)['bindings'] as Array<Record<string, unknown>>)[0] as Record<string, Record<string, unknown>>;
    expect(binding['item']).toMatchObject({ type: 'uri', datatype: null, lang: null });
    expect(binding['label']).toMatchObject({ type: 'literal', lang: 'en' });
    expect(binding['b']).toMatchObject({ type: 'bnode' });
    expect(binding['typed']).toMatchObject({ type: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#integer' });
    expect(JSON.stringify(payload)).not.toContain('x-served-by');
  });

  it('truncates oversized result sets to the effective LIMIT at a binding boundary', async () => {
    const bindings = Array.from({ length: 20 }, (_, i) => qidBinding(`Q${100 + i}`));
    standardResponse(bindings);
    const { result, payload } = await runSparql({ query: 'SELECT ?item WHERE { ?item ?p ?o } LIMIT 20', limit: 3 });
    expect(result.isError).toBeUndefined();
    expect(payload['row_count']).toBe(3);
    expect(payload['truncated']).toBe(true);
    expect((payload['warnings'] as string[]).length).toBeGreaterThan(0);
  });

  it('returns one upstream_unavailable with parse_error for a non-JSON body', async () => {
    harness.server.use(http.get(`${WDQS}*`, () => new HttpResponse('not json', { status: 200 })));
    const { result, payload } = await runSparql({ query: 'SELECT ?item WHERE { ?item ?p ?o } LIMIT 5' });
    expect(result.isError).toBe(true);
    const error = payload['error'] as Record<string, unknown>;
    expect(error['code']).toBe('upstream_unavailable');
    expect((error['details'] as Record<string, unknown>)['parse_error']).toBeTruthy();
    expect(payload['results']).toBeUndefined();
  });

  it('parses both v1 and v2 Accept responses identically', async () => {
    standardResponse();
    const v1 = await runSparql({ query: 'SELECT ?item WHERE { ?item ?p ?o } LIMIT 5' });
    // Only one MSW server may intercept global fetch at a time.
    harness.server.close();
    const v2Harness = createWikidataHarness({ WIKIDATA_SPARQL_ACCEPT: 'application/sparql-results+json;charset=utf-8' });
    v2Harness.server.listen({ onUnhandledRequest: 'bypass' });
    v2Harness.server.use(http.get(`${WDQS}*`, ({ request }) => {
      expect(request.headers.get('accept')).toContain('sparql-results+json');
      return HttpResponse.json(sparqlJson(['item'], [qidBinding('Q42')]));
    }));
    try {
      const v2Result = await v2Harness.handlers['wikidata_sparql_query']?.({ query: 'SELECT ?item WHERE { ?item ?p ?o } LIMIT 5' }) as ToolResponse;
      expect((v1.payload['results'] as Record<string, unknown>)['bindings'])
        .toEqual(((v2Result.structuredContent as Record<string, unknown>)['results'] as Record<string, unknown>)['bindings']);
    } finally {
      v2Harness.close();
      harness.server.listen({ onUnhandledRequest: 'bypass' });
    }
  });
});
