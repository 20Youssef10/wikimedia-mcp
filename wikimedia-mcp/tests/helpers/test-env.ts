import { loadConfig, type Config } from '../../src/config.js';

/** Deterministic config for the fixture-only merge gate. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    USER_AGENT: 'WikiMCP-Test/1.0 (https://example.org/test; contact: test@example.org)',
    MCP_TRANSPORT: 'streamable-http',
    MCP_ALLOWED_HOSTS: '127.0.0.1,localhost',
    RETRY_MAX_ATTEMPTS: '1',
    RETRY_AFTER_FALLBACK_MS: '1',
    RETRY_BACKOFF_BASE_MS: '1',
    RETRY_BACKOFF_MAX_MS: '2',
    HTTP_TIMEOUT_MS: '5000',
    ...overrides,
  });
}
