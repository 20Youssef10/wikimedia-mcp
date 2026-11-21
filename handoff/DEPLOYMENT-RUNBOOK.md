# Wikimedia MCP — staged deployment runbook

**Status:** operational hand-off draft. **No real wiki write has ever been performed in this repository.** All write evidence comes from the isolated fixture harness (`tests/write/`), never from a live wiki. Do not read this document as authorisation to write.

**Grounding:** `wikimedia-mcp/src/config.ts`, `wikimedia-mcp/src/write/config.ts`, `wikimedia-mcp/.env.example`, `wikimedia-mcp/package.json`, `wikimedia-mcp/README.md` §"Security / write tooling", `wikimedia-mcp/scripts/{assert-read-only,assert-catalogue}.mjs`, `wikimedia-mcp/write-security/signoff.md`, research reports 08 §6/§8, 14, 16, 17.

All commands below run with working directory `/data/data/com.termux/files/home/wiki-mcp/wikimedia-mcp` unless stated otherwise. Node >= 22 is required (`package.json` `engines`).

---

## 0. Current truth (read before deploying anything)

| Fact | Evidence |
|---|---|
| Default catalogue is **28 tools**; the five write tools (`edit_page`, `protect_page`, `move_page`, `delete_page`, `upload_file`) are registered following the Product Owner's 2026-11-21 "enable all tools" instruction. | `README.md:359`, `scripts/assert-catalogue.mjs:26-30` |
| `READ_ONLY_PROFILE=1` yields **23 tools** and no write tool/credential in the shipped artifact. | `src/write/config.ts:7-9`, `scripts/assert-read-only.mjs` |
| With no OAuth/CIMD config supplied, write calls **fail closed** (`authentication_required` / `invalid_issuer`); real uploads fail closed with `licence_not_signed_off`. | `README.md:361`, `src/write/auth.ts:73-75`, `src/write/handlers.ts:412-413` |
| G1/AC-155 (three named human signatures) and G8 (Legal/Compliance upload sign-off) are **not satisfied**. `write-security/signoff.md` records requester risk acceptance only. | `write-security/signoff.md`, `17-threat-model-rereview.md:4,39` |
| The default write config is *inert*: random per-process secrets, empty issuer/store/approvers, kill switch released but no credential exists. | `src/write/config.ts:17-33` |
| No real issuer/CIMD/JWKS round-trip, no real revocation, no real WORM sink, and no real-rollback execution has been exercised. | `write-security/signoff.md:19-23`, `incident-revocation-drill.md:4,27` |

**Consequence:** Stage 1 (read-only) is deployable today. Stage 2 (write-enabled) is a *prerequisite checklist*, not an authorisation: it cannot be completed truthfully until humans sign AC-155 and G8 and supply real secrets/issuer configuration.

---

## 1. Universal preflight (both stages)

```sh
cd /data/data/com.termux/files/home/wiki-mcp/wikimedia-mcp
npm run build
npm run typecheck
npm test
npm run verify:catalogue
```

- `npm run build` → `tsc -p tsconfig.json`; must succeed before either verify script (they import `dist/`).
- `npm run typecheck` → `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json`.
- `npm test` → `vitest run` (fixture-only merge gate; no live network).
- `npm run verify:catalogue` → `node scripts/assert-catalogue.mjs`; asserts 28 default tools, five write tools present, all write controls wired, no auto-confirm bypass, and that the read-only profile still asserts 23 tools.
- Optional: `npm run lint`, `npm run verify:sdk`, `npm run test:coverage`.

Optional live read smoke (only from clean egress, off-peak): `npm run smoke` starts a stdio server, calls `server/discover`, `tools/list`, and `get_summary` for "Earth" against the live REST API.

---

## 2. Stage 1 — read-only rollout (recommended default)

1. Build first (preflight above).
2. Select the explicit read-only profile:

   ```sh
   export READ_ONLY_PROFILE=1
   # equivalent alternative: export MCP_WRITES_ENABLED=false
   ```

3. Verify the shipped artifact:

   ```sh
   READ_ONLY_PROFILE=1 npm run verify:read-only
   # prints five PASS lines then "READ-ONLY ASSERTION PASSED"; exits non-zero on any failure
   ```

   The script skips with a message (exit 0) if `READ_ONLY_PROFILE != 1` — always pass the variable explicitly. It checks: no write tool in the shipped catalogue, no write-tool registration in any `dist/*.js`, no write-credential key set in env, no write-credential field in the validated config object, 23 tools.

