# Key Wikimedia APIs — Detailed Reference

**Document version:** 2026-11-21 (Revised)  
**Language:** en-GB  
**Status:** Corrected for quotas, format deprecation, rate-limit policy and Enterprise MCP purpose

> **Revision note (2026-11-21):** Updated free-account quotas, removed deprecated `format=php`, clarified rate-limit guidance, and corrected the nature of the official Enterprise MCP endpoint.
>
> **Verification (2026-11-21):** Factual claims were checked against live primary sources; see the package `README.md` for methodology and the **[Verified] / [Design] / [Watch]** notation used below.

---

## 1. MediaWiki Action API

**Endpoint pattern:** `https://{project}/w/api.php`

**Core characteristics:**
- Action-based (`action=query`, `action=edit`, `action=parse`, etc.).
- Extremely flexible; supports property modules, list modules, generators, and continuation.
- Can perform both read and write operations.
- **Preferred and only fully supported response format: JSON** (`format=json`) [Verified]. `API:Data_formats` states JSON is the standard and default format and that all other formats are discouraged.
- `format=php` was removed in Wikimedia production on **1 May 2026** [Verified]. The removal was announced on `mediawiki-api` on 31 March 2026 ("We will drop the format… around May 1, 2026"), recorded in the Wikimedia APIs Changelog ("sunset on May 1st, 2026") and committed as `3691e7c` (`Api: Drop php format`, 2026-05-01T08:53Z). It landed in the **MediaWiki 1.47** branch, still pre-release at verification (stable 1.46.3), but production deployment is live: `format=php` now returns `badvalue`.
- XML (`xml`, `xmlfm`) is **deprecated but still accepted** [Verified] — `API:Data_formats` labels it "XML format. (deprecated)". Do not treat it as removed.

**Common useful modules for an MCP server:**
- `action=query` with `prop=extracts|info|revisions|categories|links|images|pageimages|description`
- `list=search`, `list=categorymembers`, `list=geosearch`
- `meta=siteinfo`, `meta=tokens`
- Generators for efficient multi-page operations

**Strengths:** Power and completeness.  
**Weaknesses:** Verbose responses, poorer caching characteristics, steeper learning curve for LLMs.

**Official docs:** https://www.mediawiki.org/wiki/API:Main_page

---

## 2. Wikimedia REST API (`/api/rest_v1/`)

**Base path example:** `https://en.wikipedia.org/api/rest_v1/`

**Primary purpose:** High-volume, low-latency, cacheable access optimised for mobile and application use.

**Key endpoint groups:**
- `/page/summary/{title}` — title, description, extract, thumbnail, coordinates, content_urls, Wikidata QID
- `/page/html/{title}` — Parsoid HTML
- `/page/media-list/{title}`
- `/page/related/{title}`
- `/page/random/summary`
- `/feed/featured/{yyyy}/{mm}/{dd}`
- `/feed/onthisday/events/{mm}/{dd}`
- Metrics endpoints under `https://wikimedia.org/api/rest_v1/metrics/...`

**Strengths:** Excellent performance and caching; clean, predictable JSON.  
**Weaknesses:** More limited write capabilities; not every Action API feature is available.

**Official docs:** https://www.mediawiki.org/wiki/Wikimedia_REST_API

---

## 3. MediaWiki Core REST API (`/w/rest.php`)

Available on MediaWiki 1.35+ installations. Provides a more standard RESTful interface for page operations, search, history, and transforms. On Wikimedia projects it coexists with the older Wikimedia REST API.

---

## 4. Wikimedia Enterprise APIs

**Base URLs:**
- Authentication: `https://auth.enterprise.wikimedia.com`
- Data: `https://api.enterprise.wikimedia.com`
- Realtime: `https://realtime.enterprise.wikimedia.com`

**Three main products (same underlying article model):**

### 4.1 Snapshot API
- Full project dumps as compressed NDJSON (or tar.gz containing NDJSON).
- **Free tier:** up to 30 snapshot downloads + 1,500 chunk downloads per month; monthly refresh.
- Paid: more frequent (weekly/daily) and higher volume.

### 4.2 On-demand API
- Lookup current revision of specific articles by title.
- Supports filters, field selection, and Structured Contents (parsed sections, infoboxes — still Beta).
- **Free tier:** 50,000 requests per month.

### 4.3 Realtime API
- Streaming (SSE / NDJSON) of article and Wikidata updates + hourly batch files.
- **Currently available only on paid plans.**

**Authentication** [Verified]: JWT Bearer tokens. Access **and ID** tokens last 24 hours; refresh tokens last 90 days (or 90 refreshes, whichever comes first). Source: `https://enterprise.wikimedia.com/docs/authentication/`.

