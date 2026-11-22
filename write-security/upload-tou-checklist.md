# G8 — Upload licence / attribution / Terms-of-Use checklist

**Status: PENDING HUMAN SIGN-OFF — not complete. Do not enable `upload_file` on the strength of this document.**

This artefact records the checklist required by write contract 16 §2.7 / AC-146 and report 14 WP1. It is a **documentation artefact only**; no legal or policy approval is asserted by the engineering team.

| # | Check | Evidence required | State |
|---|---|---|---|
| 1 | Licence is one of the signed allowlist (`CC-BY-SA-4.0`, `CC-BY-4.0`, `CC0-1.0`, `PD`, `OWN-WORK-AUTHORISED`) | Signed licence policy | Pending human owner |
| 2 | Attribution string preserved verbatim in the description page | `upload_file` output + audit `content_hash` | Implemented in code; not compliance-approved |
| 3 | Author and source URL recorded | Description wikitext + audit | Implemented in code |
| 4 | Commons Terms of Use reviewed for the deployment | Compliance owner sign-off | Pending human owner |
| 5 | No personal data in uploaded file or description | Human review of each upload | Pending per upload |
| 6 | Per-file licence never replaced by site-wide default | Code inspection (`src/write/handlers.ts`) | Implemented in code |
| 7 | `MCP_UPLOAD_TOU_SIGNED_BY` names person, role and date | Signed record with name/role/date | **Absent** |

`MCP_UPLOAD_TOU_SIGNED_BY` is required at boot when writes are enabled, but a configured string alone does not constitute the human sign-off. Because the signed record does not exist, `upload_file` remains disabled in the write-enabled harness for real execution; only preview/dry-run paths are exercised.
