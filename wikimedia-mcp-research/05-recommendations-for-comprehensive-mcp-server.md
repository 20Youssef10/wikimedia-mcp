# Recommendations for a Comprehensive Wikimedia MCP Server

**Document version:** 2026-11-21 (Revised)  
**Language:** en-GB  
**Audience:** Developers building a full-ecosystem MCP server for Wikimedia APIs

> **Revision note (2026-11-21):** Expanded to include Commons, Wikifunctions evaluation, EventStreams architecture guidance, attribution policy, and security requirements. Aligned with MCP 2026-07-28 and corrected Enterprise quotas.
>
> **Verification (2026-11-21):** Factual anchors were checked against live primary sources; see the package `README.md` for methodology and the **[Verified] / [Design] / [Watch]** notation. Recommendations are architectural judgements and are marked **[Design]**.

---

## 1. Design Goals

- Expose the useful capabilities of the entire Wikimedia API surface through a coherent, LLM-friendly tool set.
- Prefer task-oriented tools over 1:1 endpoint mappings.
- Internally route each request to the most appropriate backend (REST, Action, Enterprise data APIs, EventStreams consumer, Analytics, Wikidata, etc.).
- Enforce good citizenship (User-Agent, rate limits, concurrency) by default.
- Support both free public usage and optional authenticated Enterprise / write access.
- Return licence and attribution metadata with content where applicable.
- Remain maintainable as Wikimedia APIs and the MCP specification evolve.

---

## 2. Recommended Tool Groups

### Group A — Content Retrieval (highest priority) — FROZEN, see report 09 §3

- `search`
- `get_summary`
- `get_page` (whole page only: plain text / wikitext / HTML)
- `get_sections` (list sections, or fetch one with optional `section`)
- `get_related_pages`
- `get_media` (with per-file licence info)
- `get_languages` (interlanguage links)
- `get_random_page`
- `get_feed` (`kind: "featured" | "on_this_day"`)

Contract v1.0.1 in report 09 §3 is normative. It resolves two ambiguities from this earlier list: `get_sections` absorbs `get_section_content`, and `get_feed` absorbs `get_featured`/`get_on_this_day`. `get_page` is whole-page only.

### Group B — Knowledge Graph (Wikidata)
- `wikidata_search_entities`
- `wikidata_get_entity`
- `wikidata_get_statements`
- `wikidata_sparql_query` (with safety limits)
- `wikidata_resolve_external_id`
- `wikidata_get_sitelinks`

### Group C — Metrics & Popularity
- `get_pageviews`
- `get_most_read`
- `get_unique_devices` (where relevant)

### Group D — Live / Recent Changes
- Prefer an internal EventStreams consumer that stores a rolling window.
- Expose bounded tools such as `get_recent_changes` (filtered by project, namespace, time window, limit).
- Avoid exposing a raw long-lived SSE stream as an MCP tool in most deployments.

### Group E — Enterprise / Bulk (DESIGN ONLY — excluded from implementation; no subscription)
- `enterprise_get_article`
- `enterprise_get_structured_contents`
- `enterprise_list_snapshots`
- `enterprise_download_snapshot` (or return metadata / signed URL)
- Long-running operations should use the 2026-07-28 **`io.modelcontextprotocol/tasks` extension** (poll via `tasks/get`, `tasks/update` for client input) rather than blocking a tool call; see `https://modelcontextprotocol.io/extensions/tasks/overview.md`. **[Design]**

### Group F — Media & Commons
- Dedicated handling for file pages, image metadata, licence, author, and attribution requirements.
- Tools should surface machine-readable licence information whenever available.

### Group G — Advanced / Administrative
- `compare_revisions`
- `get_category_members`
- `geo_search`
- `liftwing_predict` (public models only). **Note [Verified]:** Lift Wing is explicitly excluded from Wikimedia's general 2026 API rate limits and documents separate external-usage limits on Wikitech (`https://wikitech.wikimedia.org/wiki/Machine_Learning/LiftWing/API/External_usage#Rate_limits_for_external_usage`). Apply its own budget.
- Write tools (`edit_page`, upload, etc.) only when properly authenticated, clearly marked as destructive, and gated behind user confirmation.

**Wikifunctions:** Evaluate necessity; include if there is clear user demand for function execution / definition lookup.

---

## 3. Internal Architecture Suggestions

```
┌─────────────────────────────────────────┐
│              MCP Server Layer           │
│  (tools, schemas, instructions, auth)   │
│  Targets MCP 2026-07-28 (server/discover)│
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│           Routing / Orchestration       │
│  (choose backend, apply defaults,       │
│   language/project resolution, quotas)  │
└────────────────────┬────────────────────┘
                     │
      ┌──────────────┼──────────────┐
      ▼              ▼              ▼
┌──────────┐  ┌────────────┐  ┌──────────────┐
│ REST     │  │ Action API │  │ Enterprise   │
│ clients  │  │ client     │  │ data client  │
└──────────┘  └────────────┘  └──────────────┘
      │              │              │
      ▼              ▼              ▼
┌──────────┐  ┌────────────┐  ┌──────────────┐
│Analytics │  │EventStreams│  │ Wikidata /   │
│ & others │  │ consumer   │  │ Lift Wing    │
└──────────┘  └────────────┘  └──────────────┘
```

