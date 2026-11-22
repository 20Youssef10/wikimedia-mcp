import { writeFileSync } from 'node:fs';

/**
 * WP9 — `wmcp config <host>` generator.
 *
 * Emits copy-pasteable MCP client snippets for every host documented in
 * research report 06 §7 (the 11-row config matrix) plus OpenCode from §7.1.
 * Host keys and transport fields come from that matrix and from the local
 * deployment block in `handoff/DEPLOYMENT-RUNBOOK.md` §2; nothing here invents
 * a host, a transport key, a credential or a secret.
 *
 * This module is pure and offline: it never reads the network, never reads
 * secrets and never registers an MCP tool.
 */

/** Local default from `DEPLOYMENT-RUNBOOK.md` §2 (`MCP_HTTP_HOST/PORT/PATH`). */
export const DEFAULT_SERVER_URL = 'http://127.0.0.1:3000/mcp';

/** The only protocol revision this server speaks (contract 09 §2.5). */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

export type ConfigFormat = 'json' | 'toml' | 'text';

export interface ConfigSnippet {
  /** Stable slug used on the command line. */
  id: string;
  /** Human-readable host label from report 06 §7. */
  label: string;
  /** Where the snippet belongs, as documented for that host. */
  config_file: string;
  format: ConfigFormat;
  /** Top-level key the host expects (for matrix/tests); null for UI-only hosts. */
  root_key: string | null;
  /** Transport-bearing field the host expects (for matrix/tests). */
  transport_key: string | null;
  /** The snippet itself, ready to copy. No commentary, no secrets. */
  snippet: string;
  /** Documented caveats, surfaced on stderr so stdout stays copy-pasteable. */
  notes: readonly string[];
}

