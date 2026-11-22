# Phase 1 Implementation Contract — Unified Wikimedia MCP Server

**Document version:** 1.0.1 (frozen; v1.0.1 adds project-code aliases only)  
**Date:** 2026-11-21  
**Language:** en-GB  
**Target protocol:** MCP 2026-07-28  
**Status:** Ready to implement (read-only Phase 1)

> This contract closes the four "Definition of Ready" items from the readiness review. It consolidates three specialist workstreams: frozen tool contracts (§3), the TypeScript stack decision (§2) and the load profile (§4), plus binary acceptance criteria (§5). Research basis: reports 01–08 and `test-corpus.json`.

---

## 1. Scope and decisions

### 1.1 Decisions closed

| # | Item | Decision |
|---|------|----------|
| 1 | Phase 1 tool list and schemas | **Frozen** — nine Group A tools, contract v1.0.1, §3. Ambiguities resolved: `get_sections` absorbs `get_section_content` (§3.1); `get_feed` absorbs `get_featured`/`get_on_this_day` (§3.2). |
| 2 | Load profile for M3/M4 | **Defined** — §4. M3/M4 are nightly live gates; merge gate is fixture-only and enforces mechanisms. |
| 3 | MCP acceptance criteria | **Defined** — 32 binary criteria, §5. |
| 4 | Language and SDK | **TypeScript**, official **v2** packages `@modelcontextprotocol/server@2.4.0` + `@modelcontextprotocol/client@2.4.0`, Node ≥20 LTS (built on Node 24.22.2). Python path evaluated and rejected (§2). |

### 1.2 Scope boundary

**In scope:** nine read-only Group A tools; both stdio and Streamable HTTP transports; `server/discover`; per-request `_meta`; caching metadata; routing headers; shared language/project resolver; User-Agent, rate-limit and retry infrastructure; licence/attribution enrichment; WDQS and Attribution **configuration keys present from day 1** (§2.6).

**Out of scope (decided):** Enterprise data APIs (Group E) — **no paid subscription exists**; all write tools; EventStreams live consumer (Group D — one-week spike instead); Lift Wing; Wikifunctions; MCP change notifications (`subscriptions/listen`). See §6.

> **Change control:** any rename, removal or semantic change to a field in §3 requires a new major contract version. Never rename or remove fields silently.

---

## 2. Stack decision — TypeScript

### 2.1 Runtime

Node.js **22 LTS** (minimum 20 LTS). Protocol revision 2026-07-28 — **no `initialize` handshake, no sessions, no `Mcp-Session-Id`, no independent GET/SSE stream**.

### 2.2 Dependencies (exact pins, committed lockfile; no caret ranges)

| Package | Policy | Purpose |
|---|---|---|
| `@modelcontextprotocol/server` + `@modelcontextprotocol/client` | **Pinned to 2.4.0** after the §2.3 gate | MCP server/client, protocol types, transports (v2 split packages) |
| ~~`@modelcontextprotocol/sdk`~~ | **REJECTED** — v1.32.2 reports `LATEST_PROTOCOL_VERSION = "2025-11-25"`, retains `initialize`, and misses 16/18 required 2026-07-28 literals | Do not use for this project; see SDK-VERIFICATION.md in the implementation |
| `zod` | Exact pin, **single copy** shared with SDK (`npm ls zod` must show one version) | Tool/config schemas, error envelopes |
| `zod-to-json-schema` | Exact pin if Zod 3.x; omit for Zod 4 (`z.toJSONSchema()`) | Advertise JSON Schema in `tools/list` |
| `undici` | Exact pin | Outbound HTTP with deterministic `Agent` limits, timeouts, `AbortSignal` |
| `p-limit` | Exact pin | Concurrency semaphore, ceiling **3** |
| `p-retry` | Exact pin | Bounded jittered backoff; `Retry-After` parsed in-house and passed as delay |

Dev dependencies (exact-pinned): `typescript`, `tsx`, `vitest`, `@vitest/coverage-v8`, `msw`, `eslint`, `typescript-eslint`, `@types/node`. Environment loading uses Node 22's built-in `--env-file` — no `dotenv`.

> **Rejected:** the Python path (MCP Python SDK / FastMCP 4.0 / `httpx` / Pydantic / pytest). Recorded for auditability only; see report 05 §4 and report 07 §7.2.

### 2.3 SDK verification gate — verify the implementation, not the claim

Before pinning, in a clean directory:

1. `npm pack @modelcontextprotocol/server@<candidate>` and `npm pack @modelcontextprotocol/client@<candidate>` into `/tmp/opencode/sdk-verify`; extract. Do not inspect the project's own `node_modules`. **Note:** the original v1 package `@modelcontextprotocol/sdk` was tested first and rejected — it does not implement 2026-07-28. The gate must be run against the v2 packages.
2. **Literal check** on shipped `.d.ts`/`.js`/`.mjs`/schema JSON only — **exclude README, CHANGELOG, package.json descriptions**. All of these must be present: `2026-07-28`, `server/discover`, `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientCapabilities`, `resultType`, `input_required`, `ttlMs`, `cacheScope`, `subscriptions/listen`, `-32020`, `-32021`, `-32022`, `HeaderMismatch`, `UnsupportedProtocolVersion`, `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `Mcp-Param-`.
3. **Type check:** temporary `verify-sdk.ts` importing SDK types for `server/discover`, `resultType`, `ttlMs`, `cacheScope`, `InputRequiredResult` and the three error codes; `tsc --noEmit` must pass with zero errors.
4. **Behavioural smoke test:** start SDK server+client over both transports; assert `server/discover` advertises `2026-07-28`, a bogus version yields `-32022` plus HTTP 400 on Streamable HTTP, a mismatched `Mcp-Name` yields `-32020`, and the six cacheable operations return `ttlMs`/`cacheScope`.
5. **Pin and record** the exact version in `package-lock.json` and `SDK-VERIFICATION.md` (version, date, commands, output digest). CI re-runs steps 2–3 on a clean install as a supply-chain drift guard.

### 2.4 Project layout

```

