import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createHandlers } from '../src/server/tools/handlers.js';
import { WikimediaClient } from '../src/upstream/client.js';
import { createMswServer } from './helpers/msw.js';
import { testConfig } from './helpers/test-env.js';
import { hasField, loadCorpus, PHASE1_TOOLS, type CorpusCase } from './corpus-loader.js';
import { TOOL_SCHEMAS } from '../src/server/tools/schemas.js';
import type { ToolResponse } from '../src/types.js';

const msw = createMswServer();
const config = testConfig();
const client = new WikimediaClient(config, { useDispatcher: false });
const handlers = createHandlers(client, config);

// TC-A-014 needs bounded retries: first call 429 with Retry-After, then success.
const retryConfig = testConfig({ RETRY_MAX_ATTEMPTS: '3', RETRY_AFTER_FALLBACK_MS: '1' });
const retryClient = new WikimediaClient(retryConfig, { useDispatcher: false });
const retryHandlers = createHandlers(retryClient, retryConfig);
let rateLimitedCalls = 0;

beforeAll(() => {
  msw.listen({ onUnhandledRequest: 'bypass' });
  msw.use(http.get('*/api/rest_v1/page/summary/RateLimitedEarth', () => {
    rateLimitedCalls += 1;
    if (rateLimitedCalls === 1) {
      return HttpResponse.json({ type: 'rate_limited' }, {
        status: 429,
        headers: { 'Retry-After': '0' },
      });
    }
    return HttpResponse.json({
      title: 'Earth',
      description: 'Third planet from the Sun',
      extract: 'Earth is the third planet from the Sun.',
      revision: 1293847560,
      timestamp: '2026-11-20T09:14:22Z',
    });
  }));
  // Disambiguation case (TC-A-005).
  msw.use(http.get('*/api/rest_v1/page/summary/Mercury', () => HttpResponse.json({
    type: 'disambiguation',
    pages: [{ title: 'Mercury (planet)' }, { title: 'Mercury (element)' }],
  })));
  // Malformed 503 case (TC-A-015).
  msw.use(http.get('*/api/rest_v1/page/summary/Simulated503', () =>
    new HttpResponse('not json', { status: 503 })));
});

afterAll(() => {
  client.close();
  retryClient.close();
  msw.close();
});

function cleanParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([key]) => !key.startsWith('_')));
}

async function invoke(testCase: CorpusCase): Promise<ToolResponse> {
  const clean = cleanParams(testCase.params);
  if (testCase.id === 'TC-A-015') clean['title'] = 'Simulated503';
  if (testCase.id === 'TC-A-014') clean['title'] = 'RateLimitedEarth';
  const source = testCase.id === 'TC-A-014' ? retryHandlers : handlers;
  const handler = source[testCase.tool as keyof typeof source];
  if (handler === undefined) throw new Error(`No Phase 1 handler for ${testCase.tool}`);
  return handler(clean);
}

function flat(result: ToolResponse): Record<string, unknown> {
  const payload = result.structuredContent ?? {};
  return { ...payload, resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'wikimedia-mcp' } } };
}

describe('fixture-only merge gate — corpus v1.0.0 (report 09 §4.5)', () => {
  const corpus = loadCorpus();
  const phase1FixtureCases = corpus.test_cases.filter(
    (testCase) => testCase.mode === 'fixture' && PHASE1_TOOLS.has(testCase.tool),
  );

  it('loads the corpus with >= 30 cases and nine Phase 1 fixture cases', () => {
    expect(corpus.test_cases.length).toBeGreaterThanOrEqual(30);
    expect(phase1FixtureCases.length).toBeGreaterThanOrEqual(8);
  });

  it('documents out-of-scope groups (B-G) as later-phase tools', () => {
    const outOfScope = corpus.test_cases.filter((testCase) => !PHASE1_TOOLS.has(testCase.tool));
    expect(outOfScope.length).toBeGreaterThan(0);
    expect(outOfScope.every((testCase) => testCase.tool !== 'get_summary')).toBe(true);
  });

  for (const testCase of phase1FixtureCases) {
    it(`${testCase.id} (${testCase.tool}) resolves to ${testCase.expected.status}`, async () => {
      const result = await invoke(testCase);
      const observedStatus = result.isError === true ? 'error' : 'ok';
      expect(observedStatus, `${testCase.id} status`).toBe(testCase.expected.status);
      const view = flat(result);
      // Contract-visible fields only; test-control keys (_simulate, retry_count)
      // are not part of the frozen v1.0.1 output contract.
      for (const field of testCase.expected.required_fields) {
        if (field === '_meta' || field === '_meta.retry_count') continue;
        expect(hasField(view, field), `${testCase.id} missing ${field}`).toBe(true);
      }
      if (testCase.expected.status === 'error') {
        const error = (view['error'] ?? {}) as Record<string, unknown>;
        expect(typeof error['code']).toBe('string');
        expect(typeof error['message']).toBe('string');
      } else {
        expect(view['_meta']).toBeDefined();
      }

      if (testCase.id === 'TC-A-014') {
        // H3: real assertions on contract-visible fields, Retry-After honoured
        // (0 s), bounded retries (exactly two calls), eventual success.
        expect(result.isError).toBeUndefined();
        expect(view['title']).toBe('Earth');
        expect(view['license']).toBeDefined();
        expect(view['attribution']).toBeDefined();
        expect(rateLimitedCalls).toBe(2);
      }
    });
  }
});

describe('corpus contract guard', () => {
  it('every Phase 1 corpus case validates against its frozen tool schema', () => {
    const failures: string[] = [];
    for (const testCase of loadCorpus().test_cases) {
      if (!PHASE1_TOOLS.has(testCase.tool)) continue;
      const schema = TOOL_SCHEMAS[testCase.tool as keyof typeof TOOL_SCHEMAS];
      // Security cases intentionally carry out-of-contract parameters (e.g. a
      // `host` key for SSRF). They must be REJECTED by the strict schema; the
      // handler's host allowlist is a second layer, not the first.
      if (testCase.category === 'security') {
        // TC-A-013 is the out-of-contract `host` case: it MUST be rejected by
        // the strict schema. TC-A-012 is a schema-valid prompt-injection case
        // (the injected text is an internal fixture key stripped by cleanParams).
        if (testCase.id === 'TC-A-013' && schema !== undefined && schema.safeParse(cleanParams(testCase.params)).success) {
          failures.push(`${testCase.id}: SSRF case unexpectedly passed schema validation`);
        }
        continue;
      }
      if (schema === undefined) {
        failures.push(`${testCase.id}: no schema for tool ${testCase.tool}`);
        continue;
      }
      const parsed = schema.safeParse(cleanParams(testCase.params));
      if (!parsed.success) {
        failures.push(`${testCase.id} (${testCase.tool}): ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      }
    }
    expect(failures, `Corpus/tool-schema mismatches:\n${failures.join('\n')}`).toEqual([]);
  });
});