interface HostProfile {
  id: string;
  label: string;
  config_file: string;
  format: ConfigFormat;
  root_key: string | null;
  transport_key: string | null;
  make: (url: string) => string;
  notes: readonly string[];
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const HOST_PROFILES: readonly HostProfile[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    config_file: '.mcp.json / ~/.claude.json',
    format: 'json',
    root_key: 'mcpServers',
    transport_key: 'type',
    make: (url) => json({ mcpServers: { wikimedia: { type: 'http', url } } }),
    notes: [
      '`type:"http"` is required alongside `url`; `streamable-http` is accepted as an alias.',
      'Equivalent CLI: `claude mcp add --transport http wikimedia <url>`.',
    ],
  },
  {
    id: 'claude-desktop',
    label: 'Claude.ai / Desktop',
    config_file: 'claude_desktop_config.json / Connectors UI',
    format: 'json',
    root_key: 'mcpServers',
    transport_key: 'url',
    make: (url) => json({ mcpServers: { wikimedia: { url } } }),
    notes: [
      'UI flow: Customize → Connectors → Add custom connector → paste the URL.',
      'Leave OAuth fields empty — this deployment needs no credentials.',
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    config_file: '.cursor/mcp.json / ~/.cursor/mcp.json',
    format: 'json',
    root_key: 'mcpServers',
    transport_key: 'url',
    make: (url) => json({ mcpServers: { wikimedia: { url } } }),
    notes: [
      'Set the transport explicitly if the host defaults to legacy SSE.',
      'Report 06 §7.1: `cursor-agent` probes a plain `url` with GET; the POST-only server returns 405. `type:"http"` and `type:"streamable-http"` did not fix it — documented host limitation.',
    ],
  },
  {
    id: 'vscode-copilot',
    label: 'VS Code (Copilot native, preferred)',
    config_file: '~/.copilot/mcp-config.json / .mcp.json',
    format: 'json',
    root_key: 'mcpServers',
    transport_key: 'type',
    make: (url) => json({
      mcpServers: { wikimedia: { type: 'http', url, tools: ['*'] } },
    }),
    notes: [
      'The Copilot harness is replacing the editor-managed form. `tools:["*"]` is tool selection, not a host/origin wildcard.',
    ],
  },
  {
    id: 'vscode-editor',
    label: 'VS Code (editor-managed, deprecated)',
    config_file: '.vscode/mcp.json',
    format: 'json',
    root_key: 'servers',
    transport_key: 'type',
    make: (url) => json({ servers: { wikimedia: { type: 'http', url } } }),
    notes: [
      'This is the form Wikimedia documentation publishes; removal is scheduled for February 2027.',
    ],
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    config_file: '~/.codex/config.toml',
    format: 'toml',
    root_key: 'mcp_servers',
    transport_key: 'url',
    make: (url) => `[mcp_servers.wikimedia]\nurl = "${url}"\n`,
    notes: [
      'No transport field — the URL implies HTTP.',
      'Equivalent CLI: `codex mcp add wikimedia --url <url>`.',
      'Report 06 §7.1: the client opens with a legacy `initialize` and is rejected with `-32022` — host limitation.',
    ],
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    config_file: '~/.gemini/settings.json',
    format: 'json',
    root_key: 'mcpServers',
    transport_key: 'httpUrl',
    make: (url) => json({ mcpServers: { wikimedia: { httpUrl: url } } }),
    notes: [
      'Use `httpUrl`, not `url` — in Gemini CLI `url` means SSE. This is the common trap in report 06 §7.',
    ],
  },
  {
    id: 'grok-build',
    label: 'Grok Build',
    config_file: '~/.grok/config.toml',
    format: 'toml',
    root_key: 'mcp_servers',
    transport_key: 'url',
    make: (url) => `[mcp_servers.wikimedia]\nurl = "${url}"\nenabled = true\n`,
    notes: [
      'Equivalent CLI: `grok mcp add --transport http wikimedia <url>`.',
      'Verify with `grok mcp doctor wikimedia --json`.',
      'Report 06 §7.1: REAL PASS — handshake `protocol 2026-07-28`.',
    ],
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    config_file: 'UI only (no config file)',
    format: 'text',
    root_key: null,
    transport_key: 'remote-https',
    make: (url) => [
      'ChatGPT UI (no config file):',
      '  1. Plugins → + → Add custom MCP server',
      `  2. Paste the server URL: ${url}`,
      '  3. Create as a plugin',
      '',
    ].join('\n'),
    notes: [
      'Report 06 §7 caveat: the documented remote endpoint exposes `search`/`fetch` because ChatGPT requires that pair.',
      'No config file, token or wildcard is emitted for this host.',
    ],
  },
  {
    id: 'cline',
    label: 'Cline',
    config_file: '~/.cline/data/settings/cline_mcp_settings.json',
    format: 'json',
    root_key: 'mcpServers',
    transport_key: 'type',
    make: (url) => json({
      mcpServers: { wikimedia: { type: 'streamableHttp', url } },
    }),
    notes: [
      'Explicit `"type":"streamableHttp"` is required; omission falls back to legacy `sse`.',
      'Report 06 §7.1: the Cline CLI writes a nested `transport:{type:"streamableHttp",url}` object; the flat `type` form shown here is the documented alternative.',
    ],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    config_file: '~/.codeium/windsurf/mcp_config.json',
    format: 'text',
    root_key: null,
    transport_key: 'ui-flow',
    make: (url) => [
      'Windsurf UI (preferred; exact JSON schema not confirmed):',
      '  1. Customize → MCPs → Install for this computer',
      `  2. Paste the server URL: ${url}`,
      '',
    ].join('\n'),
    notes: [
      'The exact JSON schema is not confirmed from live docs — use the UI rather than a hand-written config.',
    ],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    config_file: 'opencode.json',
    format: 'json',
    root_key: 'mcp',
    transport_key: 'protocol',
    make: (url) => json({
      mcp: {
        servers: {
          wikimedia: {
            type: 'remote',
            url,
            protocol: MCP_PROTOCOL_VERSION,
          },
        },
      },
    }),
    notes: [
      'The `protocol` key is MANDATORY — the default legacy `initialize` handshake is rejected.',
      'Verify with `opencode serve --print-logs --log-level info` and look for `mcp connected server=wikimedia`; `opencode mcp list` is unreliable.',
    ],
  },
];

/** All host slugs, in report-06 matrix order with OpenCode last. */
export const HOST_IDS: readonly string[] = HOST_PROFILES.map((profile) => profile.id);

/**
 * Validate a caller-supplied URL. Rejects credentials (secrets) and wildcard
 * hosts/origins so the generator can never emit a permissive or secret-bearing
 * snippet, even with `--url`.
 */
export function normalizeServerUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`invalid server URL: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('server URL must use http: or https:');
  }
  if (parsed.username !== '' || parsed.password !== '' || raw.includes('@')) {
    throw new Error('server URL must not contain credentials');
  }
  if (parsed.hostname.includes('*') || raw.includes('://*')) {
    throw new Error('server URL must not be a wildcard host/origin');
  }
  for (const key of parsed.searchParams.keys()) {
    if (/token|secret|password|credential|auth|api[_-]?key/i.test(key)) {
      throw new Error('server URL must not carry a secret in its query string');
    }
  }
  return parsed.toString();
}

/** Build a snippet for one host. Throws on an unknown host slug. */
export function buildConfigSnippet(host: string, url: string = DEFAULT_SERVER_URL): ConfigSnippet {
  const profile = HOST_PROFILES.find((entry) => entry.id === host);
  if (profile === undefined) {
    throw new Error(`unknown host '${host}'; available: ${HOST_IDS.join(', ')}`);
  }
  const serverUrl = normalizeServerUrl(url);
  return {
    id: profile.id,
    label: profile.label,
    config_file: profile.config_file,
    format: profile.format,
    root_key: profile.root_key,
    transport_key: profile.transport_key,
    snippet: profile.make(serverUrl),
    notes: profile.notes,
  };
}

export interface ConfigFlags {
  host: string | null;
  url: string;
  out: string | null;
  list: boolean;
}

/** Parse `wmcp config <host> [--url URL] [--out FILE]` flags. */
export function parseConfigFlags(argv: readonly string[]): ConfigFlags {
  const flags: ConfigFlags = {
    host: null,
    url: DEFAULT_SERVER_URL,
    out: null,
    list: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--list') {
      flags.list = true;
      continue;
    }
    if (arg === '--url' || arg === '--out') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === '--url') flags.url = value;
      else flags.out = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`);
    if (flags.host !== null) throw new Error(`unexpected argument: ${arg}`);
    flags.host = arg;
  }
  if (!flags.list && flags.host === null) {
    throw new Error('a host is required (or use --list)');
  }
  return flags;
}

/** CLI entry: snippet to stdout (or `--out` file), metadata to stderr. */
export function runConfigCli(argv: readonly string[], outDir: string = process.cwd()): number {
  try {
    const flags = parseConfigFlags(argv);
    if (flags.list) {
      console.log(HOST_IDS.join('\n'));
      return 0;
    }
    const snippet = buildConfigSnippet(flags.host as string, flags.url);
    console.error(`# ${snippet.label} — ${snippet.config_file} (${snippet.format})`);
    for (const note of snippet.notes) console.error(`# note: ${note}`);
    if (flags.out !== null) {
      // Resolve relative paths against the caller's directory; tests pass a temp dir.
      const filePath = flags.out.startsWith('/') ? flags.out : `${outDir}/${flags.out}`;
      writeFileSync(filePath, snippet.snippet, 'utf8');
      console.log(`Wrote ${filePath}`);
      return 0;
    }
    process.stdout.write(snippet.snippet);
    return 0;
  } catch (error) {
    console.error(`config: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
