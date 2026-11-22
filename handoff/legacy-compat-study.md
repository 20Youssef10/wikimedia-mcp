# Legacy-compat adapter study — decision artefact (WP10)

**Status:** DECISION RECORDED — **KEEP MODERN-ONLY**. No shim, no `initialize`
code and no production change. This artefact is the time-boxed decision the
implementation plan calls for; it is modelled on the watch/decision structure
in `handoff/GROUP-D-REVERSAL-WATCH.md` and reuses that artefact rather than
inventing a new report number.

**Decision date:** 2026-11-22 (named date; no personal name, signature or
approval is recorded here).

**Time box:** ≤ 5 working days (report 19 §3 R5 / WP10). This review was closed
inside that box using already-verified host evidence; no new live host probes
were run, so no unrecorded observations are claimed.

**Grounding:** `wikimedia-mcp-research/06-validation-and-economics.md` §3 and
§7.1 (verified host compatibility, 2026-11-21);
`wikimedia-mcp-research/18-enhancement-design.md` §7 and decision D2;
`wikimedia-mcp-research/19-enhancement-implementation-plan.md` §§3, 5.2, 7 (R5),
WP10; contract 09 §2.5 (MCP 2026-07-28 only); `handoff/DEPLOYMENT-RUNBOOK.md`
§2 and `handoff/GROUP-D-REVERSAL-WATCH.md` (template).

---

## 1. Decision being studied

Report 18 D2 reduced "legacy support" to an **opt-in adapter study**: decide
whether a contained `initialize`-handshake adapter can translate legacy
Codex/Cursor requests **without duplicating the protocol stack**. If it cannot,
retain the modern-only posture. Report 19 WP10 makes the expected/default
outcome `KEEP MODERN-ONLY` and forbids any production change in this work
package.

Hypothesis under test: a small, non-shipped adapter could accept a classic
`initialize` (2024-11-05 / 2025-06-18) request, translate it into the v2 SDK's
modern request envelope, and forward `tools/list` / `tools/call` unchanged, so
Cursor and Codex CLI could connect without changing the server's modern-only
contract.

---

## 2. Baselines and verified host results (report 06 §7.1)

The server targets **MCP 2026-07-28 only**. Classic `initialize` hosts are
unsupported by design; GET to `/mcp` returns **405** deliberately (POST-only),
and a classic `initialize` naming a modern version is rejected with
**-32022**. Report 06 tested against the Phase 1 server (9 tools then); the
tool count has since grown to 28, but the transport/handshake behaviour studied
here is unchanged.

| Host | Test type (06 §7.1) | Result | Evidence / caveat |
|---|---|---|---|
| Grok Build | REAL | **PASS** | `grok mcp doctor` negotiated `protocol 2026-07-28`; healthy handshake. |
| OpenCode | REAL | **PASS with required key** | Default legacy `initialize` is rejected; adding `"protocol":"2026-07-28"` connects. `opencode mcp list` is unreliable — use serve logs. |
| Cursor (`cursor-agent`) | REAL | **FAIL — host limitation** | Plain `url` selects legacy SSE and probes with GET → server 405. `type:"http"` did not help; `type:"streamable-http"` unrecognised. |
| Codex CLI | REAL (server-log connection attempt) | **FAIL — host limitation** | Config parses as `streamable_http`, but the client opens with classic `2025-06-18` `initialize` → -32022. No option to request 2026-07-28. `codex mcp list` is config-only. |
| Cline | config REAL; connection NOT TESTED | **NOT TESTED** | No account in isolated profile; auth failed before MCP connection. Nested `transport` vs flat `type` documented. |
| Gemini CLI, Claude Code, Windsurf | — | **NOT TESTED** | CLIs absent; matrix entries are doc-only. |

A raw modern request is verified working: POST with
`MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: tools/list`, and a `_meta`
envelope containing `io.modelcontextprotocol/protocolVersion` and
`io.modelcontextprotocol/clientCapabilities` → HTTP 200 with the tool
catalogue. This is the contract an adapter would have to synthesise.

