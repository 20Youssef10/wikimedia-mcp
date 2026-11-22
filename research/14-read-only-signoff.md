# Read-Only Deployment Sign-Off — Wikimedia MCP Server

**Document version:** 2026-11-21 (first issue)  
**Language:** en-GB (British English)  
**Classification:** Internal — security engineering sign-off  
**Subject:** Read-only server at `./` (package `wikimedia-mcp@3.0.0`, MCP 2026-07-28)  
**Authority:** report 08 (formal threat model), §6 design gates, §7 verification, §8 sign-off checklist  
**Scope of this sign-off:** **READ-ONLY DEPLOYMENT ONLY.** It explicitly does **not** sign off write enablement.

---

## 1. Executive statement

> **Write tools remain hard-blocked.** The server registers 22 tools, all of
> which are annotated `readOnlyHint: true`, `destructiveHint: false`. No write
> tool (`edit_page`, `upload_file`, `delete_page`, `move_page`, `protect_page`),
> no write-capable credential key and no write code path exists in the source or
> in the shipped `dist/` artifact. This was re-verified in this pass by the
> live `tools/list` deployment assertion and by a shipped-artifact scan
> (`npm run verify:read-only`).
>
> Nothing in this document enables writing. The CSRF mechanism added here is a
> dormant, off-by-default control proved with a **test-only harness that is
> injected through a test seam and is never registered in production**. All
> G1–G12 write-enablement gates except G5 and G10 remain **NOT EVIDENCED**.

The two small threat-model gate gaps that could be closed without enabling
write tools (G10 and G5) have been closed; the remaining ten gates are recorded
as still open in §3. The read-only deployment is signed off in §6. The
dependency-ordered work package required before any write tool may be enabled
is in §5; its write-enablement checklist in §7 is deliberately **unchecked**.

---

## 2. Gap closure performed in this pass

All changes are confined to `./` plus this research file.

| Gate sub-gap (from the gate-gap findings) | Action taken | Evidence |
|---|---|---|
| **G10(a)** `checkOrigin` returned `ok` for a missing `Origin` although report 08 §5.9.1 says reject | Added `MCP_REQUIRE_ORIGIN` (default `false`, so current CLI/non-browser hosts keep working). When `true`, a missing `Origin` is rejected with HTTP 403 (`reason: missing_origin`); a present-but-unlisted `Origin` is still rejected. README documents that this **MUST be true for any future write-enabled deployment**. | `src/protocol/headers.ts`, `src/config.ts`, `src/transport/streamable-http.ts`; unit tests in `tests/unit/headers.test.ts`; live HTTP tests in `tests/security/http-hardening.test.ts` (both modes, 200/403/403). |
| **G10(b)** no TLS configuration/termination documentation | Added a README section "Deployment: TLS termination, Origin and CSRF": server is plain HTTP on loopback; terminate TLS at a reverse proxy; forward `Origin`/`Host` and `Mcp-*` unchanged; explicit allowlists; **no wildcard CORS with credentials**; DNS-rebinding defence at the proxy. | `README.md`; `.env.example` documents the new flags. |
| **G10(c)** no CSRF token for state-changing calls | Added `src/protocol/csrf.ts`: signed (HMAC-SHA256), time-stamped, nonce-bearing tokens with constant-time verification and TTL; issued in `MCP-CSRF-Token`, supplied in `Mcp-Csrf-Token`. Behind off-by-default `MCP_REQUIRE_CSRF` (boot fails if `MCP_CSRF_SECRET` < 16 chars). State-changing = `tools/call` to a deny-listed write tool. Proved with a test-only harness (dummy `delete_page` injected via a test-only factory seam, never used by `src/index.ts`) and a shipped-artifact scan. **No production write tool was registered.** | `src/protocol/csrf.ts`, `src/transport/streamable-http.ts`, `scripts/assert-read-only.mjs`; tests `tests/unit/csrf.test.ts`, `tests/security/http-hardening.test.ts`. |
| **G10(d)** `validateRoutingHeaders` was dead code (unit-tested only) | **Decision: delete, do not wire in.** The v2 SDK's `createMcpHandler` already performs the full SEP-2243 validation on the live path — `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` presence, base64 sentinel decoding, body cross-check and `Mcp-Param-*` rejection — returning `-32020`/HTTP 400. This is proven by contract tests AC-15/16/17 and by the independent HTTP QA script (which observes SDK-originated rejections such as `name-header-mismatch` and `method-header-missing`). A second validator would duplicate the SDK authority and could silently drift. Removed the function, its helpers and its four unit tests; no dead code remains. | `src/protocol/headers.ts` (now only the live `checkOrigin`/`checkHost`), `tests/unit/headers.test.ts`; `tests/contract/http.test.ts`; QA HTTP log. |
| **G5** real read-only separation existed but no automated deployment assertion artefact | Added (1) an in-process Vitest deployment assertion that inspects the live `tools/list` names **and annotations**, checks the write-tool deny-list and scans env/config for write-credential keys; and (2) a shipped-artifact script `scripts/assert-read-only.mjs` (npm `verify:read-only`) that imports the built `dist/server/tools/registry.js`, scans all shipped JS for a hardcoded write-tool registration, and scans env/config. Deny-list includes the three report 05 §2 Group G write-tool names `edit_page`, `upload_file`, `delete_page` plus `move_page` and `protect_page` from report 08 §1.1. | `tests/security/read-only-deployment.test.ts`, `scripts/assert-read-only.mjs`, `package.json`. |

