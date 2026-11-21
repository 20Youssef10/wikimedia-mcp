# Group D Implementation Contract — Bounded `get_recent_changes`

**Document version:** 6.1.0 — **FROZEN**  
**Date:** 2026-11-21  
**Language:** en-GB (British English)  
**Status:** Normative. An implementation agent may code against this contract without further decisions.  
**Applies to:** exactly one read-only tool, `get_recent_changes`.  
**Authority:** report 12 (Group D spike, §6 BUILD/DROP decision); reports 05 §2 Group D, 06 §7, 01 §4, 02 §6, 08 §6, and the frozen contracts 09 v1.0.1, 10 v2.0.0, 11 v3.0.0, 13 v5.0.0.

> **One-line decision.** Build the bounded, stateless `get_recent_changes` tool backed by MediaWiki Action API `list=recentchanges` polling. **DROP the permanent EventStreams (SSE) consumer, the rolling-window store and every related process, credential and configuration key.** No EventStreams code path exists in this contract.

---

## 1. Scope and boundary

### 1.1 In scope

| Item | Decision |
|---|---|
| Tool | Exactly `get_recent_changes` (name frozen by this contract and by corpus cases TC-D-001/TC-D-002). |
| Backend | MediaWiki Action API `action=query&list=recentchanges` on a host fixed by the shared Phase 1 project/language resolver (report 09 §3.1). |
| Consumption model | One bounded GET per tool call, with an in-process ETag/`If-None-Match` cache and a 60-second TTL. No background poller. |
| Conventions reused verbatim | Resolver and aliases, provenance block, error envelope, User-Agent, concurrency semaphore (≤ 3), bounded backoff, transport headers, `_meta`, `resultType`, no `ttlMs`/`cacheScope` on `tools/call` results. |
| Acceptance criteria | **AC-120 onward** (§7). |
| Corpus | Existing TC-D-001/TC-D-002 are mapped unchanged; new TC-D-003…TC-D-008 are specified in §8. |

### 1.2 Explicit non-goals — must not be registered, configured or stubbed

- **No EventStreams consumer, SSE client, NDJSON reader, `Last-Event-ID`/`?since=` replay, rolling ring buffer, canary-event filter, offset/Kafka state, reconnect state machine or always-on process** (report 12 §6; §5 of this contract).
- **No `subscriptions/listen` capability and no list-changed notification.** The server continues to return `-32601` for `subscriptions/listen` (report 03 §3.4; report 09 AC-13).
- **No new configuration key.** All limits in §4.3 are version-controlled code constants (report 13 §1.4 precedent). No `EVENTSTREAMS_*` setting exists.
- **No write tool, no write credential, no Enterprise token, no Lift Wing or Wikifunctions surface.** Threat-model gates G1–G12 (report 08 §6.2) are untouched by this contract.
- **No MCP resource or prompt.** `prompts/list` and `resources/list` continue to return empty arrays.
- **No change to any earlier contract.** Reports 09 v1.0.1, 10 v2.0.0, 11 v3.0.0 and 13 v5.0.0 are not reopened; AC-01…AC-119 are unchanged.

### 1.3 Reconciliation with the corpus — decisive

TC-D-001's note says "Backed by an internal EventStreams consumer (report 05 group D)". That note is **superseded** by the 2026-11-21 spike decision (report 12 §6) and by §5 of this contract. The fixture itself is **not altered**: its asserted fields (`changes`, `window`, `_meta`, `changes[0].rev_id`) and its constraint "bounded rolling window used, never a long-lived SSE stream" are satisfied by the Action API time window plus the bounded cache defined here. No SSE service is required to make the case pass.

### 1.4 Change control

Renaming the tool; changing a required parameter, an output field name (`changes`, `changes[].rev_id`, `window`, `applied_limit`, `continuation`, `warnings`), an error code, a bound (§2, §4.3), the resolver alias set, the cache TTL, or the read-only annotations requires a **new major contract version**, an updated `test-corpus.json`, and renumbered/extended AC. Additive optional output fields or a revised description may be a minor version with a logged change. Every change re-runs AC-120…AC-129 **and** the AC-01…AC-119 regression gates.

---

## 2. Decisions closed