├── package.json, package-lock.json, tsconfig.json, tsconfig.test.json
├── .env.example, SDK-VERIFICATION.md, README.md
├── src/
│   ├── index.ts                  # transport selection from config
│   ├── config.ts                 # Zod-validated env/config; fail fast at boot
│   ├── types.ts
│   ├── server/
│   │   ├── discover.ts           # server/discover, versions, capabilities, instructions
│   │   ├── instructions.ts       # report 05 §5 content
│   │   ├── tools/registry.ts     # nine frozen tools, Zod schemas, annotations, JSON Schema export
│   │   ├── resources/, prompts/  # minimal in Phase 1
│   ├── protocol/
│   │   ├── meta.ts               # _meta parse/validate
│   │   ├── errors.ts             # -32602 / -32022 / -32021 / -32020 mappers + actionable envelope
│   │   ├── headers.ts            # header-body validation, sentinel decode, Origin/Host checks
│   │   ├── caching.ts            # ttlMs/cacheScope for the six cacheable operations
│   │   └── result.ts             # resultType envelope, serverInfo in result _meta
│   ├── transport/stdio.ts, transport/streamable-http.ts
│   ├── upstream/
│   │   ├── client.ts             # undici Agent, User-Agent, timeouts, AbortSignal
│   │   ├── limiter.ts            # p-limit semaphore, ceiling CONCURRENCY_LIMIT
│   │   ├── retry.ts              # Retry-After parse + jittered backoff
│   │   ├── wikidata-sparql.ts    # WDQS config + fallback chain — DAY 1
│   │   └── attribution.ts        # Attribution API config + fallbacks — DAY 1
│   ├── attribution/assemble.ts   # licence/attribution/source/revision injection
│   └── observability/logging.ts  # correlation IDs; never logs credentials
└── tests/
    ├── corpus-loader.ts          # loads research/test-corpus.json
    ├── unit/, contract/, security/, resilience/, live/
    └── fixtures/cassettes/<group>/<tool>_<case_id>.yaml
```

`tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `NodeNext` module/resolution, `resolveJsonModule`. CI runs `tsc --noEmit` on both `tsconfig.json` and `tsconfig.test.json` as separate blocking steps.

### 2.5 Transports

**stdio.** Newline-delimited JSON-RPC 2.0; stdout reserved for protocol messages, logs to stderr. Version only in `params._meta["io.modelcontextprotocol/protocolVersion"]`. `server/discover` doubles as the legacy probe. No HTTP status on errors. On EOF/SIGTERM: abort in-flight fetches, release semaphore slots, exit 0.

**Streamable HTTP.** Single POST-only endpoint (default `/mcp`); GET → **405 + `Allow: POST`**. `Content-Type: application/json` required (else 415).

| Header | Required for | Rule | Failure |
|---|---|---|---|
| `MCP-Protocol-Version` | every POST | equals `_meta` protocolVersion | `-32020` |
| `Mcp-Method` | every POST | equals JSON-RPC `method` | `-32020` |
| `Mcp-Name` | `tools/call`, `resources/read`, `prompts/get` | equals `params.name` | `-32020` |
| `Mcp-Param-*` | never in Phase 1 | no tool declares `x-mcp-header`; reject any | `-32020` |
| `=?base64?…?=` sentinel | if sent | decode before comparison | `-32020` |

Origin/Host defence: bind `127.0.0.1` by default; reject `Host` outside `MCP_ALLOWED_HOSTS` → 403; reject `Origin` outside `MCP_ALLOWED_ORIGINS` → 403 before body parsing; public bind requires both lists configured. No wildcard CORS with credentials.

**HTTP status mapping:** unsupported/malformed version → `-32022` or `-32602` with **400**; header/body mismatch → `-32020` with 400; missing declared capability → `-32021` with 400; malformed envelope → `-32700`/`-32600` with 400; unregistered method → `-32601` (200 body); GET/PUT/DELETE → 405; bad Origin/Host → 403; wrong Content-Type → 415; unhandled fault → `-32603` with 500 and no stack trace.

**Result envelope:** every result carries `resultType` and `_meta["io.modelcontextprotocol/serverInfo"]`; the six cacheable operations carry `ttlMs ≥ 0` and `cacheScope ∈ {public, private}`. Every error carries `code`, `message`, `retryable` and `action`.

**Change notifications:** not offered in Phase 1. `server/discover` advertises none of the list-changed capabilities; `subscriptions/listen` returns `-32601`. No long-lived POST, no GET stream.

### 2.6 Configuration keys (all Zod-validated at boot; invalid values terminate startup)

