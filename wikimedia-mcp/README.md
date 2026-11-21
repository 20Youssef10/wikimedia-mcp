# Wikimedia MCP — Phase 1 (read-only)

A TypeScript implementation of the frozen Phase 1 contract (`report 09`, v1.0.1)
targeting **MCP 2026-07-28** (stateless, `server/discover`, per-request `_meta`,
routing headers, `resultType`/`ttlMs`/`cacheScope`).

**Nine read-only tools:** `search`, `get_summary`, `get_page`, `get_sections`,
`get_related_pages`, `get_media`, `get_languages`, `get_random_page`, `get_feed`.
Both **stdio** and **Streamable HTTP** transports are supported. No write tools,
no Enterprise APIs, no change notifications (`subscriptions/listen` returns
`-32601`).

> SDK note: the 2026-07-28 implementation is the v2 SDK, which ships as two
> packages (`@modelcontextprotocol/server` and `@modelcontextprotocol/client`),
> not the legacy single `@modelcontextprotocol/sdk` package. See
> [`SDK-VERIFICATION.md`](./SDK-VERIFICATION.md) for the gate evidence.

---

## Requirements

- Node.js **22 LTS or newer** (developed on v24.22.2)
- npm 11 (committed `package-lock.json`; install with `npm ci`)
- Network egress to Wikimedia hosts for live use (the merge gate uses fixtures)

## Install and run

```bash
npm ci
cp .env.example .env
# edit .env — USER_AGENT is REQUIRED
```

**stdio (default):**

```bash
USER_AGENT='WikiMCP/1.0 (https://example.org/bot; ops@example.org)' npm start
# or with an env file:
node --env-file=.env --import tsx src/index.ts
```

**Streamable HTTP:**

```bash
MCP_TRANSPORT=streamable-http \
MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_PORT=3000 MCP_HTTP_PATH=/mcp \
MCP_ALLOWED_HOSTS=127.0.0.1,localhost \
USER_AGENT='WikiMCP/1.0 (https://example.org/bot; ops@example.org)' \
npm start
```

The HTTP endpoint is **POST-only**: `GET` returns `405` with `Allow: POST`.
Wrong `Content-Type` → `415`; bad `Origin`/`Host` → `403`; header/body mismatch →
`-32020` with HTTP 400. Public binds require both `MCP_ALLOWED_ORIGINS` and
`MCP_ALLOWED_HOSTS` to be set.

### Configuration

All keys from contract §2.6 are Zod-validated at boot; invalid values terminate
startup. See [`.env.example`](./.env.example) for the full list and defaults.
Notable limits: `CONCURRENCY_LIMIT ≤ 3`, `HTTP_TIMEOUT_MS`, `RETRY_MAX_ATTEMPTS`,
`RETRY_AFTER_FALLBACK_MS` (≥5 s when upstream omits `Retry-After`),
`MAX_RESULT_BYTES`. WDQS (`WIKIDATA_SPARQL_*`) and Attribution
(`ATTRIBUTION_*`) keys are wired from day 1 for later groups.

---

## Host configuration examples

Adapted from report 06 §7. For a local deployment use the stdio command or
`http://127.0.0.1:3000/mcp` in place of the hosted URL shown there. Leave OAuth
fields empty — Phase 1 needs no credentials.

