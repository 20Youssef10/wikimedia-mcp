# AC-155 / G1 three-way sign-off templates (BLANK)

**Status: ROLE-TITLE PLACEHOLDERS ONLY — NOT SIGNED.** Per the Product Owner's 2026-11-21 instruction, the three role titles have been entered in the Name fields, but no personal names, dates, decisions or signatures have been invented. **This is an owner map, not a genuine sign-off.** G1/AC-155 remains unsatisfied until each named human signs their own block below.

`write-security/signoff.md` records **requester risk acceptance only**: independent named signatures from a Security Architect, Backend Lead and Product Owner were **not** obtained; G8 Legal/Compliance sign-off remains PENDING; rollback on a real wiki is untested; no real issuer/WORM/revocation round-trip was exercised. These templates exist so that **genuine human signatories** can record a real decision. Do not copy a name from any other document into these blocks.

**Grounding:** research report 08 §6.2 gates G1–G12 and §8 sign-off checklist (role line at `:474`), report 14 §7 write-enablement checklist, report 16 §8 / AC-155 (`:522-547`), report 17 (G1 technical re-review complete, formal gate NOT signed), `write-security/signoff.md`.

---

## Gate being signed

**G1 / AC-155:** A dated threat re-review records T-02, T-06, T-19, T-21 and T-22 (plus HTTP T-10/T-11) as Low or formally accepted residual; report 08 §7 verification items 1–13 are re-run (including §7.9 write confirmation E2E and §7.11 audit integrity); and **G1–G12 are signed by Security Architect, Backend Lead and Product Owner**. Until this criterion passes, no write tool ships. A dated technical re-review exists (`17-threat-model-rereview.md`) but the formal gate is **NOT SIGNED**.

Prerequisites to attach before any block is signed:

- [ ] `17-threat-model-rereview.md` re-rating table accepted (T-02/T-06/T-19/T-21/T-22, T-10/T-11).
- [ ] Report 08 §7 verification items 1–13 evidence attached.
- [ ] G2 auth/issuer/CIMD evidence; G3 signed MRTR confirmation; G4 capability + kill switch; G5 read/write separation (`verify:read-only` 5/5).
- [ ] G6 audit chain + WORM anchoring evidence; G7 dry-run + real rollback test (`REAL-WIKI-ROLLBACK-PLAN.md`); G8 signed compliance record (`G8-UPLOAD-TOC-CHECKLIST.md`).
- [ ] G9 injection canaries with writes enabled; G10 HTTP/CSRF/redaction evidence; G11 two-person approval runbook with real approvers; G12 revocation drill record.

---

## Block 1 — Security Architect

| Field | Value |
|---|---|
| Role | Security Architect |
| Name | **Security Architect** (role-title placeholder, not a personal name or signature) |
| Date (YYYY-MM-DD) | **BLANK** — ______________ |
| Scope of approval | G1 threat re-review (T-02, T-06, T-19, T-21, T-22 + HTTP T-10/T-11), SR-1–SR-12, report 08 §7 verification items 1–13, and gate evidence G2 (auth/issuer binding), G3 (signed confirmation), G9 (canaries with writes) and G10 (HTTP/Origin/CSRF/redaction). Includes acceptance of documented residuals for T-02 and T-11 with named review triggers. |
| Decision | APPROVE / APPROVE WITH CONDITIONS / REJECT (circle one): ______________ |
| Conditions / residual risks accepted | ______________________________________________________________________ |

Signature: ______________________________________________________  Date: ______________

---

## Block 2 — Backend Lead

| Field | Value |
|---|---|
| Role | Backend Lead |
| Name | **Backend Lead** (role-title placeholder, not a personal name or signature) |
| Date (YYYY-MM-DD) | **BLANK** — ______________ |
| Scope of approval | Technical correctness of G4 (capability tokens scoped to action/target/expiry, blast-radius limits, kill switch), G5 (read/write config and credential separation, 23-tool read-only assertion), G6 (HMAC audit chain and external WORM anchor), G7 (dry-run/diff preview and documented/verified rollback path), and G12 (revocation drill re-run). Confirms no auto-confirm bypass and all boot-fail controls active. |
| Decision | APPROVE / APPROVE WITH CONDITIONS / REJECT (circle one): ______________ |
| Conditions / defects accepted | ______________________________________________________________________ |

Signature: ______________________________________________________  Date: ______________

---

## Block 3 — Product Owner

| Field | Value |
|---|---|
| Role | Product Owner |
| Name | **Product Owner** (role-title placeholder, not a personal name or signature) |
| Date (YYYY-MM-DD) | **BLANK** — ______________ |
| Scope of approval | Business acceptance of the residual risks of enabling the five write tools (human diff reading, indirect prompt injection, misdeployment, upload legal exposure), the staged rollout plan (`DEPLOYMENT-RUNBOOK.md`), the testwiki-only scope, rate/blast-radius limits, and the dependency on genuine G8 Legal/Compliance sign-off and G11 two-person approval. Confirms this is an independent sign-off, not a repeat of the 2026-11-21 "enable all tools" requester instruction. |
| Decision | APPROVE / APPROVE WITH CONDITIONS / REJECT (circle one): ______________ |
| Conditions / business commitments | ______________________________________________________________________ |

Signature: ______________________________________________________  Date: ______________

---

## Gate outcome (complete only after all three blocks are genuinely signed)

- [ ] All three distinct named signatories above have signed and dated their own blocks.
- [ ] G1–G12 evidence attached; report 08 §8 additional sign-off block completed.
- [ ] `MCP_WRITE_GATES_SIGNED=true` set only after the signed record exists at `write-security/signoff.md` (boot fails otherwise).
- [ ] G8 signed compliance record attached; uploads remain failed closed until it exists.

Result: **PENDING — NOT SIGNED.** Only role titles were filled, per the Product Owner's instruction; no personal names, dates or approvals were invented. Until genuine signatures are recorded, write tools must remain in the fail-closed posture described in `DEPLOYMENT-RUNBOOK.md` (no real write can succeed without operator-supplied OAuth config, approvers and G8 sign-off).