| # | Decision | Choice | Basis |
|---|---|---|---|
| D1 | Consumption architecture | Stateless Action API polling + bounded in-process cache. No SSE, no internal consumer, no rolling-window service. | report 12 §6; report 09 §6 |
| D2 | Backend | `list=recentchanges` only. MediaWiki Core REST has no recent-changes equivalent (report 12 §4: `404 rest-no-match`); RESTBase feeds are unrelated. | report 12 §4 |
| D3 | Host resolution | Reuse the Phase 1 resolver unchanged, including `enwiki`, `wikipedia:en`, `en.wikipedia`, `commonswiki`, `testwiki`, `meta`, `species`. No caller-supplied host. | report 09 §3.1; SR-3 |
| D4 | Time window | Relative `time_window_seconds`; service maximum 86 400 s (24 h), absolute schema ceiling 604 800 s (7 d). Values above the service maximum are **clamped**, not rejected (reconciles TC-D-002). | TC-D-002; report 12 §3.3 |
| D5 | Limit | Service cap 500; absolute schema ceiling 100 000. Values above 500 are **clamped** and surfaced as `applied_limit` (reconciles TC-D-002). | TC-D-002; SR-1/SR-10 |
| D6 | Continuation | Opaque, bounded, filter-bound cursor (`continue`) with a fixed window end and a hop count ≤ 10. No unbounded paging. | report 12 §3.3; report 03 §5.6 |
| D7 | Empty result | Success: `changes: []`, `count: 0`, `truncated: false`, `continuation: null`, full provenance. Never `no_changes` or `page_not_found`. A **stale** cache is an explicit `stale_window` error, never a silent empty result. | report 12 §3.4; report 09 §3.2 |
| D8 | Licence/attribution | Reuse the Phase 1 block verbatim: CC BY-SA 4.0, `attribution.required: true`, 100 % coverage. `revision`/`timestamp` are `null` for the list result; never fabricated. | report 09 §3.1; SR-11 |
| D9 | Untrusted content | `title`, `user`, `comment` are fully attacker-influenceable (report 08 A3/T-02). Return verbatim as data, labelled untrusted in `warnings` and `attribution.disclaimer`; never interpret as instructions. | report 08 §5.2 |
| D10 | Annotations | `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`, `idempotentHint: false` (the implicit "now" makes identical calls non-deterministic). No `x-mcp-header`. | report 09 §3.1/§3.2; report 13 §3.4 |
| D11 | Nightly gates | Does **not** feed Phase 1 M1–M6, Phase 2 B-M3/B-M4, Phase 3 CF-M3/CF-M4 or Phase 5 G5-M3/G5-M4. Optional opt-in `D-M3`/`D-M4` counters only. | report 13 §5 |
| D12 | Politeness | 1 upstream call per tool call (plus at most 1 conditional revalidation); 60 s cache; global concurrency ≤ 3; contactable `USER_AGENT`; honour `Retry-After`. | report 01 §4; report 02 §9 |

---

## 3. Tool contract (normative)

### 3.1 Backend and concrete URL pattern

Every outbound request is GET, carries the configured non-empty `USER_AGENT`, uses the shared SDK `AbortSignal`, and has a host fixed by the Phase 1 allowlist resolver (SR-3). No caller-supplied host is ever interpolated. Titles do not appear in this tool's request; timestamps are encoded with `encodeURIComponent` (`:` → `%3A`), the `rcprop` list uses `%7C` for pipes, and `rcshow=!bot` uses `%21` for `!`.

| Operation | Pattern |
|---|---|
| Recent changes | `GET {actionUrl}?action=query&format=json&list=recentchanges&rcprop=title%7Cids%7Cuser%7Ctimestamp%7Ccomment%7Csizes%7Cflags&rcnamespace={namespace}&rclimit={applied_limit}&rcstart={window_end}&rcend={window_start}&rcshow=%21bot` (omit `rcshow` when `include_bots: true`; append `&rccontinue={encodedCursor}` when continuing; append `&rctype={types}` when `change_types` is supplied). |
| Concrete TC-D-001 fixture | `GET https://en.wikipedia.org/w/api.php?action=query&format=json&list=recentchanges&rcprop=title%7Cids%7Cuser%7Ctimestamp%7Ccomment%7Csizes%7Cflags&rcnamespace=0&rclimit=50&rcstart=2026-11-21T17%3A20%3A00Z&rcend=2026-11-21T17%3A15%3A00Z&rcshow=%21bot` |

`window_end` is captured **once per logical query** and is frozen in the cursor (§3.6), so continuation calls do not drift the window. `window_start = window_end − time_window_seconds`.

