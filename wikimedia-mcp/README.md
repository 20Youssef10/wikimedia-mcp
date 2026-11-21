# Wikimedia MCP — Phase 1 + Phase 2 + Phase 3 (read-only)

A TypeScript implementation of the frozen Phase 1 contract (`09-implementation-contract.md`,
v1.0.1), the frozen Phase 2 Group B contract (`10-phase2-contract.md`, v2.0.0)
and the frozen Phase 3 Group C/F contract (`11-phase3-contract.md`, v3.0.0),
targeting **MCP 2026-07-28** (stateless, `server/discover`, per-request `_meta`,
routing headers, `resultType`/`ttlMs`/`cacheScope`).

**Twenty read-only tools:** the nine Phase 1 Group A tools (`search`,
`get_summary`, `get_page`, `get_sections`, `get_related_pages`, `get_media`,
`get_languages`, `get_random_page`, `get_feed`), the six Phase 2 Group B
(Wikidata) tools and the five Phase 3 tools (three Group C metrics, two Group F
media) listed below. Both **stdio** and **Streamable HTTP** transports are
supported. No write tools, no Enterprise APIs, no change notifications
(`subscriptions/listen` returns `-32601`).

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
(`ATTRIBUTION_*`) keys are wired from day 1; Phase 2 **reuses the same eight
WDQS keys** and adds no new configuration key.

**Wikidata host notes (Phase 2):**

- Wikibase REST v1.6 is fixed at `https://www.wikidata.org/w/rest.php/wikibase/v1`;
  item search, `get_entity`, `get_statements` and `get_sitelinks` use it.
- WDQS endpoints come only from `WIKIDATA_SPARQL_ENDPOINT` (default
  `https://query.wikidata.org/sparql`), `_V2`, `_FALLBACKS` and `_PREFER_V2`.
  Every endpoint must be `https:` — startup fails otherwise. Do **not** use
  `HEAD` as a WDQS health check (it times out while `GET` succeeds).
- `WIKIDATA_SPARQL_TIMEOUT_MS ≤ 60000`; `WIKIDATA_SPARQL_MAX_ROWS` and
  `_MAX_QUERY_LENGTH` must be positive. The advertised `wikidata_sparql_query`
  schema is regenerated from these caps at boot so schema and guard cannot drift.
- **Label-service deadlines:** `SERVICE wikibase:label` is the one known slow
  WDQS path (it resolves labels after the main pattern). A live query at
  `timeout_ms=30000` otherwise fails with `query_timeout` even though the
  contract permits up to 60000 ms. `wikidata_sparql_query` therefore *uses* the
  full 60000 ms hard cap for guarded label-service queries whose `timeout_ms`
  is below it, reports `effective_timeout_ms`, and adds a non-fatal warning
  (`label-service query: timeout_ms raised …`). Non-label queries keep the
  requested deadline. The global 60 s cap is **never raised**, and if a label
  query still times out the `query_timeout` error names `wikibase:label` as the
  likely cause instead of suggesting a deadline above the cap. Detection is
  token-based, so a `SERVICE wikibase:label` string inside a comment or literal
  does not trigger the bump.
- WDQS concurrency is a dedicated semaphore of `min(2, CONCURRENCY_LIMIT)`
  nested inside the global `p-limit(3)`. Identical effective queries are cached
  for `min(300000, METADATA_CACHE_TTL_MS)` ms.
- `WIKIDATA_SPARQL_FALLBACKS` is an ordered comma-separated list. On 401/403/
  404/other-5xx/timeout the next endpoint is tried; 429/503 **stay** on the same
  endpoint and honour `Retry-After` (≥ `RETRY_AFTER_FALLBACK_MS` when absent).