| Host | Config location | Key / transport field | Snippet |
|---|---|---|---|
| **Claude Code** | `.mcp.json` / `~/.claude.json` | `mcpServers`, `"type":"http"` | `claude mcp add --transport http wikimedia http://127.0.0.1:3000/mcp` |
| **Claude.ai / Desktop** | Connectors UI or `claude_desktop_config.json` | `mcpServers`; URL for remote, `command`/`args` for stdio | `{"mcpServers":{"wikimedia":{"url":"http://127.0.0.1:3000/mcp"}}}` |
| **Cursor** | `.cursor/mcp.json` | `mcpServers`, URL infers remote | `{"mcpServers":{"wikimedia":{"url":"http://127.0.0.1:3000/mcp"}}}` — set transport explicitly if it defaults to legacy SSE |
| **VS Code (Copilot native)** | `~/.copilot/mcp-config.json` | `mcpServers`, `"type":"http"` | `{"mcpServers":{"wikimedia":{"type":"http","url":"http://127.0.0.1:3000/mcp","tools":["*"]}}}` |
| **VS Code (editor-managed, deprecated)** | `.vscode/mcp.json` | `servers`, `"type":"http"` | `{"servers":{"wikimedia":{"type":"http","url":"http://127.0.0.1:3000/mcp"}}}` |
| **Codex CLI** | `~/.codex/config.toml` | TOML `[mcp_servers.<name>]`, URL implies HTTP | `codex mcp add wikimedia --url http://127.0.0.1:3000/mcp` |
| **Gemini CLI** | `~/.gemini/settings.json` | **`httpUrl`** (its `url` means SSE) | `{"mcpServers":{"wikimedia":{"httpUrl":"http://127.0.0.1:3000/mcp"}}}` |
| **Grok Build** | `~/.grok/config.toml` | `--transport http` | `grok mcp add --transport http wikimedia http://127.0.0.1:3000/mcp` |
| **Cline** | `~/.cline/data/settings/cline_mcp_settings.json` | **`"type":"streamableHttp"`** | `{"mcpServers":{"wikimedia":{"type":"streamableHttp","url":"http://127.0.0.1:3000/mcp"}}}` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` | UI flow preferred | Customize → MCPs → add server → paste the URL |
| **ChatGPT** | UI only | remote HTTPS | Plugins → Add custom MCP server → paste URL |

**Integration risks:** the POST-only endpoint (clients that probe with GET
fail), transport-key differences (`httpUrl`, `streamableHttp`, `type:"http"`),
and VS Code's documented config migration (editor-managed form removed Feb
2027).

---

## Tools

| Tool | Required | Purpose |
|---|---|---|
| `search` | `q` | Full-text search (titles, snippets, page IDs). Empty results are success. |
| `get_summary` | `title` | Lead summary + thumbnail. |
| `get_page` | `title` | Whole page as `plaintext` / `wikitext` / `html`, truncated at `max_chars`. |
| `get_sections` | `title` | List sections (omit `section`) or fetch one (`section`, `content_format`). |
| `get_related_pages` | `title` | Related pages. |
| `get_media` | `title` | Media files with **per-file** licence/attribution from `extmetadata`. |
| `get_languages` | `title` | Interlanguage links. |
| `get_random_page` | — | Random page summary (non-deterministic). |
| `get_feed` | `kind` | `featured` or `on_this_day` (`event_type`, `date`). |

All accept optional `lang` (default `en`) and `project` (default `wikipedia`).
Project aliases include `wiki`/`wp`, `commonswiki`, `wikidatawiki`, Wikimedia
codes (`enwiki`, `dewiki`, `testwiki`) and dotted forms (`en.wikipedia`); a
code-encoded language overrides `lang`.

**Provenance:** every content result carries `source`, `license`, `attribution`,
`revision` and `timestamp` (null where there is no single revision). Text is
CC BY-SA 4.0 by default; media files carry their own licence. Attribution links
preserve `wprov=afsw1`. Returned wiki text is **untrusted data**, never
instructions.

**Errors** are actionable (`code`, `message`, `retryable`,
`retry_after_seconds`, `hint`, `action`, `details`) and never leak raw HTTP
text, tokens or stack traces.

---

## Verification

```bash
npm ci
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
npx vitest run
```

The merge gate is fixture-only (MSW + Vitest), covers both transports, and
enforces the protocol mechanisms (semaphore ≤3, `Retry-After`, jittered
backoff, routing headers, sentinel decoding, cache metadata). Nightly live
M3/M4 load tests are in `tests/live` and are skipped by default
(`WMCP_LIVE=1` to enable).

## Security notes

- Caller-supplied host parameters are rejected at the transport boundary
  (`host_not_allowed`) with zero outbound requests; hosts come only from the
  fixed resolver allowlist.
- Every outbound request carries the configured contactable User-Agent,
  concurrency is capped at 3, and 429s honour `Retry-After` (≥5 s fallback).
- `Origin`/`Host` allowlists, loopback default bind, and POST-only HTTP defend
  against DNS rebinding and cross-origin invocation.
- Logs go to stderr only, carry correlation IDs, and redact token-shaped
  values. stdout on stdio is reserved for JSON-RPC.
- The tool catalogue is static (no dynamic registration). No write capability
  exists in Phase 1.

## Known limitations / deviations

- The contract names `@modelcontextprotocol/sdk`; the registry's v1 line
  (`@modelcontextprotocol/sdk@1.32.2`) implements only up to 2025-11-25. The
  2026-07-28 surface is provided by the v2 packages at 2.4.0 (see
  `SDK-VERIFICATION.md`).
- TypeScript is pinned to 6.0.3 (not 7.x) because `typescript-eslint@8.73.0`
  caps the peer at `<6.1.0`; the SDK's "≥6.0" requirement is still met.
- The real nightly live gate (330 calls, M1–M4) is skipped by default; run
  `npm run build && WMCP_LIVE=1 npx vitest run tests/live/live.test.ts` off-peak.
  Metric computation is enforced fixture-backed in CI. `TC-A-014` (429 → retry)
  runs in the merge gate.
- Groups B–G corpus cases target tools that ship in later phases and are
  documented as out of scope in the corpus test.
- Language variants without their own wiki (`zh-hans`, `pt-br`, ...) are routed
  to their real base-language host; the full requested code is retained in
  `lang`/`source`. Codes with real wikis (`be-tarask`, `zh-min-nan`, `zh-tw`)
  keep their exact host. Network/DNS failures map to `upstream_unavailable`
  with the failed host in the hint, never a generic `TypeError` fault.
- `get_related_pages` also emits a `pages` alias and feed items carry per-item
  licence/attribution for test-corpus compatibility; these are additive.