---

## 3. Gate status after this pass (G1–G12)

"Improved" means the specifically identified sub-gap(s) were closed for the
read-only posture; it does **not** mean the gate is signed off for writes.

| Gate | Requirement (report 08 §6.2) | Status before | Status now | Honest note |
|---|---|---|---|---|
| **G1** | Threats T-02, T-06, T-19, T-21, T-22 closed to Low / accepted residual | NOT EVIDENCED | **NOT EVIDENCED** | Requires re-review of the threat model after write code and confirmation/capability controls exist. |
| **G2** | Write AuthN/AuthZ with least-privilege OAuth scopes + issuer binding | NOT EVIDENCED | **NOT EVIDENCED** | No write auth implemented; read-only server carries no user credentials. |
| **G3** | Signed, single-use MRTR `input_required` confirmation; no silent writes | NOT EVIDENCED | **NOT EVIDENCED** | No confirmation flow exists (nothing to confirm). |
| **G4** | Capability tokens scoped to action/target/expiry; blast-radius limits; kill switch | NOT EVIDENCED | **NOT EVIDENCED** | Not implemented. |
| **G5** | Read/write tool and credential separation verified | PARTIAL | **IMPROVED — read-only evidenced** | Real separation already existed; now backed by an automated live `tools/list` assertion + shipped-artifact scan. Still requires deployment audit at write-enable time. |
| **G6** | Immutable, secret-free audit of every write | NOT EVIDENCED | **NOT EVIDENCED** | No write audit (no writes). |
| **G7** | Dry-run/diff preview + documented rollback for every destructive op | NOT EVIDENCED | **NOT EVIDENCED** | No destructive op exists. |
| **G8** | Licence/attribution + ToU review signed off for upload content | NOT EVIDENCED | **NOT EVIDENCED** | No upload content path. |
| **G9** | Prompt-injection canary suite passes with writes enabled | NOT EVIDENCED | **NOT EVIDENCED** | Cannot run "with writes enabled" while writes are hard-blocked. |
| **G10** | Origin/header/CSRF controls and secret-redaction tests pass on HTTP | PARTIAL (4 gaps) | **IMPROVED — all 4 sub-gaps closed** | (a) `REQUIRE_ORIGIN`, (b) TLS docs, (c) CSRF mechanism + test-only proof, (d) dead code removed; secret-redaction tests already exist (`tests/security/security.test.ts`). Flags are **off by default** in the read-only deployment and **MUST be enabled** for write deployment. |
| **G11** | Two-person approval runbook for delete/move/protect/upload | NOT EVIDENCED | **NOT EVIDENCED** | No runbook. |
| **G12** | Incident runbook + revocation procedure exercised in a drill | NOT EVIDENCED | **NOT EVIDENCED** | No drill record. |

**Net:** G5 and G10 are improved; G1, G2, G3, G4, G6, G7, G8, G9, G11 and G12
remain **NOT EVIDENCED**. Write enablement is therefore **blocked**.

---

## 4. Verification results (exact, from this pass)

All commands run from `./`. Exit codes were 0 unless stated.

