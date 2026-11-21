# 12 — Group D Feasibility Spike (EventStreams / live recent changes)

**Status:** SPIKE COMPLETE — research only, no implementation.
**Observation date:** 2026-11-21 (all live probes and registry/package queries below).
**Decision served:** Should the bounded recent-changes tool be built now, and should a permanent EventStreams consumer be built at all?

---

## 1. Question and decision criteria

**One-sentence question:** Is a bounded `get_recent_changes` tool worth adding now, and does that justify a permanent internal EventStreams (SSE) consumer with a rolling window, as report 05 §2 proposed?

| Criterion | Threshold that would justify BUILD |
|---|---|
| Demand | ≥1 active, discoverable MCP server with a recent-changes tool **or** ≥1 concrete user issue/request; not merely "the API exists" |
| Technical feasibility | Endpoint reachable, schema stable, bounded-consumption pattern demonstrable, reconnect handled |
| Cost / ops | No new always-on service, no new credential, no per-tenant connection fan-out, no paid tier |
| Fit with MCP 2026-07-28 | Bounded query tool, not a long-lived raw SSE stream (`subscriptions/listen` is deliberately `-32601` — report 03 §3.4 / AC-13) |

**What changes the answer:** any of (a) registry/GitHub/npm demand above threshold, (b) a consumer that actually needs sub-minute push rather than poll, (c) Action API polling becoming rate-limited enough that a stream is cheaper.

**Literal answer on the registry:** the exact queries **"recent changes", "recentchange", "eventstreams" and "wikimedia stream" still return ZERO results** in the official MCP registry. This is confirmed below, and it is partly a search-index artifact — see §2.

---

## 2. Demand re-check (live, 2026-11-21)

### 2.1 Official MCP registry API

All queries hit `https://registry.modelcontextprotocol.io/v0/servers?search=…&limit=100` (HTTP 200, JSON key `servers`).

| Query | Exact URL | Count | Verdict |
|---|---|---:|---|
| recent changes | `https://registry.modelcontextprotocol.io/v0/servers?search=recent%20changes&limit=100` | **0** | ZERO |
| recentchange | `https://registry.modelcontextprotocol.io/v0/servers?search=recentchange&limit=100` | **0** | ZERO |
| eventstreams | `https://registry.modelcontextprotocol.io/v0/servers?search=eventstreams&limit=100` | **0** | ZERO |
| wikimedia stream | `https://registry.modelcontextprotocol.io/v0/servers?search=wikimedia%20stream&limit=100` | **0** | ZERO |
| watchlist | `https://registry.modelcontextprotocol.io/v0/servers?search=watchlist&limit=100` | 9 | All non-Wikimedia: 7× `com.reelrifter/watchlist` ("viewing stats"), 2× `io.github.fairquery/sanctions-watchlist-screener` (OFAC/EU/UN screening) |
| wikipedia | `https://registry.modelcontextprotocol.io/v0/servers?search=wikipedia&limit=100` | 49 raw / **13 unique names** | 1 relevant hit |

**Indexing caveat (important, corrects report 06):** the registry `search` parameter matches the **description**, not the server name. `search=recent changes` returns 0 even though an active entry is named `…/wikipedia-recent-changes-mcp`, because its description says "Live Wikipedia **edit feed**". Report 06's "zero results" is therefore true for the literal queries but overstates the absence.

**The one relevant entry (full registry record):**
- Name: `io.github.guptaprakhariitr/wikipedia-recent-changes-mcp`, title "Wikipedia Recent Changes", version 0.1.1
- Description: "Live Wikipedia edit feed, page summaries, trending pages, and Wikidata search."
- Repository: `https://github.com/guptaprakhariitr/wikipedia-recent-changes-mcp`
- Remote: `https://wikipedia-recent-changes-mcp.atlasword.workers.dev/mcp` (streamable-http)
- Status `active`; published/updated `2026-06-11T08:34:29.905811Z` — i.e. **it already existed when report 06 was written**.
- GitHub health (live API): created 2026-06-10, last push 2026-06-11, **0 stars, 0 forks, 0 watchers, 0 open issues**, single author.