| Key | Default | Required | Purpose |
|---|---|---|---|
| `USER_AGENT` | — | **Yes** | Contactable UA on every outbound call |
| `CONCURRENCY_LIMIT` | `3` | No | Values > 3 rejected at boot |
| `HTTP_TIMEOUT_MS` | `15000` | No | Per-request timeout |
| `RETRY_MAX_ATTEMPTS` | `3` | No | Bounded retries |
| `RETRY_BACKOFF_BASE_MS` / `_MAX_MS` | `250` / `5000` | No | Jittered backoff |
| `RETRY_AFTER_FALLBACK_MS` | `5000` | No | Wait when 429 omits `Retry-After` |
| `MCP_TRANSPORT` | `stdio` | No | `stdio` \| `streamable-http` |
| `MCP_HTTP_HOST` / `_PORT` / `_PATH` | `127.0.0.1` / `3000` / `/mcp` | No | Listener |
| `MCP_ALLOWED_ORIGINS` | — | Conditional | Required when binding publicly |
| `MCP_ALLOWED_HOSTS` | `127.0.0.1,localhost` | No | DNS-rebinding defence |
| `LOG_LEVEL` | `info` | No | Per-request override via `_meta["io.modelcontextprotocol/logLevel"]`, **not** `logging/setLevel` |
| `METADATA_CACHE_TTL_MS` | `3600000` | No | siteinfo/project-code cache |
| `MAX_RESULT_BYTES` | `65536` | No | Truncation ceiling |
| `WIKIDATA_SPARQL_ENDPOINT` | `https://query.wikidata.org/sparql` | No | Day-1 config (report 06 §5.2) |
| `WIKIDATA_SPARQL_ENDPOINT_V2` | `https://query-next.wikidata.org/sparql` | No | Optional v2 |
| `WIKIDATA_SPARQL_FALLBACKS` | ordered list | No | Alternates |
| `WIKIDATA_SPARQL_PREFER_V2` | `false` | No | Flip at v2 GA |
| `WIKIDATA_SPARQL_ACCEPT` | `application/sparql-results+json` | No | Both v1/v2 |
| `WIKIDATA_SPARQL_TIMEOUT_MS` | `60000` | No | ≤ 60 s |
| `WIKIDATA_SPARQL_MAX_ROWS` / `_MAX_QUERY_LENGTH` | `1000` / `10000` | No | Complexity guards |
| `ATTRIBUTION_API_VERSION` | `v0-beta` | No | Do **not** assume v1 (report 06 §6.4) |
| `ATTRIBUTION_FALLBACKS` | `rest-bare,action-rightsinfo,action-imageinfo` | No | Beta 404 fallback chain |
| `ATTRIBUTION_DISCLAIMER` | vendor string | No | Compliance disclaimer on results |

**Day-1 requirement:** all WDQS and Attribution keys are defined, typed, validated and wired into `src/upstream/wikidata-sparql.ts` and `src/upstream/attribution.ts` in the first commit, even though Groups B/F ship later. This prevents the WDQS-v2 migration and beta-to-v1 Attribution transition from becoming retrofits. **Deliberately absent:** any Enterprise token, write credential, EventStreams setting, Lift Wing budget or Wikifunctions endpoint.

---

## 3. Frozen Phase 1 tool contract (Group A)

**Contract version 1.0.1.** Backends: Wikimedia REST (`/api/rest_v1/`), MediaWiki Action API (`/w/api.php`). No tool calls Enterprise.

### 3.1 Tool list and ambiguity resolutions

| Tool | Purpose (model-facing) | Backend | Required params |
|---|---|---|---|
| `search` | Full-text search across wiki pages, returning titles, snippets and page IDs. | Action `list=search` | `q` |
| `get_summary` | Concise lead-section summary and thumbnail for one page. | REST `page/summary` | `title` |
| `get_page` | Full page content as plain text, wikitext or HTML. | Action `extracts`/`revisions`, REST `page/html` | `title` |
| `get_sections` | List a page's sections, or retrieve one section's content. | Action `parse&prop=sections` / `wikitext\|text` | `title` |
| `get_related_pages` | Pages related to one page. | REST `page/related` | `title` |
| `get_media` | Media files on a page with per-file licence and attribution. | Action `images` + `imageinfo` | `title` |
| `get_languages` | Interlanguage links for one page. | Action `prop=langlinks` | `title` |
| `get_random_page` | Summary of a randomly selected page. | REST `page/random/summary` | — |
| `get_feed` | Featured content or On This Day entries for a date. | REST `feed/featured` / `feed/onthisday` | `kind` |

All nine also accept optional `lang` (default `"en"`) and `project` (default `"wikipedia"`).

**Resolution (a) — `get_sections` absorbs `get_section_content`.** One tool: no `section` → section index; with `section` → that section's content (`content_format`: `wikitext` default, `html` alternative). Justification: report 03 §5 prefers a small number of task-oriented tools; both names describe one task, and splitting them doubles the surface without adding capability. `get_page` is therefore whole-page only.

**Resolution (b) — `get_feed` absorbs `get_featured` and `get_on_this_day`.** One tool with required `kind` enum (`featured` | `on_this_day`) and optional `event_type` (`events` default, plus `selected`, `births`, `deaths`, `holidays`). Same backend family, date parameters and item shape = one task; enum dispatch is strongly typed and extensible.

**Project/language resolver.** `project` accepts `wikipedia`, `wiktionary`, `wikisource`, `wikibooks`, `wikiquote`, `wikivoyage`, `wikiversity`, `commons`, `wikidata`, `meta`, `species`, plus aliases `wiki`/`wp`, `commonswiki`, `wikidatawiki`. **Patch v1.0.1 adds Wikimedia-style project codes** used by the test corpus: `{lang}wiki` (e.g. `enwiki` → `wikipedia:en`, `dewiki` → `wikipedia:de`), dotted forms (`en.wikipedia` → `wikipedia:en`), and `testwiki` → `https://test.wikipedia.org`. Where a code encodes a language, it overrides the `lang` default. Hosts: multilingual projects → `https://{lang}.{project}.org`; `commons` → `commons.wikimedia.org`; `wikidata` → `www.wikidata.org`; `meta` → `meta.wikimedia.org`; `species` → `species.wikimedia.org`. Bases: `{host}/api/rest_v1`, `{host}/w/api.php`. Titles URL-encoded (`%20`, not `+`).

**Shared provenance block (100% licensing metric).** Every content result carries top-level fields; example for `Earth`:

```json
{
  "source": "wikipedia:en",
  "title": "Earth",
  "revision": 1293847560,
  "timestamp": "2026-11-20T09:14:22Z",
  "license": {
    "title": "Creative Commons Attribution-ShareAlike 4.0 International",
    "short": "CC BY-SA 4.0",
    "url": "https://creativecommons.org/licenses/by-sa/4.0/"
  },
  "attribution": {
    "required": true,
    "text": "Earth — Wikipedia contributors, CC BY-SA 4.0",
    "link": "https://en.wikipedia.org/wiki/Earth?wprov=afsw1",
    "disclaimer": "You remain responsible for licence compliance."
  }
}
```