| Check | Result |
|---|---|
| `npm run build` | **PASS** — `tsc -p tsconfig.json`, exit 0 (after fixing one `string[]` header-type error introduced in the CSRF wiring). |
| `npm run typecheck` | **PASS** — both `tsconfig.json` and `tsconfig.test.json` clean, exit 0. |
| `npm run lint` | **PASS** — `eslint .`, exit 0. |
| `npm test` (run 1) | **PASS** — 36 test files passed, 1 skipped; **328 tests passed**, 5 skipped (333 total); 65.20 s. |
| `npm test` (run 2) | **PASS** — identical counts: 36 passed / 1 skipped files; **328 passed** / 5 skipped tests; 54.23 s. |
| `npm run verify:read-only` (new shipped-artifact assertion) | **PASS** — 5/5 checks: 22-tool non-empty catalogue; no write tool in shipped `TOOL_NAMES`; no shipped file registers a write tool; no write credential key in env; no write credential field in config. |
| Independent QA: `qa-mcp-smoke.mjs` (stdio) | **PASS — 15/15 checks** (22 tools exposed, all read-only annotated, schemas present, live content/attribution/source, protocol errors). |
| Independent QA: `qa-mcp-http.mjs` (HTTP) | **PASS — 10/10 checks** (405/Allow, discover, `-32020` header mismatch, `-32022` version, 22 tools, tools/call). |
| Independent QA: `qa-mcp-defects.mjs` | **PASS — 9/9 checks** (missing-page errors, language variants, date validation). |

Baseline before this pass was 308 tests; +20 tests were added (CSRF unit tests,
Origin/CSRF live HTTP tests, G5 deployment assertion, updated config/header
tests). The three independent QA scripts are external to the repository and
were left unmodified.

---

## 5. Dependency-ordered work package required to ever enable writes

