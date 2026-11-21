# Wikimedia APIs Ecosystem — Comprehensive Overview

**Document version:** 2026-11-21 (Revised)  
**Language:** en-GB  
**Purpose:** Foundational research report for designing a unified MCP server covering the full Wikimedia API surface.

> **Revision note (2026-11-21):** Updated rate-limit guidance, licensing notes, and catalogue completeness. Aligned with current 2026 policies.
>
> **Verification (2026-11-21):** Factual claims were checked against live primary sources; see the package `README.md` for methodology. Claims are marked **[Verified]** where confirmed, **[Design]** where they are recommendations, and **[Watch]** where a known change is imminent.

---

## 1. Introduction

The Wikimedia Foundation operates a large family of free knowledge projects (Wikipedia, Wikidata, Wikimedia Commons, Wiktionary, Wikisource, Wikivoyage, Wikibooks, Wikiquote, Wikiversity, Wikifunctions, and others). These projects expose multiple public and commercial APIs that differ in design philosophy, performance characteristics, authentication requirements, and intended use cases.

A complete MCP server aiming to “gather the entire system” must understand and selectively expose this heterogeneous landscape rather than treating it as a single monolithic API.

---

## 2. High-Level Catalogue of APIs

| API Name | Primary Purpose | Auth | High-volume suitability | Notes |
|----------|-----------------|------|--------------------------|-------|
| **MediaWiki Action API** (`/w/api.php`) | Full wiki operations (read + write) | Optional OAuth / bot passwords | Moderate (rate-limited) | Most powerful and mature; JSON only (php format removed 2026) |
| **MediaWiki REST API** (`/w/rest.php`) | Modern RESTful page CRUD & transforms | Optional | Good | Introduced in MediaWiki 1.35+ |
| **Wikimedia REST API** (`/api/rest_v1/`) | High-performance, cache-friendly content | Public | Excellent | Mobile-friendly summaries, HTML, feeds |
| **Wikimedia Enterprise** | Commercial-scale bulk & real-time | JWT required | Excellent (SLA available) | Snapshot, On-demand, Realtime; free tier has quotas |
| **Analytics / Pageviews API** | Metrics | Public | Good | Hosted under wikimedia.org |
| **EventStreams** | Live recent changes firehose | Public | High | Server-Sent Events |
| **Lift Wing** | Machine-learning model predictions | Public / limited | Moderate | Access varies by model |
| **Wikidata Query Service** | SPARQL endpoint | Public | Moderate (query complexity limits) | Knowledge graph queries |
| **Wikibase REST API** | Structured data on Wikidata | Optional | Good | Items, properties, statements |
| **Attribution API** | Licence / attribution helpers | Public (beta) | — | Useful for compliance |
| **Wikifunctions API** | Function definitions & execution | Public | — | Evaluate for inclusion |

**Evidence note on the catalogue [Verified]:** API existence and base paths were checked against the official sources in §6. The *High-volume suitability* column is **[Design]** guidance based on architecture and was subsequently checked against live latency measurements in `06-validation-and-economics.md` §2; those measurements support the ordering but are single-vantage-point data, not controlled benchmarks. The **"Attribution API" is a real beta REST API** — `GET {wiki}/w/rest.php/attribution/v0-beta/pages/{title}/signals` — live on 21 November 2026 (see `https://www.mediawiki.org/wiki/Attribution_API` and report 06 §6). An earlier revision of this report incorrectly described it as an unconfirmed working label; that claim was withdrawn after deeper verification. The Toolforge site (`https://wikimedia-attribution.toolforge.org/`) is the framework/documentation, not the API.

---

## 3. Design Philosophies

### 3.1 Action API
- Action-oriented, parameter-heavy, highly flexible.
- Supports generators, continuation, many modules in a single request.
- Best for complex queries, editing, and administrative tasks.
- Responses can be large and are less cache-friendly than REST endpoints.

### 3.2 REST-family APIs
- Resource-oriented, clean URLs, better caching behaviour.
- Wikimedia REST API (`rest_v1`) is optimised for high request volume and low latency via global CDN/caching.
- MediaWiki Core REST is more general-purpose and available on any recent MediaWiki installation.

### 3.3 Wikimedia Enterprise
- Designed for bulk consumption, commercial reuse, and high freshness requirements.
- Unified JSON schema across Snapshot, On-demand and Realtime products.
- Includes structured contents (parsed sections, infoboxes) and credibility signals.
- Free tier: 50 000 On-demand requests, 30 snapshots + 1 500 chunks per month; Realtime is paid.
- Official MCP endpoint exists but is **documentation-only** [Verified]. It is listed in the official MCP registry as `com.wikimedia.enterprise/docs`, requires no credentials, accepts POST only (GET returns 405), and exposes `search`, `fetch`, `list_endpoints` and `get_endpoint` over guides and the OpenAPI definition — see `https://enterprise.wikimedia.com/docs/agents/`.

---

## 4. Key Operational Constraints (All Public APIs)

- **User-Agent policy**: A meaningful, contactable User-Agent is required.
- **Rate limits (2026)** [Verified]: Global, identity-aware limits apply across the Action API and REST APIs and are enforced per user. Published tiers (requests/minute): unidentified clients **10**; unauthenticated browser requests, compliant-User-Agent bots, third-party MediaWiki wikis and authenticated newcomers **200**; established editors **2,000**; stewards, bot-flagged accounts, Wikimedia Cloud Services and known clients **exempt** (still subject to operational limits). Keep concurrency **≤ 3**. A 429 response carries `Retry-After`; if absent, wait at least 5 seconds or use exponential backoff. **Lift Wing is explicitly excluded** from these limits and documents its own limits on Wikitech. Source: `https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits` (last edited 8 Nov 2026).
- **Etiquette**: Prefer GET for reads, use generators and multi-title requests where possible, avoid tight polling loops.
- **Licensing**: Most textual content is CC BY-SA 4.0 (or similar). Wikimedia Commons files carry individual licences that must be checked. Attribution requirements should be surfaced in tool outputs.

---

## 5. Implications for an MCP Server

A comprehensive MCP server should:

1. Present a **task-oriented tool surface** rather than a 1:1 mapping of every endpoint.
2. Internally route requests to the most appropriate backend.
3. Enforce User-Agent, rate limiting, and polite concurrency by default.
4. Support optional authentication for Enterprise data APIs and write operations.
5. Return source, revision and licence/attribution metadata with content.
6. Implement MCP 2026-07-28 (`server/discover`, per-request `_meta`, etc.).
7. Provide clear, model-friendly descriptions and schemas.

---

## 6. Primary Official Sources

- https://www.mediawiki.org/wiki/Wikimedia_APIs
- https://www.mediawiki.org/wiki/API:Main_page
- https://www.mediawiki.org/wiki/Wikimedia_REST_API
- https://enterprise.wikimedia.com/docs/
- https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
- https://developer.wikimedia.org/
- https://wikitech.wikimedia.org/
- https://www.mediawiki.org/wiki/API:Data_formats
- https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use
- https://enterprise.wikimedia.com/docs/agents/

---

*End of revised overview report.*