**Its implementation choice is decisive.** `src/wikipedia.ts` opens with:
```
// EventStreams: https://stream.wikimedia.org/v2/stream/recentchange (SSE — not used here; we poll instead)
```
`wiki_recent_changes(limit, topic, exclude_bots, namespace)` is implemented as Action API `list=recentchanges` polling behind a 60-second KV cache. Even the only dedicated "live recent changes" MCP server rejected EventStreams.

### 2.2 A second, more substantial precedent (not in the registry search results)

Found via live web search (Tavily): `ProfessionalWiki/MediaWiki-MCP-Server`
(`https://github.com/ProfessionalWiki/mediawiki-mcp-server`) exposes:
> `get-recent-changes` — List recent change events across the wiki, filterable by timestamp, namespace, user, tag, type, and hide flags (up to 50 per call, paginated via `continue`).

This is exactly report 05 §2's "bounded tool" shape, in an established general-purpose MediaWiki MCP server.

### 2.3 npm / PyPI

| Query / package | URL | Result |
|---|---|---|
| npm search `recent changes mcp` | `https://registry.npmjs.org/-/v1/search?text=recent%20changes%20mcp&size=20` | No dedicated recent-changes package; surfaced `@insnapsprakhar/wikipedia-recent-changes-mcp` |
| npm search `wikipedia recent` | `https://registry.npmjs.org/-/v1/search?text=wikipedia%20recent&size=20` | Same launcher + general `wikipedia`, `wikipedia-mcp`, `@cyanheads/wikipedia-mcp-server` |
| Dedicated package downloads | `https://api.npmjs.org/downloads/point/last-month/%40insnapsprakhar%2Fwikipedia-recent-changes-mcp` | **19** (2026-10-22 → 2026-11-20) |
| `wikipedia-mcp` downloads | `https://api.npmjs.org/downloads/point/last-month/wikipedia-mcp` | 68,555 |
| `@professional-wiki/mediawiki-mcp-server` | `.../last-month/%40professional-wiki%2Fmediawiki-mcp-server` | 9,485 |
| `@cyanheads/wikipedia-mcp-server` | `.../last-month/%40cyanheads%2Fwikipedia-mcp-server` | 3,123 |
| PyPI search `wikimedia mcp` | `https://pypi.org/search/?q=wikimedia+mcp` | **UNVERIFIED** — returns a JS "Client Challenge" anti-bot page. No claim made. |

**Read:** general Wikipedia/MediaWiki MCP demand is healthy (68.6k / 9.5k / 3.1k monthly downloads), but the one *dedicated* recent-changes product has 19 downloads/month and zero community engagement. Demand is for recent changes as a **feature of a general server**, not as a standalone streaming product.

### 2.4 GitHub issues / blog survey

| Query | URL | Count | Relevant |
|---|---|---:|---|
| `wikimedia mcp recent changes in:title,body type:issue` | `https://api.github.com/search/issues?q=wikimedia%20mcp%20recent%20changes%20in%3Atitle%2Cbody%20type%3Aissue` | 13 | **0** — all noise (road-trip lists, kitchen ops, agent digests) |
| `eventstreams mcp in:title,body type:issue` | `https://api.github.com/search/issues?q=eventstreams%20mcp%20in%3Atitle%2Cbody%20type%3Aissue` | 13 | **0** — all noise (Fabric data skills, SSE connection caps, unrelated digests) |
| `repo:modelcontextprotocol/servers wikimedia in:title,body type:issue` | `https://api.github.com/search/issues?q=repo%3Amodelcontextprotocol%2Fservers%20wikimedia` | 0 | 0 |

Tavily search (`MCP server Wikimedia recent changes EventStreams live edit feed 2026`, 2026-11-21) returned only Wikimedia's 2017/2018 EventStreams posts, generic Kafka/Hazelcast tutorials, and the ProfessionalWiki repo above. **No 2026 blog post, survey, or feature request advocating an EventStreams-backed MCP tool.** Note also that today is the same date as report 06, so a genuine "one-week" delta window has not elapsed — this spike is a deeper re-check, not a later observation.

**Demand verdict:** not zero (two real implementations, one mainstream), but weak for streaming and moderate for the bounded tool. No evidence at all for a *permanent SSE consumer*.

