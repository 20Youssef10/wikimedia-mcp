# Real-wiki rollback validation plan — HUMAN-EXECUTED TEST

**Status: NOT PERFORMED. REQUIRES OPERATOR EXECUTION. NO REAL WIKI WRITE HAS EVER BEEN PERFORMED BY THIS PROJECT.**

Dry-run and diff preview are fixture-evidenced only; rollback execution against a real wiki is **untested** (`write-security/signoff.md:16-17`, report 17 §"Report 08 §7 verification items" item 10). This document is a plan for a human operator to execute on `test.wikipedia.org` or a private wiki. It does not authorise a write, does not invent results, and records no signatures.

**Grounding:** `wikimedia-mcp/write-security/rollback-runbooks.md`, research report 08 §6.2 G7 / §7, report 16 §2.6 / AC-147-ish rollback path, report 17, `src/write/handlers.ts` (dry-run path), `src/write/config.ts:164-170` (testwiki-only project allowlist).

---

## 0. Non-negotiable constraints

- **No automatic rollback.** Every rollback needs its own confirmation, capability and audit event (`rollback-runbooks.md:3`). A rollback is a *new* write with its own human confirmation, not a hidden undo button.
- Use **only** `testwiki` (this build rejects any other project at boot: `MCP_WRITE_ALLOWED_PROJECTS` may contain only `testwiki`). A private wiki requires a separately reviewed deployment path; do not assume it is configured.
- `dry_run:true` must return `resultType:"complete"`, `executed:false`, `would_change:true` and make **no** mutating Action API call.
- Keep the kill switch engaged until the operator is ready; a test write must be preceded by explicit human sign-off of the exact diff.
- Preserve the audit chain export (events + anchors) before and after the test; see `WORM-AUDIT-SPEC.md`.

---

## 1. Prerequisites (operator checklist)

- [ ] Target is `test.wikipedia.org` (or an explicitly approved private wiki); a dedicated test page exists and no shared/production page will be touched.
- [ ] Real OAuth/CIMD/issuer configuration supplied in staging (see `OAUTH-CIMD-TEMPLATE.md`); token is in the secret store, never a tool argument.
- [ ] `MCP_WRITES_ENABLED=true`, `MCP_WRITE_GATES_SIGNED=true`, `MCP_WRITE_KILL_SWITCH=engaged` until the test window; signed AC-155 (three named humans) and G8 records exist for this deployment (see `SIGNOFF-TEMPLATES.md`, `G8-UPLOAD-TOC-CHECKLIST.md`). Upload tests require a genuine G8 sign-off.
- [ ] Two distinct approver identities configured (`MCP_WRITE_APPROVER_IDS`) and an out-of-band approval channel for non-edit tools.
- [ ] `MCP_REQUIRE_ORIGIN=true`, `MCP_REQUIRE_CSRF=true`, explicit allowlists, TLS verified.
- [ ] `npm run build && npm test && npm run verify:catalogue` all green; audit HMAC secret stored outside the sink.
- [ ] A named human operator and a named witness are assigned: Operator ______________, Witness ______________.
- [ ] Maintenance/alerting on the test wiki is arranged so the test edit does not disturb other users.

---

## 2. Dry-run (no mutation — safe to perform)

1. Preview the chosen tool call with `dry_run:true` (e.g. `edit_page` on the test page with the new wikitext).
2. Record the returned preview: `base_revision`, current content hash / `prior_protections` / location as applicable, and the **exact diff** to be confirmed.
3. Confirm no mutating Action API call occurred: the tool returns `executed:false`, `would_change:true`; the page's revision id is unchanged; `audit` shows a `dry_run` (or `previewed`) outcome only.
4. Save the dry-run diff and audit event id as the expected-diff baseline:
   - Expected diff / content hash: ______________________________________
   - Baseline revision id: ______________________________________
   - Dry-run audit event id: ______________________________________

---

## 3. Expected diff per tool (from `rollback-runbooks.md`)

