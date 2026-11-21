# Write-enablement decision record — risk acceptance

**Date:** 2026-11-21
**Decision:** enable all five write tools (`edit_page`, `protect_page`, `move_page`, `delete_page`, `upload_file`) in the default server catalogue.

## G1 / AC-155 — authorisation for enablement
- The **Product Owner (the requester in this session) explicitly instructed: "enable all tools"** on 2026-11-21. This record treats that instruction as the authorisation to enable the tools.
- **Independent named signatures from a Security Architect, a Backend Lead and a Product Owner were NOT obtained.** No names or signatures are fabricated here. This is a **risk acceptance by the requester**, not the three-way sign-off required by frozen contract 16 §8 / AC-155.
- The technical threat re-review in `../wikimedia-mcp-research/17-threat-model-rereview.md` remains valid; the formal gate is accepted-by-risk rather than signed.
- **Owner map (role titles only, NOT signatures):** Security Architect / Backend Lead / Product Owner. Per the requester's 2026-11-21 instruction these role titles — not personal names — are recorded as the intended signatories in `../../handoff/SIGNOFF-TEMPLATES.md`. Dates, decisions and signatures remain blank; this is not three-way sign-off.

## G8 — upload licence / ToU
- The upload compliance checklist (`upload-tou-checklist.md`) remains **PENDING human Legal/Compliance review**. It is deliberately **not** marked complete.
- `MCP_UPLOAD_TOU_SIGNED_BY` has no genuine named sign-off. The default write configuration leaves it empty, so `upload_file` preview/dry-run works but real upload execution fails closed with `licence_not_signed_off` until a human compliance owner supplies a real record.
- The Product Owner accepted this residual risk with the enable instruction.

## G7 — rollback
- Dry-run and diff preview are fixture-evidenced. **Rollback execution on a real wiki is untested**; only documented procedures exist (`rollback-runbooks.md`). No real rollback should be assumed.

## Production-only gaps (documented, not closed by this decision)
- **G2:** no real issuer/CIMD/JWKS round-trip was exercised. The default write configuration has no issuer configured, so all write calls fail closed with `authentication_required`/`invalid_issuer` until an operator supplies real OAuth configuration.
- **G10:** TLS termination at a proxy with forwarded `Origin`/`Host`/`Mcp-*` headers is a deployment responsibility and was not evidenced. Header/CSRF validation logic is active.
- **G11:** the out-of-band approver identities and channel are not deployed. Two distinct configured approvers are still enforced in code; no real approver subjects exist in the default configuration.
- **G12:** the drill was executed in the isolated fixture harness only; real issuer revocation and a production audit WORM sink were not exercised.

## Residual risk accepted
Enabling the tools increases exposure to: human error in confirming a diff (T-06/T-22), indirect prompt injection amplified by write capability (T-02), unauthorised writes if OAuth configuration is misdeployed (G2), and upload legal exposure (G8). The requester explicitly accepted these risks. **Every technical control remains active**; this record does not disable, bypass or auto-confirm any control.

**Status: ENABLED BY REQUESTER RISK ACCEPTANCE — not three-way signed, not legally signed off.**
