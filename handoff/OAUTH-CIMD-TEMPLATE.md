# OAuth / issuer / CIMD production configuration template

**Status:** TEMPLATE ONLY — contains **PLACEHOLDER values, no real secrets, no real issuer**. Do not copy into a `.env` file and expect writes to work. Production OAuth/issuer wiring has never been exercised with a real provider; the only round-trip evidence is the fixture harness (`tests/write/harness.ts`, AC-133).

**Grounding:** `src/write/auth.ts` (all validation logic), `src/write/config.ts:79-92,138-237` (exact key names and boot rules), `src/write/constants.ts:9-24` (scope map), `src/write/transport.ts:93-97` (secret-store token selection), `write-security/signoff.md:20`, research report 16 §2.1/§2.2.

---

## 1. Required configuration keys (exact names from the project)

### 1.1 OAuth / issuer / CIMD block

| Key | Meaning | Validation enforced at boot / call time |
|---|---|---|
| `MCP_WRITE_OAUTH_ISSUER` | Canonical HTTPS issuer URL. | `https:` required; RFC 9207 `iss` from the token endpoint must equal it byte-for-byte; JWT `iss` must equal it byte-for-byte. |
| `MCP_WRITE_OAUTH_AUDIENCE` | Expected `aud` claim. | Must be non-empty; JWT `aud` must equal it exactly. |
| `MCP_WRITE_OAUTH_CIMD_URL` | HTTPS URL of the Client Instance Metadata Document (CIMD). | `https:` required; fetched explicitly. No DCR, no dynamic discovery. |
| `MCP_WRITE_OAUTH_CLIENT_ID` | Client id. | Must non-empty; must equal CIMD `client_id`. |
| `MCP_WRITE_OAUTH_TOKEN_ENDPOINT` | HTTPS token endpoint. | `https:` required; must equal CIMD `token_endpoint`. |
| `MCP_WRITE_OAUTH_SCOPES` | Explicit space/comma-separated scope allowlist. | Non-empty, no wildcards, all tokens must be in `{edit, protect, move, delete, upload}`. |
| `MCP_WRITE_TOKEN_STORE` | Name of the env var holding the server-side bearer token. | Non-empty; token read via `env[config.tokenStore]` with fallback `MCP_WRITE_TOKEN`. Never a tool argument. |
| `MCP_WRITE_TOKEN_MAX_TTL_SECONDS` | Max accepted token lifetime. | <= 900; default 900. |
| `MCP_WRITE_TOKEN_REVOCATION_ENDPOINT` | HTTPS revocation endpoint (G12). | `https:` required; used by `revokeToken()` with a hashed `token_id_hint`. |

### 1.2 Gate / secret block (all required for a write-enabled boot)

| Key | Validation |
|---|---|
| `MCP_WRITES_ENABLED` | `true`; `READ_ONLY_PROFILE=1` or `MCP_WRITES_ENABLED=false` disables writes entirely. |
| `MCP_WRITE_GATES_SIGNED` | Must be `true`; boot fails unless `write-security/signoff.md` exists (AC-155). |
| `MCP_WRITE_KILL_SWITCH` | `engaged`\|`released`; defaults `engaged`; `released` is illegal while gates are unsigned. |
| `MCP_MRTR_SECRET` | HMAC-SHA256 secret, >= 32 chars; signs single-use confirmation `requestState`. |
| `MCP_MRTR_STATE_TTL_SECONDS` | <= 300 (default 120). |
| `MCP_CAPABILITY_SECRET` | HMAC secret, >= 32 chars; signs scoped capability tokens. |
| `MCP_CAPABILITY_MAX_TTL_SECONDS` | <= 300 (default 300). |
| `MCP_CSRF_SECRET` | >= 16 chars (also enforced by base `loadConfig` when `MCP_REQUIRE_CSRF=true`). |
| `MCP_REQUIRE_ORIGIN` / `MCP_REQUIRE_CSRF` | Both must be `true` for writes. |
| `MCP_ALLOWED_ORIGINS` / `MCP_ALLOWED_HOSTS` | Explicit, non-wildcard comma lists; required for any non-loopback bind. |

### 1.3 Blast-radius / audit / approval block

