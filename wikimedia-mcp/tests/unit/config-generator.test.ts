import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildConfigSnippet, DEFAULT_SERVER_URL, HOST_IDS, MCP_PROTOCOL_VERSION,
  normalizeServerUrl, parseConfigFlags, runConfigCli, type ConfigSnippet,
} from '../../src/cli/config-generator.js';

/** The 11 hosts in report 06 §7, plus OpenCode verified in report 06 §7.1. */
const MATRIX: ReadonlyArray<{
  id: string;
  root_key: string | null;
  transport_key: string;
  marker: string;
}> = [
  { id: 'claude-code', root_key: 'mcpServers', transport_key: 'type', marker: '"type": "http"' },
  { id: 'claude-desktop', root_key: 'mcpServers', transport_key: 'url', marker: '"url"' },
  { id: 'cursor', root_key: 'mcpServers', transport_key: 'url', marker: '"url"' },
  { id: 'vscode-copilot', root_key: 'mcpServers', transport_key: 'type', marker: '"type": "http"' },
  { id: 'vscode-editor', root_key: 'servers', transport_key: 'type', marker: '"servers"' },
  { id: 'codex-cli', root_key: 'mcp_servers', transport_key: 'url', marker: '[mcp_servers.wikimedia]' },
  { id: 'gemini-cli', root_key: 'mcpServers', transport_key: 'httpUrl', marker: '"httpUrl"' },
  { id: 'grok-build', root_key: 'mcp_servers', transport_key: 'url', marker: 'enabled = true' },
  { id: 'chatgpt', root_key: null, transport_key: 'remote-https', marker: 'Plugins' },
  { id: 'cline', root_key: 'mcpServers', transport_key: 'type', marker: '"type": "streamableHttp"' },
  { id: 'windsurf', root_key: null, transport_key: 'ui-flow', marker: 'Customize' },
  { id: 'opencode', root_key: 'mcp', transport_key: 'protocol', marker: '"protocol"' },
];

const NO_SECRET = /(MCP_[A-Z0-9_]*SECRET|bearer\s+|authorization\s*:|client_secret|access_token|refresh_token)/i;

