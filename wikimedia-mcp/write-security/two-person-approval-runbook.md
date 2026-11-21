# G11 — Two-person approval runbook

**Scope:** `protect_page`, `move_page`, `delete_page`, `upload_file` (contract 16 §2.8 / AC-145). `edit_page` is deliberately excluded.

## Roles
- **Requester:** the authenticated subject whose token is attached to the tool call. Never an approver of their own request.
- **Approver A and Approver B:** two **distinct** subjects from `MCP_WRITE_APPROVER_IDS`. Both must differ from the requester.

## Out-of-band channel
Approvals are collected outside the MCP transcript (ticket or messaging system) and supplied to the server as the request-scoped `approvals` list. They are never tool arguments and never client-asserted MRTR content alone: the implementation re-checks them against `MCP_WRITE_APPROVER_IDS` both at preview and at execution, and embeds both hashes in the signed `requestState`, the capability token and the audit event.

## Evidence capture
Each approval record must contain: request identifier, approver subject, timestamp, action/target, and the audit `event_id` returned by preview. The two hashes appear in `audit.approvals`.

## Emergency break-glass
In an incident, a single named operator may proceed only with retrospective approval from a second approver within one hour, recorded in the incident log. The break-glass path still requires the kill switch to be released and emits a normal audit event; it does not bypass confirmation or capability checks.

## Enforcement status
The two-distinct-subject rule is implemented in `src/write/handlers.ts` (`enforceApprovals`) and is covered by negative tests in `tests/write/`. Operational rollout of the channel and approver identities is a human action and is **not** evidenced by this document.