`MCP_WRITE_ALLOWED_PROJECTS` (this build accepts only `testwiki`), `MCP_WRITE_ALLOWED_NAMESPACES` (0–15), `MCP_WRITE_MAX_EDITS_PER_SESSION` (default 5), `MCP_WRITE_MAX_WRITES_PER_HOUR` (default 30), `MCP_WRITE_MAX_BYTES_PER_EDIT` (default 65536), `MCP_WRITE_UPLOAD_MAX_BYTES` (default 20971520), `MCP_WRITE_UPLOAD_MIME_ALLOWLIST` (default `image/png,image/jpeg,image/gif`), `MCP_WRITE_AUDIT_SINK`, `MCP_WRITE_AUDIT_HMAC_SECRET` (>= 32 chars), `MCP_WRITE_AUDIT_RETENTION_DAYS` (>= 365), `MCP_WRITE_TWO_PERSON_APPROVAL` (default true), `MCP_WRITE_APPROVER_IDS` (>= 2 distinct ids), `MCP_WRITE_CANARIES_REQUIRED` (default true), `MCP_UPLOAD_TOU_SIGNED_BY` (required at boot but **not** a substitute for a signed G8 record).

---

## 2. Issuer discovery and CIMD pinning

There is **no** dynamic OIDC discovery in this build. The deployment supplies an explicit HTTPS issuer and an explicit HTTPS CIMD URL; no DCR (Dynamic Client Registration) is attempted.

`loadCimd()` (`src/write/auth.ts:31-58`):

1. `GET <MCP_WRITE_OAUTH_CIMD_URL>` with `User-Agent: WikiMCP-Write/1.0`, `Accept: application/json`.
2. Requires HTTP 200 and a JSON object.
3. Requires `client_id === MCP_WRITE_OAUTH_CLIENT_ID` and `token_endpoint === MCP_WRITE_OAUTH_TOKEN_ENDPOINT` — exact string equality. Any mismatch → `invalid_issuer`.
4. Requires `jwks_uri` to be a string beginning with `https://`.
5. Requires `scopes_supported` to be an array of strings with **no `*` wildcards**.
6. Returns `{client_id, token_endpoint, jwks_uri, scopes_supported}` — only `jwks_uri` and `scopes_supported` are taken from the document; identity fields are re-asserted from config.

CIMD document shape expected (PLACEHOLDER values):

```json
{
  "client_id": "PLACEHOLDER_CLIENT_ID",
  "token_endpoint": "https://issuer.PLACEHOLDER.example/token",
  "jwks_uri": "https://issuer.PLACEHOLDER.example/.well-known/jwks.json",
  "scopes_supported": ["edit", "protect", "move", "delete", "upload"]
}
```

**Operator rule:** host the CIMD and JWKS on the issuer's own HTTPS origin, serve them over TLS with a trusted chain, and change them only through a reviewed rotation. The CIMD is the pin: a compromised or redirected CIMD is an issuer-change event requiring re-sign-off.

---

## 3. Token validation pipeline (exact order in `validateAccessToken`)

1. **Configured?** Missing issuer/CIMD/scopes → `authentication_required` ("no write issuer configured").
2. **Load + pin CIMD** as above; any failure → `invalid_issuer`.
3. **RFC 9207 `iss` binding:** the token-endpoint response must carry an issuer value equal to `MCP_WRITE_OAUTH_ISSUER` byte-for-byte. Missing/mismatched → `invalid_issuer`. This is a transport-provided, request-scoped value (`tokenEndpointIss`), not a claim the caller can assert.
4. **JWT structure:** exactly three dot-separated base64url segments; decodable header and claims JSON.
5. **Algorithm:** header `alg === "RS256"` and `kid` is a string; anything else → `authentication_required`.
6. **Issuer claim:** `iss` must be a string, start with `https://`, and equal the configured issuer exactly.
7. **Audience:** `aud === MCP_WRITE_OAUTH_AUDIENCE`.
8. **Time claims:** `exp` numeric, `exp > now`, `exp - now <= MCP_WRITE_TOKEN_MAX_TTL_SECONDS`; optional `nbf` must not be in the future.
9. **JWKS / signature:** fetch `jwks_uri`; select the key whose `kid` matches the header; construct a public key from JWK; verify `RSA-SHA256` over `header.payload` against the signature segment. Unknown `kid`, fetch failure, or bad signature → `invalid_issuer` / `authentication_required`.
10. **Scope:** `scope` claim split on spaces must include the tool's required scope → otherwise `insufficient_scope`.
11. **Actor:** non-empty `sub` required; optional `tenant` defaults to `default`; stored actor uses `sha256-prefix:<first 8 hex of sha256>` for identifiers (raw token/sub are never stored).