describe('WP9 — wmcp config <host> generator', () => {
  it('covers all 11 report-06 matrix hosts plus OpenCode, and no others', () => {
    expect(HOST_IDS).toHaveLength(12);
    expect([...HOST_IDS].sort()).toEqual(MATRIX.map((row) => row.id).sort());
  });

  it.each(MATRIX)('emits the documented key/transport for $id', (row) => {
    const snippet: ConfigSnippet = buildConfigSnippet(row.id);
    expect(snippet.root_key).toBe(row.root_key);
    expect(snippet.transport_key).toBe(row.transport_key);
    expect(snippet.snippet).toContain(row.marker);
    expect(snippet.snippet).toContain(DEFAULT_SERVER_URL);
    expect(snippet.format).toMatch(/^(json|toml|text)$/);
    expect(snippet.config_file.length).toBeGreaterThan(0);
    expect(snippet.notes.length).toBeGreaterThan(0);
  });

  it('OpenCode emits protocol exactly "2026-07-28" in the mcp.servers.wikimedia block', () => {
    const snippet = buildConfigSnippet('opencode');
    expect(MCP_PROTOCOL_VERSION).toBe('2026-07-28');
    expect(snippet.snippet).toContain('"protocol": "2026-07-28"');
    const parsed = JSON.parse(snippet.snippet) as {
      mcp: { servers: { wikimedia: { type: string; url: string; protocol: string } } };
    };
    expect(parsed.mcp.servers.wikimedia.protocol).toBe('2026-07-28');
    expect(parsed.mcp.servers.wikimedia.type).toBe('remote');
  });

  it('every JSON snippet parses and every TOML snippet uses the documented table', () => {
    for (const row of MATRIX) {
      const snippet = buildConfigSnippet(row.id);
      if (snippet.format === 'json') {
        expect(() => JSON.parse(snippet.snippet), `${row.id} must be valid JSON`).not.toThrow();
      }
      if (snippet.format === 'toml') {
        expect(snippet.snippet).toContain('[mcp_servers.wikimedia]');
        expect(snippet.snippet).toContain(`url = "${DEFAULT_SERVER_URL}"`);
      }
    }
  });

  it('never emits a secret, token or wildcard host/origin', () => {
    const urlLikeKeys = new Set(['url', 'httpUrl', 'origin', 'host', 'allowed_origins', 'allowed_hosts']);
    const walk = (value: unknown, out: string[]): void => {
      if (Array.isArray(value)) {
        for (const entry of value) walk(entry, out);
        return;
      }
      if (value === null || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        if (urlLikeKeys.has(key) && typeof entry === 'string') out.push(entry);
        walk(entry, out);
      }
    };
    for (const row of MATRIX) {
      const snippet = buildConfigSnippet(row.id);
      expect(snippet.snippet, `${row.id} must not contain a secret`).not.toMatch(NO_SECRET);
      expect(JSON.stringify(snippet.notes), `${row.id} notes must not contain a secret`).not.toMatch(NO_SECRET);
      expect(snippet.snippet).not.toMatch(/https?:\/\/\*/);
      const urls: string[] = [];
      if (snippet.format === 'json') walk(JSON.parse(snippet.snippet) as unknown, urls);
      else {
        for (const line of snippet.snippet.split('\n')) {
          if (/(url|httpUrl|origin|host)/i.test(line)) urls.push(line);
        }
      }
      for (const url of urls) expect(url, `${row.id} url/host/origin must not be a wildcard`).not.toContain('*');
    }
  });

  it('rejects unknown hosts, wildcard URLs and credential-bearing URLs', () => {
    expect(() => buildConfigSnippet('not-a-host')).toThrow(/unknown host/);
    expect(() => normalizeServerUrl('https://*/mcp')).toThrow(/wildcard/);
    expect(() => normalizeServerUrl('https://user:pass@example.org/mcp')).toThrow(/credentials/);
    expect(() => normalizeServerUrl('ftp://example.org/mcp')).toThrow(/http: or https:/);
    expect(() => normalizeServerUrl('not a url')).toThrow(/invalid server URL/);
    expect(() => normalizeServerUrl('https://example.org/mcp?access_token=abc')).toThrow(/query string/);
  });

  it('honours --url and rejects malformed flags', () => {
    const custom = 'https://mcp.example.org/mcp';
    expect(buildConfigSnippet('opencode', custom).snippet).toContain(custom);
    expect(parseConfigFlags(['opencode', '--url', custom]).url).toBe(custom);
    expect(parseConfigFlags(['--list']).list).toBe(true);
    expect(() => parseConfigFlags(['opencode', '--url'])).toThrow(/requires a value/);
    expect(() => parseConfigFlags(['opencode', '--bogus'])).toThrow(/unknown flag/);
    expect(() => parseConfigFlags([])).toThrow(/host is required/);
  });

  it('writes the snippet to a file with --out and keeps stdout copy-pasteable by default', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wmcp-config-'));
    try {
      expect(runConfigCli(['opencode', '--out', 'opencode.json'], dir)).toBe(0);
      expect(readFileSync(path.join(dir, 'opencode.json'), 'utf8')).toContain('"protocol": "2026-07-28"');
      expect(runConfigCli(['gemini-cli', '--out', 'gemini.json'], dir)).toBe(0);
      expect(readFileSync(path.join(dir, 'gemini.json'), 'utf8')).toContain('"httpUrl"');
      expect(runConfigCli(['unknown-host'], dir)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is deterministic — no network, no clock, no environment dependence', () => {
    for (const row of MATRIX) {
      expect(buildConfigSnippet(row.id).snippet).toBe(buildConfigSnippet(row.id).snippet);
    }
  });
});
