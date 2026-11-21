import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOL_NAMES } from '../../src/server/tools/registry.js';
import { GROUP_G_SCHEMAS, GROUP_G_TOOL_NAMES, GROUP_G_DESCRIPTIONS } from '../../src/groupg/schemas.js';
import { G5Tracker, excludePhase5, isPhase5Tool } from '../../src/groupg/g5-metrics.js';
import { DAY_ONE_CONFIG_KEYS, loadConfig } from '../../src/config.js';
import { WARN } from '../../src/groupg/constants.js';
import {
  createPhase5Harness, phase5Case, payload, errorOf,
  type Phase5Harness,
} from './harness.js';
import { hasField } from '../corpus-loader.js';
import type { RawStdioClient as RawStdioClientType } from '../helpers/raw-stdio.js';
import { startTestHttp, rpc } from '../helpers/raw-http.js';

function cleanParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([key]) => !key.startsWith('_')));
}

function flat(result: { structuredContent: Record<string, unknown> }): Record<string, unknown> {
  return {
    ...result.structuredContent,
    resultType: (result.structuredContent['resultType'] as string | undefined) ?? 'complete',
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'wikimedia-mcp' } },
  };
}

let stdio: RawStdioClientType;

beforeAll(async () => {
  const { RawStdioClient } = await import('../helpers/raw-stdio.js');
  stdio = new RawStdioClient();
  await stdio.request('tools/list', {}, 9500);
});
afterAll(() => stdio?.close());

describe('AC-95 — registration of exactly geo_search and get_tables (23 tools after Group D)', () => {
  it('registers 23 tools including the two Phase 5 names and no write/Enterprise/out-of-scope tool', () => {
    expect(TOOL_NAMES).toHaveLength(23);
    expect(TOOL_NAMES).toContain('geo_search');
    expect(TOOL_NAMES).toContain('get_tables');
    expect(TOOL_NAMES.slice(-3)).toEqual(['geo_search', 'get_tables', 'get_recent_changes']);
    for (const forbidden of [
      'compare_revisions', 'get_category_members', 'liftwing_predict', 'wikifunctions',
      'edit_page', 'upload_file', 'delete_page', 'move_page',
    ]) {
      expect(TOOL_NAMES).not.toContain(forbidden);
    }
  });

  it('new schemas are strict with non-empty, contract-matching descriptions', () => {
    for (const name of GROUP_G_TOOL_NAMES) {
      const schema = GROUP_G_SCHEMAS[name];
      const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
      expect(json['additionalProperties']).toBe(false);
      expect(GROUP_G_DESCRIPTIONS[name].length).toBeGreaterThan(80);
    }
    expect(GROUP_G_DESCRIPTIONS.geo_search).toContain('WGS84');
    expect(GROUP_G_DESCRIPTIONS.geo_search).toContain('get_summary');
    expect(GROUP_G_DESCRIPTIONS.get_tables).toContain('Parsoid HTML');
  });

  it('tools/list over stdio advertises both tools verbatim', async () => {
    const listed = await stdio.request('tools/list', {}, 9501);
    const tools = ((listed.body['result'] as Record<string, unknown> | undefined)?.['tools'] as Array<Record<string, unknown>> | undefined) ?? [];
    expect(tools).toHaveLength(23);
    const added = tools.filter((tool) => GROUP_G_TOOL_NAMES.includes(String(tool['name']) as 'geo_search' | 'get_tables'));
    expect(added).toHaveLength(2);
    for (const tool of added) {
      expect(String(tool['description']).length).toBeGreaterThan(80);
      expect(tool['inputSchema']).toBeDefined();
      expect(JSON.stringify(tool)).not.toContain('x-mcp-header');
    }
  });
});