---

## 3. Technical feasibility

### 3.1 Live SSE probe (bounded: connect, read, disconnect)

`curl -sN -H 'Accept: text/event-stream' https://stream.wikimedia.org/v2/stream/recentchange` under `timeout 5`:
- **166 `event: message` frames in 5 s ≈ 33 events/s** global firehose (all wikis, all namespaces, bots included).
- Headers: `HTTP/2 200`, `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache`, `access-control-allow-origin: *`, `server: production-tls`, `date: Sat, 21 Nov 2026 17:19:05 GMT`.
- First frame is the `:ok` heartbeat; then `event: message` / `id: …` / `data: …` triples separated by blank lines.
- Connection closed politely by client `timeout`/pipe close; no error surfaced.

### 3.2 Event schema (observed, real event)

`$schema: /mediawiki/recentchange/1.0.0`
- `meta`: `uri`, `request_id`, `id`, `domain`, `stream` (`mediawiki.recentchange`), `dt` (ISO-8601), `topic` (e.g. `codfw.mediawiki.recentchange`), `partition`, `offset`
- payload: `id` (rcid), `type` (`edit` | `new` | `log` | `categorize`), `namespace`, `title`, `title_url`, `comment`, `parsedcomment`, `timestamp` (epoch seconds), `user`, `bot` (boolean), `minor`, `patrolled`, `length{new,old}`, `revision{new,old}`, `notify_url`, `server_url`, `server_name`, `server_script_path`, `wiki` (e.g. `commonswiki`, `mgwiktionary`).
- Observed across `commons.wikimedia.org`, `mg.wiktionary.org`, `pt.wikipedia.org`, `da.wikisource.org` in a single 5-second read — confirming a global, mixed-language, mixed-wiki feed.
- **Canary events** must be discarded (`meta.domain === 'canary'`); WMF injects them hourly.

### 3.3 Reconnect, `Last-Event-ID`, backpressure, filtering

From the official Wikitech doc (`https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams_HTTP_Service`, last edited 2026-08-20) plus bounded live probes:
- `id` is a JSON array of Kafka `{topic, partition, offset|timestamp}` objects for **all** topic-partitions in the stream. In multi-DC active/active mode **timestamps** (not offsets) are used.
- Replay: send the last `id` back as the `Last-Event-ID` request header. **Verified live** — a bounded probe with `Last-Event-ID: [{"topic":"codfw.mediawiki.recentchange","partition":0,"timestamp":1795270000000}]` resumed at `timestamp:1795270000198`.
- `?since=<ISO-8601>` is a simpler replay form. **Verified live** — `?since=2026-11-21T17:00:00Z` began at `≈1795280403799`. History window only **7–31 days**; docs explicitly ask clients to consume the minimum needed.
- `Accept: application/json` yields **NDJSON** instead of SSE. **Verified live** — lines of raw `/mediawiki/recentchange/1.0.0` JSON.
- **Server enforces a ~15-minute connection timeout**; a consumer must auto-reconnect via `Last-Event-ID` or lose continuity.
- **No server-side filtering** (no `$wgServerName` etc.). All wiki/namespace/bot/type filtering is client-side. The 33 events/s firehose must be filtered locally.
- **Backpressure:** an unbounded `await response.text()` on the SSE stream never resolves (two such probes in this spike timed out). A Node consumer must read `Response.body` (WHATWG `ReadableStream`) with an explicit byte/frame budget and `AbortController`, or use the `eventsource` / `wikimedia-streams` npm packages the official docs recommend. No SSE reconnection state machine ships in Node 22 core `fetch`.

### 3.4 Rolling-window storage sketch (if ever built)

Single **global** consumer (not per tenant) → validate schema → drop canaries → dedupe on `id` (rcid) → bounded ring buffer (e.g. 500–2,000 entries, 5–10 min TTL, FIFO eviction) indexed by `wiki`, `namespace`, `type`, `bot`. Read tools query this window with hard `limit` and time bounds. Freshness/age must be surfaced; a stale window must return an explicit error, not empty results. This is a stateful service — see §5.

### 3.5 MCP shape constraint

