import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { RawStdioClient } from '../helpers/raw-stdio.js';
import { TOOL_NAMES } from '../../src/server/tools/registry.js';
import { buildGroupBSchemas, GROUP_B_DESCRIPTIONS, GROUP_B_TOOL_NAMES } from '../../src/wikidata/schemas.js';
import { DAY_ONE_CONFIG_KEYS, loadConfig } from '../../src/config.js';
import { testConfig } from '../helpers/test-env.js';

const GROUP_B = [...GROUP_B_TOOL_NAMES];
const schemas = buildGroupBSchemas(testConfig());

function advertised(schema: z.ZodType): Record<string, unknown> {
  const bridge = (schema as unknown as {
    '~standard': { jsonSchema: { output: (options: { target: string }) => Record<string, unknown> } };
  })['~standard'];
  return bridge.jsonSchema.output({ target: 'draft-2020-12' });
}

let client: RawStdioClient;
beforeAll(() => { client = new RawStdioClient(); });
afterAll(() => { client.close(); });

describe('AC-33 — Group B registration', () => {
  it('registers exactly the six frozen Group B names, strict schemas, descriptions', () => {
    expect(GROUP_B).toEqual([
      'wikidata_search_entities', 'wikidata_get_entity', 'wikidata_get_statements',
      'wikidata_get_sitelinks', 'wikidata_resolve_external_id', 'wikidata_sparql_query',
    ]);
    for (const name of GROUP_B) {
      expect(TOOL_NAMES).toContain(name);
      expect(GROUP_B_DESCRIPTIONS[name]).toBeTruthy();
      const json = advertised(schemas[name] as z.ZodType);
      expect(json['type']).toBe('object');
      expect(json['additionalProperties']).toBe(false);
    }
    // No write, Enterprise, guest or G-group tool is registered.
    expect(TOOL_NAMES.some((name) => /edit|upload|delete|enterprise/i.test(name))).toBe(false);
    // Phase 3 adds five Group C/F tools; the Phase 2 six are unchanged.
    expect(TOOL_NAMES).toHaveLength(20);
  });

  it('advertises oneOf for resolve_external_id and config-derived SPARQL caps', () => {
    const resolve = advertised(schemas['wikidata_resolve_external_id'] as z.ZodType);
    expect(Array.isArray(resolve['oneOf'])).toBe(true);
    const sparql = advertised(schemas['wikidata_sparql_query'] as z.ZodType);
    const properties = sparql['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['query']?.['maxLength']).toBe(10000);
    expect(properties['limit']?.['maximum']).toBe(1000);
    const overridden = advertised(buildGroupBSchemas(testConfig({
      WIKIDATA_SPARQL_MAX_QUERY_LENGTH: '2500', WIKIDATA_SPARQL_MAX_ROWS: '25',
    }))['wikidata_sparql_query'] as z.ZodType);
    const overriddenProps = overridden['properties'] as Record<string, Record<string, unknown>>;
    expect(overriddenProps['query']?.['maxLength']).toBe(2500);
    expect(overriddenProps['limit']?.['maximum']).toBe(25);
  });
});

describe('AC-34 / AC-58 — annotations and tool-list parity', () => {
  it('all six tools carry read-only, non-destructive, open-world, idempotent annotations', async () => {
    const { body } = await client.request('tools/list', {}, 201);
    const tools = (body['result'] as Record<string, unknown>)['tools'] as Array<Record<string, unknown>>;
    const group = tools.filter((tool) => GROUP_B.includes(String(tool['name'])));
    expect(group).toHaveLength(6);
    for (const tool of group) {
      expect(tool['annotations']).toMatchObject({
        readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true,
      });
      expect(tool['_meta']).toBeUndefined();
      expect(String((tool['inputSchema'] as Record<string, unknown>)?.['type'])).toBe('object');
    }
  });

  it('no tool declares x-mcp-header', async () => {
    const { body } = await client.request('tools/list', {}, 202);
    const tools = (body['result'] as Record<string, unknown>)['tools'] as Array<Record<string, unknown>>;
    expect(tools.every((tool) => !JSON.stringify(tool).includes('x-mcp-header'))).toBe(true);
  });
});

describe('AC-36 — configuration reuse (no new keys)', () => {
  it('reads all eight WIKIDATA_SPARQL_* keys with documented defaults', () => {
    const keys = DAY_ONE_CONFIG_KEYS.filter((key) => key.startsWith('WIKIDATA_SPARQL_'));
    expect(keys).toHaveLength(8);
    const config = loadConfig({ USER_AGENT: 'Test/1.0 (test@example.org)' });
    expect(config.wikidataSparql.endpoint).toBe('https://query.wikidata.org/sparql');
    expect(config.wikidataSparql.endpointV2).toBe('https://query-next.wikidata.org/sparql');
    expect(config.wikidataSparql.accept).toBe('application/sparql-results+json');
    expect(config.wikidataSparql.timeoutMs).toBe(60000);
    expect(config.wikidataSparql.maxRows).toBe(1000);
    expect(config.wikidataSparql.maxQueryLength).toBe(10000);
    expect(config.wikidataSparql.preferV2).toBe(false);
    expect(config.wikidataSparql.fallbacks.length).toBeGreaterThan(0);
  });

  it('terminates boot on timeout > 60000, non-positive caps or a non-https endpoint', () => {
    expect(() => loadConfig({ USER_AGENT: 'x', WIKIDATA_SPARQL_TIMEOUT_MS: '60001' })).toThrow();
    expect(() => loadConfig({ USER_AGENT: 'x', WIKIDATA_SPARQL_MAX_ROWS: '0' })).toThrow();
    expect(() => loadConfig({ USER_AGENT: 'x', WIKIDATA_SPARQL_MAX_QUERY_LENGTH: '0' })).toThrow();
    expect(() => loadConfig({ USER_AGENT: 'x', WIKIDATA_SPARQL_ENDPOINT: 'http://example.test/sparql' })).toThrow(/https/);
  });
});

describe('AC-41 — strict Group B schema validation', () => {
  it('rejects wrong types, missing required params and unknown extra fields', () => {
    expect(schemas['wikidata_search_entities']?.safeParse({}).success).toBe(false);
    expect(schemas['wikidata_search_entities']?.safeParse({ query: 'x', extra: 1 }).success).toBe(false);
    expect(schemas['wikidata_get_entity']?.safeParse({ qid: 'not-a-qid' }).success).toBe(false);
    expect(schemas['wikidata_get_statements']?.safeParse({ qid: 'Q42', property: '5P' }).success).toBe(false);
    expect(schemas['wikidata_get_sitelinks']?.safeParse({ qid: 'Q42', sites: ['evil.example'] }).success).toBe(false);
  });

  it('rejects out-of-range numbers and malformed language/site values', () => {
    expect(schemas['wikidata_search_entities']?.safeParse({ query: 'x', limit: 51 }).success).toBe(false);
    expect(schemas['wikidata_get_entity']?.safeParse({ qid: 'Q42', languages: ['EN_UPPER'] }).success).toBe(false);
    expect(schemas['wikidata_sparql_query']?.safeParse({ query: 'SELECT * WHERE {}', timeout_ms: 60001 }).success).toBe(false);
    expect(schemas['wikidata_sparql_query']?.safeParse({ query: 'SELECT * WHERE {}', timeout_ms: 999 }).success).toBe(false);
  });

  it('accepts exactly one resolve_external_id mode', () => {
    const resolve = schemas['wikidata_resolve_external_id'];
    expect(resolve?.safeParse({ scheme: 'doi', id: '10.1038/nature12345' }).success).toBe(true);
    expect(resolve?.safeParse({ site: 'enwiki', title: 'Ada Lovelace' }).success).toBe(true);
    expect(resolve?.safeParse({ scheme: 'doi', id: '10.1038/nature12345', site: 'enwiki', title: 'Ada' }).success).toBe(false);
    expect(resolve?.safeParse({ scheme: 'doi' }).success).toBe(false);
    expect(resolve?.safeParse({}).success).toBe(false);
  });
});