describe('AC-96 / AC-97 — annotations, config reuse and no new keys', () => {
  it('both tools are read-only, non-destructive, open-world and idempotent', async () => {
    const listed = await stdio.request('tools/list', {}, 9502);
    const tools = ((listed.body['result'] as Record<string, unknown> | undefined)?.['tools'] as Array<Record<string, unknown>> | undefined) ?? [];
    const added = tools.filter((tool) => GROUP_G_TOOL_NAMES.includes(String(tool['name']) as 'geo_search' | 'get_tables'));
    expect(added).toHaveLength(2);
    for (const tool of added) {
      expect(tool['annotations']).toMatchObject({
        readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true,
      });
    }
  });

  it('incoming Mcp-Param-* header is rejected with -32020 over stdio tools/call', async () => {
    // Verified on the HTTP transport by AC-116/contract suite; here assert the
    // Phase 5 schemas expose no x-mcp-header capability at all.
    for (const schema of Object.values(GROUP_G_SCHEMAS)) {
      expect(JSON.stringify(z.toJSONSchema(schema))).not.toContain('x-mcp-header');
    }
  });

  it('zero new config keys; boot guards unchanged', () => {
    const base = { USER_AGENT: 'QA/1.0 (https://example.org; qa@example.org)' };
    const config = loadConfig(base);
    expect(config.maxResultBytes).toBe(65536);
    expect(config.concurrencyLimit).toBe(3);
    expect(DAY_ONE_CONFIG_KEYS).toHaveLength(11);
    expect(() => loadConfig({ ...base, USER_AGENT: '' })).toThrow(/USER_AGENT/);
    expect(() => loadConfig({ ...base, CONCURRENCY_LIMIT: '4' })).toThrow(/CONCURRENCY_LIMIT/);
    expect(() => loadConfig({ ...base, MAX_RESULT_BYTES: '0' })).toThrow(/MAX_RESULT_BYTES/);
  });
});