| Tool | Preview captures | Expected change | Rollback target |
|---|---|---|---|
| `edit_page` | `base_revision`, prior text hash, exact diff | One new revision with the confirmed wikitext | New revision's content hash equals the preview's original `content_hash` after revert |
| `protect_page` | `prior_protections[]` (type/level/expiry), reason | Protection levels change as previewed | Current protection levels equal `prior_protections` |
| `move_page` | `from`, `to`, `movetalk`, `noredirect` | Page moves; redirect/talk effects as previewed | Source title restored; redirect cleanup reviewed manually; move history is **not fully reversible** |
| `delete_page` | target revision, reason, protected status | Page deleted | Restored revision id and content hash match the audit event |
| `upload_file` | filename, MIME, size, sha1, content hash, licence text | File uploaded (requires G8) | Deleted file's sha1 equals the audit `content_hash` before deletion |

---

## 4. Test execution (human-confirmed write — NOT DONE)

Operator steps, to be performed only after the dry-run diff is approved:

1. Re-preview without `dry_run`; receive `input_required` with the exact prompt and signed `requestState` (`confirm_write`).
2. A human reads the diff and supplies an affirmative `inputResponses` entry with the returned `requestState`. No auto-confirm exists; never reuse a state.
3. For `protect_page`/`move_page`/`delete_page`/`upload_file`, supply the two out-of-band approvals (they are re-checked against `MCP_WRITE_APPROVER_IDS`). For `upload_file`, also require the signed G8 record.
4. Execute. Record: new revision id / protection state / move result / deletion log id / file sha1, and the audit event id.
5. Note the audit chain head before rollback (`verifyHead`/`head`) so tail integrity can be checked afterwards.

Observed result fields (fill during execution):

- Tool tested: ______________  Target page/file: ______________________________
- Execution UTC timestamp: ____________________  New revision/log id: ____________________
- Confirmation id (`jti`): ______________________________  Audit event id: ____________________
- Chain head after write: __________________________________________________

---

## 5. Rollback steps (per tool — human executes)

| Tool | Rollback action | Reason string to use |
|---|---|---|
| `edit_page` | Submit a reverting `edit_page` with the prior wikitext | `Revert of <audit_event_id>` |
| `protect_page` | Re-issue `action=protect` with recorded prior levels/expiries | Reference audit event id |
| `move_page` | Re-issue `action=move` in reverse with recorded options | Reference audit event id; review redirect cleanup manually |
| `delete_page` | Authorised operator runs `action=undelete` with the recorded reason | Recorded reason + audit event id |
| `upload_file` | Administrator deletes the uploaded file and records a log entry | Recorded reason + audit event id |

Every rollback is itself a confirmed, capability-scoped, audited write. The kill switch remains engaged until the operator deliberately opens the test window again; disengage only for the rollback call and re-engage immediately after.

---

## 6. Verification after rollback (all must pass)

- [ ] Page content hash equals the preview's original `content_hash` (edit) / restored revision id and content hash match the audit event (delete).
- [ ] Protection levels equal `prior_protections` (protect).
- [ ] Source title restored; redirect cleanup reviewed (move); history caveat acknowledged.
- [ ] Deleted file sha1 equals the audit `content_hash` (upload).
- [ ] A new `executed` audit event exists for the rollback with its own `confirmation_id`, `capability_id`, `actor` and `outcome`; the diff hash matches the revert.
- [ ] `AuditStore.verify() === null` and `verifyHead(preWriteHead)` is false (new records appended) but the pre-write head is still present in the chain; chain export verifies after the test.
- [ ] No unexpected mutations on other pages/files; test wiki recentchanges inspected.
- [ ] Kill switch re-engaged; test token revoked or allowed to expire; temporary approver access removed.

Verification result: PASS / FAIL (circle one)  Verified by: ______________________  UTC time: ______________

Notes / deviations: ______________________________________________________________________

---

## 7. Sign-off (BLANK — operator and witness to complete)

Operator:

Signature: ______________________________________  Name (printed): ______________________  Date: ______________

Witness:

Signature: ______________________________________  Name (printed): ______________________  Date: ______________

Security/Backend reviewer (optional, if required by policy):

Signature: ______________________________________  Name (printed): ______________________  Date: ______________

**Result of this plan as handed off: NOT EXECUTED. No real write or rollback has been performed; all signatures above are blank.**
