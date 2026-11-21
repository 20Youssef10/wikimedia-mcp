# SDK Verification Gate — report 09 §2.3

**Target protocol revision:** MCP `2026-07-28`
**Date executed:** 2026-11-21
**Host:** Termux (aarch64), Node v24.22.2, npm 11.19.1
**Working directory for verification:** `/tmp/opencode/sdk-verify` (clean; project `node_modules` NOT inspected)

---

## Verdict

**GATE PASSES — with one documented deviation.**

The single package named by the contract (`@modelcontextprotocol/sdk`) no longer implements
`2026-07-28`. The `2026-07-28` implementation ships in the v2 SDK as **two packages**,
`@modelcontextprotocol/server@2.4.0` and `@modelcontextprotocol/client@2.4.0`. Both were
verified and are pinned exactly. The v1 maintenance line was rejected with evidence below.

### Deviation (required by report 09 §2.3 step 5 and the task brief)

| Contract says | Reality (registry, 2026-11-21) | Action |
|---|---|---|
| `@modelcontextprotocol/sdk`, exact pin from gate | `@modelcontextprotocol/sdk@1.32.2` is the `latest` dist-tag and implements **up to 2025-11-25 only**. Its README states: *"Support for the 2026-07-28 spec is not planned for v1.x: it is in v2 … which ships as separate packages, `@modelcontextprotocol/server` and `@modelcontextprotocol/client`."* | Pin `@modelcontextprotocol/server@2.4.0` + `@modelcontextprotocol/client@2.4.0`. Nearest available versions that satisfy the contract's *behavioural* requirement. |
| `zod-to-json-schema` if Zod 3.x; omit for Zod 4 | v2 SDK depends on `zod ^4.2.0` | Omitted; use `z.toJSONSchema()` (Zod 4). Single Zod copy confirmed via `npm ls zod`. |

---

## Step 1 — `npm pack` into a clean directory

```
mkdir -p /tmp/opencode/sdk-verify && cd /tmp/opencode/sdk-verify
npm pack @modelcontextprotocol/sdk@1.32.2      # tarball 616330 bytes, 701 files
npm view @modelcontextprotocol/sdk dist-tags   # { "latest": "1.32.2" }
npm view @modelcontextprotocol/server version  # 2.4.0
npm view @modelcontextprotocol/client version  # 2.4.0
npm pack @modelcontextprotocol/server@2.4.0    # 117 files
npm pack @modelcontextprotocol/client@2.4.0    # 101 files
```

## Step 2 — literal check on shipped code

Method: `grep -rF` restricted to shipped `.d.ts` / `.d.mts` / `.js` / `.mjs` / schema `.json`;
README, CHANGELOG and `package.json` descriptions excluded. 348 v1 files scanned.

| Literal | v1 `@modelcontextprotocol/sdk@1.32.2` | v2 `@modelcontextprotocol/server@2.4.0` | v2 `@modelcontextprotocol/client@2.4.0` |
|---|---|---|---|
| `2026-07-28` | MISSING* | PRESENT | PRESENT |
| `server/discover` | MISSING | PRESENT | PRESENT |
| `io.modelcontextprotocol/protocolVersion` | MISSING | PRESENT | PRESENT |
| `io.modelcontextprotocol/clientCapabilities` | MISSING | PRESENT | PRESENT |
| `resultType` | MISSING | PRESENT | PRESENT |
| `input_required` | PRESENT | PRESENT | PRESENT |
| `ttlMs` | MISSING | PRESENT | PRESENT |
| `cacheScope` | MISSING | PRESENT | PRESENT |
| `subscriptions/listen` | MISSING | PRESENT | PRESENT |
| `-32020` | MISSING | PRESENT | PRESENT |
| `-32021` | MISSING | PRESENT | PRESENT |
| `-32022` | MISSING | PRESENT | PRESENT |
| `HeaderMismatch` | MISSING | PRESENT | PRESENT |
| `UnsupportedProtocolVersion` | MISSING | PRESENT | PRESENT |
| `MCP-Protocol-Version` | PRESENT | PRESENT | PRESENT |
| `Mcp-Method` | MISSING | PRESENT | PRESENT |
| `Mcp-Name` | MISSING | PRESENT | PRESENT |
| `Mcp-Param-` | MISSING | PRESENT | PRESENT |
| **Result** | **FAIL (16/18 missing)** | **PASS (18/18)** | **PASS (18/18)** |

\* The only v1 file containing `2026-07-28` is `README.md`, which is explicitly excluded by the
gate. It is a *claim* about v2, not an implementation.

**v1 declaration evidence (why it fails):**
```
dist/cjs/types.js:33  exports.LATEST_PROTOCOL_VERSION = '2025-11-25';
dist/cjs/types.js:35  exports.SUPPORTED_PROTOCOL_VERSIONS =
    ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];
```
No shipped `.d.ts` in v1 declares `InputRequiredResult`, `resultType`, `ttlMs`, `cacheScope`,
`ServerDiscoverRequestSchema`, `UnsupportedProtocolVersionError`, `HeaderMismatchError`,
`Mcp-Method` or `Mcp-Name` (0 files each). It implements the `initialize` handshake
(`InitializeRequestSchema` present). It is therefore an older revision and was **not** used.

## Step 3 — type check (shipped type symbols)

Proxy probe run against the packed declarations; the full `verify-sdk.ts` `tsc --noEmit`
gate is re-run against the installed pinned packages below.