- Centralise User-Agent construction and rate-limit / retry logic.
- Maintain a small language + project resolver (defaults + aliases).
- Cache metadata (siteinfo, project codes) aggressively.
- Prefer structured, truncated responses for LLM consumption.
- Attach source, title, revision/timestamp, licence and attribution fields to content results.
- **Rate and quota budget [Verified]:** public APIs are identity-tiered at 10 / 200 / 2,000 req/min with concurrency ≤ 3; Enterprise free accounts allow 50,000 On-demand requests, 30 snapshots and 1,500 chunks per month at a hard 10 req/s. Centralise these limits in the routing layer, expose remaining quota where the API reports it, and degrade gracefully with actionable 429/401 errors.

---

## 4. Implementation Technology Choices — DECIDED: TypeScript

**Decision (2026-11-21): TypeScript.** The Python path (MCP Python SDK / FastMCP 4.0 / `httpx` / Pydantic) was evaluated but **not selected**. TypeScript is the implementation language for this project; see report 09 §2 for exact packages, versions, project layout and config keys.

- Official **v2** packages `@modelcontextprotocol/server` + `@modelcontextprotocol/client` — 2026-07-28 support verified in the implementation [Verified]. The older `@modelcontextprotocol/sdk` v1 package **does not** implement 2026-07-28 and was rejected. Tier 1 SDK support also exists for Python, Go and C#, with Rust in beta.
- Zod for tool and configuration schemas.
- Support both **stdio** and **Streamable HTTP** transports; implement `server/discover`.

**Scope decision (2026-11-21): Enterprise data APIs (Group E) are excluded from implementation.** They are gated on a paid subscription and unpublished pricing (report 06 §4); no Enterprise subscription is in place. The Group E tool *design* is retained in §2 as a future option, but no Enterprise client, credential handling or tools will be built in this implementation phase. The cost model and quote-request inputs in report 06 §4 remain the reference for revisiting this decision.

---

## 5. Server Instructions (Example Content)

The `instructions` field should teach the model:

- Preferred order of tools for common tasks (search → summary → full page).
- How language and project parameters work and what the defaults are.
- No Enterprise guidance is included: Enterprise data APIs are out of scope for this implementation phase.
- Rate-limit and politeness expectations.
- How to interpret QIDs and sitelinks.
- That write tools require explicit authentication and user confirmation.
- That content is generally CC BY-SA 4.0 (or project-specific) and attribution should be preserved.

---

## 6. Security Requirements

- Isolate user credentials; never log or persist Enterprise tokens unnecessarily.
- Prevent SSRF when allowing custom MediaWiki hosts.
- Impose hard limits on SPARQL query complexity and result size.
- Treat wiki page content as untrusted external data.
- Clearly separate read tools from write / upload / delete tools.
- Require explicit user confirmation for any destructive operation.
- Validate and sanitise all tool inputs.

---

## 7. Phased Delivery Roadmap (revised against demand evidence)

> **Revision (2026-11-21):** the original order was expert judgement. Measured download, registry and issue evidence (`06-validation-and-economics.md` §3) supports the revised order below.

**Phase 1 — Core public content (Group A)**  
Search, summary, page content, sections, related, languages, featured/on-this-day, basic media, plus requested coordinates/tables.  
Backends: Wikimedia REST + Action API. Target MCP 2026-07-28.

**Phase 2 — Wikidata integration (Group B)**  
Entity lookup, SPARQL (bounded, portable SPARQL 1.1 and configurable endpoint per report 06 §5), sitelinks, external ID resolution.

**Phase 3 — Metrics and Commons/attribution (Groups C + F)**  
Pageviews, most-read; **Commons licence-aware media tools promoted from the old Phase 5**, backed by the Attribution API with Action API/REST fallbacks (report 06 §6).

**Phase 4 — Enterprise data APIs (Group E): EXCLUDED from implementation**  
Design retained as a future option only. Excluded on 2026-11-21 because no paid subscription exists and pricing is unpublished (report 06 §4). Revisit only via the quote-request inputs in report 06 §4.4.

**Phase 5 — Advanced (Group G), sliced**  
Compare revisions, categories, Lift Wing (public models), controlled write capabilities, richer resources and prompts, Wikifunctions evaluation. Write tools additionally gated by `08-threat-model.md` §6. Coordinates/tables already shipped in Phase 1.

**Spike (not a phase) — Group D, live recent changes**  
One-week feasibility spike and registry watch before committing to an internal EventStreams consumer; no demand evidence was found (report 06 §3.3).

---

## 8. Quality & Compliance Checklist

