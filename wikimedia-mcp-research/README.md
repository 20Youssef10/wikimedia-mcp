# Wikimedia MCP Server — Research Reports

**Generated / last revised:** 21 November 2026 (verification pass and gap closure: 21 November 2026)  
**Language of reports:** en-GB (British English)  
**Status:** Verified against primary sources; see "Methodology and verification" below.

This directory contains research materials prepared as the foundation for building a comprehensive MCP (Model Context Protocol) server that unifies the Wikimedia APIs ecosystem.

## Research questions and scope

The package answers five questions:

1. **What is in the Wikimedia API ecosystem, and how do its surfaces differ?** (report 01)
2. **Which endpoints, quotas, authentication and routing rules apply to each surface?** (report 02)
3. **What does the current MCP specification require of a server?** (report 03)
4. **What has the community already built, and what is missing?** (report 04)
5. **Given 1–4, what should we build and in what order?** (report 05)

The package closes the operational gaps that remained after those five questions: live performance validation, user-demand evidence, an Enterprise cost decision model, SPARQL endpoint configuration, attribution-service resolution, an MCP host configuration matrix, a test corpus and strategy, and a formal threat model (reports 06–08). The only item that still requires an external party is the absolute paid Enterprise price, which is unpublished.

## Methodology and verification

Each report was drafted from official documentation, then verified on 21 November 2026 against live primary sources. Direct web search was unavailable during verification (HTTP 402); verification used direct HTTP fetches of official pages, the GitHub REST API and live endpoint probes.

Primary sources used:

- **MCP:** `https://modelcontextprotocol.io/specification/2026-07-28/` and its sub-pages (`architecture`, `basic`, `basic/versioning`, `server/discover`, `server/utilities/caching`, `basic/patterns/subscriptions`, `basic/transports/streamable-http`); the [changelog](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx); and the [release announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/).
- **Wikimedia Enterprise:** `/docs/`, `/docs/agents/`, `/docs/authentication/`, `/docs/best-practices/`, `/pricing.md`, `/llms.txt`.
- **MediaWiki / Wikimedia APIs:** `API:Action_API`, `API:Data_formats`, `Wikimedia_APIs/Rate_limits`, `Wikimedia_REST_API`, `Wikidata:REST_API`, EventStreams and Analytics documentation, and the Wikimedia Foundation Terms of Use.
- **Landscape:** GitHub REST API (`/repos/<owner>/<repo>`) and repository READMEs.

Reproducibility note: an official source's wording can be ambiguous (for example, the release blog's "it is not required" for `server/discover` refers to clients calling it, not servers implementing it). Where such ambiguity exists, the normative specification text takes precedence and the ambiguity is stated in the relevant report.

## Evidence and confidence notation

The reports carry a "Verified" status (see the table below), meaning their factual content was checked against primary sources on 21 November 2026. Tags are applied selectively to make notable claims easy to find:

- **[Verified]** — a corrected, change-sensitive or otherwise notable factual claim, confirmed against a named primary source cited inline or in the report's source section. Untagged factual claims fall under the report-level "Verified" status rather than being unverified.
- **[Design]** — a recommendation or architectural judgement, not a factual claim; no verification implied.
- **[Watch]** — true at verification time but subject to a known, imminent change; re-check before relying on it.

Where a claim's precision was previously overstated or understated, the current text reflects the verified position. Corrections are recorded below.

## Revision history

