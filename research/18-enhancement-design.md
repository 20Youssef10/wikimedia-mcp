# Enhancement Design — Post-Merge Feature Portfolio

**Document version:** 1.0.0  
**Date:** 2026-11-21  
**Language:** en-GB  
**Status:** APPROVED — design complete, implementation not yet started  
**Approach:** Approach C (balanced portfolio) with Approach A's gate-first spine as the non-negotiable first tranche

> This document is the durable record of the brainstorming outcome. It does not authorise implementation by itself; an implementation plan must be agreed separately.

---

## 1. Understanding summary

- The user requested a broad feature/enhancement brainstorm spanning **all five axes**: operational/security gap closure, capability expansion, host/developer experience, result intelligence, and cost/sustainability.
- This was a **design exercise only** — no implementation while brainstorming was active.
- Baseline: shipped 28-tool server, `READ_ONLY_PROFILE=1` yields 23 tools, nightly gate with persisted JSON report, full hand-off package, write tools registered but fail-closed.
- Explicit non-goals today: Enterprise (excluded, no subscription), Lift Wing, Wikifunctions, compare-revisions, categories.
- Open human gaps: G8 legal sign-off, G1 named signatures, real OAuth/WORM/approver/TLS wiring, real-wiki rollback test.
- Success = prioritised, evidence-grounded shortlist with rationale, effort/risk, and validation triggers.

## 2. Assumptions

- Single-team operation, modest traffic, one deployment region; no Enterprise subscription; no new paid services.
- Security gates remain human-owned; tooling can assist but cannot replace signatories.
- "Enhancement" includes tooling and process, not only new MCP tools.
- New tools are feature-flagged and default-off until validated.
- No new config keys for intelligence/cost ideas where existing keys suffice.

## 3. Decision log

| ID | Decision | Alternatives considered | Why chosen |
|---|---|---|---|
| D1 | Approach C with gate-first spine | A (gate-only), B (capability-only) | Honours "all above" while protecting the human-sign-off critical path. |
| D2 | Legacy support reduced to an opt-in adapter study | Full `initialize` shim, permanent modern-only stance | Preserves modern-only default; avoids duplicating the protocol stack without evidence. |
| D3 | Backlog capped at two flagged tools | Build all deferred Group G tools | YAGNI until demand evidence exists. |
| D4 | Intelligence/cost ideas use additive fields and existing config | New config keys, output schema changes | No schema breakage; keeps AC-01…AC-155 stable. |

## 4. Portfolio structure

Five tranches:

1. **Gate-first spine** — tooling that closes or prepares G1/G7/G8; no new MCP tools. Non-negotiable, ships first.
2. **Capability** — two backlog tools, flagged, each with a validate-before-build trigger.
3. **Host & developer experience** — config generation and a bounded legacy-compat *study*.
4. **Result intelligence** — ranking hints, tiered caching, better error recovery, provenance UX.
5. **Cost & sustainability** — politeness telemetry, adaptive concurrency, request coalescing.

Tranches 2–5 are small bets with explicit kill criteria. A bet whose validation trigger fails is dropped, not defended. No idea adds a paid dependency or reopens Enterprise. The default catalogue stays at 28 tools until tranche 2 validation succeeds.

---

## 5. Tranche 1 — Gate-first spine

| Item | What it does | Why | Effort |
|---|---|---|---|
| **Gate status CLI** | `npm run gate:status` prints G1–G12 status, evidence paths and residual risks; flags unsigned gates. | Makes scattered evidence reviewable in one command; supports G1 sign-off. | S |
| **Structured sign-off recorder** | `wmcp gate record --role <role> --decision ... --evidence <hash>` writes a tamper-evident record read by the boot gate. Labelled *records decisions, does not sign*. | Removes prose ambiguity without fabricating signatures. | M |
| **WORM anchoring adapter** | Pluggable sink (S3 Object Lock / append-only log / webhook) anchoring the existing HMAC audit chain. | Closes the "external WORM anchor only modelled" gap in G6. | M |
| **Approver identity helper** | Validates two distinct OIDC subjects/groups against configured approvers; feeds MRTR confirmation. | Closes the "real approver identities absent" gap in G11. | M |
| **Real-wiki rollback harness** | testwiki-only: dry-run → edit → rollback → verify, producing a signed evidence artefact. Human executes; tool records. | Closes G7's untested rollback path. | M |

None of these register a tool or weaken fail-closed behaviour.

## 6. Tranche 2 — Capability (flagged, validate first)

- **`compare_revisions`** — Action API `action=compare`; natural complement to `get_page`/`get_sections`.
  **Build if:** three downstream requests, or ≥2% of search sessions ask for revision diffs.
- **`get_category_members`** — `list=categorymembers`; cheap, common navigation primitive.
  **Build if:** telemetry shows category traversal demand, or a named user requests it.

Both ship disabled by default; no new config keys beyond the existing feature-flag pattern.

## 7. Tranche 3 — Host & developer experience

- **`wmcp config <host>` generator** — emits correct snippets for all documented hosts, including OpenCode's mandatory `protocol` key. **Build now** (S; prevents known misconfigurations).
- **Legacy-compat adapter study** — small opt-in `initialize`-handshake adapter tested against Codex and Cursor. **Build only if** a contained adapter can translate modern requests without duplicating the protocol stack; otherwise retain modern-only.
- **Tool-reference generator** — derives Markdown tool docs from Zod schemas so docs cannot drift from shipped schemas.

## 8. Tranche 4 — Result intelligence

- Ranking hints on `search`/`get_related_pages`: `relevance_reason` and canonical-title resolution, bounded and explainable.
- Tiered caching: extend metadata cache to content using upstream `ETag`/`Cache-Control`, with `cache_tier` in output.
- Error recovery: `suggested_tool` and `next_action` on error envelopes where a deterministic recovery exists.
- Provenance UX: group `source`/`license`/`attribution` into one compact block with a ready-to-render attribution string.

## 9. Tranche 5 — Cost & sustainability

- Politeness telemetry: per-tool upstream call counts, cache hit rate and `Retry-After` proximity exported with the nightly report.
- Adaptive concurrency: temporarily reduce below 3 on 429/503 rather than only per-request backoff.
- In-flight request coalescing: identical concurrent reads share one upstream call.

All tranche 4–5 changes are internal or additive output fields — no schema breakage.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Sign-off tooling mistaken for actual approval | Loud "records, not signs" labelling; boot gate requires genuine human record. |
| WORM adapter adds operator burden | Sink optional with documented local fallback. |
| Feature flags expand test matrix | Every flag gets default-off and default-on CI passes. |
| Demand validation needs telemetry that does not exist | Tranche 2 stays blocked until telemetry is collected. |
| Legacy study scope creep | Time-boxed; no production shim without explicit re-approval. |

## 11. Non-goals (retained)

Enterprise; Lift Wing; Wikifunctions; compare-revisions/categories until validated; full legacy shim; any change to the fail-closed write posture.

## 12. Success criteria

- G1 and G8 closed by real human signatures.
- One real testwiki write executed and rolled back.
- At least two new tools with measured adoption.
- Host configuration errors eliminated by the config generator.
- Measurable reduction in upstream calls per session.
- Zero QA regressions (current baseline: 16/16, 10/10, 9/9 independent checks).

---

*End of approved enhancement design v1.0.0.*
