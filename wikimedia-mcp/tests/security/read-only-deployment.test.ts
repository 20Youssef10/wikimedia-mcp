import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WikimediaClient } from '../../src/upstream/client.js';
import { assertNoWriteTool, findWriteCredentialEnvKeys, WRITE_TOOL_DENYLIST } from '../../src/protocol/csrf.js';
import { loadConfig } from '../../src/config.js';
import { activeToolNames } from '../../src/server/tools/registry.js';
import { startTestHttp, rpc, type TestHttpServer } from '../helpers/raw-http.js';
import { testConfig } from '../helpers/test-env.js';

/**
 * G5 automated deployment assertion. The read-only deployment is proven on the
 * LIVE tools/list surface (names + annotations) and by scanning both the
 * environment and the validated config object for write-credential keys.
 */
let server: TestHttpServer;

beforeAll(async () => {
  process.env['READ_ONLY_PROFILE'] = '1';
  server = await startTestHttp(testConfig(), new WikimediaClient(testConfig(), { useDispatcher: false }));
});

afterAll(async () => {
  delete process.env['READ_ONLY_PROFILE'];
  await server.close();
});

type AdvertisedTool = {
  name: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

describe('G5 — read-only deployment assertion', () => {
  it('tools/list advertises only the static read-only catalogue', async () => {
    const response = await rpc(server.url, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } as never);
    expect(response.status).toBe(200);
    const result = response.body['result'] as { tools?: AdvertisedTool[] } | undefined;
    expect(result?.tools).toBeDefined();
    const names = (result?.tools ?? []).map((tool) => tool.name).sort();
    expect(names).toEqual([...activeToolNames({ READ_ONLY_PROFILE: '1' })].sort());
  });

  it('no deny-listed write tool is advertised and every tool is read-only/non-destructive', async () => {
    const response = await rpc(server.url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } as never);
    const result = response.body['result'] as { tools?: AdvertisedTool[] } | undefined;
    const tools = result?.tools ?? [];
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(WRITE_TOOL_DENYLIST).not.toContain(tool.name);
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
    expect(() => assertNoWriteTool(tools.map((tool) => tool.name))).not.toThrow();
  });

  it('no write credential key is present in the environment', () => {
    expect(findWriteCredentialEnvKeys(process.env)).toEqual([]);
  });

  it('no write credential field is present in the validated config', () => {
    const config = loadConfig({
      USER_AGENT: 'WikiMCP-Test/1.0 (https://example.org/test; contact: test@example.org)',
      MCP_REQUIRE_ORIGIN: 'true',
      MCP_REQUIRE_CSRF: 'true',
      MCP_CSRF_SECRET: 'a-strong-test-secret-value',
    }) as unknown as Record<string, unknown>;
    const writeShaped = Object.keys(config).filter((key) =>
      /oauth|bot[_-]?password|write[_-]?(token|credential)|(^|_)access[_-]?token|(^|_)refresh[_-]?token/i.test(key));
    expect(writeShaped).toEqual([]);
    // CSRF secret is a request-binding secret, not a write credential.
    expect(config['requireOrigin']).toBe(true);
    expect(config['requireCsrf']).toBe(true);
  });
});