| Date | Change |
|------|--------|
| 2026-11-21 (initial) | MCP 2026-07-28 alignment; Enterprise quota correction; `format=php` removal; rate-limit guidance; repository cleanup; Commons/attribution/security/EventStreams notes. |
| 2026-11-21 (verification) | Added methodology, provenance and confidence labels; added the published API rate-limit tiers and the Enterprise 10 req/s hard limit; clarified that `ttlMs`/`cacheScope` are mandatory on six MCP result types; added the `MCP-Protocol-Version` header and the 2026-07-28 extensions/MRTR/auth changes; corrected landscape status labels and added repository links and activity metrics; added the WDQS v2 migration watch item, the Lift Wing rate-limit exception, a capacity/rate budget, success metrics and a risk register. Withdrawn as incorrect: an earlier suggestion that the `format=php` removal date was unsourced (it is confirmed by primary sources) and an apparent blog/spec conflict over `server/discover` (the blog refers to clients calling the RPC, not servers implementing it). |
| 2026-11-21 (gap closure) | Added reports 06–08 and `test-corpus.json`. Resolved all eight open gaps: live latency benchmarks, measured user demand with a revised roadmap, Enterprise cost decision model, WDQS endpoint configuration contract, MCP host matrix, 45-case test corpus/strategy and a STRIDE threat model. **Corrected a further error:** an earlier claim that no formal "Attribution API" exists was wrong — a beta REST API is live; reports 01, 02 and 05 were corrected. |
| 2026-11-21 (implementation contract) | Added report 09, closing all four readiness items: frozen Phase 1 tool list and JSON schemas (two ambiguities resolved), load profile for M3/M4, 32 binary MCP acceptance criteria, and the **TypeScript** stack decision. Enterprise data APIs excluded from implementation (no subscription); Python path rejected. Corrected a precision issue in the acceptance criteria: missing required `_meta` fields map to `-32602`, while `-32022` is for unsupported versions and `-32021` for capability shortfalls. |
| 2026-11-21 (implementation) | Built the Phase 1 server in `../wikimedia-mcp/`. Found and corrected a contract error: `@modelcontextprotocol/sdk` v1 does not implement 2026-07-28; the real v2 packages `@modelcontextprotocol/server`/`client@2.4.0` are pinned and verified. A principal-code-review REQUEST_CHANGES cycle fixed six blocking defects plus three recommended ones. Final gates: build, typecheck, lint, 132 tests passing, and independent QA 15/15 (stdio), 10/10 (HTTP), 9/9 (defect regression). |
| 2026-11-21 (acceptance & Phase 2) | Nightly live gate executed off-peak and **PASSED** after fixing a contract contradiction (147 samples in Class R vs a 150-sample minimum) and a provenance-detection bug — 330 live calls, M1=1.0, M4=0 429s, M5/M6=1.0. Host compatibility verified: Grok and OpenCode (with mandatory `protocol:"2026-07-28"`) pass; Cursor/Codex are legacy-client incompatibilities, Cline untested. Phase 1 merged as tag `phase-1-merged`. Phase 2 (Group B Wikidata: six tools, bounded SPARQL, external-ID map, AC-33..AC-59, 22 new corpus cases) implemented with 218 tests passing and independent QA green; merged as tag `phase-2-merged`. |
| 2026-11-21 (rough edges) | Nightly gate now persists a structured JSON report (`reports/nightly-live.json`) on every run; SPARQL label-service queries get a documented timeout bump to the 60 s cap with a warning; all three opt-in Group B live cases executed and passed (20/20). Independent QA 15/15, 10/10, 9/9. |
| 2026-11-21 (Phase 3) | Added report 11 and implemented Groups C+F: `get_pageviews`, `get_most_read`, `get_unique_devices`, `get_file_metadata`, `get_image_info` (20 total tools). Attribution beta primary with Action `extmetadata` fallback, per-file licences, zero new config keys, AC-60…AC-94, 17 new corpus cases (84 total). Live smoke verified against Analytics and Commons. 278 tests passing, independent QA green. |
| 2026-11-21 (hardening & spike) | Capped Vitest at 4 workers / 45 s timeouts — three consecutive `npm test` runs pass with identical counts. `serverInfo.version` bumped 1.0.0 → 3.0.0 (contract/protocol versions unchanged). Two additional clean nightly baselines (p95R 287–370 ms, p95A 504–638 ms, 0 429s) — no §4.6 re-baselining needed. Group D spike (report 12): registry demand still ~zero; DROP the always-on EventStreams consumer, BUILD only a bounded stateless `get_recent_changes` via Action API polling. Enterprise remains excluded; modern-only host stance retained. |
| 2026-11-21 (Phase 5) | Added report 13 and implemented the requested Group G slice: `geo_search` and `get_tables` (22 tools), Parsoid-HTML table extraction with deterministic caps, geosearch bounds, separate G5-M3/G5-M4 counters, AC-95…AC-119, 11 new corpus cases (95 total). Write tools remain hard-blocked: gate assessment found G1–G12 largely unevidenced. 308 tests passing, independent QA green. |
| 2026-11-21 (read-only sign-off) | Closed the two independently closable gates: G10 (optional `MCP_REQUIRE_ORIGIN`, documented TLS, dormant HMAC CSRF mechanism with test-only proof, dead duplicate header validator removed) and G5 (automated shipped-artifact read-only assertion). Report 14 records the read-only sign-off; G1–G4, G6–G9, G11–G12 remain NOT EVIDENCED and write tools stay hard-blocked pending a WP0–WP4 security work package. 328 tests passing, 5/5 read-only assertion, independent QA green. |
| 2026-11-21 (Group D + write package) | Added reports 15–17. Group D's `get_recent_changes` implemented via Action API polling (no SSE consumer); live defect in `rcstart`/`rcend` ordering fixed in contract v6.1.0 and verified with real changes + continuation cursor (23 tools, 101 corpus cases). Full write-tool control plane implemented behind off-by-default flags (auth/issuer, MRTR confirmation, capabilities, hash-chain audit, dry-run/rollback, canaries, two-person approval, revocation drill) with five write tools built but deliberately NOT registered. G8 (human ToU/Legal sign-off) and G1 (human security sign-off, AC-155) remain unsatisfiable by an AI — write tools stay disabled. 378 tests passing, 5/5 read-only assertion, QA 15/15 + 10/10 + 9/9. |
| 2026-11-21 (write enablement) | Product Owner explicitly instructed "enable all tools". All five write tools registered (28 total) with every control active — OAuth/issuer, MRTR signed confirmation, capability tokens, blast-radius limits, kill switch, HMAC hash-chain audit, dry-run diff, two-person approval, CSRF/Origin, redaction. `write-security/signoff.md` records this as requester risk acceptance; it explicitly does NOT fabricate named role signatures and records G8 Legal review as PENDING. `verify:catalogue` asserts 28 tools + control wiring; `READ_ONLY_PROFILE=1` still yields a 23-tool read-only build. No real wiki write performed. 378 tests passing, QA 16/16 + 10/10 + 9/9. |
| 2026-11-21 (enhancement design) | Added report 18: APPROVED five-tranche enhancement portfolio (gate-first spine, two validated backlog tools, host config generator + legacy study, result intelligence, cost telemetry), with four design decisions, risks, non-goals and success criteria. Design only — no implementation. |
| 2026-11-21 (implementation plan) | Added report 19: ordered WP1–WP18 plan covering all five tranches, with a locked baseline (378 tests; QA 16/16 + 10/10 + 9/9; nightly PASS; verify:catalogue 28; read-only 23), strict-sequence vs parallel lanes, binary exit gates, per-WP test strategy, 12-item risk register and portfolio definition of done. Plan only — no implementation. |

