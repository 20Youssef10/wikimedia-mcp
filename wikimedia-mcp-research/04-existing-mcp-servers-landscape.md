# Existing MCP Servers for Wikipedia / Wikimedia — Landscape Analysis

**Document version:** 2026-11-21 (Revised)  
**Language:** en-GB  
**Status:** Verified and cleaned

> **Revision note (2026-11-21):** Removed non-existent repository, marked outdated projects, and added verification status. The official Wikimedia Enterprise MCP is documentation-only.
>
> **Verification (2026-11-21):** Every repository was checked against the live GitHub REST API and its README; the official MCP was checked against the Enterprise agents documentation. See the package `README.md` for methodology and the **[Verified] / [Design] / [Watch]** notation.

---

## 1. Summary of Current Landscape

As of late 2026 there are multiple community and commercial MCP servers focused on Wikipedia or broader MediaWiki content. Most concentrate on a subset of the public APIs (primarily Wikimedia REST summaries and Action API search/content). Coverage of Wikidata, Enterprise data APIs, EventStreams, Analytics, and Lift Wing remains limited or non-existent in a single unified server.

The official Wikimedia Enterprise MCP endpoint exists but serves **only documentation and OpenAPI** — it does not expose the data products.

This creates a clear opportunity for a more comprehensive “full-ecosystem” MCP server.

---

## 2. Verified Existing Projects

All rows were verified against the GitHub REST API and repository READMEs on 21 November 2026 [Verified].

| Project | Status | Notes |
|---------|--------|-------|
| [Rudra-ravi/wikipedia-mcp](https://github.com/Rudra-ravi/wikipedia-mcp) | Maintained (last code push May 2026) | Search, full article, summary, key facts (`extract_key_facts`), multi-language/country mapping, stdio and HTTP/streamable-HTTP transports, optional auth. Last code push 2026-05-01; repository metadata updated 2026-11-15. |
| [cyanheads/wikipedia-mcp-server](https://github.com/cyanheads/wikipedia-mcp-server) | Active (pushed 2026-11-13) | TypeScript; tools include search (QIDs), summary (QID), full article, sections, nearby/geo search, languages and references. Dual REST + Action API. |
| [cyanheads/wikidata-mcp-server](https://github.com/cyanheads/wikidata-mcp-server) | Active (pushed 2026-11-16) | TypeScript; `search_entities`, `get_entity`, `get_statements`, `get_sitelinks`, `sparql_query`, `resolve_external_id`, `get_labels`. Strong Wikidata focus. |
| [ProfessionalWiki/MediaWiki-MCP-Server](https://github.com/ProfessionalWiki/MediaWiki-MCP-Server) | Active (pushed 2026-11-19) | Broad MediaWiki support (any wiki), multi-wiki management, write operations (create/update/delete/move/protect, uploads), OAuth (browser, proxy, manual token, bot password), extension packs. Recommended successor for older MediaWiki servers. |
| [shiquda/mediawiki-mcp-server](https://github.com/shiquda/mediawiki-mcp-server) | Stale — self-declared outdated (not GitHub-archived) | README first line: "Outdated. Please use https://github.com/ProfessionalWiki/MediaWiki-MCP-Server instead!" Last code push 2025-07-13. GitHub flags `archived: false`, `disabled: false`. |
| punkpeye/wikimedia | Not found (404) | GitHub API returns 404; removed from recommendations. |
| [Wikimedia Enterprise official MCP](https://enterprise.wikimedia.com/mcp) | Active (docs only) | `search` / `fetch` / `list_endpoints` / `get_endpoint` over guides and the OpenAPI definition. No data API access, no credentials required; POST-only. Registry name `com.wikimedia.enterprise/docs`. |

**Adoption and maintenance signals (GitHub API, 21 November 2026) [Verified]:**

| Project | Stars | Forks | Last code push | Archived |
|---------|-------|-------|----------------|----------|
| Rudra-ravi/wikipedia-mcp | 310 | 62 | 2026-05-01 | No |
| cyanheads/wikipedia-mcp-server | 6 | — | 2026-11-13 | No |
| cyanheads/wikidata-mcp-server | 3 | 2 | 2026-11-16 | No |
| ProfessionalWiki/MediaWiki-MCP-Server | 148 | 44 | 2026-11-19 | No |
| shiquda/mediawiki-mcp-server | 27 | — | 2025-07-13 | No |

The two `cyanheads` projects are genuine and recently maintained but have very low adoption (6★ and 3★); treat their feature lists as promising rather than battle-tested.

Additional lighter or specialised servers (including offline/Kiwix variants) exist but are out of scope for a full online ecosystem server.

---

## 3. Common Limitations Observed

- Heavy bias toward English Wikipedia or a single language (some projects do support multiple languages).
- Limited or no support for:
  - Wikimedia Enterprise **data** APIs (Snapshot / Structured Contents / Realtime)
  - EventStreams live changes (as a proper streaming consumer)
  - Analytics / pageviews
  - Lift Wing ML models
  - Full Wikidata SPARQL power combined with Wikipedia tools
  - Multi-project routing (Commons, Wiktionary, Wikivoyage, etc.) under a unified interface
  - Explicit licence and attribution handling in tool outputs
- Tool surfaces are often either too granular or too monolithic.
- Inconsistent handling of User-Agent, rate limiting, and error messages optimised for LLM recovery.
- Few servers expose clear server-level instructions that teach the model how to combine tools effectively.

---

## 4. Gaps Relevant to a Full-Ecosystem Server

A new server that aims to “gather the entire system” should deliberately fill these gaps:

1. Unified routing layer that chooses the optimal backend per request.
2. First-class support for multiple projects and languages with sensible defaults.
3. Optional Enterprise authentication and Structured Contents (data APIs, not the docs MCP).
4. Bounded EventStreams / recent-changes tools (prefer internal consumer + query interface).
5. Analytics and popularity signals.
6. Explicit Commons / media handling with licence information.
7. Thoughtful tool grouping and strong server instructions.
8. Robust rate-limit and User-Agent enforcement.
9. Attribution and licence metadata returned with content.

---

## 5. Useful References

- Individual repository READMEs, linked directly in the §2 table (GitHub REST API records captured 21 November 2026)
- Official Enterprise MCP: https://enterprise.wikimedia.com/docs/agents/
- MCP Registry entries where available

---

*End of revised landscape analysis.*
