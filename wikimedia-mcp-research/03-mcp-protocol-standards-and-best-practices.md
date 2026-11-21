# Model Context Protocol (MCP) — Standards & Best Practices for Server Development

**Document version:** 2026-11-21 (Revised)  
**Language:** en-GB  
**Primary specification:** 2026-07-28 (current)  
**Status:** Corrected and aligned with the official 2026-07-28 revision

> **Revision note (2026-11-21):** This report has been substantially rewritten to reflect the breaking changes introduced in MCP 2026-07-28. Earlier drafts incorrectly retained session-based and initialize-handshake behaviour that no longer exists.
>
> **Verification (2026-11-21):** Every named method, header, `_meta` key, error, field, version and reference URL was checked against the live official specification; see the package `README.md` for methodology and the **[Verified] / [Design] / [Watch]** notation used below.

---

## 1. Core Architecture (2026-07-28)

MCP remains a client–server protocol using **JSON-RPC 2.0**. The three participants are unchanged:

- **Host** — the AI application (Claude Desktop, Cursor, VS Code, custom agents, etc.).
- **Client** — the connector component inside the host.
- **Server** — the process that exposes tools, resources and prompts.

### Major architectural shift

The 2026-07-28 revision makes the protocol **stateless**:

| Aspect | Pre-2026-07-28 | 2026-07-28 |
|--------|----------------|------------|
| Handshake | `initialize` / `notifications/initialized` | **Removed** |
| Sessions | Optional `Mcp-Session-Id` header | **Removed** |
| Capability discovery | Returned in initialize result | `server/discover` (servers **MUST** implement) |
| Protocol version | Negotiated once | Carried on **every request** in `_meta` (`io.modelcontextprotocol/protocolVersion`, required) and, on Streamable HTTP, in the `MCP-Protocol-Version` header |
| Change notifications | HTTP GET stream + `resources/subscribe` | `subscriptions/listen` (long-lived POST response) |
| State across calls | Session storage | Explicit server-minted handles passed as ordinary tool arguments |
| HTTP routing headers | None | On Streamable HTTP POST: `MCP-Protocol-Version` (every request), `Mcp-Method` (all requests) and `Mcp-Name` (for `tools/call`, `resources/read`, `prompts/get`); header/body mismatches are rejected with `-32020` `HeaderMismatch` [Verified] |

Every request is now self-describing. A request can be handled by any server instance behind a plain load balancer.

---

## 2. Transports

Two standard transports remain:

1. **stdio** — Client launches the server as a subprocess; communication via stdin/stdout. Still preferred for local desktop integrations.
2. **Streamable HTTP** — Independent process. Uses HTTP POST (and optionally long-lived responses for subscriptions). Protocol-level sessions and the independent GET stream endpoint have been removed.

Clients and servers may still implement custom transports, but the two above are the official ones. The legacy HTTP+SSE transport is still present but formally **deprecated** with a minimum 12-month window; new implementations should not adopt it (see §4) [Verified].

---

## 3. Required Server Behaviours (2026-07-28)

### 3.1 `server/discover`

Every server **MUST** implement the `server/discover` RPC. It advertises:

- Supported protocol versions
- Server identity (`serverInfo`)
- Capabilities (tools, resources, prompts, etc.)