**Phase 3 adds zero configuration keys.** The three existing Attribution keys
are reused as-is: `ATTRIBUTION_API_VERSION` (default `v0-beta`, pattern
`^v[0-9]+(?:-[a-z0-9]+)?$`; `v1` is accepted but still falls back because the
live `v1` path returns `404 rest-no-match`), `ATTRIBUTION_FALLBACKS` (allowed
tokens exactly `rest-bare,action-rightsinfo,action-imageinfo`) and
`ATTRIBUTION_DISCLAIMER` (injected verbatim into every media result). An
empty/malformed version or an unknown fallback token terminates boot. Date caps
(`MIN_DATE`, `MAX_SPAN`), project aliases, the licence URL map and Class M/T/I
pacing are version-controlled code constants, not environment variables.

---

## Host configuration examples

Adapted from report 06 §7 (see §7.1 for verified host results). For a local
deployment use the stdio command or `http://127.0.0.1:3000/mcp` in place of the
hosted URL shown there. Leave OAuth fields empty — no credentials are needed.

> **Compatibility:** this server speaks **MCP 2026-07-28 only**. Classic
> `initialize`/2024–2025 hosts are unsupported. Verified working: **Grok Build**
> and **OpenCode** (OpenCode requires the `protocol` key below). Verified
> incompatible: **Cursor CLI** (legacy SSE GET probe → 405) and **Codex CLI**
> (classic `2025-06-18` initialize → `-32022`). **Cline** was config-checked
> but not connection-tested.

| Host | Config location | Key / transport field | Snippet |
|---|---|---|---|
| **Claude Code** | `.mcp.json` / `~/.claude.json` | `mcpServers`, `"type":"http"` | `claude mcp add --transport http wikimedia http://127.0.0.1:3000/mcp` |
| **Claude.ai / Desktop** | Connectors UI or `claude_desktop_config.json` | `mcpServers`; URL for remote, `command`/`args` for stdio | `{"mcpServers":{"wikimedia":{"url":"http://127.0.0.1:3000/mcp"}}}` |
| **Cursor** | `.cursor/mcp.json` | `mcpServers`, URL infers remote | `{"mcpServers":{"wikimedia":{"url":"http://127.0.0.1:3000/mcp"}}}` — set transport explicitly if it defaults to legacy SSE |
| **VS Code (Copilot native)** | `~/.copilot/mcp-config.json` | `mcpServers`, `"type":"http"` | `{"mcpServers":{"wikimedia":{"type":"http","url":"http://127.0.0.1:3000/mcp","tools":["*"]}}}` |
| **VS Code (editor-managed, deprecated)** | `.vscode/mcp.json` | `servers`, `"type":"http"` | `{"servers":{"wikimedia":{"type":"http","url":"http://127.0.0.1:3000/mcp"}}}` |
| **Codex CLI** | `~/.codex/config.toml` | TOML `[mcp_servers.<name>]`, URL implies HTTP | `codex mcp add wikimedia --url http://127.0.0.1:3000/mcp` |
| **Gemini CLI** | `~/.gemini/settings.json` | **`httpUrl`** (its `url` means SSE) | `{"mcpServers":{"wikimedia":{"httpUrl":"http://127.0.0.1:3000/mcp"}}}` |
| **Grok Build** | `~/.grok/config.toml` | `--transport http` | `grok mcp add --transport http wikimedia http://127.0.0.1:3000/mcp` — **verified PASS** (handshake 2026-07-28; 9 tools at verification, 15 after Phase 2) |
| **OpenCode** | `opencode.json` (`mcp.servers.wikimedia`) | `type:"remote"`, **`protocol`** | `{"mcp":{"servers":{"wikimedia":{"type":"remote","url":"http://127.0.0.1:3000/mcp","protocol":"2026-07-28"}}}}` — **verified PASS only with `protocol`**; default `legacy` fails |
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

**Phase 2 — Wikidata (Group B):**