List results carry top-level `source`/`license`/`attribution` with per-item `title` and `timestamp`; `revision`/`timestamp` are `null` where there is no single revision. `get_media` items carry **individual** licences from Action API `extmetadata` (HTML-stripped), never the site-wide default. Attribution API enrichment belongs to Phase 3 — the `wprov` link is generated locally in Phase 1.

**Annotations.** All nine tools: `{"readOnlyHint": true, "destructiveHint": false, "openWorldHint": true}`. `idempotentHint` is `true` for the seven deterministic tools and `false` for `get_random_page` and `get_feed`.

**Shared error envelope** (MCP tool error, `isError: true`):

```json
{
  "error": {
    "code": "page_not_found",
    "message": "No page titled 'Earthquakes on Mars' exists on wikipedia:en. Check the spelling or call search with the same lang/project.",
    "retryable": false,
    "retry_after_seconds": null,
    "hint": "Call search({ q: 'Earthquakes on Mars', lang: 'en', project: 'wikipedia' }).",
    "details": { "http_status": 404, "backend": "wikimedia-rest-v1" }
  }
}
```

Codes: `validation_error`, `invalid_language`, `invalid_project`, `unsupported_project`, `page_not_found`, `invalid_title`, `invalid_section`, `rate_limited` (retryable, with `retry_after_seconds`), `quota_exhausted`, `upstream_unavailable` (retryable), `timeout` (retryable), `internal_error` (retryable). On 429 honour `Retry-After`, otherwise wait ≥5 s with exponential backoff.

### 3.2 Tool schemas (normative)

#### `search`
Backend: `{actionUrl}?action=query&format=json&list=search&srsearch={q}&srnamespace=0&srlimit={limit}&sroffset={offset}&srprop=snippet|titlesnippet|timestamp|wordcount`.

```json
{
  "type": "object",
  "properties": {
    "q": {"type": "string", "minLength": 1, "maxLength": 500, "description": "Full-text search query. Supports MediaWiki syntax (quotes, incategory:, intitle:)."},
    "lang": {"type": "string", "default": "en", "minLength": 2, "maxLength": 12, "description": "Wikimedia language code."},
    "project": {"type": "string", "default": "wikipedia", "minLength": 2, "maxLength": 24, "description": "Wikimedia project or alias."},
    "limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 50, "description": "Maximum results; hard cap 50."},
    "offset": {"type": "integer", "default": 0, "minimum": 0, "maximum": 10000, "description": "Zero-based offset mapped to sroffset."}
  },
  "required": ["q"],
  "additionalProperties": false
}
```
Output: `{query, results:[{pageid,title,snippet,timestamp,wordcount,url}], total_hits, next_offset, ...provenance}`. An empty search is success with `total_hits: 0` — never `page_not_found`.

#### `get_summary`
Backend: `{restBase}/page/summary/{encodedTitle}`; metadata resolver adds revision/timestamp/licence.

```json
{
  "type": "object",
  "properties": {
    "title": {"type": "string", "minLength": 1, "maxLength": 512, "description": "Canonical page title; spaces or underscores accepted."},
    "lang": {"type": "string", "default": "en", "minLength": 2, "maxLength": 12, "description": "Wikimedia language code."},
    "project": {"type": "string", "default": "wikipedia", "minLength": 2, "maxLength": 24, "description": "Wikimedia project or alias."}
  },
  "required": ["title"],
  "additionalProperties": false
}
```
Output: `{title, displaytitle, description, extract, thumbnail{source,width,height}, pageid, wikibase_item, url, ...provenance}`.

#### `get_page`
Backends: `plaintext` → Action `prop=extracts&explaintext=1`; `wikitext` → Action `prop=revisions&rvprop=content|timestamp|ids&rvslots=main`; `html` → REST `page/html/{title}`.

```json
{
  "type": "object",
  "properties": {
    "title": {"type": "string", "minLength": 1, "maxLength": 512, "description": "Canonical title. Whole-page only; use get_sections for sections."},
    "format": {"type": "string", "default": "plaintext", "enum": ["plaintext", "wikitext", "html"], "description": "Representation to return."},
    "max_chars": {"type": "integer", "default": 20000, "minimum": 500, "maximum": 200000, "description": "Truncation ceiling; truncated flag set when clipped."},
    "lang": {"type": "string", "default": "en", "minLength": 2, "maxLength": 12, "description": "Wikimedia language code."},
    "project": {"type": "string", "default": "wikipedia", "minLength": 2, "maxLength": 24, "description": "Wikimedia project or alias."}
  },
  "required": ["title"],
  "additionalProperties": false
}
```
Output: `{title, format, content, truncated, ...provenance}`. Content is untrusted external data — never interpreted as instructions.

#### `get_sections` (unified)
Backends: no `section` → `action=parse&page={title}&prop=sections`; with `section` → `action=parse&page={title}&section={n}&prop=wikitext|text`.

```json
{
  "type": "object",
  "properties": {
    "title": {"type": "string", "minLength": 1, "maxLength": 512, "description": "Canonical title."},
    "section": {"type": "integer", "minimum": 0, "maximum": 999, "description": "Optional section index. Omit to list sections; supply to fetch content."},
    "content_format": {"type": "string", "default": "wikitext", "enum": ["wikitext", "html"], "description": "Representation of a fetched section; ignored when section omitted."},
    "lang": {"type": "string", "default": "en", "minLength": 2, "maxLength": 12, "description": "Wikimedia language code."},
    "project": {"type": "string", "default": "wikipedia", "minLength": 2, "maxLength": 24, "description": "Wikimedia project or alias."}
  },
  "required": ["title"],
  "additionalProperties": false
}
```
Output (index): `{title, mode:"index", sections:[{index,line,level,number,anchor}], ...provenance}`. Output (content): `{title, mode:"content", section, content_format, content, ...provenance}`. Invalid index → `invalid_section` with hint to call without `section`.