**Official Enterprise MCP endpoint** (`https://enterprise.wikimedia.com/mcp`):
- Purpose: **documentation search and OpenAPI retrieval only**.
- Tools: search, fetch, list_endpoints, get_endpoint.
- No credentials required; does **not** call the data APIs.
- Transport: Streamable HTTP, MCP 2026-07-28 (with fallback for older clients).

**Official docs:** https://enterprise.wikimedia.com/docs/

---

## 5. Analytics / Pageviews

Hosted primarily under `https://wikimedia.org/api/rest_v1/metrics/`.

Key capabilities:
- Aggregated pageviews
- Unique devices
- Editor statistics
- Most-read articles
- Media requests

---

## 6. EventStreams

**Endpoint:** `https://stream.wikimedia.org/v2/stream/recentchange` (and other streams)

Server-Sent Events (SSE) feed of recent changes. Highly suitable for monitoring, but should be consumed by an internal service rather than exposed as a long-lived MCP tool call in most cases. Prefer tools that query a bounded window of recent changes.

---

## 7. Wikidata-specific Surfaces

- **Wikibase REST API:** `https://www.wikidata.org/w/rest.php/wikibase/v1`
- **SPARQL endpoint:** `https://query.wikidata.org/sparql` — v1 is live and open to all clients at verification. The Blazegraph→QLever migration provides `https://query-next.wikidata.org/sparql` (and a scholarly variant), but v2 returned HTTP 403 `Unauthorized User-Agent` for unregistered clients. **Do not hardcode:** use the `WIKIDATA_SPARQL_ENDPOINT` / `_V2` / `_FALLBACKS` / `_PREFER_V2` configuration contract and fallback rules in `06-validation-and-economics.md` §5. The general-availability trigger remains a **[Watch]** item there.
- Enterprise also exposes Wikidata items/properties via On-demand and Snapshot (Beta endpoints exist).

---

## 8. Other Notable Services

- **Lift Wing** — ML predictions (revert risk, article topic, etc.). Access and rate limits vary by model; some models are internal-only.
- **Link Recommendation API**
- **Page Description API**
- **Wikifeeds**
- **Attribution API** (beta, public, Wikimedia-only) — `GET {wiki}/w/rest.php/attribution/v0-beta/pages/{title}/signals`, returning an `essential` block with `link` (preserve `wprov`), `license{title,short,url}`, `source_wiki`, `title`, `default_brand_marks[]` and (for `File:` pages) `credit`. Source: `https://www.mediawiki.org/wiki/Attribution_API`. An earlier revision incorrectly called this an unconfirmed working label; report 06 §6 has the full resolution, including fallbacks and known beta gaps.
- **Wikifunctions API** (should be evaluated for inclusion)

---

## 9. Rate-Limit Guidance (2026) [Verified]

- Global, identity-aware rate limits apply across the Action API and REST API, enforced per user. Published tiers (requests/minute): unidentified **10**; unauthenticated browser, compliant-User-Agent bots, third-party wikis and authenticated newcomers **200**; established editors **2,000**; stewards, bot-flagged accounts, WMCS and known clients **exempt** (still subject to operational limits).
- Concurrency: keep concurrent requests **≤ 3**.
- Always send a meaningful, contactable User-Agent.
- On HTTP 429, honour `Retry-After`; if absent, wait ≥ 5 seconds or apply exponential backoff.
- **Lift Wing is excluded** from these limits; consult Wikitech for its external-usage limits. OAuth 1 and owner-only OAuth 2 tokens are treated as unauthenticated for rate-limiting unless the server-set cookies are returned; prefer OAuth 2 authorisation-code/refresh or client-credentials flows (source: `https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits`).
- Enterprise free accounts have a **hard rate limit of 10 requests per second** in addition to monthly quotas; exceeding it returns HTTP 429 (source: `https://enterprise.wikimedia.com/docs/index.md`). This is not a "soft" guideline.

**LLM-recovery error shapes:** a rate-limited public API call returns HTTP 429 (occasionally 503 for backend overload) with an optional `Retry-After` header; Enterprise returns 401 for missing/expired tokens and 429 for quota or rate breaches. Surface these as actionable tool errors (retryable vs. credential-refresh vs. quota-exhausted) rather than raw HTTP text.

---

## 10. Practical Routing Recommendations for an MCP Server

| User intent | Preferred backend |
|-------------|-------------------|
| Quick summary / lead section | Wikimedia REST `/page/summary` |
| Full clean HTML or sections | REST or Enterprise Structured Contents |
| Complex multi-page query / categories / search | Action API |
| Bulk download or training data | Enterprise Snapshot |
| Live monitoring | EventStreams (via internal consumer) |
| Structured knowledge graph | Wikidata SPARQL or Enterprise Wikidata endpoints |
| Popularity / metrics | Analytics API |
| Write / edit operations | Action API (with proper auth) |

---

*End of revised detailed APIs reference.*