Calling it is **optional for clients** [Verified] — a client may invoke any RPC inline and handle `UnsupportedProtocolVersionError` on a version mismatch. Calling it is useful for up-front version selection, for presenting server capabilities in a single request, and as a stdio backwards-compatibility probe. (The release blog's phrase "it is not required" refers to the *client's call*, not to the server's obligation to implement the RPC; the normative specification is unambiguous.)

### 3.2 Per-request metadata

Every request carries (in `params._meta`):

- `io.modelcontextprotocol/protocolVersion` (required)
- `io.modelcontextprotocol/clientCapabilities`
- `io.modelcontextprotocol/clientInfo` (recommended)

Servers should identify themselves in result `_meta` with `io.modelcontextprotocol/serverInfo`.

Version mismatches return `UnsupportedProtocolVersionError` (JSON-RPC code **`-32022`**; **HTTP 400 on Streamable HTTP** — there is no HTTP status on stdio) [Verified]. On Streamable HTTP the version is also required in the `MCP-Protocol-Version` header; a header/body mismatch yields `HeaderMismatch`.

### 3.3 Result shape

Every result now carries a `resultType` field (normally `"complete"`). Multi-round-trip interactions use `"input_required"`.

Servers **MUST** include `ttlMs` and `cacheScope` on every result with `resultType: "complete"` returned by **`server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list` and `resources/read`** [Verified]. `ttlMs` is a freshness hint in milliseconds (must be ≥ 0); `cacheScope` is `"public"` or `"private"`. Interim `input_required` results are not cacheable. Source: `https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching.md`.

### 3.4 Subscriptions

Clients that want change notifications open a long-lived POST to `subscriptions/listen`, opting into specific notification types (`toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions`). The old independent GET stream and `resources/subscribe` pair are gone.

---

## 4. Server Capabilities (Primitives)

Unchanged in concept:

### Tools
Model-controlled executable functions. Each tool has a name, description and JSON Schema for inputs. Optional output schema and annotations (read-only, destructive, etc.).

### Resources
Read-only, URI-addressable data that the application or user can pull into context.

### Prompts
Reusable, parameterised templates under user control.

### Server Instructions
Free-text guidance that teaches the model how to use the server’s tools and resources together. Still highly recommended. The 2026-07-28 `server/discover` result can also carry an `instructions` field for this purpose.

### What changed in 2026-07-28 beyond the primitives [Verified]

The primitives above are unchanged in concept, but a standards report must also cover the following 2026-07-28 additions and removals:

- **Multi Round-Trip Requests (MRTR)** replace server-initiated `elicitation/create`, `sampling/createMessage` and `roots/list`. A server returns `resultType: "input_required"` with an `InputRequiredResult` carrying `inputRequests`; the client retries the original request with `inputResponses` and optional `requestState`. Results of such retries are not cacheable.
- **Elicitation** remains a client feature but is delivered through MRTR rather than a held-open bidirectional stream.
- **Extensions framework:** optional, capability-negotiated extensions with prefixed identifiers. Official extensions include `io.modelcontextprotocol/tasks` (poll-based `tasks/get`, `tasks/update` for client input), MCP Apps (`io.modelcontextprotocol/ui`) and Enterprise Managed Authorization.
- **HTTP header routing:** Streamable HTTP POSTs must carry `MCP-Protocol-Version` (every request), `Mcp-Method` (all requests) and `Mcp-Name` (for `tools/call`, `resources/read` and `prompts/get`), allowing gateways to route and meter without parsing JSON bodies. Servers MUST validate header values against the body and reject mismatches with `-32020` `HeaderMismatch`. Tools may mark primitive parameters with `x-mcp-header` in the input schema to mirror them into `Mcp-Param-*` headers (clients MUST support this; servers MAY use it). Values that are not header-safe use the `=?base64?...?=` sentinel encoding.
- **Authorisation hardening:** authorisation servers should return `iss` per RFC 9207 and clients must validate it before redeeming a code; Dynamic Client Registration is deprecated in favour of Client ID Metadata Documents (CIMD); credentials are bound to the issuing issuer.
- **Deprecations (minimum 12-month window):** Roots, Sampling, Logging, the HTTP+SSE transport, `includeContext` values `"thisServer"`/`"allServers"`, and DCR. New servers should not adopt these. `ping`, `logging/setLevel` and `notifications/roots/list_changed` were removed; log level is now per-request via the `_meta` key `io.modelcontextprotocol/logLevel`.
- **SSE resumability removed:** the `Last-Event-ID` header and SSE event IDs are gone; a broken stream means the client must re-issue the request with a new ID.
- **Icon metadata** may be attached to implementations, tools, prompts and resources, with strict URI-scheme and content-validation requirements.

---

## 5. Tool Design Best Practices

These recommendations remain valid and are even more important under a stateless model:

1. Prefer a small number of well-named, task-oriented tools over many low-level endpoints.
2. Write precise descriptions — they are the primary signal the model uses.
3. Provide detailed JSON Schema for every parameter.
4. Keep outputs concise and structured.
5. Return actionable error messages that allow the model to recover.
6. Support pagination or explicit limits; never return unbounded result sets.
7. Accurately declare side-effect annotations.
8. Surface rate-limit or quota information when available.

---

## 6. Backwards Compatibility

Servers that must support older clients (2025-11-25 and earlier) should implement fallback logic. Official SDKs generally handle the dual-era negotiation. On stdio a modern client can probe with `server/discover` and fall back to `initialize` if necessary. On HTTP a modern request that receives a non-modern error can fall back.

New servers should target 2026-07-28 as the primary revision and document any compatibility surface they still maintain. The published revision list is **2024-11-05, 2025-03-26, 2025-06-18, 2025-11-25 and 2026-07-28 (current)** [Verified]. "Legacy" means 2025-11-25 and earlier, "modern" means 2026-07-28 and later, and "dual-era" implementations support both. Tier 1 SDKs (TypeScript, Python, Go, C#) support 2026-07-28; Rust SDK support is in beta [Verified].

---

## 7. Security & Operational Notes

- Validate all inputs against schemas.
- Prefer short-lived tokens and proper OAuth flows for authenticated backends.
- Enforce least privilege, especially for write operations.
- Log invocations with correlation IDs.
- Respect upstream rate limits; implement polite concurrency and exponential backoff.
- For remote HTTP servers: validate Origin, implement authentication, and apply appropriate CORS policies.

---

## 8. Official References

- Specification (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28
- Changelog: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx
- Blog announcement: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- Official SDKs and reference servers: https://github.com/modelcontextprotocol

---

*End of revised MCP standards report.*