4. Base environment still required (from `.env.example`):

   ```sh
   USER_AGENT='WikiMCP/1.0 (https://example.org/wikimedia-mcp; contact: ops@example.org)'
   MCP_TRANSPORT=stdio            # or streamable-http
   MCP_HTTP_HOST=127.0.0.1        # loopback; public bind requires allowlists
   MCP_HTTP_PORT=3000
   MCP_HTTP_PATH=/mcp
   MCP_ALLOWED_ORIGINS=           # required (explicit, never '*') if non-loopback bind
   MCP_ALLOWED_HOSTS=127.0.0.1,localhost
   CONCURRENCY_LIMIT=3            # boot rejects > 3
   HTTP_TIMEOUT_MS=15000
   RETRY_MAX_ATTEMPTS=3
   RETRY_BACKOFF_BASE_MS=250
   RETRY_BACKOFF_MAX_MS=5000      # must be >= base
   RETRY_AFTER_FALLBACK_MS=5000
   MCP_REQUIRE_ORIGIN=false       # HTTP hardening; must be true for writes
   MCP_REQUIRE_CSRF=false         # HTTP hardening; must be true for writes
   MCP_CSRF_SECRET=               # >= 16 chars when REQUIRE_CSRF=true
   MCP_CSRF_TOKEN_TTL_MS=300000
   LOG_LEVEL=info
   METADATA_CACHE_TTL_MS=3600000
   MAX_RESULT_BYTES=65536
   WIKIDATA_SPARQL_ENDPOINT=https://query.wikidata.org/sparql
   WIKIDATA_SPARQL_ENDPOINT_V2=https://query-next.wikidata.org/sparql
   WIKIDATA_SPARQL_FALLBACKS=https://query-main.wikidata.org/sparql
   WIKIDATA_SPARQL_PREFER_V2=false
   WIKIDATA_SPARQL_ACCEPT=application/sparql-results+json
   WIKIDATA_SPARQL_TIMEOUT_MS=60000
   WIKIDATA_SPARQL_MAX_ROWS=1000
   WIKIDATA_SPARQL_MAX_QUERY_LENGTH=10000
   ATTRIBUTION_API_VERSION=v0-beta
   ATTRIBUTION_FALLBACKS=rest-bare,action-rightsinfo,action-imageinfo
   ATTRIBUTION_DISCLAIMER='You remain responsible for licence compliance.'
   ```

   Boot-fail rules: invalid config terminates startup; public bind requires both allowlists; every SPARQL URL must be `https:`; attribution version must match `^v[0-9]+(?:-[a-z0-9]+)?$`; fallback tokens must be from the fixed three-token set.

5. Start: `npm start` (`tsx src/index.ts`), or run the built server `node dist/index.js`.

### Stage 1 health checks

- `READ_ONLY_PROFILE=1 npm run verify:read-only` → 5/5 PASS, 23 tools, no write registration.
- `npm run verify:catalogue` (default profile, no `READ_ONLY_PROFILE`) → 28 tools with control wiring intact.
- `npm run smoke` (optional, live egress) → `server/discover`, `tools/list`, successful `get_summary`.
- HTTP transport: confirm loopback bind; confirm missing/foreign `Origin` and CSRF behaviour matches `MCP_REQUIRE_*` settings.
- Confirm no write-credential environment key is present (the read-only assertion checks `oauth|bot[_-]?password|write[_-]?(token|credential|secret)|access[_-]?token|refresh[_-]?token`).

Note: the independent `/tmp/opencode/qa-mcp-smoke.mjs` and `qa-mcp-http.mjs` scripts assert exactly 22 tools and will report a count mismatch; they are intentionally unmodified. Use the two `verify:*` scripts as the source of truth.

---

## 3. Stage 2 — write-enabled deployment prerequisites (NOT YET AUTHORISED)

Do not proceed until **all** of the following are true and evidenced:

1. **G1/AC-155 signed** by Security Architect, Backend Lead and Product Owner (three *distinct named humans*); dated threat re-review of T-02, T-06, T-19, T-21, T-22 (plus T-10/T-11 on HTTP) and report 08 §7 items 1–13 re-run. Use `SIGNOFF-TEMPLATES.md`.
2. **G8 Legal/Compliance sign-off** for upload licence/ToU, with a named person, role and date. Use `G8-UPLOAD-TOC-CHECKLIST.md`. Until this exists, set no TOU sign-off string; `upload_file` execution must remain failed closed.
3. **Real secrets** from a secret manager: MRTR, capability, audit-HMAC and CSRF secrets (>= 32 chars each for MRTR/capability/audit; CSRF >= 16), plus the OAuth bearer token in a secret-store env var. Never inline secrets in repo files, shell history, tool arguments, logs or chat.
4. **Real issuer/CIMD/JWKS** endpoints (HTTPS) and a real RFC 9207 `iss` round-trip, exercised in staging before production.
5. **Two distinct real approver identities** and an out-of-band approval channel (G11).
6. **Production WORM audit anchor** configured (see `WORM-AUDIT-SPEC.md`); the current `AuditStore` is a local HMAC chain with an injectable daily anchor sink only.
7. **Real rollback rehearsal** on `test.wikipedia.org` or a private wiki (see `REAL-WIKI-ROLLBACK-PLAN.md`); no live rollback has been executed.
8. **HTTP hardening active**: `MCP_REQUIRE_ORIGIN=true`, `MCP_REQUIRE_CSRF=true`, explicit `MCP_ALLOWED_ORIGINS`/`MCP_ALLOWED_HOSTS`, TLS termination at a trusted proxy (G10), header/secret-redaction tests passing.

### Exact write configuration keys

Source: `WRITE_CONFIG_KEYS` in `src/write/config.ts:79-92` and validation at lines 138-237. Setting **any** write key makes all required keys mandatory; setting none yields the inert config.

| Key | Constraint / purpose |
|---|---|
| `MCP_WRITES_ENABLED` | `false` (or `READ_ONLY_PROFILE=1`) forces read-only; otherwise writes are configurable. |
| `MCP_WRITE_GATES_SIGNED` | Must be `true`; boot fails unless `write-security/signoff.md` also exists (AC-155). |
| `MCP_WRITE_KILL_SWITCH` | `engaged`\|`released`; defaults `engaged`; may not be `released` while gates unsigned. |
| `MCP_WRITE_OAUTH_ISSUER` | Required HTTPS issuer URL; RFC 9207 `iss` must match byte-for-byte. |
| `MCP_WRITE_OAUTH_AUDIENCE` | Required expected `aud`. |
| `MCP_WRITE_OAUTH_CIMD_URL` | Required HTTPS client-metadata document URL. |
| `MCP_WRITE_OAUTH_CLIENT_ID` | Required; must equal CIMD `client_id`. |
| `MCP_WRITE_OAUTH_TOKEN_ENDPOINT` | Required HTTPS; must equal CIMD `token_endpoint`. |
| `MCP_WRITE_OAUTH_SCOPES` | Required explicit, non-wildcard list from `{edit, protect, move, delete, upload}`. |
| `MCP_WRITE_TOKEN_STORE` | Required: name of the env var holding the bearer token (fallback `MCP_WRITE_TOKEN`). Token is selected server-side, never a tool argument. |
| `MCP_WRITE_TOKEN_MAX_TTL_SECONDS` | <= 900 (default 900). |
| `MCP_WRITE_TOKEN_REVOCATION_ENDPOINT` | Required HTTPS revocation URL. |
| `MCP_MRTR_SECRET` | HMAC secret, >= 32 chars. |
| `MCP_MRTR_STATE_TTL_SECONDS` | <= 300 (default 120). |
| `MCP_CAPABILITY_SECRET` | HMAC secret, >= 32 chars. |
| `MCP_CAPABILITY_MAX_TTL_SECONDS` | <= 300 (default 300). |
| `MCP_WRITE_ALLOWED_PROJECTS` | Explicit, non-wildcard. This build accepts **only `testwiki`**; any production project is rejected at boot. |
| `MCP_WRITE_ALLOWED_NAMESPACES` | Namespace ids 0–15 (default `0`). |
| `MCP_WRITE_MAX_EDITS_PER_SESSION` | Default 5. |
| `MCP_WRITE_MAX_WRITES_PER_HOUR` | Default 30. |
| `MCP_WRITE_MAX_BYTES_PER_EDIT` | Default 65536. |
| `MCP_WRITE_UPLOAD_MAX_BYTES` | Default 20971520 (20 MiB). |
| `MCP_WRITE_UPLOAD_MIME_ALLOWLIST` | Non-wildcard; default `image/png,image/jpeg,image/gif`. |
| `MCP_WRITE_AUDIT_SINK` | Required audit sink identifier. |
| `MCP_WRITE_AUDIT_HMAC_SECRET` | HMAC secret, >= 32 chars. |
| `MCP_WRITE_AUDIT_RETENTION_DAYS` | >= 365 (default 365). |
| `MCP_WRITE_TWO_PERSON_APPROVAL` | `true`\|`false` (default `true`). |
| `MCP_WRITE_APPROVER_IDS` | Required; **at least two distinct** ids. |
| `MCP_WRITE_CANARIES_REQUIRED` | `true`\|`false` (default `true`). |
| `MCP_UPLOAD_TOU_SIGNED_BY` | Required at boot, but a configured string is *not* a human sign-off; real uploads must stay blocked without the signed G8 record. |