#### `get_related_pages`
Backend: `{restBase}/page/related/{encodedTitle}`.

```json
{
  "type": "object",
  "properties": {
    "title": {"type": "string", "minLength": 1, "maxLength": 512, "description": "Canonical title."},
    "limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 50, "description": "Maximum related pages; hard cap 50."},
    "lang": {"type": "string", "default": "en", "minLength": 2, "maxLength": 12, "description": "Wikimedia language code."},
    "project": {"type": "string", "default": "wikipedia", "minLength": 2, "maxLength": 24, "description": "Wikimedia project or alias."}
  },
  "required": ["title"],
  "additionalProperties": false
}
```
Output: `{title, related:[{title,description,extract,url,thumbnail}], truncated, ...provenance}`.

#### `get_media`
Backends (two batched calls, ≤50 titles each): `prop=images&titles={title}&imlimit=50`, then `prop=imageinfo&iiprop=url|size|mime|extmetadata|user&iiurlwidth={thumb_width}`. Strip HTML from `extmetadata` fields.

```json
{
  "type": "object",
  "properties": {
    "title": {"type": "string", "minLength": 1, "maxLength": 512, "description": "Canonical title whose media files to list."},
    "type": {"type": "string", "default": "all", "enum": ["all", "image", "video", "audio"], "description": "MIME-family filter."},
    "limit": {"type": "integer", "default": 20, "minimum": 1, "maximum": 50, "description": "Maximum media items; hard cap 50."},
    "thumb_width": {"type": "integer", "default": 320, "minimum": 40, "maximum": 1200, "description": "Thumbnail width in pixels."},
    "lang": {"type": "string", "default": "en", "minLength": 2, "maxLength": 12, "description": "Wikimedia language code."},
    "project": {"type": "string", "default": "wikipedia", "minLength": 2, "maxLength": 24, "description": "Wikimedia project or alias."}
  },
  "required": ["title"],
  "additionalProperties": false
}
```
Output: `{title, media:[{title,type,mime,width,height,size,url,thumb_url,description_url,artist,credit,license:{title,short,url},attribution:{required,text,link,disclaimer}}], truncated, ...provenance}`. Partial second-batch failure returns successful items with `truncated: true` and a non-fatal `warnings` array. Empty list is success.

#### `get_languages`
Backend: `{actionUrl}?action=query&format=json&prop=langlinks&titles={title}&lllimit={limit}&llurl=1`.

```json
{
  "type": "object",
  "properties": {
    "title": {"type": "string", "minLength": 1, "maxLength": 512, "description": "Canonical title."},
    "limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 50, "description": "Maximum language links; hard cap 50."},
    "lang": {"type": "string", "default": "en", "minLength": 2, "maxLength": 12, "description": "Language of the queried page."},
    "project": {"type": "string", "default": "wikipedia", "minLength": 2, "maxLength": 24, "description": "Wikimedia project or alias."}
  },
  "required": ["title"],
  "additionalProperties": false
}
```
Output: `{title, languages:[{lang,title,url}], count, truncated, ...provenance}`. `truncated: true` when `llcontinue` indicates more links. No links → success with empty array.

#### `get_random_page`
Backend: `{restBase}/page/random/summary` (main namespace; no namespace parameter exposed).

```json
{
  "type": "object",
  "properties": {
    "lang": {"type": "string", "default": "en", "minLength": 2, "maxLength": 12, "description": "Wiki to draw from."},
    "project": {"type": "string", "default": "wikipedia", "minLength": 2, "maxLength": 24, "description": "Wikimedia project or alias."}
  },
  "required": [],
  "additionalProperties": false
}
```
Output: summary shape like `get_summary`. Non-deterministic; `idempotentHint: false`.

#### `get_feed` (unified)
Backends: `featured` → `{restBase}/feed/featured/{yyyy}/{mm}/{dd}`; `on_this_day` → `{restBase}/feed/onthisday/{event_type}/{mm}/{dd}`. `date: "today"` → current UTC date; future dates rejected; `limit` applied client-side across flattened items.

```json
{
  "type": "object",
  "properties": {
    "kind": {"type": "string", "enum": ["featured", "on_this_day"], "description": "Which curated feed to read."},
    "event_type": {"type": "string", "default": "events", "enum": ["events", "selected", "births", "deaths", "holidays"], "description": "On This Day category; ignored for featured."},
    "date": {"type": "string", "default": "today", "pattern": "^(\\d{4}-\\d{2}-\\d{2}|today)$", "description": "ISO date or 'today'; future dates rejected."},
    "limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 50, "description": "Maximum feed items; hard cap 50."},
    "lang": {"type": "string", "default": "en", "minLength": 2, "maxLength": 12, "description": "Feed edition language."},
    "project": {"type": "string", "default": "wikipedia", "minLength": 2, "maxLength": 24, "description": "Wikimedia project or alias."}
  },
  "required": ["kind"],
  "additionalProperties": false
}
```
Output: `{kind, event_type, date, items:[...], truncated, ...provenance}`. Empty feed is success with `items: []`. `idempotentHint: false`.

### 3.3 Cross-cutting implementation notes

