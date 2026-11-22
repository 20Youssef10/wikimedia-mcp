# Phase 2 Implementation Contract — Unified Wikimedia MCP Server (Group B — Wikidata)

**Document version:** 2.0.0 (frozen)  
**Date:** 2026-11-21  
**Language:** en-GB  
**Target protocol:** MCP 2026-07-28 (unchanged from Phase 1)  
**Status:** FROZEN — ready for implementation (read-only Phase 2)

> This contract closes Phase 2 of the roadmap in report 05 §7: Group B (Wikidata) only. It extends, and does not replace, the frozen Phase 1 contract in `09-implementation-contract.md` (v1.0.1). Every protocol convention, error-envelope rule, transport rule, configuration key, annotation convention and acceptance criterion from Phase 1 (AC-01…AC-32) remains in force unchanged. Research basis: reports 02 §7, 03, 05 §2/§7/§10, 06 §3/§5, 07, 08 §5.5/§6 (SR-1…SR-12), 09, and `test-corpus.json` cases TC-B-001…TC-B-008.

---

## 1. Scope and boundary

### 1.1 In scope

Six read-only Group B tools, with the exact names from report 05 §2:

1. `wikidata_search_entities`
2. `wikidata_get_entity`
3. `wikidata_get_statements`
4. `wikidata_get_sitelinks`
5. `wikidata_resolve_external_id`
6. `wikidata_sparql_query`

Also in scope: the Group B provenance/licence block (§3.2), the Group B error codes (§3.3), the SPARQL safety pipeline (§4), the external-ID resolution map (§6), a separate Group B load profile (§9), and binary acceptance criteria AC-33…AC-59 (§10).

### 1.2 Out of scope (decided)

- **Enterprise data APIs (Group E).** No paid subscription exists; unchanged from report 09 §6. No Enterprise tool, token, credential or quota appears in Phase 2.
- **All write tools (Group G).** `edit_page`, `upload_file`, statement edits and every other mutating operation remain disabled. No write-capable code path is registered. This keeps the threat-model write gates (report 08 §6.2) untouched.
- **Groups C, D, F.** Metrics, the EventStreams spike and Commons/Attribution remain later phases.
- **New MCP resources or prompts.** Decision and rationale in §8.
- **New SPARQL/endpoint configuration keys.** Phase 1 already defines every key needed; see §3.5.

### 1.3 Relationship to Phase 1 — reuse, do not duplicate

| Phase 1 artifact | Phase 2 treatment |
|---|---|
| `WIKIDATA_SPARQL_*` keys (8 keys, report 09 §2.6) | **Reused as-is.** No `WDQS_*` alias, no replacement key, no second setting for endpoint, accept header, timeout, max rows or max query length. `src/upstream/wikidata-sparql.ts` (day-1 stub) is completed, not duplicated. |
| `CONCURRENCY_LIMIT`, `USER_AGENT`, `HTTP_TIMEOUT_MS`, `RETRY_*`, `RETRY_AFTER_FALLBACK_MS`, `MAX_RESULT_BYTES`, `METADATA_CACHE_TTL_MS` | Reused for Group B too, with the WDQS-specific override in §9.3 implemented as a nested semaphore, not a new env key. |
| `tools/registry.ts`, Zod schemas, `z.toJSONSchema()`, annotations | Six tools are **added** to the existing registry; no new registry implementation. |
| Protocol layer (`_meta`, headers, `-32020`/`-32022`/`-32021`, result envelope, caching module, error mapper) | Unchanged. Group B uses the same layers. |
| AC-01…AC-32 and the Phase 1 nightly gate | Unchanged. AC-32 is re-run after registration to prove no regression (AC-59). |
| Static complexity constants (§4.3), external-ID property map (§6.1), site allowlist (§5.4) | Version-controlled code constants, code-reviewed under SR-1/SR-12. **Not** exported as new env keys. |

### 1.4 Change control

Any rename, removal or semantic change to a tool name, required parameter, output field name, error code, SPARQL guard constant or the endpoint-fallback order requires a **new major contract version**, plus matching updates to `test-corpus.json` and AC-33…AC-59. Additive optional output fields may be a minor version. Flipping `WIKIDATA_SPARQL_PREFER_V2` or editing `WIKIDATA_SPARQL_FALLBACKS` is a deployment/configuration change recorded in the change log — **not** a contract version bump, because those keys are part of the frozen Phase 1 surface.

---

## 2. Decisions closed

| # | Decision | Choice | Basis |
|---|---|---|---|
| D1 | Tool list | Exactly the six names in §1.1; no `get_item_labels`, no separate `wikidata_get_claims` | report 05 §2 Group B |
| D2 | Backends | Wikibase REST for items/statements/sitelinks/search; WDQS for `wikidata_sparql_query` and **both** modes of `wikidata_resolve_external_id` | report 02 §7; report 05 §7 |
| D3 | SPARQL query shape | **SELECT-only**, single statement; `DESCRIBE`/`ASK`/`CONSTRUCT`/update verbs rejected | SR-1, SR-10, report 08 §5.5 |
| D4 | LIMIT policy | **Mandatory LIMIT injection**: a top-level LIMIT is always present in the outgoing query; absent → injected, oversized → clamped, caller `limit` overrides inline | task decision; report 08 §5.5 |
| D5 | Complexity guard | Hard caps + a score, evaluated locally before any outbound request; breach → `query_too_complex` with `error.limits` | SR-10; TC-B-006 |
| D6 | Timeout | `timeout_ms` 1000…60000, default `WIKIDATA_SPARQL_TIMEOUT_MS` (60000); client abort cancels upstream fetch | report 06 §5.1 |
| D7 | WDQS concurrency | Dedicated `p-limit(min(2, CONCURRENCY_LIMIT))` nested inside the unchanged global `p-limit(3)` | report 06 §5.1; SR-4; AC-26 |
| D8 | 429 / 503 | **Stay and retry** on the same endpoint, honour `Retry-After`, never switch; other 5xx/401/403/404/timeout → switch endpoint | report 06 §5.2 |
| D9 | External-ID schemes | `doi`, `pmid`, `orcid`, `openalex`, `imdb` with the property map in §6.1 | report 06 §3.2 demand evidence |
| D10 | Statements rank | `all` (preferred → normal → deprecated) or an exact rank filter; paging via `offset`/`limit` | TC-B-004; report 03 §5.6 |
| D11 | Language fallback | Explicit `languages` array overrides `language`; entity-value label decoration is opt-in and bounded (≤1 batched WDQS call, ≤10 targets) | §7.2 |
| D12 | Resource/prompt | **None in Phase 2**; query examples live in the tool description and server instructions | report 03 §4/§5; SR-12 |
| D13 | Load profile | Separate Class W and Class Q budgets; never folded into Phase 1 M3/M4; Phase 1 nightly gate unchanged | report 06 §2.4; report 09 §4.3 |

---

## 3. Shared conventions (Phase 2)

### 3.1 Backends and concrete URL patterns

| Backend | Base | Used by |
|---|---|---|
| Wikibase REST API v1 | `https://www.wikidata.org/w/rest.php/wikibase/v1` | `wikidata_search_entities`, `wikidata_get_entity`, `wikidata_get_statements`, `wikidata_get_sitelinks` |
| WDQS SPARQL | `WIKIDATA_SPARQL_ENDPOINT` (default `https://query.wikidata.org/sparql`) | `wikidata_sparql_query`, `wikidata_resolve_external_id` |

Exact paths (verified against the live `GET /w/rest.php/wikibase/v1/openapi.json`, Wikibase REST v1.6 on 2026-11-21):

| Operation | Pattern |
|---|---|
| Item search | `GET {wbRest}/search/items?q={encodedQuery}&language={lang}&limit={n}&offset={n}` |
| Get item | `GET {wbRest}/entities/items/{qid}?_fields=type,labels,descriptions,aliases,statements,sitelinks` (field list narrowed per call) |
| Item statements | `GET {wbRest}/entities/items/{qid}/statements?property={pid}` |
| Item sitelinks | `GET {wbRest}/entities/items/{qid}/sitelinks` |
| Language-fallback label | `GET {wbRest}/entities/items/{qid}/labels_with_language_fallback/{language}` (used only where §7.2 permits) |
| SPARQL | `GET {endpoint}?query={encodedQuery}&format=json` with `Accept: application/sparql-results+json` from `WIKIDATA_SPARQL_ACCEPT` |