MCP 2026-07-28 **removed SSE resumability (`Last-Event-ID`, SSE event IDs)** from the protocol; the legacy HTTP+SSE transport is deprecated, and change notifications use a long-lived POST to `subscriptions/listen`. This build deliberately advertises no list-changed capability and returns `-32601` for `subscriptions/listen` (report 03 §3.4, AC-13). Therefore exposing EventStreams as a raw MCP stream is architecturally mismatched; only a **bounded query tool** over an internal window fits — which is precisely what reports 05 §2 / 09 / 11 already concluded.

---

## 4. Alternatives

| Option | Verdict |
|---|---|
| **Wikimedia Enterprise Realtime** | **Excluded.** Paid, pricing unpublished, no subscription (report 06 §4, report 09 §6). Not revisited. |
| **Action API `list=recentchanges`** | **Recommended fallback.** Verified live at `https://en.wikipedia.org/w/api.php?action=query&list=recentchanges&format=json&rcprop=title%7Cids%7Cuser%7Ctimestamp%7Ccomment%7Csizes%7Cflags&rclimit=3&rctoponly=true&rcnamespace=0` → HTTP 200, records with `rcid`, `revid`, `old_revid`, `oldlen`, `newlen`, `user`, `timestamp`, `comment`, plus `continue.rccontinue` cursor for bounded pagination. Supports `rcshow=!bot`, `rcnamespace`, `rclimit`. **This is what both existing recent-changes MCP servers use.** Zero new infrastructure. |
| **MediaWiki Core REST** | **Not available.** `https://en.wikipedia.org/w/rest.php/v1/recent-change` → `404 {"errorKey":"rest-no-match"}` (verified). No REST equivalent found. |
| **RESTBase feeds** | `https://en.wikipedia.org/api/rest_v1/feed/featured/2026/11/20` → 200, but only featured/most-read/news feeds — no recent-changes feed. Not a substitute. |

---

## 5. Risks (why the permanent consumer is the expensive part)

- **Politeness / load:** WMF states the public EventStreams service is "intended for use by small-scale external tool developers" and asks clients to consume the minimum data. A permanent always-on connection plus `since=` backfills on every restart is exactly the pattern they caution against. Action API polling at low QPS is more clearly within etiquette.
- **Unbounded memory:** 33 events/s ≈ 2.8M events/day; without a hard cap, a ring buffer grows without limit. Requires eviction, byte caps and rate metering (threat model T-14).
- **Multi-tenant isolation:** one shared window is fine for read-only data, but any per-tenant filtering/subscription reintroduces N connections or cross-tenant leakage (T-15). The MCP build has no subscription surface, so this would be new attack area.
- **Permanent consumer hosting:** a long-lived process with reconnect state, Kafka-offset replay handling, canary filtering and freshness monitoring is a new service to deploy, alert and own — unlike a stateless tool call in the existing stateless server.
- **Ops burden:** 15-minute forced reconnects, 7–31 day replay horizon, schema drift on `$schema`, and staleness semantics all need monitoring and runbooks.
- **Data trust:** recent-change content is fully attacker-influenceable (T-14); every field must be treated as untrusted and schema-validated before entering the window.

---

## 6. Recommendation

**BUILD — but only the bounded, stateless `get_recent_changes` tool backed by Action API polling. DROP the permanent EventStreams consumer / rolling-window service.**

**One-line rationale:** Registry exact-string queries are still ZERO and nobody requests sub-minute push, but two real MCP servers already ship a bounded recent-changes tool (one with 9.5k monthly downloads) using cheap Action API polling — the feature has precedent and near-zero incremental cost, while the SSE consumer adds a stateful always-on service that no evidence justifies.

Scope notes:
- Land as a small, separately scoped change; do **not** retrofit the frozen Phase 3 contract (report 11). Reuse the existing Action API client; bounded `limit`, time window, wiki/namespace/bot filters, `rccontinue` cursor, explicit freshness/error states. No EventStreams setting, credential, consumer process or rolling window (consistent with report 09 §"deliberately absent" and report 11 §33).
- Keep the registry watch running.