**Never:** accept a token, confirmation, credential, `host` or `api_url` as a tool argument; log/echo/cache a token; put a token in a URL or error string. Raw bearer is transmitted only from the server-side secret store over TLS (`Authorization: Bearer …` in `HttpWriteTransport.mutate`) using the token from `MCP_WRITE_TOKEN_STORE`/`MCP_WRITE_TOKEN`.

---

## 4. Least-privilege scope map (from `src/write/constants.ts`)

| Tool | Required scope | Two-person approval |
|---|---|---|
| `edit_page` | `edit` | No |
| `protect_page` | `protect` | Yes |
| `move_page` | `move` | Yes |
| `delete_page` | `delete` | Yes |
| `upload_file` | `upload` | Yes + G8 sign-off |

`MCP_WRITE_OAUTH_SCOPES` and the CIMD `scopes_supported` must both be explicit; wildcard scopes are rejected at boot and at CIMD load. Grant only the scopes the deployment actually needs.

---

## 5. Secret storage rules

- Store `MCP_MRTR_SECRET`, `MCP_CAPABILITY_SECRET`, `MCP_WRITE_AUDIT_HMAC_SECRET`, `MCP_CSRF_SECRET`, and the bearer token in a managed secret store; inject as environment variables at process start. Never commit them, never place them in `handoff/`, never paste them into tickets or chat.
- Secret length floors: MRTR/capability/audit >= 32 chars; CSRF >= 16 chars. The default config generates random per-process values (inert, non-durable) — a durable deployment must supply its own.
- `MCP_WRITE_TOKEN_STORE` names the env var containing the bearer; rotation means updating the secret store and restarting. Revocation uses `MCP_WRITE_TOKEN_REVOCATION_ENDPOINT` with a hashed `token_id_hint` only.
- Rotate MRTR/capability secrets only with a coordinated restart: in-flight signed states become invalid (fail closed, not unsafe).
- Audit events store only hashed token identifiers (`token_id`), actor hash prefixes and confirmation/capability ids — never raw tokens or credentials.
- Redaction is tested in `tests/unit/csrf.test.ts` / `tests/write/control-plane.test.ts`; re-run `npm test` after any auth/config change.

---

## 6. Filled example — PLACEHOLDER values only