Additionally required: `MCP_REQUIRE_ORIGIN=true`, `MCP_REQUIRE_CSRF=true`, `MCP_CSRF_SECRET` (>= 16 chars), explicit non-wildcard `MCP_ALLOWED_ORIGINS` and `MCP_ALLOWED_HOSTS`.

Scope map (`src/write/constants.ts:10-16`): `edit_page`→`edit`, `protect_page`→`protect`, `move_page`→`move`, `delete_page`→`delete`, `upload_file`→`upload`. Two-person approval is enforced for all but `edit_page`.

After supplying all of the above, re-run the full preflight plus `npm run verify:catalogue`, then exercise a staging dry-run only. No live write until AC-155 and G8 are genuinely signed.

---

## 4. Health checks (write-enabled staging)

- Boot log: no configuration error; `verify:catalogue` green.
- With kill switch engaged: any write returns `write_halted`, zero upstream mutations.
- Without valid OAuth config: `authentication_required` / `invalid_issuer`, zero upstream mutations.
- `upload_file` without genuine G8 record: `licence_not_signed_off`, zero upload.
- `dry_run:true` → `resultType:"complete"`, `executed:false`, `would_change:true`, no mutating Action API call.
- Forged/replayed/expired confirmation → `confirmation_invalid`, zero mutations.
- `AuditStore.verify()` returns `null` on a fresh chain; `verifyHead(anchor.head)` true against the last daily anchor; see `WORM-AUDIT-SPEC.md`.

---

## 5. Rollback to read-only (operational procedure)

1. **Engage the kill switch first**: `export MCP_WRITE_KILL_SWITCH=engaged` (or remove all write env keys). This halts writes on the next config load.
2. **Revoke the issuer token** via `MCP_WRITE_TOKEN_REVOCATION_ENDPOINT` (helper: `revokeToken()` in `src/write/auth.ts`); rotate MRTR/capability/audit/CSRF secrets if compromise is suspected.
3. **Switch profiles**: `export READ_ONLY_PROFILE=1` (or `export MCP_WRITES_ENABLED=false`) and restart the process. Write config object becomes `null`; no write tool/credential is loaded.
4. **Verify**: `npm run build && READ_ONLY_PROFILE=1 npm run verify:read-only` → 5/5 PASS, 23 tools. `npm run smoke` for read-path health.
5. **Preserve evidence**: export and verify the audit chain and daily anchors *before* tearing down the process (local `memory:process` sink is ephemeral). See `WORM-AUDIT-SPEC.md`.
6. **Record the incident/decision** with timestamp, operator and reason; if a real write occurred, follow `write-security/rollback-runbooks.md` and `REAL-WIKI-ROLLBACK-PLAN.md` with a human operator.

Rollback is not automatic for individual writes: every undo needs its own confirmation, capability and audit event (`write-security/rollback-runbooks.md:3`).

---

## 6. Verification command quick reference

| Goal | Command |
|---|---|
| Compile | `npm run build` |
| Static types (src + tests) | `npm run typecheck` |
| Fixture test suite | `npm test` |
| Default catalogue (28 tools, controls wired) | `npm run verify:catalogue` |
| Explicit read-only (23 tools, 5/5) | `READ_ONLY_PROFILE=1 npm run verify:read-only` |
| Lint | `npm run lint` |
| SDK surface | `npm run verify:sdk` |
| Coverage | `npm run test:coverage` |
| Live read smoke | `npm run smoke` |
| Nightly live gate (off-peak only) | `npm run build && WMCP_LIVE=1 npx vitest run tests/live/live.test.ts` — see `NIGHTLY-SCHEDULER.md` |

---

## 7. Assumptions / open items

- Values in `.env.example` are documentation placeholders (example.org contacts); replace with real, contactable values.
- The write-enabled path has never been run against a live wiki; bootstrap risk remains with the operator.
- `MCP_WRITE_ALLOWED_PROJECTS=testwiki` is the only project this build permits; a production project requires a separately signed gates record that does not exist in this repository.
- `write-security/signoff.md` is requester risk acceptance, **not** the three-way AC-155 sign-off. These templates do not fabricate signatures or legal approvals.