## Reports

| File | Description | Status |
|------|-------------|--------|
| `01-wikimedia-apis-ecosystem-overview.md` | High-level map of the Wikimedia API landscape, design philosophies, and operational constraints | Verified |
| `02-key-apis-detailed-reference.md` | Detailed reference for Action, REST, Enterprise, Analytics, EventStreams, Wikidata, etc. | Verified |
| `03-mcp-protocol-standards-and-best-practices.md` | MCP architecture and best practices aligned with the 2026-07-28 specification | Verified |
| `04-existing-mcp-servers-landscape.md` | Verified survey of current Wikipedia/Wikimedia/Wikidata MCP servers and identified gaps | Survey verified at 21 Nov 2026 |
| `05-recommendations-for-comprehensive-mcp-server.md` | Concrete design recommendations, tool grouping, architecture, security, revised phased roadmap | Facts verified; recommendations are [Design] |
| `06-validation-and-economics.md` | Live benchmarks, demand evidence, cost model, WDQS config, attribution resolution, host matrix | Verified + measured |
| `07-test-strategy.md` | Test levels, CI gates, fixture policy, write-tool testing | [Design] |
| `08-threat-model.md` | STRIDE threat model, 22 threats, 12 write-enablement gates | [Design] |
| `09-implementation-contract.md` | Frozen Phase 1 tool schemas, TypeScript stack, load profile, 32 acceptance criteria | **Frozen v1.0.1 — ready to implement** |
| `10-phase2-contract.md` | Frozen Phase 2 (Wikidata/Group B) tool contract, AC-33…AC-59 | Frozen |
| `11-phase3-contract.md` | Frozen Phase 3 (metrics + Commons/Groups C+F) contract, AC-60…AC-94 | Frozen |
| `12-group-d-spike.md` | EventStreams feasibility spike and BUILD/DROP decision | Decision: bounded poll tool, drop SSE consumer |
| `13-phase5-contract.md` | Frozen Phase 5 (requested Group G: geosearch + tables), AC-95…AC-119 | Frozen v5.0.0 |
| `14-read-only-signoff.md` | Gate status G1–G12, read-only deployment sign-off, blocked write-enablement work package | Read-only signed off; writes blocked |
| `15-group-d-contract.md` | Frozen bounded `get_recent_changes` (Action API polling, no SSE consumer), AC-120…AC-129 | Frozen v6.1.0 |
| `16-write-tools-contract.md` | Frozen write tools + G1–G12 control plane, AC-130…AC-155 | Frozen v7.0.0 — shipping blocked until gates evidenced |
| `18-enhancement-design.md` | APPROVED post-merge feature portfolio: five tranches, decision log, validation triggers, risks and success criteria | Approved design |
| `19-enhancement-implementation-plan.md` | Ordered WP1–WP18 plan: baseline lock, dependencies, acceptance criteria, test strategy, risk register, DoD | Plan approved — implementation not started |
| `test-corpus.json` | 101+ machine-readable test cases (A–G, all categories) | Validated JSON |

## How to use these documents

Read 01 → 02 → 03 → 04 → 05 for the factual and design foundation, then 06 for validation and economics, 07 with `test-corpus.json` for quality gates, and 08 for the security sign-off gates. **Implementation starts from report 09 (frozen contract v1.0.1)** — it supersedes the open readiness items in report 05 §9. The revised roadmap in report 05 §7 supersedes the original phase order. Claims marked **[Watch]** require re-verification; the only remaining `[Watch]` item is the WDQS v2 general-availability trigger (report 06 §5).

---

*Research conducted and verified against official documentation and the MCP 2026-07-28 specification as of 21 November 2026.*
