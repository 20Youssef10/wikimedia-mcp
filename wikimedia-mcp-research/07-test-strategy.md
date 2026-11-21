# Test Strategy for a Unified Wikimedia MCP Server

**Document version:** 2026-11-21  
**Language:** en-GB  
**Audience:** Engineers implementing and operating the unified Wikimedia MCP server (MCP 2026-07-28).  
**Companion artefacts:** `test-corpus.json` (machine-readable test corpus), reports `01`–`05` in this directory.

> This strategy closes the former open gap about test strategy and fixtures; that gap is now marked resolved in report 05 §12. It is grounded in report 05 §2 (tool groups A–G), §6 (security), §10 (success metrics), §11 (risk register), report 03 §3 (MCP protocol requirements) and reports 01–02 (API/rate-limit constraints). Recommendations are **[Design]**; metric targets are quoted from report 05 §10 **[Design]**.

---

## 1. Purpose and Scope

The goal is a fast, deterministic, trustworthy test machine that makes the six success metrics in report 05 §10 measurable and enforceable, rather than a loose collection of ad-hoc checks.

Scope:

- All seven tool groups A–G from report 05 §2.
- Both transports (stdio and Streamable HTTP), the `server/discover` RPC, result shapes, caching metadata, routing headers and JSON-RPC error codes from report 03.
- Shared infrastructure: language/project resolver, User-Agent construction, rate-limit and retry logic, caching, and credential isolation.
- Write tools, which receive explicit treatment (§8).

---

## 2. Test Objectives — Mapped to Report 05 §10 Metrics

Each metric becomes a measurable gate. The `test-corpus.json` file carries a `metrics_map` and per-case `constraints` that encode these objectives.

| # | Metric (report 05 §10) | Target | How the suite measures it | Primary corpus cases |
|---|------------------------|--------|---------------------------|----------------------|
| M1 | Tool-call success rate on a fixed task corpus | **≥ 95%** | Run every corpus case; a case passes when the observed `status` equals `expected.status` and all `expected.required_fields` are present. Success rate = passing cases ÷ applicable cases. Defects in schemas/descriptions surface as mismatches. | all `test_cases` |
| M2 | Share of tasks answered with a single tool call | **≥ 70%** | Count task cases whose `expected.constraints` include “single tool call resolves the task”; divide by total task cases. A task needing 2+ calls is a task-design regression. | TC-A-001, A-002, A-003, A-007, B-001, B-002, B-007, C-002, F-002 |
| M3 | p95 latency per tool (excluding network-bound bulk) | **< 2 s** | Emit a duration histogram per tool for every `tools/call`; assert p95 < 2000 ms. Exclude groups E and D and explicit bulk operations per the metric definition. | all happy-path cases in A, B, C, F, G |
| M4 | Rate-limit 429 rate under the standard test load | **0** | Instrument the outbound HTTP layer. Any upstream 429 during a live run fails CI. Standard load = corpus live cases with concurrency ≤ 3, compliant User-Agent, metadata caching. | all `mode: live` cases; TC-A-014, TC-E-005 |
| M5 | Licence/attribution fields on content results | **100%** | For every content-returning case in groups A/F/E (and content-bearing G cases), require `licence` and `attribution` in `required_fields`; fail if absent at runtime. | TC-A-002, A-006, A-009, A-010, A-011, A-012, A-016, E-001, F-001, F-002, G-001 |
| M6 | Quota-exhaustion handled with an actionable error | **100%** | For all terminal quota/rate/credential error cases require `error.code`, `error.retryable` and `error.action`; assert no raw HTTP 429/401 text leaks. `TC-A-014` models *eventual success after backoff* (it asserts retry metadata, not a terminal error) and is measured under M1/M4 only — it is deliberately excluded from the M6 denominator. | TC-E-002, TC-E-004, TC-E-005 |

**Supporting objectives (not in §10 but required by the reports):**

- Correct MCP 2026-07-28 protocol behaviour (report 03) — §4.
- Politeness and good citizenship (reports 01 §4, 02 §9) — §5 and §6.
- Security controls from report 05 §6/§11 — §7.
- Correct write-tool gating (report 05 §2 Group G) — §8.

---

## 3. Test Levels

