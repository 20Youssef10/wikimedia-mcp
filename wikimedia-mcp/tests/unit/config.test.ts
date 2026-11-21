import { describe, expect, it } from 'vitest';
import { DAY_ONE_CONFIG_KEYS, isLoopbackHost, loadConfig } from '../../src/config.js';
import { sparqlEndpointPlan, shouldSwitchEndpoint } from '../../src/upstream/wikidata-sparql.js';
import { attributionPlan, isBetaMiss } from '../../src/upstream/attribution.js';
import { testConfig } from '../helpers/test-env.js';

describe('configuration (report 09 §2.6)', () => {
  it('accepts a minimal valid config and applies every documented default', () => {
    const config = loadConfig({ USER_AGENT: 'Test/1.0 (test@example.org)' });
    expect(config.concurrencyLimit).toBe(3);
    expect(config.httpTimeoutMs).toBe(15000);
    expect(config.retryMaxAttempts).toBe(3);
    expect(config.retryAfterFallbackMs).toBe(5000);
    expect(config.transport).toBe('stdio');
    expect(config.httpHost).toBe('127.0.0.1');
    expect(config.httpPort).toBe(3000);
    expect(config.httpPath).toBe('/mcp');
    expect(config.allowedHosts).toEqual(['127.0.0.1', 'localhost']);
    expect(config.wikidataSparql.endpoint).toBe('https://query.wikidata.org/sparql');
    expect(config.wikidataSparql.timeoutMs).toBe(60000);
    expect(config.attribution.apiVersion).toBe('v0-beta');
  });

  it('requires USER_AGENT (fail fast)', () => {
    expect(() => loadConfig({})).toThrow(/USER_AGENT/);
  });

  it('rejects CONCURRENCY_LIMIT > 3 at boot (AC-26)', () => {
    expect(() => loadConfig({ USER_AGENT: 'x', CONCURRENCY_LIMIT: '4' })).toThrow(/CONCURRENCY_LIMIT/);
  });

  it('rejects a public bind with empty allowed lists (AC-19)', () => {
    expect(() => loadConfig({
      USER_AGENT: 'x', MCP_HTTP_HOST: '0.0.0.0', MCP_ALLOWED_ORIGINS: '', MCP_ALLOWED_HOSTS: '',
    })).toThrow(/Public bind requires/);
  });

  it('recognises loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
  });

  it('reads every WDQS and Attribution key with documented defaults (AC-31)', () => {
    const config = testConfig();
    for (const key of DAY_ONE_CONFIG_KEYS) {
      expect(key.length).toBeGreaterThan(0);
    }
    expect(config.wikidataSparql.fallbacks.length).toBeGreaterThan(0);
    expect(config.wikidataSparql.accept).toBe('application/sparql-results+json');
    expect(config.wikidataSparql.maxRows).toBe(1000);
    expect(config.wikidataSparql.maxQueryLength).toBe(10000);
    expect(config.attribution.fallbacks).toEqual(['rest-bare', 'action-rightsinfo', 'action-imageinfo']);
    expect(config.attribution.disclaimer).toContain('responsible');
  });

  it('wires WDQS endpoint ordering and fallback policy', () => {
    const plan = sparqlEndpointPlan(testConfig());
    expect(plan.endpoints[0]).toBe('https://query.wikidata.org/sparql');
    expect(plan.endpoints).toContain('https://query-next.wikidata.org/sparql');
    expect(shouldSwitchEndpoint(403, 'Unauthorized User-Agent')).toBe(true);
    expect(shouldSwitchEndpoint(429)).toBe(false);
    expect(shouldSwitchEndpoint(503)).toBe(false);
  });

  it('wires the beta Attribution version and fallback detection', () => {
    const plan = attributionPlan(testConfig());
    expect(plan.apiVersion).toBe('v0-beta');
    expect(plan.signalUrl('en.wikipedia.org', 'Earth')).toContain('/attribution/v0-beta/pages/Earth/signals');
    expect(isBetaMiss(404, 'rest-no-match')).toBe(true);
    expect(isBetaMiss(404, 'other')).toBe(false);
  });
});
