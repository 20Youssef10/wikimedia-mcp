# Gate decision records (WP2)

`wmcp gate record` appends hash-chained, tamper-evident **decisions** here (`gate-decisions.json`).

**This records decisions; it does not sign.** No personal name, signature, legal approval or
chosen date is fabricated. The genuine G1/AC-155 and G8 signatures remain owner-supplied in
`SIGNOFF-TEMPLATES.md` / `G8-UPLOAD-TOC-CHECKLIST.md`. A recorded decision never satisfies
`MCP_WRITE_GATES_SIGNED` at boot.

- `gate-decisions.schema.json` — committed schema (read-only reference).
- `gate-decisions.json`, `anchors.ndjson` — runtime data, gitignored by the local `.gitignore`.
- The chain uses a fixed public domain constant for HMAC tamper-evidence, not a signer key.