Derived from the report 08 §6.2 gate table and the gate assessment ("G1–G12
largely unevidenced"). Each phase depends on the one before it; **write
enablement is blocked until WP4 is signed off.**

**WP0 — Read-only baseline (COMPLETE in this pass).** G5 assertion and G10
controls shipped (hardening flags off by default). Freeze the 22-tool read-only
catalogue and the `verify:read-only` gate as the regression baseline.

**WP1 — Write foundation (prerequisites for any write code).**
- **G2:** implement write AuthN/AuthZ with least-privilege OAuth scopes and RFC 9207 issuer (`iss`) validation; use CIMD; short-lived tokens with rotation/revocation. Separate write client and write credential store.
- **G5 (re-enforce at write time):** separate write tool group; a read-only deployment must have **no write token**; keep `verify:read-only` green for read-only profiles.
- **G10 (activate):** set `MCP_REQUIRE_ORIGIN=true` and `MCP_REQUIRE_CSRF=true` with a strong `MCP_CSRF_SECRET`, terminate TLS at the proxy, and configure explicit (never wildcard) origins/hosts for the write-enabled deployment.
- **G8 (start policy work):** licence/attribution and ToU review for any upload content; can proceed in parallel as it is a compliance task, but must be signed before uploads ship.

**WP2 — Confirmation, capability and safe execution (depends WP1).**
- **G3:** signed, single-use, short-TTL `requestState` with MRTR `input_required`; every write returns a human-readable preview of exact action, target and diff; never infer consent from annotations or prior calls.
- **G4:** capability tokens scoped to action/target/expiry; namespace/page allowlists, edit quotas, size limits and an instantly revocable kill switch.
- **G7:** dry-run/diff preview and a documented rollback path for every destructive operation (delete/move/protect/upload).

**WP3 — Audit and operations (depends WP2).**
- **G6:** immutable, tamper-evident, secret-free audit entry per write (actor, target, diff hash, confirmation ID, outcome, correlation ID).
- **G11:** two-person approval runbook for delete/move/protect/upload.
- **G12:** incident runbook and credential-revocation procedure, exercised in a recorded drill (uses the G4 kill switch and G11 runbook).

**WP4 — Verification and final sign-off (depends WP3).**
- **G1:** re-review threats T-02, T-06, T-19, T-21 and T-22; record closure to Low or formally accepted residual.
- **G9:** run the prompt-injection canary suite **with write tools enabled** in an isolated test environment; assert no write executes from injected content alone.
- Re-run report 08 §7 verification 1–13 (including write-confirmation E2E §7.9 and audit-integrity §7.11), then sign G1–G12.

Only after WP4 is fully evidenced may a write-enabled deployment be considered;
each of G1–G12 must then be checked in §7 below.

---

## 6. Sign-off checklist — READ-ONLY deployment only

Items are checked where this pass provides direct evidence. "N/A" items are
explicitly not applicable to a read-only deployment and must be revisited on
write enablement.

- [x] **Scope and trust boundaries (§1)** agreed; both stdio and Streamable HTTP covered.
- [x] **Asset inventory (§2)** reviewed; no write credential or Enterprise token is present.
- [x] **STRIDE analysis (§3) and threat table (§4)** reviewed; highest-priority risks T-01/T-04/T-08/T-09 mitigated for read-only; T-02 accepted as residual (§7.2).
- [x] **§5 treatments implemented for the read-only subset:** SSRF host rejection, untrusted-content labelling, log redaction, SPARQL bounds, rate/concurrency ≤ 3, cache defaults, transport controls; Origin/Host/CSRF controls now present (hardening flags off by default in read-only).
- [x] **SR-1, SR-2, SR-3, SR-4, SR-5, SR-7, SR-8, SR-10, SR-11, SR-12** evidenced for read-only. **N/A in read-only:** SR-6 (no user auth/issuer), SR-9 (no write audit) — re-evaluate at write enablement.
- [x] **Verification §7.1 items 1–8, 10–13 passed** for read-only (merge gate + independent QA + `verify:read-only`); item 9 (write-confirmation E2E) is N/A. Exact results in §4.
- [x] **Residual risks in §7.2 formally accepted** for the read-only posture (indirect prompt injection, upstream rate tiers, stdio host compromise).
- [x] **No write tool or write credential in the shipped artifact** — live `tools/list` assertion and `npm run verify:read-only` both green; deny-list `edit_page`/`upload_file`/`delete_page`/`move_page`/`protect_page`.
- [x] **Incident/secret-rotation note for read-only:** no write or Enterprise secret exists; the only optional secret is `MCP_CSRF_SECRET` (not enabled in read-only). Operational rotation guidance is documented with the flag in `.env.example`.
- [x] **Gate G5 and G10 sub-gaps** closed as recorded in §2; remaining gates recorded NOT EVIDENCED in §3.

**Role sign-off (read-only):** Security Architect ________  Backend Lead ________  Product Owner ________  Date ________

---

## 7. Write-enablement checklist — NOT COMPLETE, DO NOT SIGN

Every box below is intentionally **unchecked**. This section becomes actionable
only after WP1–WP4 in §5 are complete.

- [ ] **G1** T-02, T-06, T-19, T-21, T-22 closed to Low / accepted residual (threat-model re-review).
- [ ] **G2** Write AuthN/AuthZ, least-privilege OAuth scopes and issuer binding implemented and tested.
- [ ] **G3** Signed, single-use MRTR `input_required` confirmation; no silent writes (E2E tests).
- [ ] **G4** Capability tokens scoped to action/target/expiry; blast-radius limits and kill switch (negative tests).
- [ ] **G5** Read/write tool **and credential** separation re-audited on the write-enabled deployment; read-only profiles still have no write token.
- [ ] **G6** Immutable, secret-free audit of every write verified (log integration test).
- [ ] **G7** Dry-run/diff preview and documented rollback for every destructive operation (manual acceptance).
- [ ] **G8** Licence/attribution and ToU sign-off for upload content (compliance checklist).
- [ ] **G9** Prompt-injection canary suite passes **with writes enabled** (CI report).
- [ ] **G10** `MCP_REQUIRE_ORIGIN=true` and `MCP_REQUIRE_CSRF=true` active, TLS terminated at proxy, explicit origins/hosts (no wildcard CORS), secret-redaction and Origin/header/CSRF security test report green on the write deployment.
- [ ] **G11** Two-person approval runbook defined for delete/move/protect/upload.
- [ ] **G12** Incident runbook and revocation procedure exercised in a drill (drill record).
- [ ] Report 08 §8 additional sign-off block (all G1–G12) signed by Security Architect, Backend Lead and Product Owner.

**Outcome:** until every box in §7 is checked, **write tools remain hard-blocked** and no write-capable tool or credential may be registered in any environment.

---

*This sign-off is a **[Design/Verification]** artefact grounded in report 08 (formal threat model, verified 21 November 2026) and the actual repository state at the revision described above. It must be re-issued whenever the tool surface, transports, authentication model or upstream APIs change.*