- [ ] Meaningful, contactable User-Agent on every outbound request
- [ ] Concurrent requests kept low (≤ 3 recommended)
- [ ] Respect of `Retry-After` and monthly quotas
- [ ] Clear, actionable error messages
- [ ] Input validation against schemas
- [ ] Concise, structured tool outputs that include source + licence where applicable
- [ ] Accurate side-effect annotations
- [ ] `server/discover` implemented
- [ ] Server instructions that add value beyond individual tool descriptions
- [ ] Support for multiple languages and projects
- [ ] Documentation of free vs authenticated capabilities
- [ ] Example configurations for major MCP hosts
- [ ] Integration tests against real public APIs

---

## 9. Next Concrete Steps (readiness items closed 2026-11-21)

The four readiness prerequisites are **closed** in `09-implementation-contract.md` (frozen v1.0.1): the Phase 1 tool list and JSON schemas are frozen (§3), the load profile for M3/M4 is defined (§4), the 32 binary MCP acceptance criteria are set (§5), and the stack decision is **TypeScript** (§2). Enterprise data APIs are excluded from implementation.

Implementation sequence:

1. Verify and pin the MCP SDK per report 09 §2.3, then scaffold the project (§2.4) with all day-1 config keys (§2.6).
2. Implement the REST + Action client layer with shared User-Agent, `p-limit(3)` semaphore, `Retry-After` handling and caching.
3. Build a minimal server targeting MCP 2026-07-28 exposing the nine frozen tools and implementing `server/discover` (report 09 §2.5, §3).
4. Write high-quality tool descriptions and server instructions from report 05 §5 and report 09 §3.3.
5. Make AC-01…AC-32 pass in the fixture-only merge gate, then run the nightly live load profile (report 09 §4).
6. Test against current hosts using the matrix in report 06 §7; iterate on real model behaviour.

---

## 10. Success Metrics [Design]

Define these before Phase 1 closes:

| Metric | Target | Why |
|--------|--------|-----|
| Tool-call success rate on a fixed task corpus | ≥ 95% | Detects schema/description defects |
| Share of tasks answered with a single tool call | ≥ 70% | Measures task-oriented tool design |
| p95 latency per tool (excluding network-bound bulk operations) | < 2 s | Validates routing/caching choices |
| Rate-limit 429 rate under the standard test load | 0 | Validates politeness defaults |
| Licence/attribution fields present on content results | 100% | Compliance requirement |
| Quota-exhaustion handled with an actionable error | 100% | LLM-recovery requirement |

The task corpus is defined in `test-corpus.json` (45 cases across groups A–G) and the measurement procedure in `07-test-strategy.md` §2; the remaining prerequisite is a **load profile** for the concurrency/latency metrics, which must be captured from the target deployment before M3 and M4 are enforced in CI.

## 11. Risk Register [Design]

| Risk | Impact | Mitigation |
|------|--------|------------|
| Wikimedia API contract or rate-limit change | High | Pin API versions/config; monitor `Wikimedia_APIs/Changelog`; quarterly re-verification |
| WDQS v2 endpoint migration (2026–2027) | Medium | Keep SPARQL URL configurable; track the migration (**[Watch]**) |
| Terms-of-use or licensing drift | High | Re-check ToU §7; preserve machine-readable licence and attribution fields |
| Enterprise credential leakage | High | Secret store, short-lived tokens, no logging, no chat/file persistence |
| SSRF via user-supplied MediaWiki host | High | Allowlist hosts, reject private/link-local ranges |
| Untrusted wiki content used as instructions | High | Treat content as data; never execute it as directives |
| Unbounded SPARQL / page-set results | Medium | Hard complexity, timeout and result-size limits |
| Upstream 429/503 under load | Medium | Concurrency ≤ 3, retry with jitter/backoff, cache metadata |

## 12. Gap Closure Status

All eight gaps previously listed here are now resolved in companion reports:

| Gap | Resolution |
|-----|------------|
| User demand | Measured download/registry/issue evidence and a revised phase order — `06-validation-and-economics.md` §3 |
| Performance benchmarks | Live latency measurements validating the suitability ratings — report 06 §2 |
| Enterprise cost model | Published-facts decision model, free-access routes and a vendor quote-request template — report 06 §4 |
| WDQS v2 migration `[Watch]` | Configurable endpoint contract with fallback rules — report 06 §5 |
| Attribution API service | Formal beta API confirmed; earlier "no formal API" claim withdrawn — report 06 §6 |
| MCP host configuration matrix | Eleven-host matrix with transport-key caveats — report 06 §7 |
| Test corpus / strategy | `07-test-strategy.md` and `test-corpus.json` (45 cases) |
| Formal threat model | `08-threat-model.md` (STRIDE, 22 threats, 12 write-enablement gates) |

**Residual boundaries that cannot be closed from public information:**

- Absolute Enterprise paid pricing remains unpublished; report 06 §4.4 lists the inputs for a vendor quote. This is the only gap that requires an external party.
- Registry download/install counts are not published, so group D/E/G demand remains unknown; reversal triggers are listed in report 06 §3.4.
- Benchmarks are single-vantage-point measurements; repeat from the production region before setting client SLAs.
- Windsurf's exact JSON schema could not be confirmed from live docs; use the host's UI flow (report 06 §7).

---

*End of revised recommendations report.*