> **v6.1.0 wire-direction fix (pragmatic bug fix, not a semantic change).** MediaWiki enumerates `list=recentchanges` backwards in time: **`rcstart` is the NEWER timestamp (window end) and `rcend` is the OLDER timestamp (window start)**. v6.0.0 specified the reverse order, which is accepted by the API but returns an empty `recentchanges` list for a normal window. v6.1.0 swaps only the two wire values; the frozen tool name, inputs, output shape, window semantics, clamps, cursor, cache, provenance, error codes and AC numbering are unchanged. The reported `window.start`/`window.end` remain chronological (`start < end`); only the outbound parameters are reversed. This restores the behaviour the frozen fixture always intended; no new capability is introduced and no regression gate is reopened.

The implementation must not set `rctoponly`: this tool returns the change-event feed (edit/new/log/categorize), matching both existing recent-changes MCP servers (report 12 §2.1/§2.2).

Observed upstream shape (pins the parser; report 12 §4):

```json
{
  "query": {
    "recentchanges": [
      {
        "rcid": 271828182,
        "revid": 1293847560,
        "old_revid": 1293847000,
        "title": "Earth",
        "ns": 0,
        "type": "edit",
        "timestamp": "2026-11-21T17:19:52Z",
        "user": "ExampleEditor",
        "comment": "copyedit",
        "bot": false,
        "minor": true,
        "oldlen": 150000,
        "newlen": 150042
      }
    ]
  },
  "continue": { "rccontinue": "20261121171952Z|271828182", "continue": "-||" }
}
```

### 3.2 Input JSON Schema (strict; syntactically valid JSON)

All fields are optional; the defaults below apply. `additionalProperties: false` is mandatory: an unknown key (including any `token`, `credential`, `host`, `api_url` or `confirmation`) is a `validation_error` with zero outbound requests (SR-1, T-19, T-04).

```json
{
  "type": "object",
  "properties": {
    "project": {
      "type": "string",
      "default": "wikipedia",
      "minLength": 2,
      "maxLength": 24,
      "description": "Wikimedia project or alias, resolved by the shared Phase 1 resolver (e.g. enwiki, wikipedia:en, en.wikipedia, commonswiki, testwiki)."
    },
    "lang": {
      "type": "string",
      "default": "en",
      "minLength": 2,
      "maxLength": 12,
      "description": "Wikimedia language code; resolved by the shared Phase 1 resolver."
    },
    "namespace": {
      "type": "integer",
      "default": 0,
      "minimum": 0,
      "maximum": 15,
      "description": "MediaWiki namespace id to filter to; 0 = main, 6 = File."
    },
    "time_window_seconds": {
      "type": "integer",
      "default": 300,
      "minimum": 60,
      "maximum": 604800,
      "description": "Relative look-back window, 60..604800 s. Values above the service maximum of 86400 s are clamped and reported in window.seconds."
    },
    "limit": {
      "type": "integer",
      "default": 50,
      "minimum": 1,
      "maximum": 100000,
      "description": "Requested maximum changes, 1..100000. Values above the service cap of 500 are clamped and reported as applied_limit."
    },
    "include_bots": {
      "type": "boolean",
      "default": false,
      "description": "When false (default), send rcshow=!bot to exclude bot edits."
    },
    "change_types": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["edit", "new", "log", "categorize"]
      },
      "minItems": 1,
      "maxItems": 4,
      "uniqueItems": true,
      "description": "Optional change-type filter mapped to rctype; omitted means no type filter."
    },
    "continue": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "pattern": "^[A-Za-z0-9._~-]+$",
      "description": "Opaque cursor returned by a previous call's continuation.cursor. Must be passed back unchanged with identical filters."
    }
  },
  "required": [],
  "additionalProperties": false
}
```

`JSON Schema` cannot express finite-number rejection for the (absent) numeric coordinates in this tool; the schema above has no such fields. The resolver validates `lang`/`project` against the Phase 1 allowlist before any network call (AC-122).

**Clamping rule (reconciles TC-D-002).** The JSON Schema `maximum` values are absolute safety ceilings. The service maxima (`RECENT_CHANGES_MAX_LIMIT = 500`, `RECENT_CHANGES_MAX_WINDOW_S = 86400`) are enforced by clamping. A clamped call succeeds with `applied_limit`/`window.seconds` set to the effective value and a named `warnings[]` entry (`limit_clamped:500`, `window_clamped:86400`). A value above the schema ceiling, a negative or zero value, or a wrong type is `validation_error` with zero outbound requests. This is a deliberate, documented exception to the general "reject out-of-range" rule and applies only to these two fields.

