import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawStdioClient as RawStdioClientType } from '../helpers/raw-stdio.js';
import { z } from 'zod';
import { loadConfig, DAY_ONE_CONFIG_KEYS } from '../../src/config.js';
import { TOOL_NAMES } from '../../src/server/tools/registry.js';
import { TOOL_SCHEMAS, PHASE1_TOOL_NAMES } from '../../src/server/tools/schemas.js';
import { GROUP_B_TOOL_NAMES } from '../../src/wikidata/schemas.js';
import { GROUP_C_SCHEMAS } from '../../src/metrics/schemas.js';
import { GROUP_F_SCHEMAS } from '../../src/media/schemas.js';
import { installFixtures, createPhase3Harness, payload } from './harness.js';

const PHASE3_NAMES = ['get_pageviews', 'get_most_read', 'get_unique_devices', 'get_file_metadata', 'get_image_info'];

/** One shared stdio client for both registration tests (avoids child-process churn). */
let stdio: RawStdioClientType;
beforeAll(async () => {
  const { RawStdioClient } = await import('../helpers/raw-stdio.js');
  stdio = new RawStdioClient();
  // Warm the process before the assertion windows start.
  await stdio.request('tools/list', {}, 9001);
});
afterAll(() => stdio?.close());

describe('AC-60 — registration of exactly five Phase 3 tools (20 total)', () => {
  it('registers 20 tools with no write/Enterprise/D-group names', () => {
    expect(TOOL_NAMES).toHaveLength(20);
    for (const name of PHASE3_NAMES) expect(TOOL_NAMES).toContain(name);
    expect(TOOL_NAMES).toEqual(expect.arrayContaining([...PHASE1_TOOL_NAMES, ...GROUP_B_TOOL_NAMES]));
    for (const forbidden of ['edit_page', 'upload_file', 'get_recent_changes', 'get_edit_count', 'commons_search']) {
      expect(TOOL_NAMES).not.toContain(forbidden);
    }
  });

  it('advertises strict JSON Schemas with non-empty descriptions over stdio tools/list', async () => {
    const listed = await stdio.request('tools/list', {}, 9101);
    const tools = ((listed.body['result'] as Record<string, unknown> | undefined)?.['tools'] as Array<Record<string, unknown>> | undefined) ?? [];
    expect(tools).toHaveLength(20);
    const phase3 = tools.filter((tool) => PHASE3_NAMES.includes(String(tool['name'])));
    expect(phase3).toHaveLength(5);
    const allSchemas: Record<string, z.ZodType> = { ...GROUP_C_SCHEMAS, ...GROUP_F_SCHEMAS };
    for (const tool of phase3) {
      const schema = z.toJSONSchema(allSchemas[String(tool['name'])], { io: 'input' }) as Record<string, unknown>;
      expect(schema['additionalProperties']).toBe(false);
      expect(typeof tool['description']).toBe('string');
      expect(String(tool['description']).length).toBeGreaterThan(20);
      expect(tool['inputSchema']).toBeDefined();
    }
  }, 30000);
});

describe('AC-61 — annotations and no x-mcp-header', () => {
  it('all five tools are read-only, non-destructive, open-world and idempotent', async () => {
    const listed = await stdio.request('tools/list', {}, 9102);
    const tools = ((listed.body['result'] as Record<string, unknown> | undefined)?.['tools'] as Array<Record<string, unknown>> | undefined) ?? [];
    expect(tools).toHaveLength(20);
    for (const tool of tools.filter((item) => PHASE3_NAMES.includes(String(item['name'])))) {
      expect(tool['annotations']).toMatchObject({
        readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true,
      });
      expect(JSON.stringify(tool)).not.toContain('x-mcp-header');
    }
  }, 30000);

  it('schema maps expose no x-mcp-header capability', () => {
    for (const schema of [...Object.values(GROUP_C_SCHEMAS), ...Object.values(GROUP_F_SCHEMAS)]) {
      expect(JSON.stringify(z.toJSONSchema(schema))).not.toContain('x-mcp-header');
    }
  });
});