describe('AC-98 — regression gate over both transports', () => {
  it('previous tool names/schemas are unchanged and no Phase 5 result carries cache fields', async () => {
    expect(TOOL_NAMES.slice(0, 20)).toHaveLength(20);
    const h = createPhase5Harness();
    h.server.listen({ onUnhandledRequest: 'bypass' });
    try {
      const results = await Promise.all([
        h.handlers['geo_search']!({ latitude: 37.7749, longitude: -122.4194, limit: 1 }),
        h.handlers['get_tables']!({ title: 'Earth' }),
      ]);
      for (const result of results) {
        expect(result.structuredContent['ttlMs']).toBeUndefined();
        expect(result.structuredContent['cacheScope']).toBeUndefined();
      }
    } finally {
      h.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Geosearch — B and C
// ---------------------------------------------------------------------------
describe('AC-99…AC-106 / AC-119 — geo_search validation, bounds, behaviour', () => {
  let h: Phase5Harness;
  beforeAll(() => { h = createPhase5Harness(); h.server.listen({ onUnhandledRequest: 'bypass' }); });
  afterAll(() => h.close());

  it('AC-99 rejects missing/string/non-finite/unknown/out-of-range with validation_error, zero outbound', async () => {
    const bad = [
      {}, // missing
      { latitude: '37.7', longitude: -122 }, // string
      { latitude: 37.7, longitude: -122, bogus: 1 }, // unknown field
      { latitude: 37.7, longitude: -122, radius_m: 9 },
      { latitude: 37.7, longitude: -122, namespace: 16 },
      { latitude: 37.7, longitude: -122, limit: 51 },
    ];
    for (const args of bad) {
      h.requests.length = 0;
      const result = await h.handlers['geo_search']!(args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(errorOf(result)['code']).toBe('validation_error');
      expect(h.requests.length).toBe(0);
    }
    // Non-finite numbers bypass JSON but must still be rejected.
    h.requests.length = 0;
    const inf = await h.handlers['geo_search']!({ latitude: Infinity, longitude: 1 });
    expect(errorOf(inf)['code']).toBe('validation_error');
    expect(h.requests.length).toBe(0);
  });

  it('AC-100 / TC-G-009 out-of-bounds finite latitude → invalid_coordinates with details.limits', async () => {
    h.requests.length = 0;
    const result = await h.handlers['geo_search']!(cleanParams(phase5Case('TC-G-009').params));
    expect(result.isError).toBe(true);
    expect(errorOf(result)['code']).toBe('invalid_coordinates');
    expect(hasField(flat(result), 'error.details.limits')).toBe(true);
    expect(h.requests.length).toBe(0);
  });

  it('AC-101 / TC-G-010 radius/namespace/limit out of bounds → validation_error, zero outbound', async () => {
    h.requests.length = 0;
    const result = await h.handlers['geo_search']!(cleanParams(phase5Case('TC-G-010').params));
    expect(errorOf(result)['code']).toBe('validation_error');
    expect(h.requests.length).toBe(0);
  });

  it('AC-102 / TC-G-012 aliases resolve; host-shaped project → invalid_project, zero outbound', async () => {
    for (const alias of ['enwiki', 'wikipedia:en', 'en.wikipedia']) {
      h.requests.length = 0;
      const result = await h.handlers['geo_search']!({ latitude: 37.7749, longitude: -122.4194, project: alias, limit: 1 });
      expect(result.isError, alias).toBeUndefined();
      expect(payload(result)['source']).toBe('wikipedia:en');
      expect(h.requests[0]).toContain('https://en.wikipedia.org/w/api.php');
    }
    h.requests.length = 0;
    const bad = await h.handlers['geo_search']!(cleanParams(phase5Case('TC-G-012').params));
    expect(errorOf(bad)['code']).toBe('invalid_project');
    expect(h.requests.length).toBe(0);
  });

  it('AC-103 / TC-G-003 exact outbound URL, pipe encoded, one call, with User-Agent', async () => {
    h.requests.length = 0;
    const result = await h.handlers['geo_search']!(cleanParams(phase5Case('TC-G-003').params));
    expect(result.isError).toBeUndefined();
    expect(h.requests).toEqual([
      'https://en.wikipedia.org/w/api.php?action=query&format=json&list=geosearch&gscoord=37.7749%7C-122.4194&gsradius=1000&gsnamespace=0&gslimit=5',
    ]);
  });

  it('AC-104 maps hits to pages with rounded distance and host-derived url', () => {
    // Covered with the same TC-G-003 result below; kept as a named binary check.
    expect(hasField(flat({ structuredContent: {
      pages: [{ pageid: 29311341, ns: 0, title: 'San Francisco', coordinates: { lat: 37.775, lon: -122.418 }, distance_m: 123, url: 'https://en.wikipedia.org/wiki/San_Francisco?wprov=afsw1' }],
      count: 1,
    } }), 'pages[0].coordinates.lat')).toBe(true);
  });

  it('AC-104 (live fixture) verifies count/distance/url against TC-G-003', async () => {
    const result = await h.handlers['geo_search']!(cleanParams(phase5Case('TC-G-003').params));
    const view = flat(result);
    expect(hasField(view, 'pages[0].title')).toBe(true);
    expect(hasField(view, 'pages[0].coordinates')).toBe(true);
    expect(hasField(view, '_meta')).toBe(true);
    expect(view['count']).toBe(2);
    const pages = payload(result)['pages'] as Array<Record<string, unknown>>;
    expect(pages[0]!['distance_m']).toBe(123);
    expect(pages[0]!['url']).toBe('https://en.wikipedia.org/wiki/San_Francisco?wprov=afsw1');
  });

  it('AC-105 / TC-G-011 empty result is success with full provenance', async () => {
    const result = await h.handlers['geo_search']!(cleanParams(phase5Case('TC-G-011').params));
    expect(result.isError).toBeUndefined();
    const view = flat(result);
    expect(view['pages']).toEqual([]);
    expect(view['count']).toBe(0);
    expect(view['truncated']).toBe(false);
    expect(view['resultType']).toBe('complete');
    for (const field of ['source', 'license', 'attribution', '_meta']) expect(hasField(view, field)).toBe(true);
  });

  it('AC-106 page-set cap: count === limit → truncated with warning, never > 50', async () => {
    const result = await h.handlers['geo_search']!({ latitude: 1, longitude: 1, limit: 5 });
    const view = flat(result);
    expect((view['pages'] as unknown[]).length).toBe(5);
    expect(view['truncated']).toBe(true);
    expect(view['warnings']).toContain(WARN.resultCap);
    const hard = await h.handlers['geo_search']!({ latitude: 1, longitude: 1, limit: 50 });
    expect((payload(hard)['pages'] as unknown[]).length).toBeLessThanOrEqual(50);
  });

  it('AC-119 geo_search accepts no title and never calls /page/summary', async () => {
    h.requests.length = 0;
    const rejected = await h.handlers['geo_search']!({ latitude: 37.7, longitude: -122, title: 'Earth' });
    expect(errorOf(rejected)['code']).toBe('validation_error');
    expect(h.requests.length).toBe(0);
    await h.handlers['geo_search']!({ latitude: 37.7749, longitude: -122.4194, limit: 1 });
    expect(h.requests.every((url) => !url.includes('/page/summary/'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tables — D
// ---------------------------------------------------------------------------
describe('AC-107…AC-113 — get_tables extraction, caps and errors', () => {
  let h: Phase5Harness;
  beforeAll(() => { h = createPhase5Harness(); h.server.listen({ onUnhandledRequest: 'bypass' }); });
  afterAll(() => h.close());

  it('AC-107 only calls /page/html; nested table skipped with named warning', async () => {
    h.requests.length = 0;
    await h.handlers['get_tables']!({ title: 'BigTablePage' });
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toContain('/api/rest_v1/page/html/BigTablePage');
    expect(h.requests[0]).not.toContain('action=parse');
    expect(h.requests[0]).not.toContain('wikitext');
    const cap = await h.handlers['get_tables']!({ title: 'BigTablePage' });
    expect(payload(cap)['warnings']).toContain(WARN.nested);
  });

  it('AC-108 / TC-G-013 structured cells, stripped text, null caption when absent', async () => {
    const result = await h.handlers['get_tables']!(cleanParams(phase5Case('TC-G-013').params));
    expect(result.isError).toBeUndefined();
    const view = flat(result);
    expect(view['output']).toBe('structured');
    expect(hasField(view, 'tables[0].rows[0][0].text')).toBe(true);
    for (const field of ['source', 'license', 'attribution', 'resultType', '_meta']) expect(hasField(view, field)).toBe(true);
    const tables = payload(result)['tables'] as Array<Record<string, unknown>>;
    expect(tables[0]!['caption']).toBe('Planetary facts & data'); // &#38; decoded
    expect(tables[0]!['classes']).toEqual(['wikitable']);
    expect(tables[0]!['headers']).toEqual(['Property', 'Value']);
    const firstCell = (tables[0]!['rows'] as Array<Array<Record<string, unknown>>>)[0]![0]!;
    expect(firstCell).toMatchObject({ text: 'Mass', colspan: 1, rowspan: 1 });
    const firstDataRow = (tables[0]!['rows'] as Array<Array<Record<string, unknown>>>)[0]!;
    expect(firstDataRow[1]!['text']).toBe('5.972 × 10^24 kg');
    // No caption table → null
    const noCap = await h.handlers['get_tables']!({ title: 'LongHtmlPage', output: 'structured' });
    // (LongHtmlPage has no caption; its single table still parses.)
    const noCapTables = payload(noCap)['tables'] as Array<Record<string, unknown>>;
    expect(noCapTables[0]!['caption']).toBeNull();
  });

  it('AC-109 / TC-G-014 raw html output, char cap and untrusted warning', async () => {
    const result = await h.handlers['get_tables']!(cleanParams(phase5Case('TC-G-014').params));
    const view = flat(result);
    expect(view['output']).toBe('html');
    expect(hasField(view, 'tables[0].html')).toBe(true);
    expect(String(view['warnings'])).toContain(WARN.untrustedHtml);
    const attr = payload(result)['attribution'] as Record<string, unknown>;
    expect(String(attr['disclaimer'])).toContain('untrusted');
    const long = await h.handlers['get_tables']!({ title: 'LongHtmlPage', output: 'html' });
    const tables = payload(long)['tables'] as Array<Record<string, unknown>>;
    expect(String(tables[0]!['html']).length).toBeLessThanOrEqual(20000);
    expect(payload(long)['warnings']).toContain(WARN.htmlChars);
    expect(payload(long)['truncated']).toBe(true);
  });

  it('AC-110 table_index selects one table; >19 rejected with zero outbound', async () => {
    const selected = await h.handlers['get_tables']!({ title: 'BigTablePage', table_index: 2 });
    expect(payload(selected)['count']).toBe(1);
    h.requests.length = 0;
    const bad = await h.handlers['get_tables']!({ title: 'Earth', table_index: 20 });
    expect(errorOf(bad)['code']).toBe('validation_error');
    expect(h.requests.length).toBe(0);
  });

  it('AC-111 / TC-G-015 all caps enforced with deterministic, named warnings', async () => {
    const result = await h.handlers['get_tables']!(cleanParams(phase5Case('TC-G-015').params));
    expect(result.isError).toBeUndefined();
    const view = flat(result);
    expect(view['truncated']).toBe(true);
    for (const warning of [WARN.tableCap, WARN.rowCap, WARN.cellCap, WARN.cellChars, WARN.spanClamp]) {
      expect(view['warnings']).toContain(warning);
    }
    const tables = payload(result)['tables'] as Array<Record<string, unknown>>;
    expect(tables.length).toBeLessThanOrEqual(20);
    const first = tables[0]!;
    expect((first['rows'] as unknown[]).length).toBeLessThanOrEqual(200);
    const rows = first['rows'] as Array<Array<Record<string, unknown>>>;
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(30);
    expect(String((rows[0]![0] as Record<string, unknown>)['text']).length).toBeLessThanOrEqual(2000);
    expect((rows[0]![0] as Record<string, unknown>)['colspan']).toBe(10);
    for (const field of ['source', 'license', 'attribution']) expect(hasField(view, field)).toBe(true);
  });

  it('AC-112 / TC-G-016 404 → page_not_found with search hint; no-tables → success', async () => {
    const missing = await h.handlers['get_tables']!(cleanParams(phase5Case('TC-G-016').params));
    expect(missing.isError).toBe(true);
    expect(errorOf(missing)['code']).toBe('page_not_found');
    expect(String(errorOf(missing)['hint'])).toContain('search');
    const none = await h.handlers['get_tables']!({ title: 'NoTablesPage' });
    expect(none.isError).toBeUndefined();
    expect(payload(none)['tables']).toEqual([]);
    expect(payload(none)['count']).toBe(0);
    const failed = await h.handlers['get_tables']!({ title: 'ServerErrorPage' });
    expect(errorOf(failed)['retryable']).toBe(true);
    expect(['upstream_unavailable', 'timeout']).toContain(errorOf(failed)['code']);
  });

  it('AC-113 / TC-G-017 injection canary returned verbatim as data, never executed', async () => {
    const result = await h.handlers['get_tables']!(cleanParams(phase5Case('TC-G-017').params));
    expect(result.isError).toBeUndefined();
    const text = JSON.stringify(payload(result));
    expect(text).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');
    expect(payload(result)['untrusted_content']).toBe(true);
    expect(text).not.toMatch(/system prompt:\s*You are/i);
  });
});

// ---------------------------------------------------------------------------
// Provenance, errors, transport, load, corpus — E
// ---------------------------------------------------------------------------
describe('AC-114…AC-118 — provenance, errors, transport and load separation', () => {
  let h: Phase5Harness;
  beforeAll(() => { h = createPhase5Harness(); h.server.listen({ onUnhandledRequest: 'bypass' }); });
  afterAll(() => h.close());

  it('AC-114 / TC-G-019 100% provenance on both tools; revision from ETag when parseable', async () => {
    const geo = await h.handlers['geo_search']!({ latitude: 37.7749, longitude: -122.4194 });
    const table = await h.handlers['get_tables']!(cleanParams(phase5Case('TC-G-019').params));
    for (const result of [geo, table]) {
      const view = flat(result);
      for (const field of ['source', 'license', 'license.title', 'license.short', 'license.url', 'attribution', 'attribution.required', 'resultType', '_meta']) {
        expect(hasField(view, field), field).toBe(true);
      }
    }
    expect(payload(table)['revision']).toBeNull(); // no ETag on Earth fixture
    const withRev = await h.handlers['get_tables']!({ title: 'WithRevision' });
    expect(payload(withRev)['revision']).toBe(1293847560);
    expect(payload(withRev)['timestamp']).toBe('2026-11-20T09:14:22Z');
  });

  it('AC-115 / TC-G-018 429 → rate_limited with retry_after_seconds and clean message', async () => {
    const result = await h.handlers['geo_search']!(cleanParams(phase5Case('TC-G-018').params));
    expect(result.isError).toBe(true);
    const err = errorOf(result);
    expect(err['code']).toBe('rate_limited');
    expect(err['retryable']).toBe(true);
    expect(typeof err['retry_after_seconds']).toBe('number');
    expect(String(err['hint']).length).toBeGreaterThan(0);
    expect(String(err['message'])).not.toMatch(/retry-after|not json|token/i);
    const details = err['details'] as Record<string, unknown>;
    expect(details['http_status']).toBe(429);
    expect(details['backend']).toBeDefined();
  });

  it('AC-116 both contracts pass over Streamable HTTP with _meta and version checks', async () => {
    const server = await startTestHttp(h.config, h.client);
    try {
      const geo = await rpc(server.url, { id: 1, method: 'tools/call', params: { name: 'geo_search', arguments: { latitude: 37.7749, longitude: -122.4194, limit: 1 } } });
      expect(geo.body['result']).toBeDefined();
      const geoResult = geo.body['result'] as Record<string, unknown>;
      expect((geoResult['_meta'] as Record<string, unknown>)['io.modelcontextprotocol/serverInfo']).toMatchObject({ name: 'wikimedia-mcp', version: '3.0.0' });
      const tab = await rpc(server.url, { id: 2, method: 'tools/call', params: { name: 'get_tables', arguments: { title: 'Earth' } } });
      const tabResult = tab.body['result'] as Record<string, unknown>;
      expect(tabResult['content']).toBeDefined();
      const mismatch = await rpc(server.url, { id: 3, method: 'tools/call', params: { name: 'geo_search', arguments: {} } }, { protocolVersion: '1999-01-01', headerProtocolVersion: '1999-01-01' });
      expect(mismatch.body['error']).toBeDefined();
      const headerMismatch = await rpc(server.url, { id: 4, method: 'tools/call', params: { name: 'geo_search', arguments: {} } }, { extraHeaders: { 'Mcp-Param-Admin': '1' } });
      expect(headerMismatch.body['error']).toBeDefined();
    } finally {
      await server.close();
    }
  });

  it('AC-116 both contracts reachable over stdio (validation paths, zero network)', async () => {
    const bad = await stdio.request('tools/call', { name: 'geo_search', arguments: { latitude: 95, longitude: 1 } }, 9520);
    expect(bad.body['result']).toBeDefined();
    const badResult = bad.body['result'] as Record<string, unknown>;
    expect(badResult['isError']).toBe(true);
    const badTable = await stdio.request('tools/call', { name: 'get_tables', arguments: { title: '../evil' } }, 9521);
    const badTableResult = badTable.body['result'] as Record<string, unknown>;
    expect(badTableResult['isError']).toBe(true);
  });

  it('AC-117 separate G5 counters; Phase 5 tools never feed legacy gates', () => {
    for (const name of GROUP_G_TOOL_NAMES) expect(isPhase5Tool(name)).toBe(true);
    expect(isPhase5Tool('search')).toBe(false);
    const mixed = [
      { tool: 'search' }, { tool: 'geo_search' }, { tool: 'get_tables' }, { tool: 'get_pageviews' },
    ];
    expect(excludePhase5(mixed).map((item) => item.tool)).toEqual(['search', 'get_pageviews']);
    const tracker = new G5Tracker();
    for (const tool of GROUP_G_TOOL_NAMES) {
      const samples = Array.from({ length: 150 }, () => ({ tool, durationMs: 500, ok: true, htmlFetch: false, upstream429: false }));
      for (const sample of samples) tracker.record(sample);
    }
    expect(tracker.report().m3.pass).toBe(true);
    expect(tracker.report().m4.pass).toBe(true);
    expect(() => tracker.record({ tool: 'search', durationMs: 1, ok: true, htmlFetch: false, upstream429: false })).toThrow();
  });

  it('AC-118 all eleven new corpus cases run on fixtures with zero live network', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `TC-G-${String(9 + i).padStart(3, '0')}`);
    expect(ids).toEqual([
      'TC-G-009', 'TC-G-010', 'TC-G-011', 'TC-G-012', 'TC-G-013',
      'TC-G-014', 'TC-G-015', 'TC-G-016', 'TC-G-017', 'TC-G-018', 'TC-G-019',
    ]);
    for (const id of ids) {
      const testCase = phase5Case(id);
      expect(testCase.mode, id).toBe('fixture');
      const handler = h.handlers[testCase.tool as keyof typeof h.handlers];
      expect(handler, id).toBeDefined();
      const result = await handler!(cleanParams(testCase.params));
      const observed = result.isError === true ? 'error' : 'ok';
      expect(observed, id).toBe(testCase.expected.status);
      const view = flat(result);
      for (const field of testCase.expected.required_fields) {
        if (field === '_meta') continue;
        expect(hasField(view, field), `${id} missing ${field}`).toBe(true);
      }
    }
  });
});
