# G12 — Incident & revocation drill record (executed)

**Date:** 2026-11-21  
**Environment:** isolated fixture harness (`tests/write/incident-drill.test.ts`), no live wiki mutation, no real credential.  
**Owner:** engineering drill operator (test harness).  
**Result:** PASS for the harness path. This is not a production incident exercise.

## Scenario
Suspected capability theft for a write-enabled deployment.

## Executed timeline (observed in the test run)
| Time | Action | Observed result |
|---|---|---|
| t0 | Incident declared | owner recorded as on-call; capability theft scenario |
| t1 | `MCP_WRITE_KILL_SWITCH=engaged` | subsequent write rejected with `write_halted`; **zero** upstream mutations |
| t2 | Preview `jti` deny-listed | replay of the signed `requestState` rejected with `confirmation_invalid`; **zero** upstream mutations |
| t3 | `MCP_WRITE_TOKEN_REVOCATION_ENDPOINT` called with a hashed token-id hint | HTTP 200 acknowledged; raw token never transmitted or logged |
| t4 | Audit chain exported and verified | chain intact before tampering; simulated edit of an exported record detected by recomputing its HMAC |

## Evidence
- Test: `tests/write/incident-drill.test.ts` (`AC-142 / G12`).
- Harness console line: `[G12 drill] t0… | t1: MCP_WRITE_KILL_SWITCH=engaged … | t2: jti … deny-listed … | t3: issuer revocation endpoint … | t4: audit chain exported … tamper simulation detected a broken record`.
- Audit record hash scheme: `HMAC-SHA256(canonical(record without record_hash) || prev_hash, MCP_WRITE_AUDIT_HMAC_SECRET)`, verified by `AuditStore.verify()`.

## Lessons / follow-up
- The kill switch and `jti` deny-list are effective before any mutation in the harness.
- Issuer revocation is exercised against a fixture endpoint only; a real issuer round-trip and proxy TLS termination remain deployment responsibilities and are **not** evidenced here.
- Re-run this drill after any change to contract 16 §2.
