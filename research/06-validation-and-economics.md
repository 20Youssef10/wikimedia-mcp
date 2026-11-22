# Validation, Demand and Economics — Gap Closure Report

**Document version:** 2026-11-21  
**Language:** en-GB  
**Purpose:** Resolve the eight open gaps carried forward from reports 01–05. Companion to `07-test-strategy.md` (test corpus) and `08-threat-model.md` (formal security analysis).

> **Verification:** All findings were produced on 21 November 2026 from live primary sources, live endpoint probes, the GitHub REST API, package-download APIs and the official MCP registry. See each section for citations. Nothing in this report is based on training memory.

---

## 1. Gap status at a glance

| # | Gap (from report 05 §12 / risk register) | Status | Where resolved |
|---|------------------------------------------|--------|----------------|
| 1 | WDQS v2 endpoint migration `[Watch]` | **Resolved (with config contract)** | §5 |
| 2 | User-demand evidence | **Resolved (evidence + revised roadmap)** | §3 |
| 3 | Performance benchmarks | **Resolved (live measurements)** | §2 |
| 4 | Paid Enterprise cost model | **Resolved (decision model + quote inputs)** | §4 |
| 5 | Test corpus / strategy | **Resolved** | `07-test-strategy.md`, `test-corpus.json` |
| 6 | Formal threat model | **Resolved** | `08-threat-model.md` |
| 7 | Attribution API service | **Resolved — and prior claim corrected** | §6 |
| 8 | MCP host config matrix | **Resolved** | §7 |

---

## 2. Live performance benchmarks

### 2.1 Method

Three sequential GET requests per endpoint from a single Termux host on 21 November 2026, using a descriptive User-Agent, HTTP `Accept` headers, a 25 s ceiling, and a 1 s pause between requests. `curl` reported `http_code`, total time, time-to-connect, time-to-first-byte and byte count. This is a **single-vantage-point measurement**, not a controlled benchmark: it is useful for *relative* ordering and for exposing failure modes, not for absolute SLA claims. One follow-up probe used a 40 s ceiling.

### 2.2 Results (medians of three runs)

| Endpoint | Median total | Range | Bytes | HTTP results |
|----------|--------------|-------|-------|--------------|
| Wikimedia REST `/page/summary/Earth` | **0.286 s** | 0.280–0.315 | 3,490 | 200 ×3 |
| Analytics pageviews (Earth, Oct 2026) | **0.302 s** | 0.276–0.471 | 4,414 | 200 ×3 |
| Action API `list=search` | **0.586 s** | 0.544–0.686 | 4,324 | 200 ×3 |
| Action API `prop=extracts` (Earth) | **0.591 s** | 0.506–0.712 | 4,011 | 200 ×3 |
| WDQS simple SELECT (`wd:Q42 wdt:P31 ?x`, LIMIT 1) | **0.994 s** (single probe) | — | 191 | 200 |
| Wikibase REST item `Q42` | **1.074 s** (first call) | — | 211,746 | 200, then **429, 429** |
| WDQS SELECT with `SERVICE wikibase:label` | **>25 s** | timed out ×3 | 0 | 000 (timeout) |

A separate live probe by the research stream measured `wd:Q42 wdt:P569` at ≈3.2 s HTTP 200, confirming that SPARQL latency is query-dependent.

### 2.3 Failure modes observed

- **Rate limiting is real and immediate.** Repeated Wikibase REST requests for `Q42` returned HTTP **429** with `x-envoy-ratelimited: true` and **`Retry-After: 16`**, after a single successful 211 KB response. This directly validates the ≤3 concurrency and `Retry-After` rules in reports 01 §4 and 02 §9.
- **SPARQL complexity dominates latency.** A trivial query returned in under a second; a query using the `SERVICE wikibase:label` pattern exceeded 25 s three times. The "Moderate (query complexity limits)" rating in report 01 §2 is therefore **empirically supported**.
- **HEAD on the SPARQL endpoint timed out** at 20 s, while GET worked — do not rely on HEAD for availability checks.
- Connect time was roughly 0.12–0.32 s across endpoints, so a significant share of total latency is network setup, not upstream processing.