---

## 3. Test matrix for the (not built) adapter

This is the matrix a future `spikes/legacy-adapter/` probe would execute. It is
recorded here so the time-boxed decision is reproducible; **no probe code was
written and no host was re-tested in this study**.

| Case | Input | Expected if adapter existed | Evidence available today |
|---|---|---|---|
| A1 | Grok modern `initialize` equivalent | unchanged PASS | 06 §7.1 REAL PASS |
| A2 | OpenCode with `protocol:"2026-07-28"` | unchanged PASS | 06 §7.1 REAL PASS |
| A3 | OpenCode default legacy `initialize` | adapter would map to modern envelope | 06 §7.1: rejected without key; workaround is a config key, not a server change |
| B1 | Cursor plain `url`, GET probe | adapter cannot help: host sends GET, server must stay 405 | 06 §7.1 REAL FAIL (host limitation) |
| B2 | Cursor with `type:"http"` / `type:"streamable-http"` | no effect; host does not recognise the transport options | 06 §7.1 REAL FAIL |
| C1 | Codex `2025-06-18` `initialize` | adapter would need to accept an unsupported version and emulate capability negotiation | 06 §7.1 REAL FAIL (-32022); no client option to select modern version |
| C2 | `codex mcp list` | config-only; never reaches the server | 06 §7.1 evidence caveat |
| D1 | GET `/mcp` from any host | must remain 405 | 06 §7.1 and 06 §7 key risks |
| D2 | Security/protocol regression | no weakening of header/body version checks, Origin/CSRF or redaction | report 19 §3 constraint 6; contract 09 §2.5 |

**Gate:** every case must pass without a production shim before a `BUILD`
verdict could even be considered. Cases B1/B2 fail for host-side reasons an
in-server adapter cannot change, and D1 is a deliberate posture that must not
be relaxed.

---

## 4. What a contained adapter would require

1. **A legacy handshake path** accepting classic `initialize` parameter shapes
   and protocol versions the v2 SDK deliberately rejects (-32022), then
   synthesising the modern `_meta` envelope
   (`io.modelcontextprotocol/protocolVersion`,
   `io.modelcontextprotocol/clientCapabilities`) for every subsequent request.
2. **Version/capability reconciliation** between legacy capability objects and
   the modern discovery contract, including what to advertise when a legacy
   client cannot express modern capabilities.
3. **Session/lifecycle emulation** for legacy `initialized` notifications and
   any per-session state the v2 SDK now owns.
4. **Method translation for every request**, not only `initialize`: the GET→405
   posture and header/body consistency checks (Mcp-Name, Mcp-Method,
   MCP-Protocol-Version) would need a parallel legacy route that must be kept
   in step with each future protocol change.
5. **A separate, non-default opt-in flag and CI matrix** (default-off and
   default-on passes per report 19 §6.3), plus security review before any
   capability is exposed (report 19 §3 constraints 2 and 6).
6. **A non-shipped spike** under `spikes/legacy-adapter/`, excluded from
   `tsconfig.json`/build inputs, to validate 1–4 before any `src/` change.

Steps 1–4 are, in substance, a second protocol stack. That contradicts the
study's own success condition ("translate without duplicating the protocol
stack") and the modern-only contract. An adapter also cannot fix Cursor's
GET-first probing (D1 must stay 405) or Codex's inability to select a modern
version (C1): both clients fail before any translated request could be sent.

---

## 5. Effort and risk (estimates, not measurements)