### 3.3 Output shape and provenance

Field contract: `{changes, count, truncated, continuation, window, applied_limit, warnings, source, title, revision, timestamp, license, attribution, resultType}` plus `_meta["io.modelcontextprotocol/serverInfo"]`. No `ttlMs`/`cacheScope` on a `tools/call` result (report 09 AC-09).

```json
{
  "changes": [
    {
      "rcid": 271828182,
      "rev_id": 1293847560,
      "parent_rev_id": 1293847000,
      "title": "Earth",
      "namespace": 0,
      "type": "edit",
      "timestamp": "2026-11-21T17:19:52Z",
      "user": "ExampleEditor",
      "comment": "copyedit",
      "bot": false,
      "minor": true,
      "sizes": { "old": 150000, "new": 150042, "delta": 42 },
      "url": "https://en.wikipedia.org/wiki/Earth?wprov=afsw1"
    }
  ],
  "count": 1,
  "truncated": false,
  "continuation": {
    "cursor": "~eyJ2IjoxLCJlbmQiOiIyMDI2LTExLTIxVDE3OjIwOjAwWiJ9",
    "expires_at": "2026-11-21T17:25:00Z",
    "hops": 1
  },
  "window": {
    "requested_seconds": 300,
    "seconds": 300,
    "start": "2026-11-21T17:15:00Z",
    "end": "2026-11-21T17:20:00Z",
    "fetched_at": "2026-11-21T17:20:01Z",
    "cache_age_ms": 0
  },
  "applied_limit": 50,
  "warnings": [],
  "source": "wikipedia:en",
  "title": null,
  "revision": null,
  "timestamp": null,
  "license": {
    "title": "Creative Commons Attribution-ShareAlike 4.0 International",
    "short": "CC BY-SA 4.0",
    "url": "https://creativecommons.org/licenses/by-sa/4.0/"
  },
  "attribution": {
    "required": true,
    "text": "Recent changes — Wikipedia contributors, CC BY-SA 4.0",
    "link": "https://en.wikipedia.org/wiki/Special:RecentChanges?wprov=afsw1",
    "disclaimer": "You remain responsible for licence compliance; change titles, users and comments are untrusted external content."
  },
  "resultType": "complete"
}
```

Rules:

- `source` is the resolved project code from the Phase 1 resolver; `attribution.link` is built from that resolver's allowlisted host, never from caller input. `wprov=afsw1` is generated locally (Phase 1 behaviour).
- `rev_id` is upstream `revid`; `parent_rev_id` is upstream `old_revid` or `null` when `0`; `type` is upstream `type` when present, otherwise derived from the flags (`new` when `old_revid === 0`, else `edit`). `timestamp` is normalised to ISO-8601 UTC. `sizes.delta = newlen − oldlen`. `url` is built from the allowlisted host and title.
- `count === changes.length`; `changes.length` never exceeds `applied_limit`. `truncated: true` when the upstream `continue.rccontinue` is present or when the limit was reached, and a warning advises narrowing the window/namespace.
- `window.cache_age_ms` is `fetched_at`-relative; `continuation` is `null` when no further cursor exists. `licence`/`attribution`/`source`/`resultType`/`_meta` are present on **100 %** of results, including empty results (SR-11, report 05 M5).
- `warnings` is always present (`[]` when nothing notable). It carries the fixed untrusted-content label plus any clamp/truncation/freshness warning.

### 3.4 Error envelope and error codes

Identical envelope to Phases 1–5 (`isError: true`):

```json
{
  "error": {
    "code": "stale_window",
    "message": "The cached recent-changes window is older than the freshness limit; it was not served as an empty result.",
    "retryable": true,
    "retry_after_seconds": 1,
    "hint": "Retry with a larger time_window_seconds or a fresh call; do not conclude that no changes occurred.",
    "details": { "cache_age_ms": 130000, "max_cache_age_ms": 120000, "backend": "action-recentchanges" }
  }
}
```