- Required v2 types present: `InputRequiredResult`, `DiscoverResult`, `DiscoverRequest`,
  `UnsupportedProtocolVersionError`, `MissingRequiredClientCapabilityError`,
  `CacheHint`, `CacheScope`, `CACHEABLE_RESULT_METHODS`, `SERVER_INFO_META_KEY`,
  `PROTOCOL_VERSION_META_KEY`, `CLIENT_CAPABILITIES_META_KEY`, `SUPPORTED_PROTOCOL_VERSIONS`,
  `LATEST_PROTOCOL_VERSION` (`= "2026-07-28"`), `McpServer`, `createMcpHandler`,
  `serveStdio`, `StdioServerTransport`, `Client`, `StreamableHTTPClientTransport`.
- `CACHEABLE_RESULT_METHODS` =
  `["tools/list","prompts/list","resources/list","resources/templates/list","resources/read","server/discover"]`.
- Zod 4 is the schema substrate (`registerTool` accepts `StandardSchemaWithJSON`).

_Full compile result recorded in "Post-install verification" below._

## Step 4 — behavioural smoke test

_Recorder in "Post-install verification" below._

## Step 5 — pin

`package.json` pins, and `package-lock.json` commits:
`@modelcontextprotocol/server 2.4.0`, `@modelcontextprotocol/client 2.4.0`,
`zod 4.6.7`, `undici 8.13.1`, `p-limit 7.3.3`, `p-retry 9.0.0`.

CI re-runs steps 2–3 on a clean install as a supply-chain drift guard.

---

## Post-install verification (executed 2026-11-21)

### Install

```
cd wikimedia-mcp && npm install
added 202 packages, audited 203, found 0 vulnerabilities
npm ls zod   -> zod@4.6.7 deduped across client, server, core and root (ONE copy)
```

Deviation: `typescript` is pinned to **6.0.3**, not 7.0.2, because
`typescript-eslint@8.73.0` declares the peer `typescript >=4.8.4 <6.1.0`. The
SDK's documented requirement (TypeScript ≥6.0, with `"types": ["node"]`) is
still satisfied.

### Step 3 — full type-check gate

`verify-sdk.ts` imports `McpServer`, `DiscoverResult`, `InputRequiredResult`,
`CacheHint`, `UnsupportedProtocolVersionError`,
`MissingRequiredClientCapabilityError`, `LATEST_PROTOCOL_VERSION` and
`SUPPORTED_PROTOCOL_VERSIONS`, builds a server with `cacheHints` carrying
`ttlMs`/`cacheScope` and a Zod-strict tool, and references the `resultType`
literals.

```
npx tsc --ignoreConfig --noEmit --module nodenext --moduleResolution nodenext \
        --target es2023 --strict --types node verify-sdk.ts
# exit 0, zero errors      (also available as `npm run verify:sdk`)
```

Project type-checks also pass with zero errors:
`tsc --noEmit -p tsconfig.json` and `tsc --noEmit -p tsconfig.test.json`.

### Step 4 — behavioural smoke test

`npx tsx scripts/smoke.ts` starts the real server over stdio (no mocks) and
uses raw newline-delimited JSON-RPC. Observed output:

- `server/discover` → `supportedVersions: ["2026-07-28"]`, `resultType:
  "complete"`, `ttlMs: 60000`, `cacheScope: "public"`,
  `_meta["io.modelcontextprotocol/serverInfo"] = {name:"wikimedia-mcp",
  version:"1.0.0"}`, non-empty `instructions`, capabilities with all three
  `listChanged: false`.
- `tools/list` → exactly nine names: `search`, `get_summary`, `get_page`,
  `get_sections`, `get_related_pages`, `get_media`, `get_languages`,
  `get_random_page`, `get_feed`.
- `tools/call get_summary {title:"Earth"}` → live HTTP 200 from
  `en.wikipedia.org/api/rest_v1/page/summary/Earth`, `pageid 9228`,
  `timestamp 2026-11-15T08:44:08Z`, and **both** `license` (CC BY-SA 4.0 with
  title/short/url) and `attribution` (`required:true`,
  `text:"Earth — wikipedia:en contributors, CC BY-SA 4.0"`,
  `link:"https://en.wikipedia.org/wiki/Earth?wprov=afsw1"`, disclaimer) present.

Protocol error cases were exercised by `tests/contract/http.test.ts` and
`tests/contract/stdio.test.ts`:

- bogus/unsupported version → `-32022` and HTTP 400 on Streamable HTTP;
- `Mcp-Method`, `Mcp-Name` and `MCP-Protocol-Version` mismatches → `-32020`;
- missing required `_meta` fields → `-32602`;
- all six cacheable operations → `ttlMs`/`cacheScope`;
- `subscriptions/listen` → `-32601`;
- base64 sentinel, `Mcp-Param-*`, Origin/Host, GET→405 + `Allow: POST`,
  wrong Content-Type→415 were all confirmed.

### Full test run

```
npm test  (= vitest run)
Test Files  22 passed | 1 skipped (23)
Tests       132 passed | 1 skipped (133)
```
The single skipped file is the REAL nightly live gate (330 calls); it is
skipped by default so CI performs no live calls. `TC-A-014` is now unskipped
and asserts 429 → Retry-After → bounded retries → eventual success on
contract-visible fields. Metric computation is tested fixture-backed in
`tests/live/live-gate.test.ts`. `npm run build`, `npm run typecheck`,
`npm run lint`, and both independent QA scripts (15/15 stdio, 10/10 HTTP) all
pass on the built `dist/index.js` after reviewer-requested fixes
(H1–H4, M1–M3, M5, M7).

### Engineering note — undici Agent compatibility

Node 24's **global** `fetch` uses a different undici build than
`undici@8.13.1`; passing an `undici@8` `Agent` as `dispatcher` to global fetch
fails with `TypeError: fetch failed / invalid onRequestStart method`. The
client therefore uses `undici.fetch` **with** its own Agent in production, and
a configurable `useDispatcher:false` path using `globalThis.fetch` so MSW can
intercept all fixture traffic. Both paths send the configured User-Agent.