**Reversal triggers:**
1. **→ SPIKE-MORE on EventStreams** if a concrete user/issue requires true push (sub-minute notification, not poll), or ≥2 active registry entries advertise EventStreams/live-change tools, or a top-10 Wikimedia MCP repo adds a live SSE tool.
2. **→ DROP the bounded tool too** if, within 4 weeks of shipping, the dedicated recent-changes package remains <50 downloads/month *and* no registry entry, GitHub issue or downstream user asks for the feature.
3. **→ Revisit cost/ToS** if Wikimedia tightens Action API rate limits for our polling volume or publishes an affordable Enterprise Realtime tier.
4. **→ Re-open architecture** if MCP adds a first-class resumable streaming primitive that makes a bounded live stream stateless to host.

---

## 7. Sources (all observed 2026-11-21)

| # | Source / exact URL | Observation |
|---|---|---|
| 1 | `https://stream.wikimedia.org/v2/stream/recentchange` | Live SSE probe: 200, 166 frames/5 s, schema, Kafka-style `id`, multi-wiki events; bounded connect/disconnect |
| 2 | `https://stream.wikimedia.org/v2/stream/recentchange` with `Last-Event-ID` header | Replay from supplied timestamp confirmed |
| 3 | `https://stream.wikimedia.org/v2/stream/recentchange?since=2026-11-21T17:00:00Z` | Historical `since=` replay confirmed |
| 4 | `https://stream.wikimedia.org/v2/stream/recentchange` with `Accept: application/json` | NDJSON mode confirmed |
| 5 | `https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams_HTTP_Service` (oldid 2450267, edited 2026-08-20) | No server-side filtering; canaries; `Last-Event-ID`/`since`; 7–31 day history; 15-min timeout; "small scale external tool developers"; Node `eventsource`/`wikimedia-streams` guidance |
| 6 | `https://registry.modelcontextprotocol.io/v0/servers?search=recent%20changes&limit=100` | **0** |
| 7 | `https://registry.modelcontextprotocol.io/v0/servers?search=recentchange&limit=100` | **0** |
| 8 | `https://registry.modelcontextprotocol.io/v0/servers?search=eventstreams&limit=100` | **0** |
| 9 | `https://registry.modelcontextprotocol.io/v0/servers?search=wikimedia%20stream&limit=100` | **0** |
| 10 | `https://registry.modelcontextprotocol.io/v0/servers?search=watchlist&limit=100` | 9, all non-Wikimedia |
| 11 | `https://registry.modelcontextprotocol.io/v0/servers?search=wikipedia&limit=100` | 49 raw / 13 unique; 1 active live-edit-feed entry |
| 12 | `https://github.com/guptaprakhariitr/wikipedia-recent-changes-mcp` and `.../src/wikipedia.ts`, `.../src/tools.ts` | 0 stars/forks/issues; "SSE — not used here; we poll instead"; Action API + 60 s KV cache |
| 13 | `https://github.com/ProfessionalWiki/mediawiki-mcp-server` | `get-recent-changes` tool, bounded/paginated (found via Tavily) |
| 14 | `https://api.npmjs.org/downloads/point/last-month/<package>` | 19 / 68,555 / 9,485 / 3,123 downloads |
| 15 | `https://api.github.com/search/issues?q=…` (3 queries in §2.4) | 13 / 13 / 0 totals; 0 relevant |
| 16 | `https://en.wikipedia.org/w/api.php?action=query&list=recentchanges&format=json&…` | 200, records + `rccontinue` cursor |
| 17 | `https://en.wikipedia.org/w/rest.php/v1/recent-change` | 404 `rest-no-match` |
| 18 | `https://pypi.org/search/?q=wikimedia+mcp` | JS client challenge — unverified, no claim |
| 19 | Tavily `MCP server Wikimedia recent changes EventStreams live edit feed 2026` | Only 2017/2018 EventStreams posts, generic data-engineering tutorials, ProfessionalWiki repo; no new 2026 demand survey |

**Internal context consulted:** reports 01 §6, 02 §6, 03 §3.4, 04, 05 §2/§6, 06 §3.3–3.4, 07, 08 §3.5/T-14/T-15, 09 §6, 10, 11 §31/§868.