- User-Agent on **every** outbound request; concurrency hard-limited to 3 in the shared routing layer; 429 → `rate_limited` with `retry_after_seconds`.
- Cache siteinfo, `rightsinfo`, project codes and language lists aggressively; cache revision/timestamp enrichment to avoid extra calls.
- `ttlMs`/`cacheScope` are injected by the shared caching module for **all six** cacheable operations (`server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read`) — only the first two are registered in Phase 1, but the module must support all six. `cacheScope: "public"` for read-only results. `tools/call` results carry neither field.
- Server instructions teach: `search → get_summary → get_page → get_sections`; `lang`/`project` defaults and aliases; `get_sections` covers both listing and content; `get_feed` covers both feeds; content CC BY-SA 4.0 by default while media files carry individual licences; no Phase 1 tool writes.
- Verification: 100% licence/attribution on content results, 100% actionable quota errors, ≥70% single-call rate on the corpus.

---

## 4. Load profile for M3 and M4

**Decision:** M3 (p95 < 2 s) and M4 (429 == 0) are **nightly, live** gates. The per-merge gate is fixture-only and enforces *mechanisms* (rate governor, semaphore, `Retry-After` parsing), not metrics — fixtures cannot produce a real latency distribution or a real 429.

### 4.1 Standard load parameters

| Parameter | Value | Rationale |
|---|---|---|
| Workers / concurrency | **3** (one global `p-limit(3)` semaphore) | Published ≤3 limit |
| Pacing governor | **2 req/s** token bucket (120 req/min), burst 3 | 60% of the 200 req/min compliant-UA tier → 40% headroom |
| Identity tier | Compliant-User-Agent bot → 200 req/min | Never rely on the 10/min unidentified tier |
| Total tool calls | **330** = 30 warm-up + 300 measured | ≥150 samples per class for stable p95 |
| Ramp-up | Linear 0 → 2 req/s over first 30 s, then hold | Avoids initial burst |
| Steady state | 135 s at 2 req/s | 270 measured calls |
| Warm-up | 30 calls / 15 s, discarded | Fills caches, warms TCP/TLS (0.12–0.32 s connect) |
| Total wall-clock | ≈180 s (3 min) | Once nightly, off-peak (e.g. 03:00 UTC) |
| Cache mix | 60% hot hits / 40% cold upstream (180 / 300) | p95 sampled from slow path |
| Metadata cache | 100% cached; 0 upstream re-fetches | Politeness |
| Client timeout | 25 s | Above = failed call, not discarded outlier |
| Methods | GET only; fixed historical dates; no tight polling | Etiquette |

### 4.2 Per-tool request mix (of 300 measured calls)

| Tool | Share | Count | Class |
|---|---|---|---|
| `get_summary` | 20% | 60 | R (REST) |
| `search` | 15% | 45 | A (Action) |
| `get_feed` | ~13.3% | 40 | R |
| `get_page` | ~11.7% | 35 | A |
| `get_sections` | 10% | 30 | A |
| `get_related_pages` | ~8.3% | 25 | R |
| `get_languages` | ~8.3% | 25 | R |
| `get_media` | ~7.3% | 22 | A |
| `get_random_page` | 6% | 18 | A |

**Corrected 2026-11-21:** the original mix produced Class R = 147 samples, below the §4.5 requirement of ≥150 per class, making `overallPass` mathematically unachievable. The mix now yields **Class R = 150, Class A = 150**. Warm-up uses the same proportional mix.

### 4.3 Measurement and latency budgets

Measured end-to-end at the MCP client (JSON-RPC framing, routing headers, routing, cache lookup, upstream HTTP, TLS/connect); an upstream-only timer is recorded as a diagnostic but is not the gate metric.

| Class | Tools | Measured median (06 §2.2) | p95 budget | Headroom |
|---|---|---|---|---|
| R — REST read | `get_summary`, `get_feed`, `get_related_pages`, `get_languages` | 0.286 s | **≤ 1.0 s** | ~3× observed worst |
| A — Action API | `search`, `get_page`, `get_sections`, `get_media`, `get_random_page` | 0.586–0.591 s | **≤ 1.5 s** | ~2× observed worst |

**M3 PASS** iff both: every class p95 ≤ its budget **and** global weighted p95 < **2000 ms**, with ≥150 samples per class and ≤5% invalid samples. MCP overhead (~20–80 ms) is inside the measured figure. Excluded from M3: WDQS label queries (>25 s), large Wikibase items (1.07 s then 429), Enterprise bulk, EventStreams and writes — none are Phase 1 tools.

### 4.4 Rate-limit guard (M4)

Instrument `undici` outbound calls to record timestamp, tool, endpoint, HTTP status and `Retry-After` for **every** call including warm-up. Emit `wmcp_upstream_429_total` and a `Retry-After` gauge.

- **Any** upstream 429 during the run → **M4 FAIL** (no ratio, no threshold).
- A `Retry-After` header on any response is a warning; ≥2 in a run fail the nightly gate for instability.
- A 503 fails the run's success metric but is not an M4 failure.
- On 429: fail immediately, record tool/endpoint/timestamp/`Retry-After`, quarantine the sample, open a ticket. Never retry-to-green or loosen the gate.
- Staying within tier: contactable UA → 200/min tier; 120/min cap = 60% of tier; concurrency ≤3; 100% metadata caching; 60% tool-result hits → nominal ≈0.73 req/s upstream; GET-only; nightly only.

### 4.5 Warm-up, percentiles and CI

Warm-up: 30 calls, same mix, 2 req/s, concurrency 3; all discarded from histograms but counted for M4. Percentiles p50/p95/p99 by nearest rank from ≥150 samples per class (≥18 per tool; per-tool gating only when ≥30). Monotonic clock; no winsorisation or tail trimming. A timeout (>25 s) or non-2xx is a **failed call** and fails the gate; >5% invalid samples declare the run unstable.

