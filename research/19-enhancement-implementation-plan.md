# Implementation Plan: Post-Merge Enhancement Portfolio (Report 19)

**Document version:** 1.0.0
**Date:** 2026-11-21
**Language:** en-GB (British English)
**Status:** ACTIONABLE — implements the APPROVED design in `18-enhancement-design.md` v1.0.0
**Approach:** Approach C (balanced portfolio) with Approach A's gate-first spine as the non-negotiable first tranche
**Authority:** This plan operationalises report 18; it does not itself authorise any real wiki write, any Enterprise work, or any fabricated human signature.
**Grounding:** `18-enhancement-design.md`; `README.md` (research conventions); `package.json`, `src/`, `tests/`, `scripts/`, `write-security/`; `handoff/` artefacts (deployment runbook, sign-off templates, WORM spec, rollback plan, OAuth/CIMD template, nightly scheduler, G8 checklist, Group D reversal watch).

---

## 1. Purpose and scope

This plan hands implementers a strictly ordered set of work packages (WP1–WP18) covering all five tranches of the approved design. Each work package states its goal, inputs, exact files/areas to touch, binary acceptance criteria, verification commands and an exit gate. It is designed so that:

- the **gate-first spine (Tranche 1, WP1–WP5) ships first and in full** before any capability, host, intelligence or cost work begins;
- **Tranche 2 tools remain flagged, default-off and unregistered until measured demand telemetry exists** and a formal validation trigger is met;
- **Tranche 3 legacy compatibility is a time-boxed study that produces a decision, not a production shim**;
- **Tranches 4 and 5 are additive/internal only** and cannot break AC-01…AC-155;
- **no paid dependency is introduced, Enterprise stays out, and the fail-closed write posture is never weakened**.

"Done" for a work package means its exit gate is passed with evidence committed or recorded. A work package whose validation trigger fails is **dropped with a recorded decision**, not defended or silently re-scoped.

---

## 2. Baseline and non-regression lock (preconditions, no product change)

Before WP1, capture and freeze the current verified baseline. This is a measurement step, not a tranche, and does not change the gate-first ordering — it simply locks the numbers every later exit gate is compared against.

| Signal | Frozen baseline (must hold after every WP) | Source of truth |
|---|---|---|
| Fixture test suite | **378 tests passing** | `npm test` |
| Independent QA — stdio | **16/16** | independent `/tmp/opencode` QA script (per handoff) |
| Independent QA — HTTP | **10/10** | independent `/tmp/opencode` QA script |
| Independent QA — defect regression | **9/9** | independent `/tmp/opencode` QA script |
| Nightly live gate | **PASS** (330 calls; M1=1.0; M4=0 429s; M5/M6=1.0) | `reports/nightly-live.json`, `NIGHTLY-SCHEDULER.md` |
| Default catalogue | **28 tools**, all write controls wired | `npm run verify:catalogue` |
| Read-only profile | **23 tools**, **5/5** read-only assertions | `READ_ONLY_PROFILE=1 npm run verify:read-only` |
| Acceptance criteria | **AC-01…AC-155 all green** | corpus + contract + write suites |
| Dependencies | no new paid/runtime dependency | `package.json` diff |

**Precondition commands (run once, record output in the WP1 gate report):**

```sh
cd /data/data/com.termux/files/home/wiki-mcp/wikimedia-mcp
npm run build && npm run typecheck && npm test
npm run verify:catalogue
READ_ONLY_PROFILE=1 npm run verify:read-only
npm run lint
# opt-in, off-peak, clean egress only:
npm run build && WMCP_LIVE=1 npx vitest run tests/live/live.test.ts
```

**Caveat to carry forward:** the independent stdio/HTTP QA scripts historically contain a hardcoded **22-tool** count and already report a count mismatch against the 28-tool catalogue; they are intentionally unmodified (`DEPLOYMENT-RUNBOOK.md` §1 note). The `verify:*` scripts remain the source of truth for tool counts. "No QA regression" means the **16/16, 10/10 and 9/9 pass counts do not fall**; the stale tool-count assertion is not a regression to fix by editing those scripts.

**Convenience command aliases used throughout this plan:**

- `FULL` = `npm run build && npm run typecheck && npm test && npm run verify:catalogue && READ_ONLY_PROFILE=1 npm run verify:read-only && npm run lint`
- `QA` = the three independent QA scripts, expected **16/16 + 10/10 + 9/9**
- `NIGHTLY` = `npm run build && WMCP_LIVE=1 npx vitest run tests/live/live.test.ts` (opt-in, off-peak, clean egress)

---

## 3. Cross-cutting constraints (non-negotiable, apply to every WP)