### 2.4 Effect on the suitability ratings in reports 01–02

| Rating in 01/02 | Benchmark verdict |
|-----------------|-------------------|
| Wikimedia REST `rest_v1` — "Excellent" | **Supported**: fastest measured endpoint (~0.29 s) and cacheable. |
| Analytics — "Good" | **Supported** (~0.30 s). |
| Action API — "Moderate" | **Supported** (~0.59 s, more verbose per call). |
| Wikidata SPARQL — "Moderate (query complexity limits)" | **Strongly supported**: 1 s → >25 s depending on query. |
| Wikibase REST — "Good" | **Qualified**: first call ~1.1 s but 211 KB payload and rapid 429; good capability, needs strict budgeting. |
| Enterprise — "Excellent (SLA available)" | **Not benchmarked** (no credential); claim rests on the published SLA, not measurement. |

**Implication for the report 05 §10 metric "p95 latency < 2 s":** the target is achievable for groups A, B (entity lookups) and C, but **not** for SPARQL label queries or large Wikibase items. Report 07 applies a per-tool-class latency budget accordingly.

---

## 3. User-demand evidence and revised roadmap

### 3.1 Direct evidence (measured usage)

| Signal | Value (Nov 2026) | Group | Source |
|--------|------------------|-------|--------|
| PyPI `wikipedia-mcp` | **13,544 downloads/month** | A | `https://pypistats.org/api/packages/wikipedia-mcp/recent` |
| npm `@cyanheads/wikipedia-mcp-server` | **3,123 downloads/month** | A | npm downloads API |
| npm `@cyanheads/wikidata-mcp-server` | **2,125 downloads/month** | B | npm downloads API |
| npm `@pipeworx/mcp-commons-wikimedia` | **931 downloads/month** | F | npm downloads API |