Notes:

- QIDs match `^Q[1-9][0-9]{0,9}$`; PIDs match `^P[1-9][0-9]{0,9}$`. Both are validated before path interpolation. Never concatenate raw caller strings into a URL.
- Wikibase REST returns `ETag` (entity revision number) and `Last-Modified` on 200; map them to provenance `revision` and `timestamp`. Use `If-None-Match` on repeat lookups within a run; a 304 is a cache hit, not an error.
- The `HEAD` method on the SPARQL endpoint must **not** be used as a health check (report 06 §2.3: it timed out at 20 s while GET worked).
- Every outbound request carries the configured non-empty `USER_AGENT` (SR-4 / AC-25).

### 3.2 Shared Wikidata provenance block

Wikidata structured data is **CC0 1.0**. All six tools return the same top-level provenance fields as Phase 1 (report 09 §3.1); `required` is `false` because CC0 does not legally compel attribution, but the fields are always present for traceability (SR-11). Canonical example:

```json
{
  "source": "wikidata",
  "qid": "Q42",
  "revision": 2293994012,
  "timestamp": "2026-11-20T09:14:22Z",
  "license": {
    "title": "Creative Commons CC0 1.0 Universal Public Domain Dedication",
    "short": "CC0 1.0",
    "url": "https://creativecommons.org/publicdomain/zero/1.0/"
  },
  "attribution": {
    "required": false,
    "text": "Wikidata contributors — CC0 1.0",
    "link": "https://www.wikidata.org/wiki/Q42",
    "disclaimer": "Wikidata structured data is CC0 1.0; linked-site content and media retain their own licences."
  }
}
```

Rules:

- List results (`wikidata_search_entities`, `wikidata_sparql_query`) set `qid: null`, `revision: null`; SPARQL results set `source: "wikidata:sparql"` and put the exact endpoint used in an `endpoint` field.
- `wikidata_sparql_query` sets `attribution.link` to a WDQS query URL built from the endpoint plus the fully encoded **effective** query (after LIMIT injection), so the caller can reproduce the result.
- Wikibase REST entity results take `revision`/`timestamp` from `ETag`/`Last-Modified`; where absent, both are `null`. Never fabricate a revision.
- Content returned by these tools is **untrusted external data** (report 08 A3). It is never interpreted as instructions (SR-2).

### 3.3 Shared error envelope and Group B error codes

Same envelope as Phase 1 (report 09 §3.1), with one additive optional field, `limits`, used by SPARQL guard errors so TC-B-006's `required_fields` (`error.code`, `error.message`, `error.limits`) are satisfied:

```json
{
  "error": {
    "code": "entity_not_found",
    "message": "No Wikidata item with ID 'Q9999999999' exists.",
    "retryable": false,
    "retry_after_seconds": null,
    "hint": "Check the QID, or call wikidata_search_entities({ query: '...' }) to find one.",
    "details": { "http_status": 404, "backend": "wikibase-rest-v1" }
  }
}
```

Group B error codes (superset of Phase 1):

| Code | Retryable | When |
|---|---|---|
| `validation_error` | false | Strict-schema failure (wrong type, missing required, out-of-range, extra field) |
| `invalid_qid` | false | QID fails `^Q[1-9][0-9]{0,9}$` |
| `invalid_property` | false | PID fails `^P[1-9][0-9]{0,9}$` |
| `invalid_language` | false | Language/s site code fails validation or the allowlist |
| `invalid_site` | false | Sitelink site code not in the allowlist (TC-B-014) |
| `invalid_external_id` | false | Identifier fails the scheme's format rule |
| `unsupported_scheme` | false | Scheme not in the §6.1 allowlist; hint lists the allowed schemes |
| `entity_not_found` | false | Wikibase REST 404 for a QID |
| `external_id_not_found` | false | Valid identifier, zero matches; hint suggests format/scheme checks |
| `invalid_query` | false | Non-SELECT, multiple statements, forbidden `SERVICE <iri>`, or malformed SPARQL |
| `query_limit_required` | false | Inline LIMIT is malformed or non-positive |
| `query_too_complex` | false | Length/complexity cap breach; **must** carry `error.limits` |
| `query_timeout` | true | Client-side abort at `timeout_ms`; action: simplify query or change timeout (≤60000) |
| `rate_limited` | true | 429 after bounded retries; `retry_after_seconds` populated |
| `upstream_unavailable` | true | 401/403/404-fallback-exhausted/5xx/parse failure; action names the endpoint class, never a token |
| `timeout` | true | Non-SPARQL upstream timeout |
| `internal_error` | true | Unhandled fault; no stack trace or raw upstream body in `message` |

Rules: `message` never contains a raw HTTP 401/429 body, token, credential or the literal endpoint failure text from a 403 `Unauthorized User-Agent` response; it always contains a non-empty `action`/`hint` that the model can follow (AC-24, M6). Empty result sets are **success**, never `*_not_found` (report 09 §3.2 convention).

### 3.4 Annotations

