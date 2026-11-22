# G7 — Dry-run and rollback runbooks

No rollback is automatic. Every rollback needs its own confirmation, capability and audit event (contract 16 §2.6).

| Tool | Preview captures | Rollback procedure | Verification |
|---|---|---|---|
| `edit_page` | `base_revision`, prior text hash, exact diff | Submit a reverting `edit_page` with the prior wikitext and reason `Revert of <audit_event_id>` | New revision's content hash equals the preview's `content_hash` |
| `protect_page` | `prior_protections[]` (type/level/expiry), reason | Re-issue `action=protect` with the recorded prior levels/expiries | Current protection levels equal `prior_protections` |
| `move_page` | `from`, `to`, `movetalk`, `noredirect` | Re-issue `action=move` in reverse with recorded options | Source title restored; redirect cleanup reviewed manually; history caveat: move history is not fully reversible |
| `delete_page` | target revision, reason, protected status | Authorised operator runs `action=undelete` with recorded reason | Restored revision ID and content hash match the audit event |
| `upload_file` | filename, MIME, size, sha1, content hash, licence text | Administrator deletes the uploaded file and records a log entry | Deleted file's sha1 equals the audit `content_hash` before deletion |

`dry_run: true` returns `resultType:"complete"`, `executed:false`, `would_change:true` and never calls a mutating Action API action.