| Code | Retryable | When |
|---|---|---|
| `validation_error` | false | Strict-schema failure: wrong type, unknown field, out-of-schema bound, malformed `change_types`, bad title/project/language shape. |
| `invalid_project` | false | Unresolvable or host-shaped `project`; zero outbound requests (SR-3). |
| `invalid_language` | false | Language code fails validation or allowlist; zero outbound. |
| `invalid_cursor` | false | Cursor unparseable, wrong version, expired, hop count > 10, or filter/window hash mismatch; zero outbound. |
| `stale_window` | true | Cached response older than `RECENT_CHANGES_MAX_CACHE_AGE_MS`; never silently returned as empty. |
| `rate_limited` | true | Upstream 429 after bounded retries; `retry_after_seconds` populated. |
| `upstream_unavailable` | true | Timeout, non-2xx not otherwise mapped, cross-origin redirect, parse failure. |
| `timeout` | true | Non-rate-limit upstream deadline. |
| `internal_error` | true | Unhandled fault; no stack trace or raw upstream body in `message`. |

There is deliberately **no** `page_not_found`, `no_changes` or `eventstream_unavailable` code. `message` never contains a raw upstream 401/429 body, token or credential; every error has a non-empty actionable `hint` (report 09 M6). On 429, honour `Retry-After`; if absent, wait ≥ `RETRY_AFTER_FALLBACK_MS`.

### 3.5 Annotations

`{"readOnlyHint": true, "destructiveHint": false, "openWorldHint": true, "idempotentHint": false}`. `openWorldHint` communicates that wiki data changes over time; `idempotentHint: false` records that the relative window makes repeated identical calls non-deterministic. The tool declares no `x-mcp-header`; an incoming `Mcp-Param-*` is rejected with `-32020` (report 09 AC-17).

### 3.6 Continuation cursor (normative)

`continue` is an opaque `base64url`-encoded JSON object; the `pattern` in §3.2 is its external character contract.

```json
{
  "v": 1,
  "end": "2026-11-21T17:20:00Z",
  "rc": "20261121171952Z|271828182",
  "h": 1,
  "q": "9f2c1a7b4e6d08f3"
}
```

- `v` must be `1`; `end` is the **original** window end (ISO-8601 UTC); `rc` is upstream `continue.rccontinue`; `h` is the hop count; `q` is the first 16 hex characters of SHA-256 over the canonical JSON of `{source, namespace, applied_limit, requested_seconds, include_bots, change_types}`.
- The server recomputes `q` from the current arguments and rejects a mismatch with `invalid_cursor` (zero outbound). This prevents accidental filter mixing between calls; it is **not** a security boundary (recent-change data is public) and needs no new secret.
- `h` must be ≤ `RECENT_CHANGES_MAX_HOPS = 10`; a cursor is expired when `end` is older than `requested_seconds + 300 s`. Both breaches → `invalid_cursor`.
- Each hop is exactly one bounded GET. The server never loops internally to "fill" a page; there is no internal polling thread.

---

## 4. Bounded polling, cache and politeness

### 4.1 Consumption model

1. A tool call resolves the host, clamps the bounds, captures `window_end` and (if `continue` is absent) computes the cache key.
2. On a cache hit within TTL, the server optionally sends `If-None-Match` (one conditional request). HTTP 304 → serve the cached body with `window.fetched_at` unchanged and `cache_age_ms` reported; a freshness warning is added above `RECENT_CHANGES_FRESH_WARN_MS`.
3. On a miss or 200, parse and schema-validate the payload, map fields (§3.3), store the body in the bounded cache, and return.
4. Poll frequency is entirely client-driven. The server never opens a socket to `stream.wikimedia.org`, never subscribes, and never runs a background timer.

### 4.2 Cache key and isolation

Cache key = `SHA-256({source, namespace, applied_limit, requested_seconds bucket, include_bots, change_types, window_end minute bucket})`. Data is public, so cross-tenant reuse is acceptable; however the cache is in-process, per-server-instance, and never persists to disk or chat. Cached values are validated against the upstream shape on read; a malformed cached value is evicted and refetched.

### 4.3 Code constants (not configuration keys)