1. **Gate-first.** WP1–WP5 (Tranche 1) are completed before WP6–WP18 start. No new MCP tool is registered before the gate spine exits.
2. **Flagged and default-off.** Any new tool (WP7, WP8) is behind an existing-pattern boolean environment flag, defaults to disabled, and is absent from the default catalogue until its validation trigger passes and a follow-up change explicitly enables it. The default catalogue stays at **28 tools** until then.
3. **Study, not shim.** WP10 produces a time-boxed decision artefact. No `initialize` shim enters `src/` or the shipped artefact without a separate, explicit re-approval.
4. **Additive only.** WP12–WP18 add new optional output fields or internal behaviour. They never remove, rename or narrow an existing field, schema, error code or config key. AC-01…AC-155 remain green.
5. **No paid dependencies, no Enterprise.** `package.json` runtime dependencies stay exactly `@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `p-limit`, `p-retry`, `undici`, `zod`. No Enterprise endpoint, subscription or data API is referenced.
6. **Fail-closed writes never weaken.** No edit to `src/write/**`, `write-security/**`, `src/server/tools/registry.ts` or the write assertions in `scripts/assert-catalogue.mjs` may remove or bypass OAuth/issuer validation, MRTR signed confirmation, capability tokens, blast-radius limits, kill switch, HMAC audit, dry-run, two-person approval, Origin/CSRF checks, redaction or the G8 upload check. `verify:catalogue` control-wiring assertions and `verify:read-only` 5/5 must stay green.
7. **No fabricated humans.** No WP records a personal name, date, signature or legal approval on behalf of a human. Sign-off tooling **records decisions, it does not sign**. G1/AC-155 and G8 remain owner-owned.
8. **Reuse over duplication.** Every WP must reuse the relevant `handoff/` artefact listed in §10 rather than inventing a parallel format.
9. **en-GB spelling** in all new and edited prose.
10. **No source/test/research edits outside the WP's stated file list.** This plan file is the only report added by this planning step.

---

## 4. Ordered work packages

### Tranche 1 — Gate-first spine (WP1 → WP5). Strictly sequential. Ships first. No new MCP tools.

---

#### WP1 — Gate status CLI (`npm run gate:status`)

- **Goal:** Print G1–G12 status, evidence paths and residual risks in one command; flag unsigned gates; freeze the baseline from §2 into the first gate report.
- **Inputs / dependencies:** None (first WP). Reads `handoff/SIGNOFF-TEMPLATES.md`, `handoff/WORM-AUDIT-SPEC.md`, `handoff/REAL-WIKI-ROLLBACK-PLAN.md`, `handoff/G8-UPLOAD-TOC-CHECKLIST.md`, `handoff/OAUTH-CIMD-TEMPLATE.md`, `handoff/DEPLOYMENT-RUNBOOK.md`, `write-security/signoff.md`, `reports/nightly-live.json`. **Must land before WP2** (the recorder's records must be displayable by this CLI).
- **Files / areas to touch (new unless noted):**
  - `src/cli/gate-status.ts` — pure status builder: gate id → `{status, evidence_paths[], residual_risks[], signed:boolean}`.
  - `src/cli/index.ts` — subcommand dispatcher (`gate status`, later `gate record`).
  - `scripts/gate-status.mjs` — thin ESM entry (mirrors `scripts/assert-catalogue.mjs` style).
  - `scripts/wmcp.mjs` — unified `wmcp` entry for later subcommands.
  - `package.json` — add scripts `gate:status` and `wmcp`.
  - `tests/unit/gate-status.test.ts` — fixture-based status tests.
  - `README.md` — document the command (additive section).
- **Acceptance criteria (binary, testable):**
  - [ ] `npm run gate:status` exits **0** and prints a row for each of G1…G12 (12 rows).
  - [ ] Each row exposes at least one evidence path that exists on disk, or the literal `NOT EVIDENCED`.
  - [ ] G1 and G8 are printed as `UNSIGNED` while `write-security/signoff.md` records requester acceptance only; the CLI exits non-zero only with `--require-signed` (default is informational).
  - [ ] The CLI never emits a personal name, date or "APPROVED" string for an unsigned gate (assert by string scan).
  - [ ] Baseline values from §2 appear in a machine-readable `reports/gate-status.json` (pretty, newline-terminated JSON, same convention as `nightly-report.ts`).
- **Verification:** `FULL`; `npm run gate:status`; `npm run gate:status -- --require-signed` (expected non-zero); `QA`.
- **Exit gate:** `FULL` green with 378 tests; QA 16/16 + 10/10 + 9/9; 12 gate rows emitted; unsigned gates flagged; baseline JSON committed. **Then, and only then, start WP2.**

---

#### WP2 — Structured sign-off recorder (`wmcp gate record`)

- **Goal:** Provide a tamper-evident, append-only recorder for human gate decisions that the boot gate and `gate:status` can read. Explicitly labelled *records decisions, does not sign*.
- **Inputs / dependencies:** Requires WP1 (gate status CLI exists to display records). Reuses `handoff/SIGNOFF-TEMPLATES.md` block structure and the HMAC-chain pattern in `src/write/audit.ts`.
- **Files / areas to touch:**
  - `src/cli/gate-record.ts` — `recordGateDecision({role, decision, evidenceHash, gateId, signatoryRef})`; appends a hash-chained record.
  - `src/cli/record-chain.ts` — small append/verify chain (canonical JSON + HMAC-SHA256, `genesis` head, `verify()`), mirroring `AuditStore` semantics without reusing write secrets.
  - `write-security/records/` (new dir) — append-only `gate-decisions.json` + daily anchors; gitignored raw secrets, committed schema/doc only.
  - `src/cli/gate-status.ts` (edit) — read records and report a gate as `RECORDED (not signed)` distinctly from `SIGNED`.
  - `src/write/config.ts` (edit, read-only inspection only) — expose a helper for "does a genuine signed record exist" used by the existing `MCP_WRITE_GATES_SIGNED` boot rule; **do not relax that rule**.
  - `tests/unit/gate-record.test.ts` — append, verify, tamper (edit/delete/reorder/truncate) tests.
  - `write-security/signoff.md` (edit, additive) — one line clarifying recorder vs signature; no names/dates added.
- **Acceptance criteria:**
  - [ ] `npm run wmcp -- gate record --role <role> --decision APPROVE_WITH_CONDITIONS --evidence <sha256> --gate G6` appends exactly one record with a valid `prev_hash`/`record_hash` chain.
  - [ ] `verify()` returns `null` on an intact chain and a non-null index on each of the four tamper cases.
  - [ ] Output string contains `RECORDS DECISIONS — DOES NOT SIGN` on every invocation.
  - [ ] `MCP_WRITE_GATES_SIGNED=true` still fails at boot unless the genuine signed artefact exists (no bypass via recorded decisions).
  - [ ] `npm run gate:status` shows `RECORDED (not signed)` for a recorded gate, never `SIGNED`.
- **Verification:** `FULL`; targeted `npx vitest run tests/unit/gate-record.test.ts tests/unit/gate-status.test.ts`; `QA`.
- **Exit gate:** chain-verify tests green, no boot-rule relaxation, no fabricated signature, `FULL` + `QA` green.

---

#### WP3 — WORM anchoring adapter (closes G6 evidence gap)

- **Goal:** Make the existing injectable `anchorSink` real and pluggable so the HMAC audit chain can be externally anchored; keep a documented local fallback.
- **Inputs / dependencies:** Requires WP2 (recorded evidence format) so anchoring results can be recorded. Reuses `handoff/WORM-AUDIT-SPEC.md` §3–§7 verbatim for verification/retention/export rules.
- **Files / areas to touch:**
  - `src/write/audit-sink.ts` (new) — sink implementations: `local-noop` (default, unchanged behaviour), `append-only-log`, `s3-object-lock`, `webhook`; one exported `createAnchorSink(kind, opts)`.
  - `src/write/audit.ts` (edit) — keep `AuditStore` semantics; add automatic chain verification (`verify()` + `verifyHead()`) inside `anchorDaily()` and `export()`.
  - `src/write/default-runtime.ts` (edit) — inject the configured sink; default stays `local-noop`.
  - `src/write/config.ts` (edit) — reuse existing `MCP_WRITE_AUDIT_SINK`/`MCP_WRITE_AUDIT_HMAC_SECRET`/`MCP_WRITE_AUDIT_RETENTION_DAYS`; **no new config keys**.
  - `tests/write/worm-sink.test.ts` (new) — fixture MSW/webhook sink, append-only file sink, noop sink, chain-verify-on-export, retention metadata.
  - `handoff/WORM-AUDIT-SPEC.md` (edit, additive) — mark which acceptance boxes are now machine-checkable.
- **Acceptance criteria:**
  - [ ] All three concrete sinks pass a fixture round-trip: anchor written, `verifyHead(anchor.head) === true`, no HMAC secret in the sink payload (string scan).
  - [ ] `export()` refuses to export when `verify() !== null` or head mismatch (throws).
  - [ ] Default config still yields the in-process `memory:process` chain with the no-op sink; `verify:catalogue` stays green.
  - [ ] 365-day retention is *documented as sink-enforced*, not claimed by `AuditStore`; WORM spec acceptance box for "sink enforces retention" remains a human/operator check.
  - [ ] No new paid dependency: sink code uses `undici`/Node built-ins only.
- **Verification:** `FULL`; `npx vitest run tests/write/worm-sink.test.ts tests/write/control-plane.test.ts tests/write/incident-drill.test.ts`; `QA`.
- **Exit gate:** sink tests green, default behaviour unchanged, no secret leakage, `FULL` + `QA` green. **G6 evidence may now be attached — not before.**

---

#### WP4 — Approver identity helper (closes G11 evidence gap)

- **Goal:** Validate two *distinct* OIDC subjects/groups against `MCP_WRITE_APPROVER_IDS` and feed the MRTR confirmation path, so two-person approval can be evidenced with real identities.
- **Inputs / dependencies:** Requires WP1–WP2; reuses actor hashing from `src/write/auth.ts` and `handoff/OAUTH-CIMD-TEMPLATE.md` §3/§5 and the G11 section of `handoff/SIGNOFF-TEMPLATES.md`.
- **Files / areas to touch:**
  - `src/write/approvers.ts` (new) — `validateApprovers(approvals, config)` → hashed subject/group ids; rejects duplicates, missing, unconfigured ids; emits a structured reason.
  - `src/write/handlers.ts` (edit) — call the helper on the four tools that require two-person approval; **approval_required path unchanged for failures**.
  - `src/write/auth.ts` (edit, minimal) — export the existing hash-prefix helper for reuse; do not change token validation.
  - `src/write/config.ts` (edit) — keep the `>= 2 distinct ids` boot rule; no relaxation.
  - `tests/write/approvers.test.ts` (new) — distinctness, hashed-only storage, unconfigured id, replay, scope interaction.
  - `write-security/two-person-approval-runbook.md` (edit, additive) — note the helper and that it does not supply identities.
- **Acceptance criteria:**
  - [ ] Two distinct configured approver ids → approval accepted; two identical ids → rejected with `approval_required` (binary).
  - [ ] Approver ids are stored only as `sha256-prefix:`; raw subjects never appear in audit or logs (string scan).
  - [ ] Unconfigured id, replayed id and id for a tool not requiring approval behave exactly as today.
  - [ ] `verify:catalogue` still asserts two-person approval wiring and no auto-confirm.
- **Verification:** `FULL`; `npx vitest run tests/write/approvers.test.ts tests/write/control-plane.test.ts tests/write/lifecycle.test.ts`; `QA`.
- **Exit gate:** helper tests green, fail-closed approval path intact, `FULL` + `QA` green. **G11 evidence may now be attached — not before.**

---

#### WP5 — Real-wiki rollback harness (testwiki-only, human-executed)

- **Goal:** A recording harness for the dry-run → edit → rollback → verify sequence that produces a signed *evidence artefact*; the human performs the write, the tool records it.
- **Inputs / dependencies:** Requires WP3 (chain export) and WP4 (two distinct approvers) plus the REAL-WIKI-ROLLBACK-PLAN prerequisites and real G8/AC-155 signatures — which are **owner-supplied**. This WP builds the harness; it does not execute a real write.
- **Files / areas to touch:**
  - `src/cli/rollback-harness.ts` (new) — orchestrates preview/execute/rollback calls against the existing write handlers; refuses any project other than `testwiki`.
  - `scripts/rollback-harness.mjs` (new) — ESM entry, `--dry-run` default, `--execute` requires explicit `--operator`/`--witness` refs and `--i-have-signoff`.
  - `write-security/evidence/` (new dir) — newline-terminated JSON evidence artefacts (exported chain + diff hashes + timestamps).
  - `tests/unit/rollback-harness.test.ts` (new) — fixture-only: project rejection, dry-run no mutation, artefact shape, chain export present.
  - `handoff/REAL-WIKI-ROLLBACK-PLAN.md` (edit, additive) — reference the harness commands in the existing human checklist; do not fill in result blanks.
- **Acceptance criteria:**
  - [ ] `--dry-run` makes zero mutating Action API calls and returns `executed:false, would_change:true` (fixture assertion).
  - [ ] Any project other than `testwiki` is rejected without a network call.
  - [ ] `--execute` without `--i-have-signoff` exits non-zero with no call.
  - [ ] Evidence artefact contains exported `events` + `anchors`, chain verified, and a `license_not_signed_off`-style fail-closed check for upload remains intact.
  - [ ] No real wiki write is performed by this WP (human-only, evidenced by the blank sign-off plan).
- **Verification:** `FULL`; `npx vitest run tests/unit/rollback-harness.test.ts tests/write/lifecycle.test.ts`; `QA`. Real execution is a separate, human-owned event (`NIGHTLY` not involved).
- **Exit gate:** fixture harness green, testwiki guard proven, no real write executed, `FULL` + `QA` green. **Tranche 1 complete. Only now may Tranche 2–5 begin.**

---

### Tranche 2 — Capability (WP6 → WP8). Flagged, default-off, validation-gated.

---

#### WP6 — Demand telemetry and validation gate (no tools built)

- **Goal:** Collect the demand signals the two flagged tools require, and produce a binary build/drop decision. This WP is the **telemetry prerequisite** that unblocks WP7/WP8.
- **Inputs / dependencies:** After Tranche 1. Reuses the nightly report infrastructure (`src/observability/nightly-report.ts`) and `handoff/NIGHTLY-SCHEDULER.md` collection/alerting pattern. No new config keys.
- **Files / areas to touch:**
  - `src/observability/demand-telemetry.ts` (new) — incremental counters: `get_summary`/`search` call sites, `revision_diff_requested` and `category_traversal_requested` signal counters, keyed by tool and session surrogate (no PII).
  - `src/server/tools/handlers.ts` (edit, additive instrumentation only) — increment signal counters on the relevant read paths.
  - `src/observability/nightly-report.ts` (edit, additive optional fields only) — include `demand_signals` block; keep `schema_version:1` compatibility by adding optional fields.
  - `reports/demand.json` (new, gitignored, archived by timestamp per scheduler §5) — rolling evidence.
  - `tests/unit/demand-telemetry.test.ts` (new).
  - `README.md` (additive) — explain "signals are counts, not requests".
- **Acceptance criteria:**
  - [ ] Counters increment only on the documented read paths; no PII, token or title content in `reports/demand.json` (string scan).
  - [ ] Report remains parseable by the existing nightly alert snippet (`overallPass`, `m4_429_count`, `failures` unchanged).
  - [ ] A `reports/demand-decision.json` is produced with `compare_revisions: BUILD|DROP` and `get_category_members: BUILD|DROP` and the exact measured numbers and dates.
  - [ ] Decision rules hard-coded: `compare_revisions` BUILD iff **≥3 downstream requests OR ≥2% of search sessions** request revision diffs over **≥7 consecutive days** of telemetry; `get_category_members` BUILD iff **measured category traversal demand OR a named user request with requester + date**. Otherwise DROP.
  - [ ] Default catalogue remains **28 tools**; no new tool is registered by this WP.
- **Verification:** `FULL`; `npx vitest run tests/unit/demand-telemetry.test.ts tests/live/nightly-report.test.ts`; run the nightly alert snippet against a sample report; `QA`.
- **Exit gate:** telemetry tests green, decision JSON committed, 28-tool catalogue intact. A DROP decision closes the corresponding WP7/WP8 as "dropped with evidence" — no tool is built.

---

#### WP7 — `compare_revisions` (CONDITIONAL — only if WP6 says BUILD)

- **Goal:** Add a flagged, default-off read tool wrapping Action API `action=compare`.
- **Inputs / dependencies:** WP6 decision = BUILD. Follows the existing group-module pattern (`src/groupg`, `src/groupd`).
- **Files / areas to touch:**
  - `src/compare/{constants,schemas,handlers}.ts` (new) — Zod schema, bounded diff output, `source`/`lang`/`project` allowlist, `ttlMs`/`cacheScope` where mandated by contract.
  - `src/config.ts` (edit, additive) — flag `MCP_ENABLE_COMPARE_REVISIONS` default `false`, following the existing boolean-env pattern.
  - `src/server/tools/registry.ts` (edit, additive) — conditionally add to `PHASE1/activeToolNames()`-equivalent registration only when flag is true; default `TOOL_NAMES` stays 28.
  - `tests/unit/compare-revisions.test.ts` + a new `tests/contract/compare.test.ts` (new) — schema, bounds, flag-off absence, flag-on registration.
  - `scripts/assert-catalogue.mjs` (edit, additive only) — assert flag-off = 28; add a separate flag-on check that expects 29 without removing any existing assertion.
  - `scripts/assert-flags.mjs` (new) — default-off/default-on CI passes for the flag.
- **Acceptance criteria:**
  - [ ] With no flag set: catalogue **28**, tool absent, 23-tool read-only unchanged.
  - [ ] With flag `true`: tool present (29), schema validates, fixture returns bounded diff with provenance/`ttlMs`.
  - [ ] Flag-on CI pass and flag-off CI pass both green; `verify:catalogue` default still asserts 28 with all write controls.
  - [ ] No paid dependency; no Enterprise endpoint; fail-closed write posture unchanged.
- **Verification:** `FULL`; `node scripts/assert-flags.mjs`; `npx vitest run tests/unit/compare-revisions.test.ts tests/contract/compare.test.ts`; `QA`.
- **Exit gate:** both flag passes green, default catalogue 28, `FULL` + `QA` green. Enabling by default is a **separate, later, explicitly approved change** — not part of this WP.

---

#### WP8 — `get_category_members` (CONDITIONAL — only if WP6 says BUILD)

- **Goal:** Add a flagged, default-off read tool wrapping `list=categorymembers`.
- **Inputs / dependencies:** WP6 decision = BUILD. Independent of WP7 (can run in parallel once WP6 exits).
- **Files / areas to touch:**
  - `src/categories/{constants,schemas,handlers}.ts` (new) — bounded `cmtitle`/`cmnamespace`/`cmlimit` schema, continuation cursor, `ttlMs`/`cacheScope` where mandated.
  - `src/config.ts` (edit, additive) — flag `MCP_ENABLE_GET_CATEGORY_MEMBERS` default `false`.
  - `src/server/tools/registry.ts` (edit, additive) — conditional registration as in WP7.
  - `tests/unit/get-category-members.test.ts` + `tests/contract/categories.test.ts` (new).
  - `scripts/assert-catalogue.mjs` (edit, additive) — flag-off 28 / flag-on 29; no existing assertion removed.
  - `scripts/assert-flags.mjs` (edit, additive) — second flag pair.
- **Acceptance criteria:**
  - [ ] Flag-off: catalogue 28, tool absent; flag-on: 29, tool present with valid bounded schema.
  - [ ] Continuation cursor is opaque and bounded; malformed cursor → `invalid_cursor` with the existing `DEFAULT_ACTIONS` recovery hint.
  - [ ] Both flag passes green; `verify:catalogue` and read-only 23/5-5 unchanged.
- **Verification:** `FULL`; `node scripts/assert-flags.mjs`; targeted unit + contract tests; `QA`.
- **Exit gate:** as WP7. **Tranche 2 complete (built or formally dropped).**

---

### Tranche 3 — Host & developer experience (WP9, WP10, WP11).

---

#### WP9 — `wmcp config <host>` generator (BUILD NOW)

- **Goal:** Emit correct MCP client snippets for every documented host, including OpenCode's mandatory `protocol:"2026-07-28"` key, eliminating the known misconfiguration class.
- **Inputs / dependencies:** After Tranche 1. Independent of WP6–WP8. Reuses the host matrix in research report 06 and `handoff/DEPLOYMENT-RUNBOOK.md` §2 config block.
- **Files / areas to touch:**
  - `src/cli/config-generator.ts` (new) — host profiles for Grok, OpenCode, Cursor, Codex, Cline and the generic stdio/HTTP cases; emits JSON snippets with `protocol` where required.
  - `src/cli/index.ts` (edit) — register `config` subcommand.
  - `tests/unit/config-generator.test.ts` (new) — snapshot each host; assert OpenCode includes `protocol:"2026-07-28"`.
  - `README.md` (additive) — document `npm run wmcp -- config <host>`.
- **Acceptance criteria:**
  - [ ] Every host named in report 06's matrix produces a snippet; OpenCode snippet contains `protocol` exactly `"2026-07-28"`.
  - [ ] Generated snippets never include a secret, token or wildcard host/origin.
  - [ ] `FULL` green; no tool registration change (catalogue still 28).
- **Verification:** `FULL`; `npx vitest run tests/unit/config-generator.test.ts`; `npm run wmcp -- config opencode`; `QA`.
- **Exit gate:** snapshots green, no secret in output, `FULL` + `QA` green.

---

#### WP10 — Legacy-compat adapter study (TIME-BOXED, decision only)

- **Goal:** Determine, within a fixed budget, whether a contained opt-in `initialize`-handshake adapter can translate legacy Codex/Cursor requests without duplicating the protocol stack. Produce a decision; ship no shim.
- **Inputs / dependencies:** After Tranche 1. Reuses `handoff/GROUP-D-REVERSAL-WATCH.md` as the time-boxed watch/decision template.
- **Files / areas to touch:**
  - `research/19a-legacy-adapter-study.md` (new research/decision artefact — the only new file outside the implementation plan; if the single-file constraint of the planning step still applies to implementers, fold into `handoff/legacy-compat-study.md` instead) — hypothesis, time box (**≤5 working days**), test matrix against Codex/Cursor, findings, BUILD/KEEP-MODERN-ONLY decision.
  - `spikes/legacy-adapter/` (new, non-shipped) — throwaway adapter probe; excluded from `tsconfig.json`/build inputs.
  - `package.json` / `src/**` — **no production change permitted in this WP**.
- **Acceptance criteria:**
  - [ ] Decision artefact contains an explicit `BUILD` or `KEEP MODERN-ONLY` verdict with evidence and named date.
  - [ ] Time box not exceeded; no production registration, no shipped shim, no `initialize` code in `src/`.
  - [ ] A `BUILD` verdict is explicitly conditional on **separate re-approval** and does not itself authorise a shim.
  - [ ] `FULL` green and catalogue still 28 (no source change).
- **Verification:** `FULL`; review decision artefact; `QA`.
- **Exit gate:** decision recorded; `KEEP MODERN-ONLY` is the expected/default outcome; any `BUILD` is parked pending re-approval. **Legacy shim remains a non-goal.**

---

#### WP11 — Tool-reference generator (drift-proof docs)

- **Goal:** Derive Markdown tool documentation from the shipped Zod schemas so docs cannot drift.
- **Inputs / dependencies:** After Tranche 1. Scaffold now; **regenerate at portfolio DoD** so it reflects WP7/WP8/WP12–WP15 additive fields.
- **Files / areas to touch:**
  - `scripts/gen-tool-reference.mjs` (new) — import built schemas from `dist/`, emit deterministic Markdown.
  - `TOOLS.md` (new, generated) — committed output.
  - `package.json` (additive script `docs:tools`).
  - `tests/unit/tool-reference.test.ts` (new) — deterministic output, field coverage, no secret.
- **Acceptance criteria:**
  - [ ] `npm run docs:tools` produces byte-identical `TOOLS.md` on two consecutive runs.
  - [ ] Every schema field for every registered tool appears; no secret or internal-only field appears.
  - [ ] Regeneration after later WPs changes only additive-field documentation.
- **Verification:** `FULL`; `npm run docs:tools && git diff --exit-code -- TOOLS.md`; `QA`.
- **Exit gate:** deterministic output, `FULL` + `QA` green. **Tranche 3 complete.**

---

### Tranche 4 — Result intelligence (WP12–WP15). Additive output fields only. Must not break AC-01…AC-155.

---

#### WP12 — Ranking hints and canonical-title resolution

- **Goal:** Add bounded, explainable `relevance_reason` and canonical-title resolution on `search`/`get_related_pages`.
- **Inputs / dependencies:** After Tranche 1; independent of Tranche 2/3. Reuses `src/resolver.ts`, `src/lang.ts`.
- **Files / areas to touch:** `src/server/tools/handlers.ts`, `src/resolver.ts`, `src/types.ts` (add optional fields), `tests/unit/ranking-hints.test.ts` (new), corpus cases appended to `research/test-corpus.json` (additive cases only, no existing case edited).
- **Acceptance criteria:**
  - [ ] New fields are optional and additive; removing them from an assertion still yields a valid prior-shape response (superset check).
  - [ ] `relevance_reason` is one of a fixed enumerated set; canonical title resolves to the server's allowlisted project/lang only.
  - [ ] All pre-existing corpus/case assertions pass unchanged; AC-01…AC-155 green.
- **Verification:** `FULL`; targeted unit + `npm test` (≥378); `QA`.
- **Exit gate:** superset check green, count ≥378, `FULL` + `QA` green.

---

#### WP13 — Tiered caching with `cache_tier`

- **Goal:** Extend the metadata cache to content using upstream `ETag`/`Cache-Control`, exposing an additive `cache_tier` output field.
- **Inputs / dependencies:** After Tranche 1; independent. Reuses `src/protocol/caching.ts`, `src/groupd/cache.ts`, `src/upstream/client.ts`.
- **Files / areas to touch:** `src/protocol/caching.ts`, `src/upstream/client.ts`, `src/types.ts`, `tests/unit/caching.test.ts` (edit, additive), `tests/fixtures/cassettes/` (new ETag/304 cassettes).
- **Acceptance criteria:**
  - [ ] `ETag`/`Cache-Control` honored with a bounded TTL; a 304 produces the cached body without a full re-fetch (fixture assertion).
  - [ ] `cache_tier` is additive; existing `ttlMs`/`cacheScope` semantics unchanged.
  - [ ] No cache key includes a token, raw subject or unallowlisted host; `verify:read-only` still 5/5.
- **Verification:** `FULL`; `npx vitest run tests/unit/caching.test.ts tests/unit/fixtures.test.ts`; `QA`.
- **Exit gate:** fixture 304 path green, `FULL` + `QA` green.

---

#### WP14 — Error-recovery fields (`suggested_tool`, `next_action`)

- **Goal:** Add deterministic recovery hints to error envelopes where a known recovery exists.
- **Inputs / dependencies:** After Tranche 1. Reuses `src/protocol/errors.ts` (already has `action` and `DEFAULT_ACTIONS`) and `src/types.ts`.
- **Files / areas to touch:** `src/protocol/errors.ts`, `src/types.ts`, `tests/unit/protocol-errors.test.ts` (edit, additive), `tests/contract/stdio.test.ts` and `tests/contract/http.test.ts` (assert superset only).
- **Acceptance criteria:**
  - [ ] `suggested_tool`/`next_action` appear only where a deterministic recovery exists; otherwise absent.
  - [ ] Existing `code`, `message`, `action`, `retry_after_seconds` semantics unchanged; error-code set unchanged (no new `ToolErrorCode`).
  - [ ] No raw upstream status text, token or title leaked (string scan across error suite).
- **Verification:** `FULL`; `npx vitest run tests/unit/protocol-errors.test.ts tests/contract/stdio.test.ts tests/contract/http.test.ts`; `QA`.
- **Exit gate:** error suite green with unchanged codes, `FULL` + `QA` green.

---

#### WP15 — Provenance UX block

- **Goal:** Group `source`/`license`/`attribution` into one compact block with a ready-to-render attribution string.
- **Inputs / dependencies:** After Tranche 1; serialise **after WP14 and before WP12** if merging into shared response-shaping files (see §5). Reuses `src/attribution/assemble.ts`, `src/attribution/license.ts`, `src/protocol/result.ts`.
- **Files / areas to touch:** `src/attribution/assemble.ts`, `src/protocol/result.ts`, `src/types.ts`, `tests/unit/attribution.test.ts` (edit, additive), `tests/phase3/phase3-media.test.ts` (superset assertions).
- **Acceptance criteria:**
  - [ ] Existing flat provenance fields remain present and unchanged; the new grouped block is additive.
  - [ ] Attribution string is derived from the same licence data as the flat fields (no divergence); disclaimer preserved.
  - [ ] `verify:catalogue` 28 and read-only 23/5-5 unchanged.
- **Verification:** `FULL`; `npx vitest run tests/unit/attribution.test.ts tests/phase3/phase3-media.test.ts`; `QA`.
- **Exit gate:** provenance tests green, no flat-field change, `FULL` + `QA` green. **Tranche 4 complete — regenerate `TOOLS.md` (WP11 output).**

---

### Tranche 5 — Cost & sustainability (WP16 → WP17/WP18). Internal/additive only.

---

#### WP16 — Politeness telemetry in the nightly report

- **Goal:** Export per-tool upstream call counts, cache hit rate and `Retry-After` proximity with the nightly report. **Measurement prerequisite for WP17/WP18.**
- **Inputs / dependencies:** After Tranche 1; reuses WP6 counter approach and `src/observability/nightly-report.ts`, `src/upstream/pacing.ts`, `NIGHTLY-SCHEDULER.md` §5–§7.
- **Files / areas to touch:** `src/observability/nightly-report.ts` (additive optional `politeness` block), `src/upstream/client.ts`/`src/upstream/pacing.ts` (counters), `tests/live/nightly-report.test.ts` (edit, additive), `handoff/NIGHTLY-SCHEDULER.md` (additive field documentation).
- **Acceptance criteria:**
  - [ ] Report still satisfies the existing alert snippet (`overallPass`, `m4_429_count`, `failures`, `total=330`, `measured=300`, `peak_concurrency<=3`).
  - [ ] New fields are counts/ratios only — no token, title, raw subject or secret.
  - [ ] `NIGHTLY` (opt-in) passes with 0 429s; baseline p95 ranges unchanged in kind.
- **Verification:** `FULL`; `npx vitest run tests/live/nightly-report.test.ts`; `NIGHTLY`; alert snippet; `QA`.
- **Exit gate:** nightly PASS with 0 429s, report backward-compatible, `FULL` + `QA` green. **Then WP17 and WP18 may run in parallel.**

---

#### WP17 — Adaptive concurrency (temporarily below 3 on 429/503)

- **Goal:** Reduce effective concurrency temporarily on `429`/`503` rather than relying only on per-request backoff.
- **Inputs / dependencies:** WP16 (to measure the effect). Reuses `src/upstream/limiter.ts`, `src/upstream/client.ts`, existing `CONCURRENCY_LIMIT` cap of 3 (`src/config.ts`). **No new config key.**
- **Files / areas to touch:** `src/upstream/limiter.ts`, `src/upstream/client.ts`, `tests/unit/retry.test.ts` + `tests/resilience/resilience.test.ts` (additive), `src/observability/nightly-report.ts` (additive reduction counter).
- **Acceptance criteria:**
  - [ ] Effective concurrency never exceeds `CONCURRENCY_LIMIT` (3); it only decreases temporarily and recovers to the configured value.
  - [ ] A `429`/`503` fixture causes a bounded reduction with documented recovery; no change to `RETRY_*` semantics or `Retry-After` handling.
  - [ ] `NIGHTLY` still PASS with M4=0 429s and `total=330`.
- **Verification:** `FULL`; `npx vitest run tests/unit/retry.test.ts tests/resilience/resilience.test.ts`; `NIGHTLY`; `QA`.
- **Exit gate:** no cap breach, nightly green, `FULL` + `QA` green.

---

#### WP18 — In-flight request coalescing

- **Goal:** Let identical concurrent reads share one upstream call, reducing calls per session without changing output.
- **Inputs / dependencies:** WP16 (measurement). Reuses `src/upstream/client.ts`; must respect abort signals and the existing cache. **No new config key, no output change.**
- **Files / areas to touch:** `src/upstream/client.ts`, `tests/resilience/network-error.test.ts` + `tests/unit/caching.test.ts` (additive), `src/observability/nightly-report.ts` (coalesced-call counter).
- **Acceptance criteria:**
  - [ ] Two identical concurrent reads produce one upstream call (fixture assertion) and identical responses to sequential calls.
  - [ ] Abort of one waiter does not cancel the shared call or affect the other waiter; errors are fanned out correctly.
  - [ ] No coalescing across distinct `lang`/`project`/credential scopes; no token in the coalescing key.
  - [ ] Measured reduction in upstream calls per session is reported from WP16 telemetry; `NIGHTLY` still PASS.
- **Verification:** `FULL`; `npx vitest run tests/resilience/network-error.test.ts tests/unit/caching.test.ts`; `NIGHTLY`; `QA`.
- **Exit gate:** coalescing + abort tests green, measurable reduction evidenced, `FULL` + `QA` green. **Tranche 5 complete.**

---

## 5. Dependency graph and ordering (parallel vs strictly sequential)

### 5.1 Strictly sequential chains (must not be reordered)

```
[Baseline freeze §2]
        |
        v
WP1 gate:status  --(before)-->  WP2 gate record
        |                            |
        +-------> WP3 WORM adapter <--+ (record format feeds anchors)
                       |                      WP4 approver helper
                       |                            |
                       +----------> WP5 rollback harness  (needs WP3 chain + WP4 approvers)
                                          |
                    ===== TRANCHE 1 EXIT GATE =====
                                          v
        WP6 telemetry + validation decision (BUILD/DROP)
                       |                       |
                (BUILD) v                       v (BUILD)
                     WP7                     WP8
```
Additional strict edges required by the brief:

- **WP1 → WP2:** gate status CLI before sign-off recorder (recorder records must be displayable).
- **WP3 → G6 evidence; WP4 → G11 evidence:** external evidence may only be attached after the corresponding adapter/helper exists and its exit gate passes.
- **WP6 → WP7 / WP8:** no flagged tool is built before telemetry and the validation trigger.
- **WP16 → WP17 / WP18:** measurement before optimisation, so "measurable reduction" is provable.
- **WP11 regenerate last:** `TOOLS.md` is regenerated at portfolio DoD, after all additive output fields exist.

### 5.2 Parallelisable lanes (after Tranche 1 exit gate)

| Lane | Work packages | Constraint |
|---|---|---|
| A — capability | WP7 ∥ WP8 (only if WP6 says BUILD) | Both edit `registry.ts`/`assert-catalogue.mjs` — serialise those two specific edits to avoid merge conflicts; tests can run in parallel. |
| B — host/dev-ex | WP9 ∥ WP10 ∥ WP11(scaffold) | WP10 must not touch `src/`; WP11 scaffold later regenerated. |
| C — intelligence | WP13 ∥ WP14; then WP15 → WP12 | WP12 and WP15 both shape success envelopes — run WP15 first, then WP12, to avoid conflicting result-assembly edits. |
| D — cost | WP17 ∥ WP18 (after WP16) | Both edit `nightly-report.ts` additively — serialise that one file edit; limiter and client changes are otherwise independent. |

**Merge rule:** wherever two WPs must touch the same file (`registry.ts`, `assert-catalogue.mjs`, `nightly-report.ts`, response-shaping modules), land the smaller additive change first and re-run `FULL` before the second. No force merges; no resetting the gate-first spine.

---

## 6. Test strategy

### 6.1 Per-work-package coverage matrix

| WP | Unit | Contract / schema | Fixture harness (MSW/cassettes) | Live (opt-in) | Independent QA |
|---|---|---|---|---|---|
| WP1 | `gate-status.test.ts` | gate row shape + JSON report | file-based evidence fixtures | — | 16/16 + 10/10 + 9/9 |
| WP2 | `gate-record.test.ts` | record schema | chain tamper fixtures | — | same |
| WP3 | `worm-sink.test.ts` | audit event schema | webhook/append-only/noop sinks | — | same |
| WP4 | `approvers.test.ts` | approval reason schema | existing write harness | — | same |
| WP5 | `rollback-harness.test.ts` | evidence artefact schema | fixture write handlers (no mutation) | human-only, separate event | same |
| WP6 | `demand-telemetry.test.ts` | demand JSON schema | sample nightly report | NIGHTLY collection | same |
| WP7 | `compare-revisions.test.ts` | `tests/contract/compare.test.ts` | Action `compare` cassette | optional smoke | same |
| WP8 | `get-category-members.test.ts` | `tests/contract/categories.test.ts` | `categorymembers` cassette | optional smoke | same |
| WP9 | `config-generator.test.ts` | snippet snapshots | — | — | same |
| WP10 | — (study) | — | spike probes (non-shipped) | manual Codex/Cursor | same |
| WP11 | `tool-reference.test.ts` | generated Markdown determinism | built schemas | — | same |
| WP12 | `ranking-hints.test.ts` | superset response check | resolver fixtures | — | same |
| WP13 | `caching.test.ts` (additive) | `ttlMs`/`cacheScope` unchanged | ETag/304 cassettes | optional smoke | same |
| WP14 | `protocol-errors.test.ts` (additive) | stdio/HTTP error superset | error fixtures | — | same |
| WP15 | `attribution.test.ts` (additive) | flat-field preservation | media fixtures | — | same |
| WP16 | `nightly-report.test.ts` (additive) | alert-snippet compatibility | report sample | NIGHTLY required | same |
| WP17 | `retry.test.ts`, `resilience.test.ts` | cap-3 assertion | 429/503 fixtures | NIGHTLY required | same |
| WP18 | `network-error.test.ts`, `caching.test.ts` | identical-response assertion | concurrency fixture | NIGHTLY required | same |

### 6.2 Global non-regression rule

Every WP exit gate runs `FULL` and `QA`. The following must hold at every exit gate:

- `npm test` reports **≥378 passing** and zero failing (new tests only increase the count; no existing test deleted or weakened).
- `QA` reports **16/16 + 10/10 + 9/9** (no fall; ignore the intentionally stale 22-tool assertion per §2).
- `npm run verify:catalogue` reports **28 tools** with all write-control wiring assertions green (until a flagged-tool enable change, which is out of scope for these WPs).
- `READ_ONLY_PROFILE=1 npm run verify:read-only` reports **5/5 PASS, 23 tools**.
- `NIGHTLY` remains **PASS** with M4=0 429s at every WP that touches upstream/telemetry behaviour.
- AC-01…AC-155 remain green in the corpus/contract/write suites.

### 6.3 Flagged-tool CI matrix

Each of WP7 and WP8 adds a `scripts/assert-flags.mjs` pass with two CI invocations: **flag default-off** (28 tools, tool absent) and **flag on** (29 tools, tool present). Both must pass in CI. No test may assume a flagged tool is present by default.

### 6.4 Test hygiene

- Do not edit `handoff/` QA scripts or the research `test-corpus.json` existing cases; append new cases only.
- New cassettes go under `tests/fixtures/cassettes/` with a clear case id; never record real tokens or titles.
- Fixture-only remains the merge gate; `WMCP_LIVE=1` is set only for the opt-in nightly job.

---

## 7. Risk register (with mitigations and validation triggers)

| ID | Risk | Mitigation | Validation trigger before the flagged item is built/shipped |
|---|---|---|---|
| R1 | Sign-off tooling mistaken for genuine approval | WP2 loud `RECORDS DECISIONS — DOES NOT SIGN`; WP1 flags unsigned gates; boot gate still requires real signed artefact | G1/G8 closed only by real human signatures in `SIGNOFF-TEMPLATES.md`; no WP may set them |
| R2 | WORM adapter adds operator burden | Default `local-noop` sink unchanged; sinks optional; documented fallback in WORM spec | G6 evidence: real sink injected, sink-enforced 365-day retention, automated chain verification — all checked before G6 is called closed |
| R3 | Feature flags expand the test matrix | Every flag gets default-off and default-on CI passes (`assert-flags.mjs`) | Both flag passes green before a flagged tool is merged |
| R4 | Demand validation needs telemetry that does not exist | WP6 builds telemetry first; Tranche 2 blocked until measured evidence | `compare_revisions`: ≥3 downstream requests **or** ≥2% of search sessions over ≥7 days; `get_category_members`: measured traversal demand **or** named request with requester+date |
| R5 | Legacy study scope creep | ≤5 working-day time box; non-shipped spike dir; decision artefact modelled on Group D reversal watch | `BUILD` verdict requires separate explicit re-approval; default outcome `KEEP MODERN-ONLY` |
| R6 | Additive fields break strict schema/contract tests | Superset-style assertions; no field removed/renamed/narrowed; AC-01…AC-155 suite green | WP12–WP15 exit gates require unchanged pre-existing field assertions and ≥378 tests |
| R7 | Fail-closed write posture weakened | No relaxation of `src/write/**` boot rules; `verify:catalogue` control wiring + `verify:read-only` 5/5; security review on any write-file diff | Every WP touching write files must show unchanged control-wiring assertions; WP2/3/4/5 explicitly re-verify |
| R8 | Concurrency/coalescing harm politeness or latency | Cap 3 never exceeded; WP16 measurement first; nightly M4=0 429s | WP17/18 exit gates require `NIGHTLY` PASS with 0 429s and unchanged call mix (330/300) |
| R9 | Paid dependency or Enterprise creep | `package.json` diff reviewed at each DoD; no Enterprise endpoint in any WP file list | Any new runtime dependency or Enterprise reference blocks the exit gate |
| R10 | Real write/rollback performed without authorisation | WP5 harness defaults to `--dry-run` and testwiki-only; `--execute` requires `--i-have-signoff`; human-only sign-off plan stays blank | One real testwiki write executed and rolled back is a **human success criterion**, never an AI WP action |
| R11 | Cache/coalescing leak tokens or cross-scope data | Cache/coalescing keys exclude token, raw subject, unallowlisted host; string scans in tests | WP13/WP18 exit gates include token/PII scan of cache and key code |
| R12 | Docs drift after additive fields | WP11 generator regenerated at portfolio DoD | `npm run docs:tools && git diff --exit-code -- TOOLS.md` at DoD |

---

## 8. Definition of done (whole portfolio)

- [ ] Baseline §2 frozen and every WP exit gate recorded with evidence; WP1–WP18 each PASS or formally DROP with a recorded decision.
- [ ] Tranche 1 complete first: gate status CLI, sign-off recorder, WORM adapter, approver helper, rollback harness all exit-gated.
- [ ] G1/AC-155 and G8 closed by **real human signatures** (owner action; no fabricated names/dates/decisions).
- [ ] One real testwiki write executed and rolled back with a signed evidence artefact (human-executed per `REAL-WIKI-ROLLBACK-PLAN.md`).
- [ ] At least two new tools built **with measured adoption** if WP6 triggers BUILD; otherwise both DROP decisions recorded with evidence.
- [ ] Host configuration errors addressed: config generator covers all report-06 hosts including OpenCode's `protocol` key.
- [ ] Legacy adapter decision recorded; no production shim shipped; modern-only retained unless separately re-approved.
- [ ] Measurable reduction in upstream calls per session evidenced from WP16 telemetry (WP18).
- [ ] Additive fields only in Tranches 4–5; AC-01…AC-155 green; no existing field removed, renamed or narrowed.
- [ ] Zero regressions: **378→≥378 tests**, **QA 16/16 + 10/10 + 9/9**, **nightly gate PASS (M4=0)**, **verify:catalogue 28 tools with controls**, **read-only 23 tools + 5/5**.
- [ ] No paid dependency; `package.json` runtime dependencies unchanged; Enterprise remains out (no code, config or endpoint).
- [ ] Fail-closed write posture intact: no auto-confirm bypass, all control-wiring assertions green, write tools never silently enabled.
- [ ] All new/changed prose uses en-GB spelling; handoff artefacts reused rather than duplicated; `TOOLS.md` regenerated and clean.
- [ ] Only the files listed per WP were changed; this plan remains the only new research report from the planning step.

---

## 9. Suggested commit / tag sequence

Follow the existing conventional-commit style and the tag pattern already used in this repo (`phase-1-merged`, `read-only-signoff`, `handoff-complete`, `enhancement-design-approved`). One logical tranche per merge; smaller WPs may be squashed into their tranche commit.

| Order | Commit message (conventional) | Tag | Gate to tag |
|---|---|---|---|
| 1 | `feat(gates): add gate status CLI and structured sign-off recorder` | `gate-spine-cli` | WP1–WP2 exit gates |
| 2 | `feat(gates): add WORM anchor adapter and approver identity helper` | `gate-spine-controls` | WP3–WP4 exit gates |
| 3 | `feat(gates): add testwiki rollback recording harness` | `gate-spine-complete` | WP5 exit gate; Tranche 1 done |
| 4 | `feat(telemetry): add demand instrumentation and validation decision` | `demand-baseline` | WP6 decision JSON committed |
| 5 | `feat(tools): add flagged compare_revisions and get_category_members` (omit if both DROP) | `capability-flagged` | WP7/WP8 exit gates; default catalogue still 28 |
| 6 | `feat(host): add config generator and tool-reference generator; docs: legacy adapter study decision` | `host-dev-experience` | WP9–WP11 exit gates |
| 7 | `feat(intelligence): add additive ranking, caching, recovery and provenance fields` | `result-intelligence` | WP12–WP15 exit gates |
| 8 | `feat(cost): add politeness telemetry, adaptive concurrency and request coalescing` | `cost-sustainability` | WP16–WP18 exit gates |
| 9 | `docs(handoff): record portfolio closeout and regenerated tool reference` | `enhancement-portfolio-complete` | §8 DoD all checked |

**Tag discipline:** do **not** create any tag that implies write enablement or gate sign-off (e.g. `writes-signed`, `gates-signed`) — those are human-owned events. Never rewrite or move an existing tag. Each tag is created only after the listed gate passes with recorded evidence.

---

## 10. Hand-off artefact reuse map

| Artefact | Reused by | How |
|---|---|---|
| `handoff/DEPLOYMENT-RUNBOOK.md` | WP1, WP5, WP9 | gate/status and config blocks; preflight command reference |
| `handoff/SIGNOFF-TEMPLATES.md` | WP1, WP2, WP4 | record schema; "records, not signs" labelling; real-signature requirement |
| `handoff/WORM-AUDIT-SPEC.md` | WP1, WP3, WP5 | chain verification, retention and export procedures; sink options |
| `handoff/REAL-WIKI-ROLLBACK-PLAN.md` | WP1, WP5 | human checklist and per-tool rollback table; harness commands added additively |
| `handoff/OAUTH-CIMD-TEMPLATE.md` | WP3, WP4, WP5 | actor hashing, approver ids, secret storage rules |
| `handoff/NIGHTLY-SCHEDULER.md` | WP6, WP16, WP17, WP18 | report collection, alert snippet, 330/300 call mix, retention |
| `handoff/G8-UPLOAD-TOC-CHECKLIST.md` | WP1, WP5 | G8 evidence path; upload remains failed closed |
| `handoff/GROUP-D-REVERSAL-WATCH.md` | WP10 | template for time-boxed study/watch decision |
| `write-security/**` | WP2, WP3, WP4, WP5 | records/ and evidence/ dirs; additive doc notes only |
| `reports/nightly-live.json` | WP1, WP6, WP16 | baseline + additive report fields, same JSON convention |

---

*End of implementation plan v1.0.0 — hand to implementers only after the approved design remains unchanged. No source code, tests or other research reports were modified in producing this plan.*