| Tool | Required | Purpose |
|---|---|---|
| `wikidata_search_entities` | `query` | Label/alias search → QIDs, labels, descriptions (`language`, `limit`, `offset`). |
| `wikidata_get_entity` | `qid` | Projected labels/descriptions/aliases/`claims`/sitelinks with statement caps. |
| `wikidata_get_statements` | `qid`, `property` | Rank-ordered statements with paging, qualifiers and opt-in bounded `resolve_labels`. |
| `wikidata_get_sitelinks` | `qid` | Sitelinks filtered by allowlisted site codes (`sites`, `include_badges`, `limit`). |
| `wikidata_resolve_external_id` | exactly one of `scheme`+`id` or `site`+`title` | DOI/PMID/ORCID/OpenAlex/IMDb or sitelink → QID via bounded WDQS. |
| `wikidata_sparql_query` | `query` | Portable SPARQL 1.1 SELECT; local guard + mandatory LIMIT + endpoint fallback. |

**Phase 3 — Metrics (Group C):**

| Tool | Required | Purpose |
|---|---|---|
| `get_pageviews` | `article`, `start`, `end` | Daily/hourly/weekly/monthly page views for one article over a bounded, completed UTC range. Supports dotted Analytics codes and Phase 1 aliases (`enwiki` → `en.wikipedia`, `commonswiki` → `commons.wikimedia`). Empty data is `results: []` with `count: 0`. |
| `get_most_read` | `date` | Most-read articles of one completed UTC day (`YYYY-MM-DD`), rank-ordered, with allowlisted article URLs. `limit` 1–100. |
| `get_unique_devices` | `start`, `end` | **Project-wide** cookie-based device reach estimate (`devices`, `offset`, `underestimate` + a `meaning` string). NOT per-article and NOT pageviews. `daily`/`monthly` only; `all-sites`/`desktop-site`/`mobile-site`. |

All three metrics tools enforce local, zero-request date guards: explicit
completed dates only (no `today`/future), `end ≤ yesterday UTC`, earliest date
`20150101` (`20160101` for most-read), granularity-aligned timestamps (weekly
Mondays, monthly the 1st) and bounded spans (hourly 24 h, daily 366 d, weekly
730 d, monthly 3650 d). Breaches return `invalid_date_range` with
`details.limits`. Metrics are **CC0 1.0** data with `attribution.required: false`
and an `endpoint` reproducing the exact request; linked article titles and
content keep their own licences.

**Phase 3 — Commons media (Group F):**

| Tool | Required | Purpose |
|---|---|---|
| `get_file_metadata` | `filename` | Full, compliance-oriented view: `author`, `credit`, `brand_marks`, `wiki`, `restrictions`, per-file licence and technical metadata. `include_brand_marks` (default true). |
| `get_image_info` | `filename` | Compact machine-readable projection: `url`, `thumb_url`, `mime`, dimensions, `size`, per-file licence short/URL and attribution. |

Both tools accept optional `project` (default `commonswiki`) and `thumb_width`
(40–1200, default 320), require a `File:`-prefixed title, and share **one**
resolve pipeline: Attribution API `v0-beta` `essential.*` signals (primary) →
Action API `imageinfo`/`extmetadata` enrichment → media-filtered fallbacks.
The site-wide CC BY-SA 4.0 licence is **never** substituted for a per-file
licence: an unmapped licence URL is `null` plus a warning (resolved via a small
static deed map where possible), `action-rightsinfo` is always skipped with a
recorded warning, HTML in `extmetadata` is stripped/entity-decoded and returned
as untrusted data, and remote media (`imagerepository != local`) skips the beta
call entirely. Every media result carries `license`, `author` (possibly `null`
with a warning), `attribution` (with `ATTRIBUTION_DISCLAIMER` verbatim), `source`,
`attribution_source`, `warnings` and `resultType: "complete"`.