describe('AC-62 — config smoke, zero new keys, terminally invalid values', () => {
  it('reads the three Attribution keys with documented defaults', () => {
    const config = loadConfig({ USER_AGENT: 'QA/1.0 (https://example.org; qa@example.org)' });
    expect(config.attribution.apiVersion).toBe('v0-beta');
    expect(config.attribution.fallbacks).toEqual(['rest-bare', 'action-rightsinfo', 'action-imageinfo']);
    expect(config.attribution.disclaimer).toBe('You remain responsible for licence compliance.');
    expect(DAY_ONE_CONFIG_KEYS).toContain('ATTRIBUTION_API_VERSION');
    expect(DAY_ONE_CONFIG_KEYS).toContain('ATTRIBUTION_FALLBACKS');
    expect(DAY_ONE_CONFIG_KEYS).toContain('ATTRIBUTION_DISCLAIMER');
    expect(DAY_ONE_CONFIG_KEYS).toHaveLength(11);
  });

  it('terminates boot on malformed version or unknown fallback token', () => {
    const base = { USER_AGENT: 'QA/1.0 (https://example.org; qa@example.org)' };
    expect(() => loadConfig({ ...base, ATTRIBUTION_API_VERSION: 'beta' })).toThrow(/ATTRIBUTION_API_VERSION/);
    expect(() => loadConfig({ ...base, ATTRIBUTION_FALLBACKS: 'rest-bare,magic' })).toThrow(/ATTRIBUTION_FALLBACKS/);
    expect(() => loadConfig({ ...base, ATTRIBUTION_FALLBACKS: '' })).toThrow(/ATTRIBUTION_FALLBACKS/);
    expect(() => loadConfig({ ...base, ATTRIBUTION_API_VERSION: 'v1' })).not.toThrow();
  });

  it('v1 accepts the value and falls back on rest-no-match (TC-F-005)', async () => {
    const harness = createPhase3Harness({ ATTRIBUTION_API_VERSION: 'v1' });
    harness.state.simulate = 'v1-404';
    installFixtures(harness);
    harness.server.listen({ onUnhandledRequest: 'bypass' });
    try {
      const result = await harness.handlers['get_file_metadata']({ filename: 'File:Commons-logo.svg', project: 'commonswiki' });
      expect(result.isError).toBeUndefined();
      expect(payload(result)['attribution_source']).toBe('action-extmetadata');
      expect(harness.state.betaCalls[0]).toContain('/attribution/v1/pages/');
    } finally {
      harness.close();
    }
  });
});

describe('AC-63 / AC-89 — regression and result contract', () => {
  const harness = createPhase3Harness();
  beforeAll(() => {
    harness.state.simulate = 'beta-404';
    installFixtures(harness);
    harness.server.listen({ onUnhandledRequest: 'bypass' });
  });
  afterAll(() => harness.close());

  it('Phase 1 and Phase 2 tool names are unchanged', () => {
    expect(Object.keys(TOOL_SCHEMAS)).toHaveLength(9);
    expect(GROUP_B_TOOL_NAMES).toHaveLength(6);
    expect(TOOL_NAMES.slice(0, 15)).toEqual([...PHASE1_TOOL_NAMES, ...GROUP_B_TOOL_NAMES]);
  });

  it('no Phase 3 tools/call result carries ttlMs or cacheScope', async () => {
    const result = await harness.handlers['get_pageviews']({
      article: 'Earth', start: '20261101', end: '20261103', project: 'en.wikipedia',
    });
    expect(payload(result)['ttlMs']).toBeUndefined();
    expect(payload(result)['cacheScope']).toBeUndefined();
  });

  it('every result has resultType complete and every error is actionable', async () => {
    const ok = await harness.handlers['get_unique_devices']({ start: '20230101', end: '20230101' });
    expect(payload(ok)['resultType']).toBe('complete');
    const bad = await harness.handlers['get_pageviews']({ article: 'Earth', start: '20261101', end: '20261103', granularity: 'hourly' });
    expect(bad.isError).toBe(true);
    const error = payload(bad)['error'] as Record<string, unknown>;
    expect(typeof error['code']).toBe('string');
    expect(String(error['message']).length).toBeGreaterThan(0);
    expect(typeof error['retryable']).toBe('boolean');
    expect(String(error['action'] ?? error['hint'] ?? '').length).toBeGreaterThan(0);
  });
});