| Constant | Value | Purpose |
|---|---|---|
| `RECENT_CHANGES_MAX_LIMIT` | 500 | Service cap; above → clamp + `limit_clamped:500` warning. |
| `RECENT_CHANGES_MAX_WINDOW_S` | 86400 | Service cap; above → clamp + `window_clamped:86400` warning. |
| `RECENT_CHANGES_CACHE_TTL_MS` | 60000 | Local TTL (matches both existing recent-changes MCP servers, report 12 §2.1). |
| `RECENT_CHANGES_MAX_CACHE_AGE_MS` | 120000 | Above → `stale_window`; never a silent empty result. |
| `RECENT_CHANGES_FRESH_WARN_MS` | 30000 | Adds a non-fatal freshness warning. |
| `RECENT_CHANGES_CACHE_MAX_ENTRIES` | 256 | LRU eviction; bounded memory (mitigates T-14 without an EventStreams window). |
| `RECENT_CHANGES_CACHE_MAX_BYTES` | 8388608 | 8 MiB aggregate byte cap. |
| `RECENT_CHANGES_MAX_HOPS` | 10 | Hard bound on continuation depth. |

### 4.4 Reused configuration keys — zero new keys

| Key | Use |
|---|---|
| `USER_AGENT` | Required, non-empty, on every outbound call (report 01 §4). |
| `CONCURRENCY_LIMIT` | Global semaphore, > 3 rejected at boot. No second limiter. |
| `HTTP_TIMEOUT_MS`, `RETRY_MAX_ATTEMPTS`, `RETRY_BACKOFF_BASE_MS`, `RETRY_BACKOFF_MAX_MS`, `RETRY_AFTER_FALLBACK_MS` | Shared timeout and bounded jittered backoff. |
| `MAX_RESULT_BYTES` | Final serialised-output cap (default 65536). |
| `METADATA_CACHE_TTL_MS` | Project-code/host resolver cache. |
| `MCP_*`, `LOG_LEVEL` | Unchanged transports, listener, Origin/Host controls, per-request log level. |

**Deliberately absent:** every `EVENTSTREAMS_*`, subscription, write, Enterprise, Lift Wing and Wikifunctions key.

### 4.5 Politeness

100 % of outbound calls carry `USER_AGENT`; global concurrency ≤ 3; 429 is never retried to green — after bounded backoff it becomes `rate_limited` with `retry_after_seconds`. A `Retry-After` header on any response is recorded. No tight polling loop exists in the server. This is within the published 200 req/min compliant-User-Agent tier and is more clearly inside Wikimedia etiquette than a permanent SSE connection with `since=` backfills (report 12 §5; report 01 §4).

---

## 5. Why there is no SSE consumer — decisive

Report 02 §6 says an EventStreams feed is "highly suitable for monitoring" and suggests an internal service; report 05 §2 Group D proposed exactly that. The 2026-11-21 spike (report 12) supersedes that proposal for this build for six independent reasons:

1. **No push demand.** Registry exact-string queries for "recent changes", "recentchange", "eventstreams" and "wikimedia stream" return **0**; no GitHub issue or 2026 blog post asks for sub-minute push. The dedicated recent-changes MCP package has 19 downloads/month. Nobody needs push.
2. **The only two real implementations poll.** Both `io.github.guptaprakhariitr/wikipedia-recent-changes-mcp` ("SSE — not used here; we poll instead", 60 s KV cache) and `ProfessionalWiki/MediaWiki-MCP-Server` (`get-recent-changes`, bounded/paginated) use Action API polling. The larger general server has 9.5k monthly downloads.
3. **It would be a new always-on service.** A consumer needs a 15-minute reconnect cycle, `Last-Event-ID`/`?since=` replay across a 7–31 day horizon, canary-event dropping, schema-drift handling, dedupe, eviction, byte caps and freshness monitoring (report 12 §3.3–§3.4/§5). This server is stateless and behind a plain load balancer.
4. **Protocol mismatch.** MCP 2026-07-28 removed SSE resumability (`Last-Event-ID`, SSE event IDs) and uses a long-lived POST to `subscriptions/listen`. This build advertises no list-changed capability and returns `-32601` (report 03 §3.4; report 09 AC-13). A raw SSE tool is architecturally mismatched.
5. **Cost and trust.** The global firehose is ≈ 33 events/s ≈ 2.8M events/day, with no server-side filtering and fully attacker-influenceable payloads (report 08 T-14). WMF asks small-scale clients to consume the minimum data; an always-on connection plus replay is the cautioned pattern.
6. **Ops burden without benefit.** Memory exhaustion, multi-tenant filtering leakage (T-15), replay gaps and staleness semantics all need runbooks and alerts for a feature with no evidenced demand.

**Reversal triggers (report 12 §6, retained as a watch, not a build item):** reopen as SPIKE-MORE if a concrete user/issue requires true push, or ≥ 2 active registry entries advertise EventStreams tools, or a top-10 Wikimedia MCP repo adds a live SSE tool; keep the registry watch running. None is true on 2026-11-21.