Context: third-party trackers report ~13,658 packaged MCP servers and ~92 M monthly downloads, but only **188 packages exceed 10 K downloads/month** and the top 0.1 % take ~84 % of installs (https://majorlabs.co/data, https://mcphq.ai/state-of-mcp, https://protocolprobe.com/mcp/servers/top/downloads — methodologies differ). Group A's 13.5 K/month is therefore genuinely notable.

An npm package named `wikipedia-mcp` with 68,555 downloads/month was **excluded**: registry metadata shows no repository and cannot be attributed to a known project.

### 3.2 Proxy evidence

- **GitHub stars:** `Rudra-ravi/wikipedia-mcp` 310★/62 forks; `zzaebok/mcp-wikidata` 49★; `wmde/WikidataMCP` 35★ (official Wikimedia Deutschland); `shiquda/mediawiki-mcp-server` 27★; the two `cyanheads` servers 6★ and 3★.
- **MCP Registry:** "wikipedia"/"wikidata"/"wikimedia" return several servers; searches for **"recent changes", "lift wing" and "wikipedia edit" return zero results** — evidence of absence for groups D, G and E.
- **Issue themes:** the main Wikipedia server's tracker repeatedly requests languages/variants, table access and coordinates/geosearch; the Wikidata server's 58-issue tracker is dominated by SPARQL row caps, external-ID resolution (DOI/PMID/ORCID/OpenAlex/IMDb), sitelinks and statements — unusually deep engagement for group B.
- **Willingness to pay for metrics:** multiple API-key-gated hosted pageview MCPs exist (trendsapi, trendsmcp, Apify), plus a free alternative — a real, if indirect, signal for group C.

### 3.3 Ranked demand

| Rank | Group | Confidence | Evidence |
|------|-------|------------|----------|
| 1 | **A — content retrieval** | **High** | Two independent download signals; most implementations; richest issue themes. |
| 2 | **B — Wikidata** | **High** | 2.1 K/month npm; engaged power-user tracker; two registry families. |
| 3 | **C — metrics** | Medium | Several paid/hosted offerings; no install counts. No evidence for "unique devices" specifically. |
| 4 | **F — Commons + attribution** | Medium–low | 931/month npm; two dedicated Commons servers; no issue evidence for licence requirements. |
| 5 | **G — advanced/admin** | Low (medium for geosearch) | Coordinates/tables explicitly requested; no evidence for compare-revisions, categories or Lift Wing. |
| 6 | **E — Enterprise bulk** | Low (demand) | Only the docs-only official MCP; absence of demand ≠ absence of product value. |
| 7 | **D — live recent changes** | Low / unknown | No registry entries, issues or posts found. |

Ranks 5–7 are close and weakly evidenced; treat their order as tentative.

### 3.4 Revised roadmap (supersedes report 05 §7)

| Phase | Content | Change from original |
|-------|---------|----------------------|
| 1 | Group A core public content | Unchanged |
| 2 | Group B Wikidata integration | Unchanged |
| 3 | Group C metrics **+ Group F Commons/attribution promoted from Phase 5** | F promoted; **D removed** |
| 4 | Group E Enterprise data | **Gated** on an Enterprise subscription or a validated use case |
| 5 | Group G advanced, sliced | **Coordinates/tables ship in Phase 1**; compare-revisions, categories, Lift Wing and write tools move to an unvalidated backlog |
| Spike | Group D EventStreams | **One-week spike + registry watch, not a build phase** |

**Reversal triggers:** registry install counts; a tracker category for knowledge/reference MCPs; published Enterprise subscriber numbers; a surge of D/E/G issues; or a published user survey. None exists today.

---

## 4. Paid Enterprise cost model

### 4.1 What is published

| Dimension | Free account | Paid account |
|-----------|--------------|--------------|
| On-demand requests | 50,000/month | Unlimited |
| Snapshots | 30/month | Unlimited |
| Snapshot chunks | 1,500/month | Unlimited |
| Snapshot cadence | Monthly (1st of month) | Up to daily |
| Realtime API | Not included | Included (stream + hourly batches, 48 h replay) |
| Structured Contents | Beta | Beta |
| SLA / support | FAQ + feedback form | Up to 99 % SLA, support team |
| Rate | Hard 10 req/s | Contract-specific QPS |
| Price | Free | **Bespoke egress pricing, not published** — "pay only for data egress beyond your free allocation" |

Sources: `https://enterprise.wikimedia.com/pricing.md`, `/docs/snapshot/`, `/docs/on-demand/`, `/docs/realtime/`.

**Egress scale matters:** English Wikipedia's article snapshot exceeds 1 TB; the Wikidata Main Graph is ~105 GB compressed in ~300 chunks (properties ~37 MB in one chunk); German Wikipedia ~35.5 GB. A "monthly refresh" of a large project is a material transfer even on a free account's 30-download allowance.

### 4.2 Free alternatives that change the decision

Meta-Wiki's access page (https://meta.wikimedia.org/wiki/Wikimedia_Enterprise#Access) documents three free routes: a free account; **calls from PAWS, Wikimedia Cloud VPS or Toolforge with no authorisation header, receiving the same access as a paid account**; and third-party-hosted Structured Contents datasets. Mission-aligned organisations whose needs exceed free limits may request **exceptional free access** via `techpartnerships@wikimedia.org` against six published criteria (need, obligation, mission alignment, values alignment, etc.). New features built under such an exception must be made available to all (non-exclusivity).

### 4.3 Decision model

Define the monthly demand vector:

- `N` = On-demand lookups; `S` = full snapshot downloads; `C` = chunk downloads
- `Q` = sustained requests/second; `F` = required freshness (monthly / weekly / daily / realtime)
- `E` = egress GB/month; `A` = SLA/support requirement

**Free tier is sufficient iff:** `N ≤ 50,000` **and** `S ≤ 30` **and** `C ≤ 1,500` **and** `Q ≤ 10` **and** `F = monthly` **and** no Realtime/SLA requirement.

If any condition fails, the options in order are:

1. **Optimise before paying** — field filters, caching, `fields`/`limit`, chunk-only downloads, ETags/`Range` resume (all documented). Many workloads fall back inside the free tier after this step.
2. **Free hosted route** — if the deployment can run inside WMCS/Toolforge/PAWS, paid-level access is available without authorisation headers.
3. **Exceptional access** — if mission-aligned and the six criteria can be evidenced.
4. **Paid plan** — otherwise.

**Cost expression:** `monthly cost = F_monthly + max(0, E − E_free) × P_egress`, where `F_monthly` and `P_egress` are **unpublished** and must come from a vendor quote. The model therefore resolves *when* to pay, not *how much*; the absolute figure cannot be resolved from public information and no vendor quote was obtained. This is the honest boundary of the gap closure.

### 4.4 Quote-request inputs (to obtain a real price)

Send `https://enterprise.wikimedia.com/contact/` with: expected `N`, `S`, `C`, `Q`, `E` (GB/month, with peak), required freshness, whether Realtime stream or hourly batches are needed, SLA target, project list, retention/deduplication plan, and whether the use case is mission-aligned (which may unlock exceptional access instead).

---

## 5. SPARQL endpoint configuration (WDQS v2 migration)

### 5.1 Verified state

- `https://query.wikidata.org/sparql` (v1, Blazegraph) is **still live**: HTTP 200 with standard SPARQL JSON on 21 November 2026.
- The migration is Blazegraph → **QLever**. New endpoints are **`https://query-next.wikidata.org/sparql`** (main) and **`https://query-scholarly-next.wikidata.org/sparql`** (scholarly), routed via REST Gateway → `wdqs-proxy` → QLever (Phabricator **T443756**, resolved 18 Nov 2026).
- **The v2 endpoints returned HTTP 403 `Unauthorized User-Agent`** for an unregistered client even with a browser UA. Early access currently requires an NDA Phabricator request. `query-main.wikidata.org/sparql` returns 200 but is a **v1 alias** (`x-served-by: wdqs1033`) — do not mistake it for v2.
- Timeline: dual v1+v2 access until **June 2027**; v1 may degrade from **February 2027**; Blazegraph decommissioned by **30 June 2027**. There is **no public client-side discovery mechanism or env var** — endpoint choice is entirely the client's responsibility.
- Rate limits: anonymous ~4 qps / 240 req/min, ~18 concurrent, 429 with `Retry-After`, 60 s query timeout.
- Queries must be portable SPARQL 1.1: explicit `PREFIX` declarations, no Blazegraph-only extensions; QLever needs rewrites for some date literals, geospatial and `bd:sample` patterns.

### 5.2 Configuration contract (replaces the `[Watch]` flag)

| Key | Default | Purpose |
|-----|---------|---------|
| `WIKIDATA_SPARQL_ENDPOINT` | `https://query.wikidata.org/sparql` | Primary (only generally open endpoint today) |
| `WIKIDATA_SPARQL_ENDPOINT_V2` | `https://query-next.wikidata.org/sparql` | Optional v2 target |
| `WIKIDATA_SPARQL_FALLBACKS` | ordered list | Alternate endpoints |
| `WIKIDATA_SPARQL_PREFER_V2` | `false` | Flip when v2 is generally available |

**Fallback rules:** on `403` (body contains `Unauthorized User-Agent`), `401`, `404`, `5xx` or timeout → try the next endpoint; on `429`/`503` → honour `Retry-After` and **do not** switch. Always send a descriptive User-Agent. Request `Accept: application/sparql-results+json` (works on both); set a client timeout ≤ 60 s; parse the standard SPARQL JSON shape.

**Reversal triggers:** v2 returns 200 for an unregistered UA → set `PREFER_V2=true`; v1 degradation/decommission in Feb–Jun 2027 → make v2 the default; re-verify the announced "week of 23 Nov 2026" general launch, which had not materialised for anonymous clients by 21 Nov 2026.

---

## 6. Attribution service — resolved, and prior claim corrected

### 6.1 Correction

Earlier revisions of reports 01, 02 and 05 stated that no formal "Attribution API" had been confirmed. **That was incorrect.** A formal beta REST API exists and was live on 21 November 2026. The Toolforge site is the framework/documentation, not the API itself. Reports 01, 02, 05 and the README have been corrected to reflect this.

### 6.2 Verified service

- **Endpoint:** `GET {wiki}/w/rest.php/attribution/v0-beta/pages/{encodedTitle}/signals`
- **Example:** `https://en.wikipedia.org/w/rest.php/attribution/v0-beta/pages/Earth/signals` → HTTP 200.
- **Status:** beta, public, all Wikimedia wikis, Wikimedia-only (part of the `WikimediaCustomizations` extension). Launched 20 April 2026; `v1` expected later but `.../attribution/v1/...` returned **404 `rest-no-match`** on 21 Nov 2026.
- **Returns:** an `essential` block containing `link` (preserve `wprov=afsw1`), `source_wiki` (site name, family, id, languages), `title`, `license{title, short, url}`, `default_brand_marks[]`, and — for Commons `File:` pages — `credit`.
- **Known beta gaps:** null `contributor_counts`, licence-name normalisation in progress, no remote media, `relative` trending hardcoded to `false`, hard-coded CTAs, no all-images-per-page endpoint. Official docs note v1 was expected around September 2026, but the `v1` path still returned 404 on 21 November 2026.

### 6.3 Complementary sources (still required)

| Need | Source | Notes |
|------|--------|-------|
| Commons media author/licence detail | Action API `prop=imageinfo&iiprop=extmetadata\|url\|user` | Fields `Artist`, `Credit`, `LicenseShortName`, `LicenseUrl`, `UsageTerms`, `AttributionRequired`, `Restrictions`; values are HTML — strip tags. |
| Wiki-wide licence | Action API `meta=siteinfo&siprop=rightsinfo` | Fallback for text. |
| Text licence | MediaWiki REST `GET /v1/page/{title}/bare` | Returns `license{url,title}`; no per-file licence via REST. |
| High-volume / commercial | Enterprise On-demand / Structured Contents | Machine-readable `license` in payload; auth required. |

### 6.4 Implementation recommendation for Group F

Use the Attribution API as the **primary** signal source with config key `ATTRIBUTION_API_VERSION="v0-beta"`, on 404 `rest-no-match` re-detect/fall back. Return the `essential` fields: title, source wiki, licence (short/title/url), the attribution link with `wprov` intact, credit for media, and default brand marks. Enrich Commons results with Action API `extmetadata` (HTML-stripped). Fall back to REST `/bare` and `rightsinfo` when the Attribution API is unavailable. Include the API's compliance disclaimer in output: callers remain responsible for licence compliance. Keep per-file licences distinct from the site-wide CC BY-SA 4.0 default. Re-simplify when v1 ships or beta gaps close.

---

## 7. MCP host configuration matrix

All examples use the public read-only endpoint `https://enterprise.wikimedia.com/mcp` (Streamable HTTP, MCP 2026-07-28, **POST-only: live GET returned 405**), registry ID `com.wikimedia.enterprise/docs`, no authentication (leave OAuth fields empty).

| Host | Config location | Key | Transport field | Snippet / action | Caveat |
|------|-----------------|-----|-----------------|------------------|--------|
| **Claude Code** | `.mcp.json` / `~/.claude.json` | `mcpServers` | `"type":"http"` | `claude mcp add --transport http wme-docs https://enterprise.wikimedia.com/mcp` | `type` required alongside `url`; `streamable-http` accepted as alias. |
| **Claude.ai / Desktop** | Connectors UI, or `claude_desktop_config.json` | `mcpServers` | URL for remote; `command`/`args` for stdio | Paste URL in Customize → Connectors → Add custom connector | Leave OAuth empty. |
| **Cursor** | `.cursor/mcp.json` / `~/.cursor/mcp.json` | `mcpServers` | URL infers remote | `{"mcpServers":{"wme-docs":{"url":"https://enterprise.wikimedia.com/mcp"}}}` | Set transport explicitly if it defaults to legacy SSE. |
| **VS Code (Copilot native, preferred)** | `~/.copilot/mcp-config.json` or `.mcp.json` | `mcpServers` | `"type":"http"` | `{"mcpServers":{"wme-docs":{"type":"http","url":"https://enterprise.wikimedia.com/mcp","tools":["*"]}}}` | Copilot harness is replacing the editor-managed form. |
| **VS Code (editor-managed, deprecated)** | `.vscode/mcp.json` | `servers` | `"type":"http"` | `{"servers":{"wme-docs":{"type":"http","url":"https://enterprise.wikimedia.com/mcp"}}}` | This is the form Wikimedia's docs publish; removal Feb 2027. |
| **Codex CLI** | `~/.codex/config.toml` | TOML `[mcp_servers.<name>]` | URL implies HTTP | `codex mcp add wme-docs --url https://enterprise.wikimedia.com/mcp` | No transport field. |
| **Gemini CLI** | `~/.gemini/settings.json` | `mcpServers` | **`httpUrl`** | `{"mcpServers":{"wme-docs":{"httpUrl":"https://enterprise.wikimedia.com/mcp"}}}` | Its `url` key means SSE, not HTTP — a common trap. |
| **Grok Build** | `~/.grok/config.toml` | TOML `[mcp_servers.<name>]` | `--transport http` | `grok mcp add --transport http wme-docs https://enterprise.wikimedia.com/mcp` | Current docs: `/build/features/mcp-servers` (old path 404). |
| **ChatGPT** | UI only | — | Remote HTTPS | Plugins → + → Add custom MCP server → paste URL → Create as a plugin | Server exposes `search`/`fetch` because ChatGPT requires the pair. |
| **Cline** | `~/.cline/data/settings/cline_mcp_settings.json` | `mcpServers` | **`"type":"streamableHttp"`** | Explicit `type` required | Omission falls back to legacy `sse`. |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` | unverified | UI flow preferred | Customize → MCPs → Install for this computer → paste URL | Exact JSON schema not confirmed from live docs — use the UI. |

Key integration risks: the POST-only endpoint (clients that probe with GET fail), transport-key differences (`httpUrl`, `streamableHttp`, `type:"http"`), and VS Code's documented config migration. Sources: each host's official MCP documentation, `https://enterprise.wikimedia.com/docs/agents/` and `https://registry.modelcontextprotocol.io/`, all fetched live on 21 Nov 2026. Two stale URLs found and excluded: `docs.x.ai/developers/grok-build/mcp` and `help.openai.com/en/articles/11381631-connectors`.

### 7.1 Verified host compatibility against the Phase 1 server (21 November 2026)

The server targets **MCP 2026-07-28 only** (contract 09 §2.5); classic `initialize`/2024–2025 hosts are unsupported by design. Real host→server HTTP attempts were made with isolated configs; no global config was modified.

| Host | Test type | Result | Evidence / caveat |
|------|-----------|--------|-------------------|
| **Grok Build** | REAL | **PASS** | `grok mcp doctor` → handshake `protocol 2026-07-28`, 9 tools discovered, healthy. Docs: `docs.x.ai/build/features/mcp-servers`. |
| **OpenCode** | REAL | **PASS with required `protocol` key** | Default config uses legacy `initialize` and is rejected. With `"protocol":"2026-07-28"`, serve log: `mcp connected server=wikimedia tools=9`. `opencode mcp list` is unreliable (reported no servers while connected) — use `opencode serve --print-logs --log-level info` and grep for `mcp connected`. |
| **Cursor (`cursor-agent`)** | REAL | **FAIL — host limitation** | Config per live docs, but the CLI selects legacy SSE for a plain `url` and probes with GET → server correctly returns 405. `type:"http"` did not help; `type:"streamable-http"` is unrecognised. Keep the POST-only posture; document as incompatible until the host detects Streamable HTTP. |
| **Codex CLI** | REAL (connection attempt via server logs) | **FAIL — host limitation** | Config parsed correctly as `streamable_http`, but the client opens with classic `2025-06-18` `initialize`, rejected with `-32022`. No option to request 2026-07-28. `codex mcp list` is config-only. |
| **Cline** | Config REAL; connection NOT TESTED | **NOT TESTED** | CLI registers `transport:{type:"streamableHttp",url}` correctly, but the isolated profile has no account; auth failed before any MCP connection. Live docs show a flat `type` field — both forms should be documented. |
| **Gemini CLI, Claude Code, Windsurf** | — | NOT TESTED | CLIs absent from the environment; matrix entries above remain doc-only. |

**Verified working snippets (against the built Phase 1 server):**

```jsonc
// OpenCode — opencode.json (the protocol key is MANDATORY)
{"mcp":{"servers":{"wikimedia":{
  "type":"remote",
  "url":"http://127.0.0.1:39118/mcp",
  "protocol":"2026-07-28"
}}}}
```
```toml
# Grok — ~/.grok/config.toml
[mcp_servers.wikimedia]
url = "http://127.0.0.1:39118/mcp"
enabled = true
```
```bash
grok mcp add --transport http wikimedia http://127.0.0.1:39118/mcp
grok mcp doctor wikimedia --json
```

A raw modern request also succeeds: POST with `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: tools/list`, and a `_meta` envelope containing `io.modelcontextprotocol/protocolVersion` + `io.modelcontextprotocol/clientCapabilities` → HTTP 200 with the tool catalogue.

**Known limitations to document in downstream READMEs:** (a) classic-`initialize` hosts are unsupported; (b) GET→405 is deliberate and breaks legacy SSE probing; (c) a classic `initialize` that names a modern version produces a misleading `-32022` message ("Unsupported protocol version: 2026-07-28" while listing it as supported) — actionable guidance should be added upstream; (d) Cline CLI writes a nested `transport` object while docs show a flat `type`.

---

## 8. Sources

- Performance and rate limits: live probes against `en.wikipedia.org/w/api.php`, `en.wikipedia.org/api/rest_v1`, `wikimedia.org/api/rest_v1/metrics`, `www.wikidata.org/w/rest.php`, `query.wikidata.org/sparql`; `https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits`.
- Demand: PyPI Stats API, npm downloads API, GitHub REST API, `https://registry.modelcontextprotocol.io/`, trackers `majorlabs.co/data`, `mcphq.ai/state-of-mcp`, `protocolprobe.com/mcp/servers/top/downloads`.
- Enterprise: `https://enterprise.wikimedia.com/pricing.md`, `/docs/snapshot/`, `/docs/on-demand/`, `/docs/realtime/`, `https://meta.wikimedia.org/wiki/Wikimedia_Enterprise#Access`.
- WDQS: `https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/API`, `/WDQS_backend_update`, `/WDQS_backend_update/Early_access`, `https://phabricator.wikimedia.org/T443756`, `https://wikitech.wikimedia.org/wiki/Wikidata_Query_Service/WDQS_Architecture_re-design`.
- Attribution: `https://www.mediawiki.org/wiki/Attribution_API`, `https://www.mediawiki.org/wiki/Wikimedia_Attribution_Framework`, `https://wikimedia-attribution.toolforge.org/technical-implementation.html`, plus live endpoint probes.
- Hosts: official MCP documentation for Claude, Cursor, VS Code, OpenAI Codex, Gemini CLI, Grok Build, Cline, Windsurf and ChatGPT.

---

*End of validation and economics report.*