| Item | Effort estimate | Risk |
|---|---|---|
| Non-shipped spike (handshake + translation probe) | 2–3 working days | May still be inconclusive because no failing host can be driven past its own limitation. |
| Contained opt-in adapter if the spike succeeded | 3–5 further working days | Exceeds the ≤5-day time box for the *study*; would need separate re-approval and a new budget. |
| Dual CI matrix + documentation + security review | 1–2 working days | More flags, more regression surface: report 19 R3. |
| Long-term maintenance | ongoing | Every v2 protocol change needs a parallel legacy translation; report 06 §7.1 already shows hosts change config keys (`type`, `httpUrl`, `transport`) independently. |
| Posture change (accepting classic `initialize`, relaxing 405) | n/a — **not permitted** | Would weaken the deliberate modern-only/POST-only contract; report 19 §3 constraint 6 and contract 09 §2.5. |

Risk verdict: **high effort, high maintenance risk, low expected benefit**. The
two failing hosts fail for reasons outside the server; a server-side adapter
would not make them work and would add a second handshake surface to secure.

---

## 6. Findings

- The modern path is verified with three host classes (Grok, OpenCode with the
  required key, raw modern POST). There is no server-side defect to repair.
- Cursor's failure is a **client transport selection** problem (legacy SSE +
  GET probe). The server's 405 is correct and must remain; an `initialize`
  adapter is never reached.
- Codex's failure is a **client protocol-version selection** problem. The
  client cannot request 2026-07-28, so it sends a classic handshake that is
  correctly rejected. An adapter would have to accept a version the contract
  forbids and emulate capabilities the client cannot express.
- A contained adapter therefore cannot satisfy the WP10 hypothesis: it either
  does nothing for the two failing hosts, or it duplicates the protocol stack
  and weakens the modern-only posture.
- No spike code was created. This is an evidence-led decision from report 06
  §7.1, not an implementation attempt; no shim exists in `src/` or the shipped
  artefact.

---

## 7. Decision

**KEEP MODERN-ONLY** — recorded 2026-11-22.

- No `initialize` adapter, shim or compatibility flag is built.
- No production file, `package.json`, tool registration or
  `serverInfo.version` (3.0.0) was changed by this WP. The default catalogue
  stays at **28** tools.
- Classic-`initialize` hosts remain unsupported by design; the documented
  remedies are host configuration (OpenCode's `protocol` key, report 06 §7.1)
  or host-side support for 2026-07-28.
- A `BUILD` verdict would be **conditional on separate, explicit re-approval**
  and would not itself authorise a shim (report 19 WP10 acceptance criterion).

---

## 8. Reversal triggers — what would have to be true to reconsider

Reopen this decision only if **all** of the following hold:

1. A named, real user request (requester and date recorded by a human) shows a
   concrete task blocked on a legacy host, not a generic compatibility wish.
2. That host has shipped first-class MCP 2026-07-28 support and still cannot
   express the required envelope, i.e. the failure is demonstrably server-side.
3. The v2 SDK offers a supported compatibility bridge that does **not**
   duplicate the protocol stack, or a time-boxed spike proves a contained
   adapter can pass test matrix cases A1–D2 without touching the 405/version
   posture.
4. Security review (report 19 §3 constraint 6) confirms no weakening of
   header/body version checks, Origin/CSRF, redaction or fail-closed writes.
5. Separate re-approval is recorded for a new budget beyond the ≤5-day study
   box and for any production shim.

Until then the watch item is **closed as KEEP MODERN-ONLY**; re-check only
these triggers rather than re-running an open-ended compatibility project.

---

## 9. Limitations / assumptions

- The host evidence is the 2026-11-21 verified matrix in report 06 §7.1. Host
  CLIs change quickly; a future reconsideration must re-run the live matrix
  with current builds before relying on it.
- Cline, Gemini CLI, Claude Code and Windsurf were not connection-tested in
  report 06; their absence from the failing set is not evidence of compatibility.
- No `spikes/legacy-adapter/` directory was created: the plan permits a
  throwaway probe but the time-boxed decision is evidence-led, and creating
  adapter code without a passing hypothesis would be scope creep. If
  reconsidered, probe code belongs there and must be excluded from
  `tsconfig.json`/build inputs.
- This artefact records a decision, not a human approval. No personal name,
  signature or legal sign-off is invented here.
