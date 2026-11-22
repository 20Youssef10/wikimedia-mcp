# G8 — Upload licence / attribution / Terms-of-Use sign-off template

**Status: PENDING — HUMAN LEGAL/COMPLIANCE REVIEW REQUIRED. NOT COMPLETE. DO NOT ENABLE REAL UPLOADS ON THE STRENGTH OF THIS DOCUMENT.**

This is a **blank template** for the human compliance owner. It is not a legal approval, contains no reviewer names, and has not been signed. The existing `write-security/upload-tou-checklist.md` also remains PENDING. In the current build, `MCP_UPLOAD_TOU_SIGNED_BY` has no genuine named sign-off, so `upload_file` preview/dry-run works but real upload execution fails closed with `licence_not_signed_off` (`write-security/signoff.md:11-14`). Setting a placeholder value to bypass that check is a policy violation.

**Grounding:** `write-security/upload-tou-checklist.md` (checks 1–7), research report 16 §2.7 / AC-146 / AC-152, report 08 §6.2 G8, report 14 WP1.

---

## 1. Review metadata (all fields BLANK — operator fills)

| Field | Value |
|---|---|
| Reviewer name | ______________________________________ |
| Role / title | ______________________________________ |
| Organisation | ______________________________________ |
| Review date (YYYY-MM-DD) | ______________________________________ |
| Deployment / environment reviewed | ______________________________________ |
| Scope (file types, projects, namespaces) | ______________________________________ |
| Related ticket / record id | ______________________________________ |
| `MCP_UPLOAD_TOU_SIGNED_BY` value to configure | ______________________________________ (must be "name — role — date" of the person below) |

---

## 2. Licence / ToU determinations for uploaded content

For each determination, record the decision and the evidence reviewed. Leave blank if not yet determined.

| # | Determination | Required evidence | Decision (APPROVE / REJECT / N/A) | Evidence reference | Notes |
|---|---|---|---|---|---|
| 1 | Licence is on the signed allowlist: `CC-BY-SA-4.0`, `CC-BY-4.0`, `CC0-1.0`, `PD`, `OWN-WORK-AUTHORISED` | Signed licence policy | ______________ | ______________ | ______________ |
| 2 | Attribution string is preserved **verbatim** in the description page | `upload_file` output + audit `content_hash` | ______________ | ______________ | ______________ |
| 3 | Author and source URL are recorded for each file | Description wikitext + audit record | ______________ | ______________ | ______________ |
| 4 | Commons Terms of Use reviewed for this deployment | Compliance owner sign-off | ______________ | ______________ | ______________ |
| 5 | No personal data in uploaded file or description | Human review per upload | ______________ | ______________ | ______________ |
| 6 | Per-file licence is never replaced by a site-wide default | Code inspection of `src/write/handlers.ts` | ______________ | ______________ | ______________ |
| 7 | `MCP_UPLOAD_TOU_SIGNED_BY` names a real person, role and date | Signed record (this document, section 4) | ______________ | ______________ | ______________ |
| 8 | Uploaded media type is within the configured MIME allowlist and size cap | Deployment config / policy | ______________ | ______________ | ______________ |
| 9 | Re-use / deletion path (administrator deletion by hash) is acceptable | Rollback runbook review | ______________ | ______________ | ______________ |

**Per-file determinations** (attach one row per file or a linked manifest; leave blank if none reviewed):

| Filename | Declared licence | Author | Source URL | ToU decision | Reviewer initials | Date |
|---|---|---|---|---|---|---|
| ______________ | ______________ | ______________ | ______________ | ______________ | ______________ | ______________ |
| ______________ | ______________ | ______________ | ______________ | ______________ | ______________ | ______________ |

---

## 3. Overall decision (operator circles / fills — do not pre-fill)

- [ ] **APPROVE** upload execution for the scoped deployment described above.
- [ ] **APPROVE WITH CONDITIONS**: ______________________________________________
- [ ] **REJECT** — uploads remain failed closed (`licence_not_signed_off`).
- [ ] **DEFER** — pending evidence: ______________________________________________

Decision date: ______________  Conditions expiry / review date: ______________

---

## 4. Signature lines (BLANK — no signature is recorded here)

Reviewer (Legal / Compliance owner):

Signature: ______________________________________  Name (printed): ______________________________  Date: ______________

Second reviewer (if required by policy):

Signature: ______________________________________  Name (printed): ______________________________  Date: ______________

Engineering owner acknowledging the decision (not the compliance approver):

Signature: ______________________________________  Name (printed): ______________________________  Date: ______________

---

## 5. Post-decision operator action (not performed by this template)

1. If and only if APPROVE is genuinely signed above, set `MCP_UPLOAD_TOU_SIGNED_BY` to the exact "name — role — date" string from section 1/4 in the deployment secret/config store.
2. Re-run `npm run build`, `npm test`, `npm run verify:catalogue`.
3. Confirm upload preview/dry-run still returns no mutation; only then consider a staged, human-confirmed live upload on a test wiki.
4. Attach the signed original (or a verified copy) to the deployment record and reference its id in the audit note.

**Until step 1 is backed by a real signature, `upload_file` execution stays blocked by design. This document remains PENDING and unsigned.**