### 3.1 Unit tests (fast, no I/O)

Target the pure logic that routing and protocol correctness depend on.

- **Language/project resolver**: defaults, aliases (`en`, `enwiki`, `en.wikipedia`, `commonswiki`), unknown-code fallback, case-insensitivity, multi-language lists. Mirrors the resolver called out in report 05 §3.
- **Routing decision function**: given an intent + params, assert the chosen backend (REST `/page/summary` vs Action API vs Wikidata vs Enterprise) matches report 02 §10.
- **Schema validation**: Pydantic/Zod models reject wrong types, missing required params, out-of-range `limit`, malformed QIDs, invalid dates.
- **Cache header logic**: construction of `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `Mcp-Param-*` mirroring via `x-mcp-header`, and the `=?base64?...?=` sentinel for non-header-safe values (report 03 §4).
- **Rate-limit token bucket / pacing**: concurrency ceiling of 3, Enterprise hard 10 req/s budget, backoff-with-jitter computation, `Retry-After` parsing (including the ≥ 5 s fallback when absent).
- **Attribution assembly**: given a raw upstream payload, assert licence/attribution/source/revision fields are always emitted (M5).

### 3.2 Contract / schema tests (protocol conformance)

Validate the server against the MCP 2026-07-28 contract from report 03.

- **Input/output schemas**: every tool advertises a JSON Schema; every result validates against it; no extra untyped fields.
- **`server/discover`**: implemented (mandatory per report 03 §3.1), advertises supported versions, `serverInfo`, capabilities and optional `instructions`.
- **`resultType`**: every result carries `resultType`; normal results are `"complete"`; confirmation/MRTR results are `"input_required"` with `inputRequests` (report 03 §3.3, §4).
- **Caching metadata on the six cacheable operations**: `server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read` MUST return `ttlMs` (≥ 0) and `cacheScope` (`"public"` | `"private"`) on `resultType: "complete"` results. Assert `input_required` results do **not** carry them.
- **`_meta` required fields**: requests carry `io.modelcontextprotocol/protocolVersion` (required), `clientCapabilities`, `clientInfo`; results carry `_meta.io.modelcontextprotocol/serverInfo`.
- **Routing headers**: on Streamable HTTP POST assert `MCP-Protocol-Version` on every request, `Mcp-Method` on all requests, and `Mcp-Name` on `tools/call`, `resources/read`, `prompts/get`.
- **Error codes**: header/body mismatch → JSON-RPC **`-32020` `HeaderMismatch`**; unsupported version → **`-32022` `UnsupportedProtocolVersionError`** with **HTTP 400** on Streamable HTTP. Also cover malformed JSON-RPC (parse/error/response shapes).
- **Transport parity**: run the contract suite over both stdio and Streamable HTTP.

### 3.3 Integration tests — LIVE public APIs

These hit real endpoints and validate that our understanding of upstream behaviour still holds.

- Groups A, B, C, F and read-only G cases marked `mode: live` in the corpus.
- Assertions are **shape and invariant based**, not brittle full-body equality (volatile revision IDs, timestamps and trending data).
- **Politeness is enforced by the harness, not by convention** (see §6):
  - a global semaphore limiting concurrent outbound requests to **≤ 3**;
  - a compliant, contactable **User-Agent** on every request (set once in the shared client);
  - GET for reads; generator/multi-title requests where supported;
  - aggressive caching of metadata (siteinfo, project codes) so live runs do not re-fetch it;
  - any upstream 429 fails the run (M4), with `Retry-After` honoured on retry.
- Live tests target stable, well-known content: `Earth`, `Ada Lovelace`, `NASA`, `Q42`.

### 3.4 Resilience tests (fixture-driven)

Simulate adverse upstream conditions without hammering public services.

- **429** with `Retry-After` → honour header, exponential backoff with jitter, bounded retries, eventual success; on exhaustion return `error.code: rate_limited`, `retryable: true` (TC-A-014).
- **503** backend overload → retry, then actionable `upstream_unavailable` error (TC-A-015).
- **Malformed upstream data** → no uncaught parse exception, single readable failure reason (TC-A-015).
- **Enterprise quota exhaustion** → `quota_exhausted`, `retryable: false`, `action` explaining the reset; and hard 10 req/s pacing (TC-E-004, TC-E-005).
- **Missing `Retry-After`** → wait ≥ 5 s or exponential backoff (unit-test the delay computation; never sleep in CI).

### 3.5 Security tests (fixture-driven)

- **SSRF**: user-supplied MediaWiki host pointing at link-local/private ranges (e.g. `169.254.169.254`) must be rejected before any outbound request; allowlist + reject private/loopback/link-local (TC-A-013).
- **Prompt injection in page content**: return a page body containing “IGNORE ALL PREVIOUS INSTRUCTIONS…”; assert the content is treated strictly as data, is escaped, no system prompt/token is disclosed, and an optional untrusted-content flag may be set in `_meta` (TC-A-012). This directly addresses report 05 §11 “untrusted wiki content used as instructions”.
- **Token handling**: Enterprise token used for auth but never logged, echoed in errors, or persisted; expired token → `credential_refresh_required` with no token value in the message (TC-E-001, TC-E-002).
- **SPARQL abuse**: oversized query with no `LIMIT` rejected before execution; complexity, timeout and result-size limits enforced (TC-B-006).
- **Read/write separation**: destructive tools annotated accordingly; write tools never reachable without confirmation (§8).

### 3.6 End-to-end task scenarios

Drive the server the way a client would, over a real transport, to measure M1 and M2.

- Search → summary → full page → media attribution for a single subject (e.g. Ada Lovelace), asserting a coherent result chain with licence fields.
- Wikidata lookup → sitelinks → cross-language summary (`Q42` → enwiki/dewiki).
- Metrics task: pageviews + most-read for a fixed historical date.
- Failure-recovery task: missing page → error with actionable `action` → client recovers via `search`.
- Confirmation task: attempt `edit_page`, receive `input_required`, supply confirmation, observe dry-run result (§8).

These scenarios run through `tools/call` with full `_meta` and routing headers so protocol and tool behaviour are exercised together.

---

## 4. Deterministic Fixtures vs Live Tests

### 4.1 Must use recorded/synthetic fixtures (reproducible)

- All **error, security, resilience and write-tool confirmation** cases — they require adverse or destructive upstream states that must never be produced against public services.
- Anything involving **time or randomness**: `get_feed` for a fixed date, `get_random_page` shape-only checks, `get_recent_changes` rolling windows (frozen tool names: report 09 §3).
- **Enterprise** cases — require credentials and quota/rate conditions; use a placeholder token and recorded responses.
- **Protocol/contract** cases — deterministic by nature.
- Any case whose assertion depends on a **specific revision ID or licence string** (freeze via `freezegun` + recorded cassette).

### 4.2 Must hit live APIs

- Stable read happy-paths in groups A, B, C, F and read-only G where shape/invariant assertions suffice: search, summary, sections, languages, entity/sitelinks, pageviews, most-read, Commons file metadata, category members, bounded SPARQL with an explicit `LIMIT`.
- Live tests exist to catch **contract drift** (report 05 §11: “Wikimedia API contract or rate-limit change”) that fixtures cannot.

### 4.3 Keeping live tests polite

1. Concurrency semaphore ≤ 3 across the whole suite.
2. Compliant User-Agent set centrally; never overridden per test.
3. Cache siteinfo/project metadata for the duration of the run.
4. Prefer historical/fixed dates for metrics; avoid tight polling.
5. Fail on any 429; a 429 is a test failure, not a retry-until-green loop.
6. Run live tests **nightly**, not on every merge (§6.2), so even aggregate load stays negligible.

---

## 5. Using the Test Corpus (`test-corpus.json`)

`test-corpus.json` is the single machine-readable source of concrete cases and the data behind the §2 metric gates. It is a JSON object with:

- `version`, `generated`, `title`, `description` — provenance.
- `schema` — a human-readable description of every field, so the corpus is self-documenting.
- `metrics_map` — the definition and measurement formula for each report 05 §10 metric, linking targets to case IDs.
- `test_cases` — the array of cases (currently 45, ≥ 30 required).

Each case has:

| Field | Meaning |
|-------|---------|
| `id` | Stable identifier prefixed by tool group, e.g. `TC-A-002`. |
| `tool_group` | `A`–`G` per report 05 §2. |
| `tool` | Exact exposed tool name. |
| `params` | Realistic arguments using real titles (`Earth`, `Ada Lovelace`, `NASA`), QIDs (`Q42`, `Q718`) and project codes (`enwiki`, `dewiki`, `commonswiki`, `testwiki`). |
| `category` | `happy_path` \| `edge_case` \| `error` \| `security` \| `resilience`. |
| `expected.status` | `ok` \| `error` \| `input_required` (the last models MCP multi-round-trip / confirmation gating). |
| `expected.required_fields` | Fields that must be present; content cases include `licence`/`attribution` to enforce M5. |
| `expected.constraints` | Non-field assertions: single-call resolution, latency, politeness, no instruction execution, confirmation-before-write. |
| `mode` | `live` or `fixture`. |
| `notes` | Optional rationale / risk link. |

Coverage includes, as required: multi-language (TC-A-003, TC-A-008, TC-B-003, TC-B-008), missing page (TC-A-004), ambiguous title (TC-A-005), rate-limit simulation (TC-A-014, TC-E-004, TC-E-005), oversized SPARQL (TC-B-006), untrusted prompt-injection content (TC-A-012), SSRF (TC-A-013), and write-tool confirmation (TC-G-005, TC-G-006, TC-G-007).

**Usage:** a small loader in the test package reads this file and parameterises tests, dispatching each case to a `live` or `fixture` transport based on `mode`. Cases with `expected.status: input_required` exercise the MRTR retry path. Metric collectors read `metrics_map` to compute the gates.

---

## 6. CI Gates

### 6.1 Blocks a merge (required, fast, fully deterministic)

- Unit tests, contract/schema tests, and all `mode: fixture` cases from the corpus (including security, resilience and write gating).
- Protocol conformance over both transports, including `-32020`/`-32022`, HTTP 400, `resultType`, `ttlMs`/`cacheScope` on the six cacheable operations, `_meta` fields and routing headers.
- M5 licensing check on all content cases; M6 actionable-error check on all quota cases.
- Static schema/description lint: every tool has a name, description, JSON Schema and accurate side-effect annotation.
- **No live network calls** in this gate.

### 6.2 Nightly (live, scheduled)

- All `mode: live` cases plus the end-to-end task scenarios.
- Metric computation: M1 ≥ 95%, M2 ≥ 70%, M3 p95 < 2 s, M4 429 count == 0, M5/M6 == 100%.
- Contract-drift detection against real APIs; failures open a ticket with the recorded response attached.

### 6.3 Manual / gated

- Any test against a **production wiki** or with real credentials — not run in CI.
- Write-tool tests against a real (non-test) wiki — manual, explicit opt-in only.
- Fixture re-recording (§7) — manual, reviewed like code.
- Formal threat model before enabling write tools in production (report 05 §12).

### 6.4 Suite health reporting

Emit a per-run report with: total/pass/fail/skip by level and tool group, runtime per suite, p95 latency per tool, 429 count, flake rate (re-runs / total), and coverage trend. Any flake is quarantined with a tracked bug rather than masked with retries (a retry is only legitimate where the test is explicitly exercising backoff, e.g. TC-A-014). Regression of any §10 metric blocks the nightly gate.

---

## 7. Tooling and Fixture Generation

### 7.1 TypeScript path (DECIDED — report 05 §4)

- `Vitest` as the test runner.
- `MSW` (Mock Service Worker) for deterministic HTTP interception in unit, contract, security and resilience tests — precise control over status codes, `Retry-After`, malformed bodies.
- Record-and-replay fixtures for live integration cases: capture real public-API responses once, commit them, replay in CI (see §7.3).
- Zod for schema validation; fake timers for date-dependent endpoints.
- `@modelcontextprotocol/client@2.4.0` (v2 package; the v1 `@modelcontextprotocol/sdk` does not implement 2026-07-28) for protocol and end-to-end tests over stdio and Streamable HTTP.

### 7.2 Python path (rejected)

The Python path (`pytest`, `httpx`, `respx`, `vcrpy`, Pydantic, MCP Python SDK / FastMCP 4.0) was evaluated but **not selected**: report 05 §4 decided on TypeScript. It is recorded here only so the decision and its alternatives are auditable.

### 7.3 Generating fixtures

1. **Record once, replay always.** Add a `record` mode gated behind an env var (e.g. `WMCP_RECORD=1`). Run a live case once to capture a response fixture; commit the fixture. CI never records.
2. **Cassette layout:** `tests/fixtures/cassettes/<group>/<tool>_<case_id>.yaml` (e.g. `.../A/get_summary_TC-A-002.yaml`). The corpus `id` is the key linking case to cassette.
3. **Normalise volatile fields** with custom matchers: ignore `Date`, `ETag`, `Last-Modified`, revision IDs and timestamps; match on method + path + relevant query params only. Freeze the clock so date-dependent paths are stable.
4. **Scrub secrets and personal data:** redact User-Agent-specific identifiers, tokens and cookies before committing; replace tokens with placeholders such as `$ENTERPRISE_TOKEN`.
5. **Adverse fixtures are hand-authored**, not recorded: 429/503/`Retry-After`, malformed JSON, oversized SPARQL, SSRF host, prompt-injection page text, quota-exhaustion and confirmation gating are written explicitly with `respx`/`MSW` so they are exact and reproducible.
6. **Synthetic factories** (Faker with a fixed seed) generate large-but-valid payloads for paging/limit tests.
7. **Re-record deliberately:** a quarterly job (or on `Wikimedia_APIs/Changelog` changes) flags stale cassettes for human review; never auto-refresh silently.

---

## 8. Explicit Coverage of Write Tools

Write tools (report 05 §2 Group G: `edit_page`, `upload_file`, etc.) are high-risk and get dedicated treatment.

- **Safe test wikis only.** All write cases target `testwiki` (the Wikimedia sandbox), never `enwiki` or another production project. The corpus encodes this: TC-G-005/006/007 use `testwiki`; TC-G-008 asserts an unauthenticated edit against `enwiki` is **rejected**. A CI guard rejects any write case whose params name a non-test project.
- **Dry-run mode.** TC-G-006 sets `dry_run: true` and asserts no persistent mutation — the response describes the would-be change. This lets edit logic be covered in CI without side effects.
- **Confirmation gating.** TC-G-005 and TC-G-007 send `confirmation: false` and assert `resultType: "input_required"` with an `inputRequests[0].confirmation` prompt naming the exact page/action. No write occurs until the client supplies confirmation via the MRTR retry. This maps the report 05 requirement that destructive operations be “gated behind user confirmation”.
- **Side-effect annotations.** Contract tests assert write tools are annotated non-read-only/destructive, keeping them clearly separated from read tools.
- **Credential isolation.** Tokens are placeholders, never logged, never echoed in errors (TC-E-001/002 pattern applied to writes). Expired/missing token → actionable `authentication_required` / `credential_refresh_required` (TC-G-008).
- **No credential, no write.** Every write path requires a valid token; unauthenticated attempts are rejected before any outbound edit call.
- **Blast-radius limits.** Size/rate caps on edit text and uploads; confirmation prompt includes the target page and action so the user can make an informed choice.
- A formal threat model is a precondition before enabling any write tool against a production wiki (report 05 §12).

---

## 9. Traceability Summary

| Report 05 section | Strategy coverage |
|-------------------|-------------------|
| §2 tool groups A–G | Corpus `tool_group` A–G; every group has ≥ 1 case. |
| §3 architecture / caching | Unit resolver/routing tests; §4.3 metadata caching; §3.2 `ttlMs`/`cacheScope`. |
| §4 technology choices | §7 tooling (TypeScript decided; Python path rejected). |
| §5 server instructions | Contract test for `instructions` in `server/discover`. |
| §6 security | §3.5 and §8 (SSRF, prompt injection, tokens, SPARQL, confirmation). |
| §10 success metrics | §2 metric table + `metrics_map` in the corpus. |
| §11 risk register | Contract-drift nightlies, configurable WDQS endpoint, fixture scrubbing, politeness gates, flake quarantine. |
| §12 open gaps | This document + `test-corpus.json` close the “Testing” gap; threat model noted for the security gap. |

*End of test strategy.*