All nine Phase 1 tools accept optional `lang` (default `en`) and `project`
(default `wikipedia`).
Project aliases include `wiki`/`wp`, `commonswiki`, `wikidatawiki`, Wikimedia
codes (`enwiki`, `dewiki`, `testwiki`) and dotted forms (`en.wikipedia`); a
code-encoded language overrides `lang`.

**Provenance:** every content result carries `source`, `license`, `attribution`,
`revision` and `timestamp` (null where there is no single revision). Text is
CC BY-SA 4.0 by default; media files carry their own licence. Attribution links
preserve `wprov=afsw1`. All Wikidata results carry CC0 1.0 (`attribution.required:
false`), a `qid` (or `null` for list/SPARQL results), and `revision`/`timestamp`
from Wikibase REST `ETag`/`Last-Modified`; SPARQL results use
`source: "wikidata:sparql"` and an `endpoint` reproducing the effective query.
Phase 3 metrics carry `source: "wikimedia:analytics"`, a CC0 1.0 licence block
and an `endpoint`; Phase 3 media carry a per-file licence block, `author` and
`attribution_source`. Returned wiki/Wikidata/media text is **untrusted data**,
never instructions.

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
  exists in either phase.
- Group B SPARQL is SELECT-only with a single-statement guard, a local
  complexity score, a mandatory top-level LIMIT (clamped to
  `WIKIDATA_SPARQL_MAX_ROWS`), a ≤60 s abort deadline, row/byte caps and a
  restricted `SERVICE wikibase:label` only. Remote `SERVICE <iri>`, update verbs
  and non-HTTPS endpoints are rejected before any request.
- Site codes and external-ID schemes are allowlisted; QIDs/PIDs are validated
  before URL interpolation. Wikidata labels/descriptions are returned as data
  (prompt-injection canaries are not promoted to instructions).

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
  runs in the merge gate. Every nightly run (pass, fail, or startup failure)
  writes `reports/nightly-live.json` (gitignored) with the timestamp, call
  counts, per-tool success/p95, M1–M6 pass flags, the M4 429 count, peak
  concurrency, `overallPass` and failure details; the human-readable
  `[nightly]` console diagnostics are unchanged. Set
  `WMCP_NIGHTLY_REPORT_PATH` to override the output path.
- Groups D, E and G corpus cases target tools that ship in later phases and
  are documented as out of scope. Group B fixtures and AC-33…AC-59, plus
  Group C/F fixtures and AC-60…AC-94 (except nightly live AC-71/72/92), run in
  the merge gate. The live cases (AC-42/45/59, TC-B-001/003/005/008/030,
  TC-C-001/002, TC-F-001) run nightly with `WMCP_LIVE=1`.
- The independent `/tmp/opencode/qa-mcp-smoke.mjs` and `qa-mcp-http.mjs` scripts
  assert *exactly fifteen* tools (the Phase 1 + Phase 2 invariant). With Phase 3
  registered they report 19/20 and 14/15 respectively: only the tool-count
  check differs. They are intentionally left unmodified; the in-repo contract
  tests assert the full 20-tool catalogue.
- Group C/F keep a separate nightly load profile (`CF-M3` p95 budgets and
  `CF-M4` 429-count == 0). Phase 3 tools do **not** feed the Phase 1 M3/M4 or
  Phase 2 B-M3/B-M4 gates. No live Analytics/Attribution/imageinfo call runs in
  the fixture-only merge gate (`AC-71`, `AC-72`, `AC-92` are nightly live).
- Language variants without their own wiki (`zh-hans`, `pt-br`, ...) are routed
  to their real base-language host; the full requested code is retained in
  `lang`/`source`. Codes with real wikis (`be-tarask`, `zh-min-nan`, `zh-tw`)
  keep their exact host. Network/DNS failures map to `upstream_unavailable`
  with the failed host in the hint, never a generic `TypeError` fault.
- `get_related_pages` also emits a `pages` alias and feed items carry per-item
  licence/attribution for test-corpus compatibility; these are additive.