```sh
# Base (see .env.example) — USER_AGENT must be contactable
USER_AGENT='WikiMCP/1.0 (https://PLACEHOLDER.example/wikimedia-mcp; contact: ops@PLACEHOLDER.example)'
MCP_TRANSPORT=streamable-http
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
MCP_HTTP_PATH=/mcp
MCP_ALLOWED_ORIGINS=https://console.PLACEHOLDER.example
MCP_ALLOWED_HOSTS=127.0.0.1,localhost

# HTTP hardening — mandatory for writes
MCP_REQUIRE_ORIGIN=true
MCP_REQUIRE_CSRF=true
MCP_CSRF_SECRET=PLACEHOLDER_CSRF_SECRET_REPLACE_FROM_VAULT_0001

# Gates — only after genuine AC-155 + G8 human sign-off and signoff.md exists
MCP_WRITES_ENABLED=true
MCP_WRITE_GATES_SIGNED=true
MCP_WRITE_KILL_SWITCH=engaged

# OAuth / issuer / CIMD (all HTTPS, all PLACEHOLDER)
MCP_WRITE_OAUTH_ISSUER=https://issuer.PLACEHOLDER.example/tenant/PLACEHOLDER_TENANT
MCP_WRITE_OAUTH_AUDIENCE=wikimedia-mcp-write-PLACEHOLDER
MCP_WRITE_OAUTH_CIMD_URL=https://issuer.PLACEHOLDER.example/.well-known/client.json
MCP_WRITE_OAUTH_CLIENT_ID=PLACEHOLDER_CLIENT_ID
MCP_WRITE_OAUTH_TOKEN_ENDPOINT=https://issuer.PLACEHOLDER.example/token
MCP_WRITE_OAUTH_SCOPES=edit,protect,move,delete,upload
MCP_WRITE_TOKEN_STORE=PLACEHOLDER_SECRET_ENV_VAR_NAME
MCP_WRITE_TOKEN_MAX_TTL_SECONDS=900
MCP_WRITE_TOKEN_REVOCATION_ENDPOINT=https://issuer.PLACEHOLDER.example/revoke

# Signing secrets (>= 32 chars). Replace every PLACEHOLDER with vault values.
MCP_MRTR_SECRET=PLACEHOLDER_MRTR_SECRET_REPLACE_FROM_VAULT_000001
MCP_MRTR_STATE_TTL_SECONDS=120
MCP_CAPABILITY_SECRET=PLACEHOLDER_CAPABILITY_SECRET_REPLACE_FROM_VAULT_0001
MCP_CAPABILITY_MAX_TTL_SECONDS=300

# Blast radius / approvals / audit
MCP_WRITE_ALLOWED_PROJECTS=testwiki
MCP_WRITE_ALLOWED_NAMESPACES=0
MCP_WRITE_MAX_EDITS_PER_SESSION=5
MCP_WRITE_MAX_WRITES_PER_HOUR=30
MCP_WRITE_MAX_BYTES_PER_EDIT=65536
MCP_WRITE_UPLOAD_MAX_BYTES=20971520
MCP_WRITE_UPLOAD_MIME_ALLOWLIST=image/png,image/jpeg,image/gif
MCP_WRITE_AUDIT_SINK=PLACEHOLDER_WORM_SINK_IDENTIFIER
MCP_WRITE_AUDIT_HMAC_SECRET=PLACEHOLDER_AUDIT_HMAC_SECRET_REPLACE_FROM_VAULT_001
MCP_WRITE_AUDIT_RETENTION_DAYS=365
MCP_WRITE_TWO_PERSON_APPROVAL=true
MCP_WRITE_APPROVER_IDS=PLACEHOLDER_APPROVER_ID_1,PLACEHOLDER_APPROVER_ID_2
MCP_WRITE_CANARIES_REQUIRED=true
MCP_UPLOAD_TOU_SIGNED_BY=PLACEHOLDER_NAME__ROLE__DATE__DO_NOT_USE_WITHOUT_REAL_G8_SIGNATURE
```

**Important:** `MCP_UPLOAD_TOU_SIGNED_BY` must be left unset unless a genuine, dated human G8 record exists. Setting a placeholder to bypass the boot requirement is a policy violation; real upload execution must stay failed closed with `licence_not_signed_off`.

---

## 7. What the operator must supply (checklist)

- [ ] A real HTTPS issuer with RFC 9207 support in its token response, and a real `aud` value.
- [ ] A real CIMD document at an HTTPS URL whose `client_id`, `token_endpoint`, `jwks_uri` and `scopes_supported` are correct and wildcard-free.
- [ ] A real JWKS endpoint serving RS256 signing keys with stable `kid` values; key-rotation procedure documented.
- [ ] Real secrets from a secret manager for MRTR, capability, audit HMAC, CSRF and the bearer token; all length floors met.
- [ ] The bearer token itself injected via a secret-store env var (`MCP_WRITE_TOKEN_STORE`), never as a tool argument.
- [ ] Real, distinct approver identities and an out-of-band two-person approval channel.
- [ ] Signed AC-155 record (three named humans) and signed G8 Legal/Compliance record (named person/role/date).
- [ ] A production WORM audit anchor sink and a rehearsed revocation/rollback procedure.
- [ ] A real token revocation endpoint and a tested revocation drill in staging.
- [ ] TLS termination with correct forwarding of `Origin`/`Host`/`Mcp-*` headers (G10) and explicit origin/host allowlists.

Until every item is genuinely complete, the correct deployment posture is `READ_ONLY_PROFILE=1` with `READ_ONLY_PROFILE=1 npm run verify:read-only` green.