All six tools: `{"readOnlyHint": true, "destructiveHint": false, "openWorldHint": true, "idempotentHint": true}`. `wikidata_sparql_query` is `idempotentHint: true` because it is a pure read: the same effective query has no side effects (the endpoint's data may change over time, which is what `openWorldHint` communicates). No tool declares `x-mcp-header`; no `Mcp-Param-*` is accepted (report 09 AC-17).

### 3.5 Configuration keys — reuse only

The following Phase 1 keys (report 09 §2.6) are the complete configuration surface for Phase 2. **No key is added.**

| Key | Phase 2 use |
|---|---|
| `WIKIDATA_SPARQL_ENDPOINT` | Primary SPARQL endpoint; default `https://query.wikidata.org/sparql` |
| `WIKIDATA_SPARQL_ENDPOINT_V2` | Optional QLever endpoint `https://query-next.wikidata.org/sparql` |
| `WIKIDATA_SPARQL_FALLBACKS` | Ordered alternates for the fallback chain (§4.7) |
| `WIKIDATA_SPARQL_PREFER_V2` | Puts `_V2` first in the chain when `true`; default `false` |
| `WIKIDATA_SPARQL_ACCEPT` | `Accept` header, default `application/sparql-results+json` (valid on v1 and v2) |
| `WIKIDATA_SPARQL_TIMEOUT_MS` | Default SPARQL deadline, default `60000`, must be ≤ 60000 |
| `WIKIDATA_SPARQL_MAX_ROWS` | Hard row/LIMIT cap, default `1000` |
| `WIKIDATA_SPARQL_MAX_QUERY_LENGTH` | Query-length cap, default `10000` |
| `USER_AGENT`, `CONCURRENCY_LIMIT`, `HTTP_TIMEOUT_MS` | Shared outbound identity, global semaphore, generic timeout |
| `RETRY_MAX_ATTEMPTS`, `RETRY_BACKOFF_BASE_MS`, `RETRY_BACKOFF_MAX_MS`, `RETRY_AFTER_FALLBACK_MS` | Shared bounded retry/backoff for 429/503 (§4.7) |
| `MAX_RESULT_BYTES` | Serialised result byte cap, default `65536` |
| `METADATA_CACHE_TTL_MS` | Entity/ETag cache; SPARQL result cache TTL is `min(300000, METADATA_CACHE_TTL_MS)` as a derived constant |
| `MCP_*`, `LOG_LEVEL` | Unchanged transport and logging behaviour |

Boot-time validation: `WIKIDATA_SPARQL_TIMEOUT_MS > 60000`, non-positive `WIKIDATA_SPARQL_MAX_ROWS` / `_MAX_QUERY_LENGTH`, and an empty primary endpoint terminate startup (same fail-fast rule as Phase 1).

---

## 4. SPARQL safety policy (normative)

This section is the authoritative implementation of report 08 §5.5 (T-07 / SR-10) and report 06 §5.2. The pipeline runs **locally, in this exact order, before any outbound request**. A failure at any stage returns immediately with `isError: true`; no partial query is ever sent.

### 4.1 Stage 1 — schema validation

`query` must be a string with `1 ≤ length ≤ WIKIDATA_SPARQL_MAX_QUERY_LENGTH` after trimming. `timeout_ms`, `limit` are integers within the bounds in §5.6. Unknown fields are rejected (strict object). Breach → `validation_error`; query longer than the cap → `query_too_complex` with `error.limits`.

### 4.2 Stage 2 — read-only / SELECT-only enforcement

After stripping comments (`#` to end of line) and string literals (replaced by a placeholder of equal length so offsets stay stable):

1. Exactly **one** SPARQL statement (no second query separated by `;`).
2. The first non-`PREFIX`/`BASE` keyword must be `SELECT`. `DESCRIBE`, `ASK`, `CONSTRUCT` and update forms (`INSERT`, `DELETE`, `LOAD`, `CLEAR`, `CREATE`, `DROP`, `COPY`, `MOVE`, `ADD`, `WITH`) are rejected with `invalid_query`.
3. `SERVICE wikibase:label` is allowed. Any other `SERVICE <iri>` (including a relative or variable IRI) is rejected with `invalid_query` — this is an SSRF and data-exfiltration defence (SR-3).
4. Token-based detection only: a keyword inside a quoted literal or IRI must not trigger rejection.

### 4.3 Stage 3 — complexity heuristic

Count on the comment/string-stripped query. All caps are code constants, code-reviewed under SR-12:

| Metric | Cap |
|---|---|
| Triple patterns | 50 |
| `UNION` clauses | 5 |
| `OPTIONAL` nesting depth | 3 |
| Property paths (`+`, `*`, `?`, `{n}`, `{n,m}`) | 3 |
| `FILTER` clauses | 20 |
| Subquery depth (`SELECT` inside braces) | 2 |
| Complexity score = `patterns + 3×UNION + 2×OPTIONAL + 2×propertyPaths + FILTER` | 40 |

Any breach → `query_too_complex` with a non-empty `error.limits` object containing every threshold, every observed value, and the offending metric names. This is what rejects **TC-B-006** (10 `UNION` branches) before any network call.

### 4.4 Stage 4 — mandatory LIMIT injection

The outgoing query always contains exactly one top-level `LIMIT`. Procedure:

1. Find the **terminal** top-level `LIMIT <non-negative integer>` (after any `OFFSET`, before the optional final `}` of the outer pattern).
2. Determine the effective limit `E`:
   - `limit` parameter supplied → `E = min(limit, WIKIDATA_SPARQL_MAX_ROWS)`; rewrite the terminal LIMIT value to `E` (or inject if absent). Non-positive/inline malformed LIMIT → `query_limit_required`.
   - `limit` not supplied, inline LIMIT present → `E = min(inline, WIKIDATA_SPARQL_MAX_ROWS)`; keep it unchanged when already within cap.
   - neither supplied → `E = min(100, WIKIDATA_SPARQL_MAX_ROWS)`; append ` LIMIT E` at the end of the query.
3. Clamping an oversized inline LIMIT is non-fatal: add `"inline LIMIT clamped to <E>"` to the result `warnings` array.
4. If no terminal LIMIT exists but a non-terminal one does (e.g. only inside a subquery), treat it as absent for the outer query and inject at the end.
5. Record `effective_limit: E` in the output.

This preserves TC-B-005's inline `LIMIT 5` (so `results.bindings.length ≤ 5`) while guaranteeing no unbounded query reaches WDQS.

### 4.5 Stage 5 — timeout and concurrency

- Effective deadline `D = min(timeout_ms ?? WIKIDATA_SPARQL_TIMEOUT_MS, 60000)`; never above 60 s (report 06 §5.1).
- Wire an `AbortSignal` from the SDK tool context plus a timer for `D` into `undici.fetch`. On abort: cancel the fetch, release the WDQS semaphore slot, and return `query_timeout` with an actionable `action`.
- Acquire the WDQS semaphore `p-limit(min(2, CONCURRENCY_LIMIT))` **nested inside** the global `p-limit(CONCURRENCY_LIMIT)`; WDQS concurrency ≤ 2, global outbound ≤ 3 (AC-26 preserved).
- Identical effective queries (endpoint + query + limit + accept) use the in-process LRU cache with TTL `min(300000, METADATA_CACHE_TTL_MS)` (report 08 §5.5 "cache identical queries"). Cache keys never include credentials (none exist in Phase 2).

### 4.6 Stage 6 — result caps and portable parsing

- Response must be standard **SPARQL 1.1 Query Results JSON**: `head.vars` (array of strings) and `results.bindings` (array of objects). Each binding value is `{type, value, datatype?, lang?}` with `type ∈ {uri, literal, bnode, typed-literal}` as returned by the endpoint.
- Parse without assuming any Blazegraph-only field. Normalise every value to `{type, value, datatype (or null), lang (or null)}` and expose `vars` from `head.vars`.
- Enforce rows ≤ `E` (truncate deterministically, preserve first `E` in upstream order) and serialised bytes ≤ `MAX_RESULT_BYTES` (truncate at a binding boundary, never mid-token). Either truncation sets `truncated: true` and appends a warning.
- A non-JSON body, wrong shape, or a parse exception returns a single `upstream_unavailable` with `details.parse_error` — no uncaught exception, no partial result (TC-B-025).

### 4.7 Stage 7 — endpoint chain, 429/503 and error surfacing

Build the ordered chain from configuration: `WIKIDATA_SPARQL_PREFER_V2 ? [V2, PRIMARY, ...FALLBACKS] : [PRIMARY, V2, ...FALLBACKS]`, de-duplicated, and validate every URL is `https:` at boot (SR-3).

| Upstream result | Action | Final error if all attempts fail |
|---|---|---|
| `403` with body containing `Unauthorized User-Agent` | Advance to next endpoint (v2 is gated today — report 06 §5.1) | `upstream_unavailable` |
| `401` | Advance to next endpoint | `upstream_unavailable` |
| `404` | Advance to next endpoint | `upstream_unavailable` |
| `5xx` **except 503** | Advance to next endpoint | `upstream_unavailable` |
| Timeout (deadline reached) | Advance to next endpoint if budget remains | `query_timeout` |
| **`429`** | **Stay on the same endpoint.** Honour `Retry-After`; if absent wait ≥ `RETRY_AFTER_FALLBACK_MS`; jittered backoff bounded by `RETRY_MAX_ATTEMPTS`. Never switch. | `rate_limited`, `retryable: true`, `retry_after_seconds` set |
| **`503`** | **Stay on the same endpoint.** Same Retry-After/backoff treatment as 429. Never switch. | `upstream_unavailable`, `retryable: true`, `retry_after_seconds` set |
| Redirection | Do not follow cross-origin redirects; treat as `upstream_unavailable` with the endpoint class named | `upstream_unavailable` |

A `429`/`503` that eventually succeeds returns a normal result plus a non-fatal `warnings` entry recording the retry count. Exhaustion produces the terminal error above. The `endpoint` output field always names the endpoint that actually answered, so operators can see a fallback occurred.

---

## 5. Tool contracts (normative)

Every INPUT schema below is strict (`additionalProperties: false`), includes defaults and bounds, and is advertised verbatim in `tools/list` via `z.toJSONSchema()`. Every OUTPUT example omits the full `license`/`attribution` objects for brevity except where first shown — **the implementation must emit the complete §3.2 provenance block on every result**. Every result also carries `resultType: "complete"` and `_meta["io.modelcontextprotocol/serverInfo"]` from the shared layer.

### 5.1 `wikidata_search_entities`

**Purpose.** Find Wikidata items by label/alias full-text search; return QIDs, labels and descriptions in one call.

**Backend.** `GET {wbRest}/search/items?q={encodedQuery}&language={lang}&limit={n}&offset={n}`. Upstream `{results:[{id, display-label:{language,value}|null, description:{language,value}|null, match}]}` is mapped to the output below. Empty hits → success with `results: []`.

**INPUT**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "description": "Label or alias text to search for (e.g. 'Ada Lovelace')."
    },
    "language": {
      "type": "string",
      "default": "en",
      "minLength": 2,
      "maxLength": 12,
      "pattern": "^[a-z]{2}[a-z0-9-]*$",
      "description": "Language whose labels/descriptions are preferred."
    },
    "limit": {
      "type": "integer",
      "default": 10,
      "minimum": 1,
      "maximum": 50,
      "description": "Maximum hits; hard cap 50."
    },
    "offset": {
      "type": "integer",
      "default": 0,
      "minimum": 0,
      "maximum": 10000,
      "description": "Zero-based offset mapped to the upstream offset parameter."
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

**OUTPUT example** (TC-B-001, truncated provenance)

```json
{
  "query": "Ada Lovelace",
  "language": "en",
  "results": [
    {
      "qid": "Q7259",
      "label": "Ada Lovelace",
      "description": "English mathematician and writer",
      "url": "https://www.wikidata.org/wiki/Q7259"
    }
  ],
  "total_hits": 1,
  "next_offset": null,
  "source": "wikidata",
  "qid": null,
  "revision": null,
  "timestamp": null,
  "license": { "short": "CC0 1.0" },
  "attribution": { "required": false, "text": "Wikidata contributors — CC0 1.0" },
  "resultType": "complete"
}
```

**Errors.** `validation_error`, `invalid_language`, `rate_limited`, `upstream_unavailable`, `timeout`, `internal_error`.

**Annotations.** `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`.

---

### 5.2 `wikidata_get_entity`

**Purpose.** Return one item's labels, descriptions, aliases, claims and sitelinks with language projection and deterministic size bounds.

**Backend.** `GET {wbRest}/entities/items/{qid}?_fields=...`. The `_fields` list is exactly the requested `fields` plus `type`; `statements` is requested only when claims are included. This is mandatory: an unbounded Q42 item is ~211 KB and triggered immediate 429s in report 06 §2.2. `ETag`/`Last-Modified` feed provenance.

**INPUT**

```json
{
  "type": "object",
  "properties": {
    "qid": {
      "type": "string",
      "pattern": "^Q[1-9][0-9]{0,9}$",
      "description": "Wikidata item ID, e.g. Q42."
    },
    "language": {
      "type": "string",
      "default": "en",
      "minLength": 2,
      "maxLength": 12,
      "pattern": "^[a-z]{2}[a-z0-9-]*$",
      "description": "Primary language for label/description projection; used when 'languages' is omitted."
    },
    "languages": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 2,
        "maxLength": 12,
        "pattern": "^[a-z]{2}[a-z0-9-]*$"
      },
      "minItems": 1,
      "maxItems": 20,
      "description": "Explicit language list; overrides 'language'. Enables one-call multi-language projection (TC-B-003)."
    },
    "fields": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["labels", "descriptions", "aliases", "claims", "sitelinks"]
      },
      "default": ["labels", "descriptions", "claims", "sitelinks"],
      "minItems": 1,
      "maxItems": 5,
      "description": "Sections to return. 'claims' maps from the REST 'statements' field."
    },
    "max_statements_per_property": {
      "type": "integer",
      "default": 10,
      "minimum": 1,
      "maximum": 50,
      "description": "Statement cap per property; deterministic first-N by upstream order."
    },
    "max_properties": {
      "type": "integer",
      "default": 50,
      "minimum": 1,
      "maximum": 200,
      "description": "Property cap for the claims object; deterministic first-N by property ID."
    }
  },
  "required": ["qid"],
  "additionalProperties": false
}
```

**OUTPUT example** (TC-B-002/003, truncated provenance and claims)

```json
{
  "qid": "Q42",
  "url": "https://www.wikidata.org/wiki/Q42",
  "labels": { "en": "Douglas Adams", "de": "Douglas Adams", "fr": "Douglas Adams" },
  "descriptions": { "en": "English writer and humorist" },
  "aliases": {},
  "claims": {
    "P569": [
      {
        "id": "Q42$8C9E1F2B-4D5A-4C6E-9B0F-1A2D3E4F5A6B",
        "rank": "normal",
        "value": { "type": "value", "content": { "time": "+1952-03-11T00:00:00Z", "precision": 11 } }
      }
    ]
  },
  "sitelinks": {
    "enwiki": { "title": "Douglas Adams", "url": "https://en.wikipedia.org/wiki/Douglas_Adams", "badges": [] }
  },
  "languages_requested": ["en", "de", "fr"],
  "truncated": false,
  "source": "wikidata",
  "revision": 2293994012,
  "timestamp": "2026-11-20T09:14:22Z",
  "license": { "short": "CC0 1.0" },
  "attribution": { "required": false, "text": "Wikidata contributors — CC0 1.0" },
  "resultType": "complete"
}
```

`labels`/`descriptions` contain only requested languages that exist; aliases are omitted from `_fields` unless requested, in which case `aliases` is `{lang: [alias, ...]}`. `truncated: true` when either cap bit. The field is always named `claims` (corpus contract), never `statements`.

**Errors.** `invalid_qid`, `invalid_language`, `entity_not_found`, `upstream_unavailable`, `timeout`, `rate_limited`, `internal_error`.

**Annotations.** `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`.

---

### 5.3 `wikidata_get_statements`

**Purpose.** Return statements for one property of one item, filtered by rank, optionally decorated with bound entity labels, with deterministic paging.

**Backend.** `GET {wbRest}/entities/items/{qid}/statements?property={pid}` — the REST v1.6 endpoint supports the `property` filter natively (verified in the live OpenAPI document). Optional label decoration uses one WDQS template query (§7.2).

**INPUT**

```json
{
  "type": "object",
  "properties": {
    "qid": {
      "type": "string",
      "pattern": "^Q[1-9][0-9]{0,9}$",
      "description": "Wikidata item ID."
    },
    "property": {
      "type": "string",
      "pattern": "^P[1-9][0-9]{0,9}$",
      "description": "Property ID, e.g. P569 (date of birth)."
    },
    "rank": {
      "type": "string",
      "default": "all",
      "enum": ["all", "preferred", "normal", "deprecated"],
      "description": "'all' returns every statement ordered preferred, normal, deprecated; other values filter exactly."
    },
    "languages": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 2,
        "maxLength": 12,
        "pattern": "^[a-z]{2}[a-z0-9-]*$"
      },
      "default": ["en"],
      "minItems": 1,
      "maxItems": 20,
      "description": "Language priority for optional label decoration."
    },
    "limit": {
      "type": "integer",
      "default": 50,
      "minimum": 1,
      "maximum": 200,
      "description": "Page size; hard cap 200."
    },
    "offset": {
      "type": "integer",
      "default": 0,
      "minimum": 0,
      "maximum": 10000,
      "description": "Zero-based offset after rank ordering."
    },
    "include_qualifiers": {
      "type": "boolean",
      "default": true,
      "description": "Include qualifier snaks."
    },
    "include_references": {
      "type": "boolean",
      "default": false,
      "description": "Include reference snaks (omitted for compactness by default)."
    },
    "resolve_labels": {
      "type": "boolean",
      "default": false,
      "description": "Opt in to one bounded WDQS query that decorates up to 10 distinct entity-valued statements with a label."
    }
  },
  "required": ["qid", "property"],
  "additionalProperties": false
}
```

**OUTPUT example** (TC-B-004, truncated provenance)

```json
{
  "qid": "Q42",
  "property": "P569",
  "property_label": { "en": "date of birth" },
  "rank_filter": "all",
  "statements": [
    {
      "id": "Q42$8C9E1F2B-4D5A-4C6E-9B0F-1A2D3E4F5A6B",
      "rank": "normal",
      "value": { "type": "value", "content": { "time": "+1952-03-11T00:00:00Z", "precision": 11 } },
      "value_label": null,
      "qualifiers": [],
      "references_count": 1
    }
  ],
  "count": 1,
  "next_offset": null,
  "truncated": false,
  "source": "wikidata",
  "revision": 2293994012,
  "timestamp": "2026-11-20T09:14:22Z",
  "license": { "short": "CC0 1.0" },
  "attribution": { "required": false, "text": "Wikidata contributors — CC0 1.0" },
  "resultType": "complete"
}
```

A missing property/item-property combination returns `statements: []`, `count: 0` with success (never an error). `property_label` is populated from a static, code-reviewed map for the ~20 most-requested properties; otherwise `null`. See §7 for rank, language and paging semantics.

**Errors.** `invalid_qid`, `invalid_property`, `entity_not_found`, `rate_limited`, `upstream_unavailable`, `timeout`, `query_timeout` (only when `resolve_labels: true`), `internal_error`.

**Annotations.** `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`.

---

### 5.4 `wikidata_get_sitelinks`

**Purpose.** Return an item's sitelinks, optionally restricted to a set of site codes, in one call.

**Backend.** `GET {wbRest}/entities/items/{qid}/sitelinks`. One upstream call fetches all sitelinks (typically < 300); filtering is client-side against the allowlist derived from the Phase 1 project resolver (report 09 §3.1). Allowed site codes: `{lang}wiki` (e.g. `enwiki`, `dewiki`), `wikisource`/`wikiquote`/`wikibooks`/`wikivoyage` variants, `commonswiki`, `specieswiki`, `metawiki`. Site codes are never caller-supplied hosts (SR-3).

**INPUT**

```json
{
  "type": "object",
  "properties": {
    "qid": {
      "type": "string",
      "pattern": "^Q[1-9][0-9]{0,9}$",
      "description": "Wikidata item ID."
    },
    "sites": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 3,
        "maxLength": 24,
        "pattern": "^[a-z-]{2,12}(wiki|wikisource|wikiquote|wikibooks|wikivoyage)$"
      },
      "minItems": 1,
      "maxItems": 50,
      "description": "Site codes to project. Omit to return all sites."
    },
    "include_badges": {
      "type": "boolean",
      "default": false,
      "description": "Include sitelink badge QIDs."
    },
    "limit": {
      "type": "integer",
      "default": 50,
      "minimum": 1,
      "maximum": 200,
      "description": "Maximum sitelinks returned when 'sites' is omitted; hard cap 200."
    }
  },
  "required": ["qid"],
  "additionalProperties": false
}
```

**OUTPUT example** (TC-B-008, truncated provenance)

```json
{
  "qid": "Q42",
  "sitelinks": {
    "enwiki": { "title": "Douglas Adams", "url": "https://en.wikipedia.org/wiki/Douglas_Adams", "badges": [] },
    "dewiki": { "title": "Douglas Adams", "url": "https://de.wikipedia.org/wiki/Douglas_Adams", "badges": [] }
  },
  "requested_sites": ["enwiki", "dewiki", "frwiki"],
  "count": 2,
  "truncated": false,
  "source": "wikidata",
  "revision": 2293994012,
  "timestamp": "2026-11-20T09:14:22Z",
  "license": { "short": "CC0 1.0" },
  "attribution": { "required": false, "text": "Wikidata contributors — CC0 1.0" },
  "resultType": "complete"
}
```

Only requested sites that exist are returned; absent sites are silently omitted (TC-B-008: "where present"). `badges` is `[]` unless `include_badges` is `true`.

**Errors.** `invalid_qid`, `invalid_site`, `entity_not_found`, `rate_limited`, `upstream_unavailable`, `timeout`, `internal_error`.

**Annotations.** `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`.

---

### 5.5 `wikidata_resolve_external_id`

**Purpose.** Resolve an external identifier (DOI, PMID, ORCID, OpenAlex, IMDb) **or** a sitelink `(site, title)` to a Wikidata QID. This is the one tool with two input modes.

**Backend.** WDQS SPARQL for both modes — Wikibase REST v1.6 has no external-ID-to-item or sitelink-to-item lookup endpoint (verified against the live OpenAPI document). Both queries are **server-generated from fixed templates**, then still passed through the §4 guards as defence in depth.

**INPUT** — strict object with a `oneOf` requiring exactly one mode:

```json
{
  "type": "object",
  "properties": {
    "scheme": {
      "type": "string",
      "enum": ["doi", "pmid", "orcid", "openalex", "imdb"],
      "description": "External-ID scheme; required with 'id'."
    },
    "id": {
      "type": "string",
      "minLength": 2,
      "maxLength": 256,
      "description": "External identifier value; required with 'scheme'. Normalised per §6.1 before use."
    },
    "site": {
      "type": "string",
      "minLength": 3,
      "maxLength": 24,
      "pattern": "^[a-z-]{2,12}(wiki|wikisource|wikiquote|wikibooks|wikivoyage)$",
      "description": "Sitelink site code; required with 'title'."
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Page title on the given site; required with 'site'."
    },
    "language": {
      "type": "string",
      "default": "en",
      "minLength": 2,
      "maxLength": 12,
      "pattern": "^[a-z]{2}[a-z0-9-]*$",
      "description": "Language used to label matches, where available."
    },
    "limit": {
      "type": "integer",
      "default": 10,
      "minimum": 1,
      "maximum": 50,
      "description": "Maximum matches; hard cap 50 and clamped to WIKIDATA_SPARQL_MAX_ROWS."
    }
  },
  "required": [],
  "additionalProperties": false,
  "oneOf": [
    {
      "required": ["scheme", "id"],
      "not": { "anyOf": [{ "required": ["site"] }, { "required": ["title"] }] }
    },
    {
      "required": ["site", "title"],
      "not": { "anyOf": [{ "required": ["scheme"] }, { "required": ["id"] }] }
    }
  ]
}
```

**SPARQL templates** (server-built; literals escaped with a strict escaper that rejects control characters and escapes `\` and `"`):

External-ID mode, e.g. DOI:

```sparql
SELECT ?item WHERE { ?item wdt:P356 "10.1038/nature12345" . } LIMIT 10
```

Sitelink mode, e.g. TC-B-007:

```sparql
SELECT ?item WHERE { <https://en.wikipedia.org/wiki/Ada_Lovelace> schema:about ?item . } LIMIT 10
```

The sitelink base URL comes from the allowlisted site resolver, never from the caller; the title is percent-encoded (` ` → `_`) and rejected if it contains `<`, `>`, `"`, `{`, `}`, `|`, `^`, `` ` `` or `\`.

**OUTPUT example** (TC-B-007, truncated provenance)

```json
{
  "qid": "Q7259",
  "matches": [
    { "qid": "Q7259", "label": "Ada Lovelace", "description": "English mathematician and writer" }
  ],
  "scheme": null,
  "id": null,
  "site": "enwiki",
  "title": "Ada Lovelace",
  "normalized_id": null,
  "endpoint": "https://query.wikidata.org/sparql",
  "effective_limit": 10,
  "source": "wikidata:sparql",
  "revision": null,
  "timestamp": "2026-11-21T09:00:00Z",
  "license": { "short": "CC0 1.0" },
  "attribution": { "required": false, "text": "Wikidata contributors — CC0 1.0" },
  "resultType": "complete"
}
```

`qid` is the first match (or `null` when there are none); zero matches is success with an empty `matches` array and `qid: null` — `external_id_not_found` is reserved for the explicit "no entity anywhere for this well-formed ID" case surfaced by upstream semantics, not for an ordinary empty SELECT. Matches are ordered by QID for determinism.

**Errors.** `validation_error`, `invalid_external_id`, `unsupported_scheme`, `invalid_site`, `external_id_not_found`, `rate_limited`, `upstream_unavailable`, `timeout`, `query_timeout`, `query_too_complex`, `internal_error`.

**Annotations.** `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`.

---

### 5.6 `wikidata_sparql_query`

**Purpose.** Execute a bounded, portable SPARQL 1.1 SELECT against the configurable WDQS endpoint and return normalised bindings.

**Backend.** WDQS with the §4.7 fallback chain.

**INPUT**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 10000,
      "description": "Portable SPARQL 1.1 SELECT query. Explicit PREFIX declarations; no Blazegraph-only extensions. A top-level LIMIT is injected when absent."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1000,
      "description": "Overrides any inline LIMIT; clamped to WIKIDATA_SPARQL_MAX_ROWS. Omit to honour an inline LIMIT."
    },
    "timeout_ms": {
      "type": "integer",
      "default": 60000,
      "minimum": 1000,
      "maximum": 60000,
      "description": "Client-side deadline in milliseconds; never above 60000."
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

The `maxLength` and `maximum` above are the default values of `WIKIDATA_SPARQL_MAX_QUERY_LENGTH` and `WIKIDATA_SPARQL_MAX_ROWS`. If either key is overridden at boot, the advertised schema must be regenerated from the configured value so schema and guard cannot drift (SR-1).

**OUTPUT example** (TC-B-005, truncated provenance)

```json
{
  "vars": ["item", "itemLabel"],
  "results": {
    "bindings": [
      {
        "item": { "type": "uri", "value": "http://www.wikidata.org/entity/Q42", "datatype": null, "lang": null },
        "itemLabel": { "type": "literal", "value": "Douglas Adams", "datatype": null, "lang": "en" }
      }
    ]
  },
  "row_count": 1,
  "truncated": false,
  "endpoint": "https://query.wikidata.org/sparql",
  "effective_limit": 5,
  "warnings": [],
  "source": "wikidata:sparql",
  "qid": null,
  "revision": null,
  "timestamp": "2026-11-21T09:00:00Z",
  "license": { "short": "CC0 1.0" },
  "attribution": { "required": false, "text": "Wikidata contributors — CC0 1.0" },
  "resultType": "complete"
}
```

**Errors.** `validation_error`, `invalid_query`, `query_limit_required`, `query_too_complex` (with `error.limits`), `query_timeout`, `rate_limited`, `upstream_unavailable`, `internal_error`.

**Annotations.** `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`.

**Description text (tool metadata).** Must include: "Portable SPARQL 1.1 only; SELECT only; a LIMIT is added automatically when missing; queries are capped by length, complexity, rows and 60 s. Examples: (1) `SELECT ?item WHERE { ?item wdt:P31 wd:Q5 } LIMIT 10`; (2) `SELECT ?item ?itemLabel WHERE { ?item wdt:P106 wd:Q36834 . SERVICE wikibase:label { bd:serviceParam wikibase:language \"en\". } } LIMIT 10` (label service is slower); (3) `SELECT ?item WHERE { ?item wdt:P356 \"10.1038/nature12345\" } LIMIT 10`." This is the in-catalogue substitute for a query resource (§8).

---

## 6. External ID resolution — decision detail

### 6.1 Property map and normalisation (static, code-reviewed)

| Scheme | Wikidata property | Normalisation applied before the query | Example |
|---|---|---|---|
| `doi` | `P356` | Lower-case; strip `https://doi.org/`, `http://dx.doi.org/`, `doi:` prefixes; validate `^10\\.[0-9]{4,9}/\\S+$` | `10.1038/nature12345` |
| `pmid` | `P698` | Strip `PMID:` and `https://pubmed.ncbi.nlm.nih.gov/`; digits only, 1…9 digits | `12345678` |
| `orcid` | `P496` | Strip `https://orcid.org/` and `ORCID:`; validate `^\\d{4}-\\d{4}-\\d{4}-[\\dX]{4}$` | `0000-0002-1825-0097` |
| `openalex` | `P10283` | Strip `https://openalex.org/` and `OpenAlex:`; validate `^[A-Z][0-9]{7,}$` | `A5023888391` |
| `imdb` | `P345` | Upper-case prefix; keep `tt`/`nm`/`co`/`ev` prefix plus digits; validate `^(tt|nm|co|ev)\\d{7,10}$` | `nm0000209` |

P10283 ("OpenAlex ID", datatype `external-id`) was verified against `wbsearchentities` on 2026-11-21. The map is a constant, not configuration; a new scheme requires a minor contract version plus a corpus case.

### 6.2 Resolution procedure

1. Validate the `oneOf` mode strictly; mixing `scheme`/`id` with `site`/`title` → `validation_error` with zero outbound requests.
2. Normalise the identifier per §6.1; a failed format check → `invalid_external_id`.
3. Build the fixed SPARQL template with the mapped property and the escaped literal; enforce `LIMIT` via §4.4.
4. Execute through the §4 pipeline (WDQS budget, fallback chain, 429/503 rules).
5. Map `head.vars`/`results.bindings` into `matches[]`, sort by QID, set `qid` to the first match, attach the §3.2 provenance with `source: "wikidata:sparql"`.
6. For sitelink mode, derive the base URL from the Phase 1 site resolver allowlist; an unknown `site` → `invalid_site` before any outbound request (AC-45).

Rationale: report 06 §3.2 records that SPARQL row caps, external-ID resolution (DOI/PMID/ORCID/OpenAlex/IMDb), sitelinks and statements dominate the Group B issue tracker. Supporting all five schemes in one tool matches that demand; a separate tool per scheme would double the surface without adding capability (report 03 §5.1).

---

## 7. Statements filtering — decision detail

### 7.1 Rank

Wikibase REST ranks are `preferred`, `normal`, `deprecated`. Semantics:

- `rank: "all"` (default): return every statement, stably sorted `preferred` → `normal` → `deprecated`, preserving upstream order within a rank. Do **not** drop deprecated statements — callers may need them, and dropping silently would be a semantic change.
- `rank: "preferred" | "normal" | "deprecated"`: keep only that rank.
- Rank filtering happens client-side after the single upstream call; it is never appended to the URL.

### 7.2 Language fallback and label decoration

- `languages` is the explicit priority list; when supplied it overrides `language` (whose only role is to seed `["en"]`-style defaults). At most 20 languages; unknown codes → `invalid_language`.
- `property_label` uses a static, code-reviewed map of common properties; unmapped properties yield `null` with no extra call.
- **Decision:** no per-value label calls. `resolve_labels: true` (default `false`) permits **one** WDQS template query using `VALUES ?target { wd:Q… }` for at most **10 distinct** wikibase-item values from the returned page, with `SERVICE wikibase:label` and an injected LIMIT, executed under the WDQS budget. Labels are selected in `languages` order, falling back to any available language, then `null`. More than 10 distinct values are not decorated (non-fatal `warnings` entry). Callers needing exhaustive labels call `wikidata_get_entity` on the value QIDs. This bounds the fan-out to one extra SPARQL call and keeps the common path to a single REST call (M2 single-call goal).

### 7.3 Paging and truncation

Ordering is established (rank, then upstream order) **before** `offset`/`limit` are applied, so pages are stable within an unchanged revision. `next_offset = offset + returnedCount` when more statements exist, else `null`. `truncated: true` when `include_references: false` omits reference snaks at the byte cap or when `MAX_RESULT_BYTES` clips serialised output; a `warnings` entry explains which. Empty pages are success.

---

## 8. Resources and prompts — decision

**Decision: no new MCP resources or prompts in Phase 2.** The six task-oriented tools already expose the entire Group B capability surface, and report 03 §5.1 prefers a small number of well-named tools over a parallel discovery surface. A SPARQL "cookbook" resource would add a cached primitive (`resources/read` already carries `ttlMs`/`cacheScope` from Phase 1), a new injection surface (SR-2: resource text is attacker-influenceable only if generated from wiki content — avoidable but reviewable), and a new item in the integrity-checked catalogue (SR-12). None of that buys capability the tool description cannot deliver.

Instead: the `wikidata_sparql_query` description carries three short reviewed query examples (§5.6), and the server `instructions` string from report 05 §5 is extended with one sentence: "Use `wikidata_search_entities` to map a name to a QID; use `wikidata_get_entity`/`wikidata_get_statements`/`wikidata_get_sitelinks` for structured facts; use `wikidata_resolve_external_id` for DOI/PMID/ORCID/OpenAlex/IMDb or sitelinks; use `wikidata_sparql_query` only for bounded, portable SELECT queries." Both live in the static signed catalogue, so they are covered by SR-12 and require code review to change. `prompts/list` and `resources/list` continue to return empty arrays in Phase 2 (AC-08 still passes). Richer prompts are deferred to Phase 5 (report 05 §7).

---

## 9. Group B load profile extension

### 9.1 Separation from Phase 1

The Phase 1 nightly gate (report 09 §4) — including M3 (p95 < 2 s, global) and M4 (429 == 0) — **remains unchanged** and is computed only from Group A calls. Group B introduces two additional metrics, `B-M3` and `B-M4`, computed in the same nightly window from **separate counters** so a WDQS 429 can never retroactively fail Phase 1's M4. The global weighted p95 ceiling of 2000 ms in report 09 §4.3 continues to apply to Group A only; Class Q is explicitly excluded from it, exactly as WDQS label queries were excluded in Phase 1 §4.3.

### 9.2 Latency classes and budgets

| Class | Tools | Median evidence (report 06 §2.2) | p95 budget | Gate |
|---|---|---|---|---|
| **W — Wikibase REST read** | `wikidata_search_entities`, `wikidata_get_entity`, `wikidata_get_statements`, `wikidata_get_sitelinks` | ~1.074 s first item (211 KB, then immediate 429) | **≤ 1.5 s**, global ≤ 2 s | `B-M3` |
| **Q — WDQS** | `wikidata_sparql_query`, `wikidata_resolve_external_id`, plus `get_statements` label decoration | 0.994 s simple SELECT; >25 s label-service (no LIMIT) | simple SELECT (no label service) **≤ 3 s**; label-service SELECT **≤ 15 s**; hard deadline 60 s | `B-M3` (class-specific) |

Class W controls that make the 1.5 s budget realistic: `_fields` projection, `max_statements_per_property`/`max_properties` caps, ETag/`If-None-Match` caching, and one call per tool invocation. Class Q timeouts (>60 s abort) count as failed calls but are excluded from the latency histogram; ≥150 samples per class are required before a p95 is computed (report 09 §4.5).

### 9.3 QPS and concurrency rules

| Parameter | Value | Source / rationale |
|---|---|---|
| WDQS token bucket | **1 qps / 60 req/min**, burst 2 | ≈25 % of the anonymous 4 qps / 240 req/min tier (report 06 §5.1); deliberate headroom |
| WDQS semaphore | `min(2, CONCURRENCY_LIMIT)` → **2** | Well under ~18 concurrent anonymous; nested in the global `p-limit(3)` |
| Global outbound concurrency | **≤ 3** (unchanged) | AC-26; WDQS slot is drawn from the same global ceiling |
| WDQS deadline | **≤ 60 s** (`WIKIDATA_SPARQL_TIMEOUT_MS`) | report 06 §5.1 |
| Identical-query cache | TTL `min(300000, METADATA_CACHE_TTL_MS)` | report 08 §5.5; no `ttlMs`/`cacheScope` advertised on `tools/call` (AC-09) |
| Public API tools | Unchanged 2 req/s governor, ≤3 concurrency | Phase 1 §4.1 |

### 9.4 WDQS quota hygiene (`B-M4`)

- Instrument every WDQS fetch with endpoint, timestamp, status and `Retry-After`; emit `wmcp_wdqs_429_total` and a `Retry-After` gauge.
- **Any** WDQS 429 during the nightly run → `B-M4 FAIL` (no ratio, no threshold), sample quarantined, ticket opened. Never retry-to-green or loosen the gate (report 09 §4.4 logic, applied to WDQS).
- 503 does not fail `B-M4` but does fail the run's success metric.
- Overall Phase 2 nightly PASS iff Phase 1's M1–M6 still pass **and** `B-M3` PASS (both classes within budget) **and** `B-M4` PASS with zero timeouts/5xx.
- Merge gate stays fixture-only (<2 min); no live WDQS call in CI (report 09 §4.5, report 07 §6.1).

---

## 10. Binary acceptance criteria AC-33…AC-59

Each criterion is yes/no. All run on fixtures in the blocking merge gate unless marked **live** (nightly). "Zero outbound requests" is asserted with MSW request counters.

### A. Registration and annotations

- **AC-33** `tools/list` advertises exactly the six names in §1.1, each with a strict JSON Schema and a non-empty description; no Enterprise, write, guest or G-group tool is registered. *(report 05 §2; SR-12)*
- **AC-34** All six tools carry `readOnlyHint:true`, `destructiveHint:false`, `openWorldHint:true`, `idempotentHint:true`; none declares `x-mcp-header`. *(report 09 AC-23; §3.4)*
- **AC-35** After Group B registration, Phase 1 AC-01…AC-32 pass unchanged over both transports; no Group B `tools/call` result carries `ttlMs` or `cacheScope`. *(report 09 AC-09/AC-32)*
- **AC-36** Config smoke reads all eight `WIKIDATA_SPARQL_*` keys with the documented defaults when unset; no new WDQS/Wikidata key exists; `timeout_ms > 60000` or non-positive row/length caps terminate boot. *(report 06 §5.2; report 09 AC-31)*

### B. Endpoint selection and fallback

- **AC-37** Endpoint chain honours `WIKIDATA_SPARQL_PREFER_V2` and `WIKIDATA_SPARQL_FALLBACKS` order; a fixture with `PREFER_V2=true` sends the first request to `query-next.wikidata.org`, and the output `endpoint` names the endpoint that answered. *(report 06 §5.2)*
- **AC-38** A `403` with `Unauthorized User-Agent`, a `401`, a `404` and a `5xx` other than 503 each independently advance to the next endpoint; when all endpoints are exhausted the result is `upstream_unavailable` naming endpoint classes, with no raw 403 body, token or credential in `message`. *(report 06 §5.1/§5.2)*
- **AC-39** On `429` and on `503` the server stays on the same endpoint (zero requests to alternates), honours `Retry-After`, uses bounded jittered backoff, and returns `rate_limited` / `upstream_unavailable` respectively with `retryable:true` and `retry_after_seconds` on exhaustion. *(report 06 §5.2; report 08 §5.6)*
- **AC-40** A `429`/`503` without `Retry-After` waits ≥ `RETRY_AFTER_FALLBACK_MS` before retry, verified with fake timers and no real sleep in CI. *(report 09 AC-27)*

### C. Tool contracts and corpus

- **AC-41** Every Group B schema rejects wrong types, missing required params, out-of-range numbers, malformed QID/PID/site/external-ID values and unknown extra fields; `wikidata_resolve_external_id` accepts exactly one of the two `oneOf` branches. *(SR-1; report 09 AC-21)*
- **AC-42** **TC-B-001** (live): `wikidata_search_entities` returns `results[0].qid == "Q7259"` with label/description and the full provenance block in one call. *(corpus)*
- **AC-43** **TC-B-002** (fixture) and **TC-B-003** (live): `wikidata_get_entity` returns `qid`, `labels`, `descriptions`, `claims`, `sitelinks`; TC-B-003 returns `labels.en`, `labels.de`, `labels.fr` in one call with `languages`. *(corpus)*
- **AC-44** **TC-B-004** (fixture): `wikidata_get_statements({qid:"Q42", property:"P569"})` returns ≥1 statement with a non-null `value`, correct rank ordering and provenance. *(corpus)*
- **AC-45** **TC-B-008** (live): `wikidata_get_sitelinks({qid:"Q42", sites:[...]})` returns only requested sites that exist, keyed as `sitelinks.enwiki` / `sitelinks.dewiki`. *(corpus)*
- **AC-46** For each of `doi`, `pmid`, `orcid`, `openalex`, `imdb`, a fixture maps to `P356`, `P698`, `P496`, `P10283`, `P345` respectively and returns a QID with provenance; an unsupported scheme returns `unsupported_scheme` listing the allowlist in its hint. *(report 06 §3.2; §6.1)*
- **AC-47** **TC-B-007** (fixture): sitelink-mode `wikidata_resolve_external_id` returns `qid == "Q7259"` plus `site`/`title`; an unknown `site` returns `invalid_site` with zero outbound requests. *(corpus; SR-3)*

### D. SPARQL safety

- **AC-48** **TC-B-006** is rejected before any outbound request with `query_too_complex` or `query_limit_required`, a non-empty `error.limits` object (thresholds + observed values), and no unbounded result set. *(corpus; SR-10; report 08 §5.5)*
- **AC-49** `DESCRIBE`, `ASK`, `CONSTRUCT`, `INSERT`, `DELETE`, a second statement, and `SERVICE <https://attacker.example/>` each return `invalid_query` with zero outbound requests; `SERVICE wikibase:label` is accepted by the shape guard. *(§4.2; SR-3)*
- **AC-50** A query longer than `WIKIDATA_SPARQL_MAX_QUERY_LENGTH` and a query breaching any complexity cap (UNION > 5, OPTIONAL depth > 3, property paths > 3, patterns > 50, FILTER > 20, score > 40) return `query_too_complex` locally; a keyword inside a string literal does not trigger rejection. *(§4.1/§4.3)*
- **AC-51** LIMIT injection: a no-LIMIT query is sent with an injected LIMIT; an inline LIMIT above `WIKIDATA_SPARQL_MAX_ROWS` is clamped with a warning; a caller `limit` overrides the inline value; TC-B-005's inline `LIMIT 5` is preserved and yields ≤5 bindings; a malformed inline LIMIT → `query_limit_required`. *(§4.4; TC-B-005/006)*
- **AC-52** `timeout_ms` outside 1000…60000 is rejected by the schema; at the deadline the upstream fetch is aborted, the WDQS semaphore slot is released, and `query_timeout` with an actionable `action` is returned. *(§4.5; report 09 AC-20)*
- **AC-53** Results are capped to the effective LIMIT and `MAX_RESULT_BYTES`, truncated deterministically at a binding boundary, and set `truncated:true` plus a warning; no partial token is emitted. *(§4.6; SR-10)*

### E. Parsing and provenance

- **AC-54** A standard SPARQL 1.1 JSON payload with `head.vars` and typed bindings (`uri`, `literal`, `lang`, `datatype`, `bnode`) is normalised to `vars` and `results.bindings`; no Blazegraph-only field leaks into the output; both v1-style and v2-style `Accept` responses parse identically. *(report 06 §5.1/§5.2; TC-B-005)*
- **AC-55** A malformed or non-JSON SPARQL response returns exactly one `upstream_unavailable` with `details.parse_error` and no uncaught exception or partial result. *(§4.6; TC-A-015 pattern)*
- **AC-56** 100 % of Group B results carry `source`, `license` (CC0 1.0), `attribution` and the applicable `qid`/`endpoint`; Wikibase REST entity results take `revision`/`timestamp` from `ETag`/`Last-Modified`, SPARQL results use `null` revision. One omission fails the run. *(SR-11; M5)*
- **AC-57** No Group B string — label, description, SPARQL literal or error body — is ever promoted to an instruction; a canary labelled "IGNORE ALL PREVIOUS INSTRUCTIONS" is returned as data with no prompt/token disclosure. *(SR-2; report 08 T-02)*

### F. Transport and load

- **AC-58** All six tool contracts pass over both stdio and Streamable HTTP, including `Mcp-Name` validation, with transport-specific checks otherwise identical (report 09 AC-32 pattern).
- **AC-59** **live** Group B load run: Class W p95 ≤ 1.5 s and global ≤ 2 s; Class Q within its class budgets and excluded from Phase 1 M3; WDQS ≤ 1 qps / 60 req/min and concurrency ≤ 2 with global ≤ 3; `B-M4` 429 count == 0; Phase 1 M1–M6 and the nightly gate unchanged. *(§9; report 06 §5.1)*

**CI placement.** AC-33…AC-41, AC-43, AC-44, AC-46…AC-58 are blocking merge gates (deterministic on fixtures; fixture doubles exist for every live corpus case). AC-42, AC-45 and AC-59 are nightly live. No live network call occurs in the merge gate.

### 10.1 Corpus mapping and new cases required

Existing cases (already in `test-corpus.json`):

| Case | Tool | Covered by |
|---|---|---|
| TC-B-001 | `wikidata_search_entities` | AC-42 |
| TC-B-002 | `wikidata_get_entity` (Q42) | AC-43 |
| TC-B-003 | `wikidata_get_entity` (multi-language) | AC-43 |
| TC-B-004 | `wikidata_get_statements` | AC-44 |
| TC-B-005 | `wikidata_sparql_query` (bounded SELECT) | AC-51, AC-54 |
| TC-B-006 | `wikidata_sparql_query` (oversized/UNION) | AC-48, AC-50 |
| TC-B-007 | `wikidata_resolve_external_id` (sitelink) | AC-47 |
| TC-B-008 | `wikidata_get_sitelinks` | AC-45 |

New cases to add to `test-corpus.json` (all `mode: fixture` unless noted):

| Case | Purpose | Criterion |
|---|---|---|
| TC-B-009…013 | One case per external scheme (DOI, PMID, ORCID, OpenAlex, IMDb) incl. prefix stripping | AC-46 |
| TC-B-014 | Unknown sitelink site / mixed `oneOf` mode rejected with zero outbound requests | AC-41, AC-47 |
| TC-B-015 | SPARQL with no LIMIT → injected LIMIT present in the recorded request | AC-51 |
| TC-B-016 | Non-SELECT / second statement / remote SERVICE rejected | AC-49 |
| TC-B-017 | Query over length cap and over complexity score, with `error.limits` asserted | AC-48, AC-50 |
| TC-B-018 | 403 `Unauthorized User-Agent` → falls back to v2 endpoint | AC-37, AC-38 |
| TC-B-019 | 401 / 404 / 502 each advance to next endpoint | AC-38 |
| TC-B-020 | 429 with `Retry-After: 1` → stay, delay ≥1 s, eventual success | AC-39 |
| TC-B-021 | 503 → stay, honour Retry-After, eventual `upstream_unavailable` on exhaustion | AC-39 |
| TC-B-022 | 429 without `Retry-After` → ≥ `RETRY_AFTER_FALLBACK_MS` (fake timers) | AC-40 |
| TC-B-023 | Deadline abort at `timeout_ms` → `query_timeout`, semaphore slot freed | AC-52 |
| TC-B-024 | Oversized result set → deterministic byte truncation, `truncated:true` | AC-53 |
| TC-B-025 | Malformed/non-JSON SPARQL body → single `upstream_unavailable` with `parse_error` | AC-55 |
| TC-B-026 | `get_statements` rank filter + paging + `resolve_labels` bounded to 10 targets | AC-44 |
| TC-B-027 | `get_entity` field projection/caps keep payload under `MAX_RESULT_BYTES` | AC-56 |
| TC-B-028 | Prompt-injection canary in a Wikidata label/description | AC-57 |
| TC-B-029 | SPARQL 1.1 typed bindings incl. `bnode` and `datatype` | AC-54 |
| TC-B-030 | `live` bounded SELECT with no label service (fast Class Q sample) | AC-59 |

---

## 11. Change-control note

- Contract version **2.0.0** is frozen on 2026-11-21. It is additive to Phase 1 v1.0.1; Phase 1 is not reopened.
- Tool names, required parameters, output field names (`claims`, `sitelinks`, `results.bindings`, `qid`, `endpoint`, `error.limits`), error codes, guard constants (§4.3) and the endpoint-fallback table (§4.7) are **frozen**. Changes require v3.0.0, an updated `test-corpus.json` and renumbered/extended AC.
- Additive optional output fields, an additional external-ID scheme with its property constant, or a revised tool description may be v2.1.0 with a logged change.
- WDQS v2 migration is configuration-driven: setting `WIKIDATA_SPARQL_PREFER_V2=true` or amending `WIKIDATA_SPARQL_FALLBACKS` is a deployment change recorded in the change log, with no version bump. Reversal triggers are those in report 06 §5.2 (v2 200 for unregistered UA; v1 degradation Feb–Jun 2027).
- Every change must re-run AC-33…AC-59 and the Phase 1 AC-01…AC-32 regression check (AC-35). A failure to preserve AC-01…AC-32 blocks release.

### Change log

| Version | Date | Change |
|---|---|---|
| 2.0.0 | 2026-11-21 | Initial frozen Phase 2 Group B contract: six tools, SPARQL safety pipeline, external-ID map, separate load profile, AC-33…AC-59. |

---

**Status: FROZEN — ready for implementation. Phase 2 is read-only Group B (Wikidata) only; Enterprise and all write tools remain out of scope. Phase 1 v1.0.1 and AC-01…AC-32 are unchanged.**

*End of Phase 2 implementation contract — version 2.0.0.*
