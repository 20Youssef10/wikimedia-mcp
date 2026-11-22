# 17 — Threat-model re-review for the gated write design

**Date:** 2026-11-21  
**Status:** RE-REVIEW COMPLETE for the *design and fixture harness*; **G1 sign-off is NOT complete** (requires the three named human signatories per contract 16 §8/AC-155).  
**Authority:** report 08 §4/§6.2/§7, report 14, contract 16 v7.0.0 §2.8, contract 15 v6.1.0.  
**Scope:** T-02, T-06, T-19, T-21, T-22 plus HTTP T-10/T-11.

> This is a new document. Report 08 is not edited. Ratings below describe the *implemented, default-off* design; they do not authorise enablement.

## Re-rating table

| ID | Original residual | Re-rated | Basis in the shipped design | Owner / review trigger |
|---|---|---|---|---|
| T-02 (indirect prompt injection) | Medium (accepted residual) | **Medium — accepted residual, unchanged** | Untrusted text is returned as labelled data (`untrusted_content` warning); write tools are off by default and require an out-of-band MRTR confirmation with a human-readable diff; fixture canaries assert zero writes caused by injected content (AC-153). No control can guarantee an LLM ignores a directive, so this stays an accepted residual. | Security Architect; re-review on any model/host/tool change or a failing canary suite |
| T-06 (writes without confirmation/capability) | Medium | **Low for the default deployment; Medium residual if writes are enabled** | Default: no write tool registered, no write credential, `verify:read-only` 5/5. Enabled design: signed single-use `requestState`, affirmative `inputResponses`, target revision re-validation, signed scoped capability, kill switch, two-person approval, dry-run. Human diff-quality remains the residual. | Backend Lead; re-review before any gate release and after any change to §2.3/§2.4 |
| T-19 (parameter injection into upstream APIs) | Low | **Low** | Strict `additionalProperties:false` schemas; no caller-supplied host/api_url/token; Action API params built with `URLSearchParams`, never concatenated from free text; read and write paths use separate config and fetch paths. | Backend Lead; re-review on any new upstream parameter |
| T-21 (state-handle forgery) | Low | **Low** | `requestState` and capability are HMAC-signed, opaque, actor/tool/target/params-bound, short-TTL and single-use with a `jti` ledger; cross-actor/target/tool tests are negative-gated. | Security Architect; re-review on secret rotation or multi-tenancy change |
| T-22 (MRTR confirmation bypass) | Low–Medium | **Low–Medium (accepted)** | No auto-confirm path; affirmative response with exact `confirm_write` id required; forged/replayed/expired states rejected with zero outbound write. Residual: a human may approve a diff they did not read. | Product Owner; re-review after any MRTR UX change |
| T-10 (header/body mismatch, HTTP) | Low | **Low** | Existing transport already rejects `Mcp-Method`/`Mcp-Name`/version mismatches with `-32020`; write deployment additionally requires `MCP_REQUIRE_ORIGIN=true`, `MCP_REQUIRE_CSRF=true` and explicit allowlists. | Security Architect; re-review on proxy/TLS topology change |
| T-11 (Origin failure / DNS rebinding) | Low–Medium | **Low–Medium (accepted)** | Explicit origin/host allowlists, loopback bind default, POST-only HTTP and CSRF requirement; TLS termination at proxy is a deployment responsibility not evidenced by code. | Security Architect; re-review at deployment sign-off |

## Report 08 §7 verification items — status in this build

1. Strict schemas and zero outbound on validation failure — evidenced (`tests/write/`).
2. Token not accepted as a tool argument — evidenced.
3. RFC 9207 issuer binding and CIMD pinning — evidenced against a fixture issuer/JWKS.
4. Least-privilege scope map — evidenced.
5. Signed MRTR state, single-use and TTL — evidenced.
6. Target revision re-validation — evidenced.
7. Capability scoping, expiry and jti deny-list — evidenced.
8. Blast-radius limits — evidenced.
9. Tamper-evident audit chain — evidenced (§7.11 equivalent: edit/delete/reorder detection test).
10. Dry-run and rollback documentation — evidenced as documentation; rollback *execution* against a real wiki is not.
11. Two-person approval enforcement — evidenced in the harness; out-of-band channel rollout is not.
12. G9 injection canaries with writes enabled — evidenced in the isolated test harness.
13. G12 incident/revocation drill — executed in the harness; see `write-security/incident-revocation-drill.md`.

## Gate conclusion
G1's *technical re-review* is complete. The formal gate remains **NOT SIGNED**: AC-155 requires Security Architect, Backend Lead and Product Owner signatures and the G8 human compliance sign-off. Consequently no write tool ships.