- **Merge gate (fixture-only, <2 min):** unit, contract/schema over both transports, all `mode: fixture` cases, M5/M6 fixture checks, and mechanism assertions — token bucket ≤120/min, semaphore ≤3, `Retry-After` parsing incl. ≥5 s fallback, jittered backoff. No live calls; M3/M4 not computed.
- **Nightly gate (live):** standard load once, off-peak. Overall PASS iff M1 ≥95%, M2 ≥70%, M3 PASS, M4 PASS, M5 =100%, M6 =100%, zero timeouts/5xx.
- **Manual/opt-in:** production-wiki tests, real credentials, writes, cassette re-recording, threat-model sign-off.

### 4.6 Re-baselining

If the median shifts >50% for three consecutive clean nights, recompute per-class budgets as `measured p95 × 1.5`, keeping the **global 2 s ceiling unchanged** (it is a product metric). Record three nights' data with the reviewed change. Other invalidation risks: upstream tier change (monitor `Wikimedia_APIs/Changelog`), shared CI egress IP reputation (quarantine and re-run from clean egress — never loosen), cache-ratio drift (instrument actual upstream req/min; keep ≤120).

---

## 5. Binary acceptance criteria

Each criterion is yes/no. A criterion passes only if its stated condition is true at the indicated level. All run on fixtures in CI unless noted.

**Correction applied during integration:** the normative 2026-07-28 spec says a request **missing a required `_meta` field is malformed → `-32602` (Invalid params), HTTP 400**. `-32022` is for an *unsupported but well-formed* version; `-32021` is for a *declared-capability shortfall* when processing a method. Criteria AC-03/AC-04 below reflect this.

### A. Discovery and protocol surface
- **AC-01** `server/discover` implemented on both transports; returns `serverInfo`, capabilities and a supported-versions list containing `2026-07-28`. *(07 §3.2; 03 §3.1)*
- **AC-02** Discover advertises exactly the primitives implemented and a non-empty actionable `instructions` string. *(07 §3.2; 05 §5)*
- **AC-03** Missing or non-string `protocolVersion` in `_meta` → `-32602` + HTTP 400 on both transports. *(03 §3.2 basic spec; corrected)*
- **AC-04** Missing `clientCapabilities` → `-32602`; a request declaring capabilities but omitting one required for the invoked method → `-32021`. *(03 §3.2; corrected)*
- **AC-05** Every result includes `_meta["io.modelcontextprotocol/serverInfo"]` with name and version. *(03 §3.2)*
- **AC-06** Every result carries `resultType`; all Phase 1 results are `"complete"`; none return `"input_required"`. *(03 §3.3)*
- **AC-07** A stub `input_required` result carries neither `ttlMs` nor `cacheScope`. *(03 §3.3)*
- **AC-08** `server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read` each return `ttlMs ≥ 0` and `cacheScope ∈ {public, private}` on every complete result. *(03 §3.3)*
- **AC-09** No `tools/call` result carries `ttlMs` or `cacheScope`. *(design)*

### B. Error semantics
- **AC-10** A well-formed but unsupported version (matching header) → `-32022` and exactly HTTP 400 on Streamable HTTP. *(03 §3.2)*
- **AC-11** Each of `Mcp-Method` ≠ body method, `Mcp-Name` ≠ `params.name` on `tools/call`, and `MCP-Protocol-Version` ≠ `_meta` version independently → `-32020`. *(03 §4)*
- **AC-12** Missing required capability for the invoked method → `-32021`. *(03 §3.2)*
- **AC-13** No list-changed capability advertised; `subscriptions/listen` → `-32601`. *(03 §3.4)*

### C. Transport, headers and network security
- **AC-14** `POST /mcp` processed; GET/PUT/DELETE → 405 + `Allow: POST`. *(06 §7; 07 §3.2)*
- **AC-15** Routing headers required as specified in §2.5; each missing required header → `-32020`. *(03 §4)*
- **AC-16** `=?base64?…?=` sentinel decoded before comparison; malformed sentinel → `-32020`. *(03 §4)*
- **AC-17** No tool declares `x-mcp-header`; incoming `Mcp-Param-*` → `-32020`. *(03 §4)*
- **AC-18** `Origin` outside `MCP_ALLOWED_ORIGINS` → HTTP 403 with no JSON-RPC body. *(03 §7)*
- **AC-19** `Host` outside `MCP_ALLOWED_HOSTS` → 403; default bind loopback; public bind with empty allowed-host list fails at boot. *(03 §7)*
- **AC-20** Aborting a request aborts its upstream fetch and frees its concurrency slot. *(07 §3.1)*

### D. Tool contracts
- **AC-21** Every Zod schema rejects wrong types, missing required params, out-of-range `limit`, malformed dates and unknown extra fields (strict object). *(07 §3.1)*
- **AC-22** `tools/list` exposes a JSON Schema for every tool; results validate with no untyped fields. *(07 §3.2)*
- **AC-23** Every Phase 1 tool has `readOnlyHint: true`, `destructiveHint: false`; none destructive. *(07 §6.1; 05 §6)*
- **AC-24** Every error has non-empty `code`/`message`, boolean `retryable`, string `action`; terminal quota errors give recovery guidance; no raw HTTP 429/401 text or token in `message`. *(07 M6)*

### E. Politeness and content compliance
- **AC-25** 100% of outbound requests carry the configured non-empty `USER_AGENT`; one omission fails the run. *(07 §3.3; M4)*
- **AC-26** Max observed concurrent outbound requests ≤3; boot rejects `CONCURRENCY_LIMIT > 3`. *(07 §3.1; 06 §2.3)*
- **AC-27** 429 with `Retry-After: 1` delays ≥1 s; repeated 429s use jittered bounded backoff; exhaustion → `rate_limited`, `retryable: true`; missing header → wait ≥ `RETRY_AFTER_FALLBACK_MS`. *(TC-A-014; 07 §3.4)*
- **AC-28** 100% of content results include `license` and `attribution` plus `source`/`revision` where applicable; one omission fails the run. *(M5; TC-A-002/006/007/009/010/011/012/016)*