---

## 6. Acceptance criteria AC-120 onward

Each criterion is binary (yes/no). All run on fixtures in the blocking merge gate with request counters asserting "zero live network calls"; the optional D-M3/D-M4 counters are nightly and opt-in. AC-01…AC-119 are re-run unchanged as the regression gate (AC-120).

### A. Registration, schema and annotations

- **AC-120** `tools/list` advertises exactly one new tool, `get_recent_changes`, with a strict JSON Schema (`additionalProperties: false`) and a non-empty description containing the §3.1/§3.2 behaviour. No EventStreams tool, subscription capability, `subscriptions/listen` registration, EventStreams configuration key or streaming process exists; `subscriptions/listen` still returns `-32601`. AC-01…AC-119 pass unchanged over both transports. *(D1/D11; report 09 AC-13; report 12 §6)*
- **AC-121** The schema rejects wrong types, unknown extra keys (including `host`, `api_url`, `token`, `confirmation`), `namespace` −1/16, `time_window_seconds` 59/604801, `limit` 0/100001, non-boolean `include_bots`, and malformed/duplicate `change_types`, each with `validation_error` and zero outbound requests. *(D4/D5; §3.2; SR-1; report 08 T-19)*
- **AC-122** `enwiki`, `wikipedia:en` and `en.wikipedia` resolve to `en.wikipedia`; `commonswiki` resolves to `commons.wikimedia`; a host-shaped or unresolvable `project` returns `invalid_project` with zero outbound requests. *(D3; report 09 §3.1; SR-3; new TC-D-003)*

### B. Backend, mapping and bounds

- **AC-123** **TC-D-001 (fixture):** exactly one GET to `https://en.wikipedia.org/w/api.php?action=query&format=json&list=recentchanges&rcprop=title%7Cids%7Cuser%7Ctimestamp%7Ccomment%7Csizes%7Cflags&rcnamespace=0&rclimit=50&rcstart=2026-11-21T17%3A20%3A00Z&rcend=2026-11-21T17%3A15%3A00Z&rcshow=%21bot`, with `USER_AGENT`; no DNS lookup or connection to `stream.wikimedia.org`; no SSE/NDJSON code path is executed. *(D2/D12; §3.1; TC-D-001)*
- **AC-124** **TC-D-002 (fixture):** `limit: 10000` yields `applied_limit: 500` and `time_window_seconds: 86400` yields `window.seconds: 86400`, both with named warnings; `changes.length ≤ applied_limit`; no unbounded result set; values above the schema ceilings are rejected with zero outbound. *(D4/D5; §3.2; TC-D-002)*
- **AC-125** Each upstream item maps to `changes[]` with `rcid`, `rev_id` (from `revid`), `parent_rev_id`, `title`, `namespace`, `type`, ISO-8601 `timestamp`, `user`, `comment`, `bot`, `minor`, `sizes{old,new,delta}` and an `url` built from the allowlisted host; `count === changes.length`; a prompt-injection canary in `comment`/`title` is returned verbatim as `untrusted_content` data and triggers no tool call. *(§3.3; D9; TC-D-001; new TC-D-008)*

### C. Empty results, freshness, continuation and cache

- **AC-126** An empty upstream response returns `changes: []`, `count: 0`, `truncated: false`, `continuation: null`, `resultType: "complete"` and full provenance — never `no_changes` or `page_not_found`. A cached response older than `RECENT_CHANGES_MAX_CACHE_AGE_MS` returns retryable `stale_window`, never a silent empty result. *(D7; new TC-D-004)*
- **AC-127** A returned cursor is opaque, filter-bound, carries a frozen `end` and `h ≤ 10`; passing it back unchanged performs exactly one further bounded GET; a mutated/expired/unparseable cursor or mismatched filter hash returns `invalid_cursor` with zero outbound requests; no internal polling loop exists. *(D6; §3.6; new TC-D-005)*
- **AC-128** Cache TTL is 60 s, capacity ≤ 256 entries and ≤ 8 MiB; a repeat call within TTL makes at most one conditional `If-None-Match` request and reports `cache_age_ms`; a 429 after bounded retries yields `rate_limited` with `retry_after_seconds`; 100 % of outbound calls carry `USER_AGENT` and concurrency ≤ 3. *(D12; §4; report 01 §4; new TC-D-006)*

### D. Provenance, errors, transport and gates