### F. Security and day-1 config
- **AC-29** TC-A-012 content is escaped/sanitised, no embedded instruction executed, no system prompt or token disclosed. *(TC-A-012; 07 §3.5)*
- **AC-30** TC-A-013 is rejected with zero outbound requests to the supplied address. The strict Zod schema rejects the out-of-contract `host` key first (`validation_error`); the handler-level host allowlist (`host_not_allowed`) is a verified second layer when the schema is bypassed. *(TC-A-013; 07 §3.5; corpus reconciled 2026-11-21)*
- **AC-31** Config smoke test reads every WDQS and Attribution key from §2.6 with documented defaults when unset. *(06 §5.2/§6.4; 05 §11)*
- **AC-32** AC-01…AC-13 and AC-21…AC-24 pass unchanged over both transports; only HTTP-specific checks AC-14…AC-19 differ. *(07 §3.2)*

**CI placement:** AC-01…AC-24 and AC-28…AC-32 are blocking merge gates (deterministic on fixtures). AC-25…AC-27 are additionally enforced on the nightly live run. No live network calls in the merge gate.

---

## 6. Non-goals for this phase

| Item | Why out of scope |
|---|---|
| Enterprise data APIs (Group E) | No paid subscription; pricing unpublished (user decision; 06 §4). Free routes not pursued now. |
| Write tools (`edit_page`, `upload_file`, Group G) | Require auth, destructive annotations, MRTR confirmation gating and threat-model gate sign-off (05 §6/§7, 07 §8, 08 §6). |
| EventStreams live consumer (Group D) | No demand evidence; one-week spike and registry watch instead (06 §3.3/§3.4). |
| Lift Wing | No demand; separate external-usage budget excluded from general limits (05 §2, 06 §3.3). |
| Wikifunctions | No established demand for function execution/lookup (05 §2). |
| MCP change notifications | Capability decision for this phase (AC-13), distinct from the EventStreams non-goal. |

---

## 7. Sources and status

Frozen 2026-11-21 from: reports 01–08, `test-corpus.json`, live primary sources cited therein. Contract v1.0.1 is ready for implementation. Any change to tool names, required parameters or output field names requires a new major version and a corresponding update to `test-corpus.json` and acceptance criteria.

---

## 8. Implementation verification (2026-11-21)

Built at `./`. Evidence in that project's `SDK-VERIFICATION.md` and `README.md`.

| Gate | Result |
|------|--------|
| SDK verification (§2.3) | **PASS** for `@modelcontextprotocol/server@2.4.0` + `client@2.4.0` (all 18 literals in shipped code; type probe and behavioural checks pass). `@modelcontextprotocol/sdk@1.32.2` **REJECTED** (2025-11-25, `initialize` retained, 16/18 literals missing). |
| `npm install` | 202 packages, 0 vulnerabilities; lockfile committed |
| `npm run build` | PASS after adding explicit `rootDir: "src"` to `tsconfig.json` (TypeScript 6 requires it on emit; `--noEmit` alone did not catch this) |
| `tsc --noEmit` (src + tests) | PASS, zero errors |
| `npm test` (vitest) | **132 passed, 1 skipped** (the single skip is the intentionally default-off 330-call nightly live gate) |
| `eslint` | PASS |
| Independent stdio QA | **15/15** — discover, 2026-07-28, nine tools, read-only annotations, licence/attribution on live `get_summary`, `-32601` |
| Independent Streamable HTTP QA | **10/10** — 405+`Allow: POST`, `-32020` header validation, `-32022`/HTTP 400, nine tools, live `tools/call` |
| Independent defect QA (post-review) | **9/9** — missing-page errors for all four Action-backed tools, hyphenated/variant language codes, impossible/future feed dates |
| Principal-code-review gate | REQUEST_CHANGES → all six blocking findings (H1–H4, M1–M2) plus M3/M5/M7 fixed and re-verified |
| Nightly live gate (final run, off-peak) | **PASS** — 330 live calls, all nine tools 100%, M1=1.0, M2 pass, M3 budgets pass (R≤1.0 s, A≤1.5 s, global <2 s), M4=0 429s, M5=1, M6=1, `overallPass=true` |

**Post-review fixes:** Action API `missing`/`error` bodies now map to `page_not_found` for all four Action-backed tools; request `AbortSignal` is threaded from the SDK tool context into every upstream fetch; the nightly live runner is real (330-call profile, M1–M4 computation, token bucket, p95 budgets) with its metric logic fixture-tested; structured log fields are deeply redacted before serialisation; feed dates use strict calendar round-trip and reject future dates; language codes accept hyphenated variants with a documented variant→base-host map (`zh-hans`→`zh`, `pt-br`→`pt`, while `be-tarask`/`zh-min-nan` keep real hosts), and network failures map to `upstream_unavailable` with the failed host named instead of `internal_error`. `MAX_RESULT_BYTES` is enforced centrally; `get_media` re-throws 429/5xx/abort faults; per-file licences never fall back to the site-wide CC BY-SA URL.

**Documented deviations:** v2 split SDK packages (above); `typescript@6.0.3` (peer cap from `typescript-eslint@8.73.0`); explicit `rootDir: "src"` required by TypeScript 6 on emit; `undici.fetch` with its own Agent due to a Node 24 dispatcher incompatibility, with a `useDispatcher:false` path for MSW fixtures; `zod-to-json-schema` omitted (Zod 4 `z.toJSONSchema()`); additive output fields (`pages` alias, per-item feed licence/attribution); `revision: null` on live `get_summary` where the REST summary payload has no revision; `-32021` mapping unit-tested but not reachable end-to-end because no Phase 1 read tool requires a declared client capability; the 330-call nightly live gate is implemented but default-off (not run in CI).

---

*End of Phase 1 implementation contract — version 1.0.1.*