- **AC-129** 100 % of results carry `source`, `license` (CC BY-SA 4.0), `attribution`, `resultType` and `_meta` with `title`/`revision`/`timestamp` as `null`, never fabricated; every error has non-empty `code`/`message`, boolean `retryable`, non-empty `hint` and `details`, with no raw upstream body or token in `message`; the contract passes over stdio and Streamable HTTP including `Mcp-Name` validation; no `tools/call` result carries `ttlMs`/`cacheScope`; the tool does not feed any existing nightly gate. *(D8/D10/D11; §3.3–§3.5; §5; SR-11; new TC-D-007)*

### 6.1 CI placement

AC-120…AC-129 are blocking merge gates (deterministic on fixtures). No live network call occurs in the merge gate. The optional `D-M3`/`D-M4` counters, if enabled, are nightly only and never alter M1–M6, B-M3/B-M4, CF-M3/CF-M4 or G5-M3/G5-M4.

---

## 7. Corpus cases

### 7.1 Existing cases (mapped, unchanged)

| Case | Tool | Covered by |
|---|---|---|
| TC-D-001 | `get_recent_changes` (fixture, `enwiki`, namespace 0, window 300 s, limit 10; note superseded per §1.3) | AC-123, AC-125, AC-129 — requires `changes[0].title`/`timestamp`/`rev_id`, `window`, `_meta` |
| TC-D-002 | `get_recent_changes` (fixture, `limit: 10000`, window 86 400 s) | AC-124 — requires `changes`, `applied_limit`, `window`, `_meta` |

### 7.2 New cases to add to `test-corpus.json` (all `mode: fixture`)

| Case | Tool | Purpose | Criterion |
|---|---|---|---|
| TC-D-003 | `get_recent_changes` | `enwiki`/`wikipedia:en`/`en.wikipedia` resolve to `en.wikipedia`; host-shaped `project` → `invalid_project`, zero outbound | AC-122 |
| TC-D-004 | `get_recent_changes` | Empty upstream → `changes: []`, `count: 0`, success + provenance; separate stale-cache case → `stale_window` | AC-126 |
| TC-D-005 | `get_recent_changes` | Valid cursor → one bounded further GET; mutated filter, expired `end`, `h = 11`, malformed cursor → `invalid_cursor`, zero outbound | AC-127 |
| TC-D-006 | `get_recent_changes` | Repeat within 60 s → ≤ 1 `If-None-Match` GET and `cache_age_ms` reported; separate 429 + `Retry-After` case → `rate_limited` | AC-128 |
| TC-D-007 | `get_recent_changes` | Provenance/error sweep: 100 % `license`/`attribution`/`source`/`resultType`/`_meta`; one malformed error has no token or raw upstream body | AC-129 |
| TC-D-008 | `get_recent_changes` | Injection canary in `comment` and `title` returned verbatim as untrusted data; no tool call, no instruction executed, no token disclosed | AC-125 |

TC-D-001/TC-D-002 fixtures must not be altered; new cases are additive. Adding a case does not change this frozen tool contract.

---

## 8. Change log and status

| Version | Date | Change |
|---|---|---|
| 6.1.0 | 2026-11-21 | **Bug-fix only (restores intended behaviour; no new semantic).** Reversed `rcstart`/`rcend` on the wire so `rcstart` = window end (newer) and `rcend` = window start (older), matching MediaWiki backwards enumeration. v6.0.0 order returned empty live `changes[]`. Updated §3.1 URL pattern, the TC-D-001 concrete URL, AC-123 and the implementation/tests. No tool name, input/output field, bound, cursor, cache, provenance, error code or AC number changed; AC-01…AC-119 unchanged.
| 6.0.0 | 2026-11-21 | Initial frozen Group D contract: one bounded read-only `get_recent_changes` tool over Action API polling; strict schema with documented clamping; cursor, ETag cache and freshness bounds; full provenance; AC-120…AC-129; six new corpus cases. EventStreams consumer explicitly dropped per report 12 §6. |

**Status: FROZEN — ready for implementation.** Group D is one stateless, read-only tool only. There is no EventStreams consumer, no SSE stream, no rolling window, no subscription capability and no new configuration key. No nightly gate is affected. Reports 09 v1.0.1, 10 v2.0.0, 11 v3.0.0 and 13 v5.0.0 and AC-01…AC-119 are unchanged.

*End of Group D implementation contract — version 6.1.0.*
