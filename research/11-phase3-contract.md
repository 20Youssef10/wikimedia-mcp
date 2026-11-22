# Phase 3 Implementation Contract — Unified Wikimedia MCP Server (Groups C + F — Metrics, Commons Media and Attribution)

**Document version:** 3.0.0 (frozen)  
**Date:** 2026-11-21  
**Language:** en-GB  
**Target protocol:** MCP 2026-07-28 (unchanged from Phases 1 and 2)  
**Status:** FROZEN — ready for implementation (read-only Phase 3)

> This contract closes Phase 3 of the roadmap in report 05 §7 / report 06 §3.4: **Group C (metrics) + Group F (Commons media and attribution)**. It extends, and does not replace, the frozen Phase 1 contract (`09-implementation-contract.md`, v1.0.1) and the frozen Phase 2 contract (`10-phase2-contract.md`, v2.0.0). Every protocol convention, error-envelope rule, transport rule, annotation convention, configuration key and acceptance criterion from Phase 1 (AC-01…AC-32) and Phase 2 (AC-33…AC-59) remains in force unchanged. Research basis: reports 01 §4, 02 §2/§5/§8/§9, 03, 05 §2/§7/§10, 06 §2/§5/§6, 08 §6 (SR-1…SR-12), 09, 10, `test-corpus.json` cases TC-C-001…TC-C-003 and TC-F-001…TC-F-003, plus live primary-source endpoint verification performed 2026-11-21 (recorded in §3.1 and §3.7).

---

## 1. Scope and boundary

### 1.1 In scope

Exactly five read-only tools, using the names already present in `test-corpus.json`:

| Group | Tool | Corpus case(s) |
|---|---|---|
| C — metrics | `get_pageviews` | TC-C-001, TC-C-003 |
| C — metrics | `get_most_read` | TC-C-002 |
| C — metrics | `get_unique_devices` | no existing case — new TC-C-007 required |
| F — media | `get_file_metadata` | TC-F-001, TC-F-003 |
| F — media | `get_image_info` | TC-F-002 |

Also in scope: the Group C provenance block (§3.3), the Group F per-file licence/attribution block (§3.4), the metrics date/range guard pipeline (§4.4), the attribution resolution pipeline with beta fallbacks (§3.7), the media licence resolution rules (§5.4), a separate Group C/F load profile (§6), and binary acceptance criteria **AC-60 onward** (§7).

### 1.2 Out of scope (decided)

- **Enterprise data APIs (Group E).** Unchanged from report 09 §6 and report 10 §1.2: no paid subscription exists. No Enterprise tool, token, credential or quota appears in Phase 3. TC-E-* remain unimplemented fixtures.
- **All write tools (Group G).** `edit_page`, `upload_file`, statement edits and every other mutating operation remain disabled. No write-capable code path is registered; threat-model gates report 08 §6.2 (G1…G12) are untouched.
- **Group D (live recent changes / EventStreams).** Still a one-week spike plus registry watch, not a build phase (report 06 §3.4).
- **Lift Wing, Wikifunctions, compare-revisions, categories, geosearch.** Group G backlog; no Phase 3 tool.
- **New MCP resources or prompts.** Decision and rationale in §5.5; `prompts/list` and `resources/list` continue to return empty arrays.
- **New configuration keys.** Zero are introduced (§1.4).
- **Per-article unique devices.** The Analytics API does not offer it; `get_unique_devices` is project-scope only (§4.3).

### 1.3 Relationship to earlier phases — reuse, do not duplicate

| Earlier artifact | Phase 3 treatment |
|---|---|
| `ATTRIBUTION_API_VERSION`, `ATTRIBUTION_FALLBACKS`, `ATTRIBUTION_DISCLAIMER` (report 09 §2.6) | **Reused as-is.** Complete the day-1 stub `src/upstream/attribution.ts`; no replacement key, no `ATTRIBUTION_VERSION` alias, no second disclaimer setting. |
| `USER_AGENT`, `CONCURRENCY_LIMIT`, `HTTP_TIMEOUT_MS`, `RETRY_MAX_ATTEMPTS`, `RETRY_BACKOFF_BASE_MS`, `RETRY_BACKOFF_MAX_MS`, `RETRY_AFTER_FALLBACK_MS`, `MAX_RESULT_BYTES`, `METADATA_CACHE_TTL_MS` | Reused for Groups C and F with the derived, code-constant pacing rules in §6 — implemented as nested semaphores/token buckets, not as new env keys. |
| Phase 1 project/language resolver (report 09 §3.1) | **Reused in reverse**: Phase-1-style codes and aliases (`enwiki`, `wikipedia:en`, `en.wikipedia`, `commonswiki`) are normalised to the dotted Analytics project code (`en.wikipedia`, `commons.wikimedia`) by the shared resolver (§3.2). For Group F the resolver supplies the wiki host. |
| `tools/registry.ts`, Zod schemas, `z.toJSONSchema()`, annotations, protocol layer, error mapper, caching module | Five tools are **added** to the existing registry; no new registry, transport or protocol implementation. |
| Phase 1 `get_media` (report 09 §3.2) | **Not changed.** It keeps its Action-API `images` + `imageinfo` path and per-file `extmetadata` licences. Phase 3 adds dedicated file-level tools and the Attribution API pipeline; it does not rewrite `get_media`. |
| `AC-01…AC-32`, `AC-33…AC-59`, Phase 1 M3/M4 and Phase 2 B-M3/B-M4 | Unchanged; re-run as regression gates (AC-63, AC-92). Group C/F counters are separate (§6.1). |

### 1.4 Configuration keys — reuse only; zero new keys

The complete Phase 3 configuration surface is the existing key set. **No key is added, renamed or removed.**

| Key | Phase 3 use | Validation |
|---|---|---|
| `ATTRIBUTION_API_VERSION` | Version segment in the Attribution API URL. Default `v0-beta`. `v1` is an accepted value used for the promotion path, but is *not* assumed to work: the live `.../attribution/v1/...` path returned `404 rest-no-match` on 2026-11-21, which triggers the fallback chain (§3.7). | Pattern `^v[0-9]+(?:-[a-z0-9]+)?$`; empty or malformed terminates boot. |
| `ATTRIBUTION_FALLBACKS` | Ordered fallback source names after a primary Attribution API miss. Default `rest-bare,action-rightsinfo,action-imageinfo`. Allowed tokens are exactly those three; unknown token terminates boot. For **media** tools the effective chain is filtered to `action-imageinfo` then `rest-bare`, with `action-rightsinfo` skipped by rule §5.4 (it is a wiki-wide text licence, never a per-file licence). | Non-empty ordered list of allowed tokens. |
| `ATTRIBUTION_DISCLAIMER` | Injected verbatim into `attribution.disclaimer` on every Group F result. | Non-empty string; default is the vendor string from report 09 §2.6. |
| `USER_AGENT`, `CONCURRENCY_LIMIT`, `HTTP_TIMEOUT_MS`, `RETRY_*`, `RETRY_AFTER_FALLBACK_MS`, `MAX_RESULT_BYTES`, `METADATA_CACHE_TTL_MS` | Shared outbound identity, global semaphore, generic timeout, bounded retry/backoff, result truncation and cache TTL, exactly as in Phases 1–2. | Unchanged from report 09 §2.6. |

**Justification for zero new keys.** All three knobs the media pipeline needs already exist (version, fallback order, disclaimer). Metrics need a fixed host, a fixed project-code map, date caps and pacing; Phase 2 established the precedent that such values are version-controlled **code constants** reviewed under SR-1/SR-12 (compare the external-ID property map and SPARQL complexity caps in report 10 §4.3/§6.1), not env keys. Pacing constants are derived from `CONCURRENCY_LIMIT` (§6.2). Adding a key would create a second source of truth for an already-frozen setting. If a future Analytics API tier change requires tunable pacing, that is a **new major contract version**, not a silent Phase 3 addition.

### 1.5 Change control

Any rename, removal or semantic change to a tool name, required parameter, output field name (`results`, `devices`, `articles[].title`, `license`, `author`, `attribution`), error code, date cap, project-code alias set, Attribution `essential.*` mapping or fallback order requires a **new major contract version**, an updated `test-corpus.json` and renumbered/extended AC. Additive optional output fields or a revised tool description may be a minor version with a logged change. Flipping `ATTRIBUTION_API_VERSION` from `v0-beta` to `v1` or editing `ATTRIBUTION_FALLBACKS` is a deployment/configuration change recorded in the change log — **not** a version bump, because those keys are part of the frozen Phase 1 surface.

---

## 2. Decisions closed

| # | Decision | Choice | Basis |
|---|---|---|---|
| D1 | Tool list | Exactly the five names in §1.1; no `get_edit_count`, no separate `get_licence`, no `commons_search` | report 05 §2 Groups C/F; corpus names are frozen |
| D2 | Metrics backend | Analytics API only, fixed host `https://wikimedia.org/api/rest_v1/metrics` | report 02 §5/§10; report 06 §2.2 |
| D3 | Metrics project format | Analytics dotted code (`en.wikipedia`), obtained by reusing the Phase 1 resolver in reverse | corpus TC-C-001/002/003; report 09 §3.1 |
| D4 | Metrics determinism | Explicit dates only; no `"today"`; end ≤ yesterday UTC; fixed historical dates in fixtures and nightly runs | report 09 §4.1; report 06 §2.2 |
| D5 | Unique devices meaning | Project-scope estimate of distinct cookie-identified devices; no per-article metric; `daily`/`monthly` only | live API verification §4.3; report 05 §2 "where relevant" |
| D6 | Metrics empty data | Success with `results: []` / `articles: []`; never a `*_not_found` error | report 09 §3.2 convention; TC-C-003 |
| D7 | Media primary backend | Attribution API `v0-beta` `signals`, returning the `essential` block | report 06 §6.2/§6.4; live verification §3.7 |
| D8 | Media fallback | On beta `404 rest-no-match` / `v1` 404 / 5xx / timeout / parse failure → `ATTRIBUTION_FALLBACKS`; for media the effective per-file chain is `action-imageinfo` then `rest-bare`, with `action-rightsinfo` excluded | report 06 §6.4; §5.4 |
| D9 | HTML in `extmetadata` | Strip tags, decode entities, collapse whitespace; result is untrusted data, never an instruction | report 06 §6.3; SR-2 |
| D10 | Per-file licence | Never falls back to site-wide CC BY-SA; if no per-file signal exists, emit `url: null` (or a static canonical map hit) and a warning, or return `attribution_unavailable` | report 09 §3.3 post-review fix; report 01 §4 |
| D11 | One tool or two | **Two tools** (`get_file_metadata`, `get_image_info`) sharing one internal resolve pipeline | §5.3 |
| D12 | Remote media | Beta API has no remote-media support; skip the beta call when `imagerepository != "local"` and build from Action API only, with a warning | report 06 §6.2 known beta gaps |
| D13 | Media licences on results | 100% of media results carry `license` + `attribution` + `source`; a missing block fails the run | report 05 §10; SR-11; TC-F-001/002 |
| D14 | Load profile | Separate Class M/T/I and `CF-M3`/`CF-M4` counters; **Phase 3 tools do not feed Phase 1 M3/M4 or Phase 2 B-M3/B-M4** | report 06 §2.3; report 10 §9.1 |
| D15 | Resources/prompts | None in Phase 3 | report 10 §8 precedent |

---

## 3. Shared conventions (Phase 3)

### 3.1 Backends and concrete URL patterns

All outbound requests use the configured non-empty `USER_AGENT` on every call, GET only, with an `AbortSignal` threaded from the SDK tool context (report 09 AC-20). All hosts are fixed constants from an allowlist; no caller-supplied host is ever interpolated (SR-3).

| Backend | Base | Used by |
|---|---|---|
| Analytics API (AQS) | `https://wikimedia.org/api/rest_v1/metrics` | `get_pageviews`, `get_most_read`, `get_unique_devices` |
| Attribution API (beta) | `{host}/w/rest.php/attribution/{ATTRIBUTION_API_VERSION}/pages/{encodedTitle}/signals` | Group F primary |
| Action API `imageinfo` | `{host}/w/api.php` | Group F per-file `extmetadata` fallback and technical metadata |
| MediaWiki REST `/bare` | `{host}/w/rest.php/v1/page/{encodedTitle}/bare` | Last-resort text licence fallback (skipped for per-file licences) |
| Action API `rightsinfo` | `{host}/w/api.php?action=query&meta=siteinfo&siprop=rightsinfo` | Wiki-wide text licence only; **never** used by Group F |

Verified concrete patterns (live probes, 2026-11-21):

| Operation | Pattern |
|---|---|
| Pageviews (per article) | `GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{project}/{access}/{agent}/{article}/{granularity}/{start}/{end}` |
| Pageviews (top / most read) | `GET https://wikimedia.org/api/rest_v1/metrics/pageviews/top/{project}/{access}/{year}/{month}/{day}` |
| Unique devices | `GET https://wikimedia.org/api/rest_v1/metrics/unique-devices/{project}/{access-site}/{granularity}/{start}/{end}` |
| Attribution signals | `GET https://en.wikipedia.org/w/rest.php/attribution/v0-beta/pages/Earth/signals` |
| Attribution signals (Commons file) | `GET https://commons.wikimedia.org/w/rest.php/attribution/v0-beta/pages/File%3AThe_Earth_seen_from_Apollo_17.jpg/signals` |
| Action imageinfo | `GET https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles={encodedTitle}&iiprop=url%7Csize%7Cmime%7Cextmetadata%7Cuser%7Ctimestamp&iiurlwidth={thumb_width}` |

Observed upstream shapes (these pin the parsers):

- Per-article pageviews: `{"items":[{"project":"en.wikipedia","article":"Earth","granularity":"daily","timestamp":"2026110100","access":"all-access","agent":"user","views":7108}]}` — the `timestamp` for `daily` is `YYYYMMDD00` (10 characters) and must be normalised to `YYYYMMDD` in output.
- Top pageviews: `{"items":[{"project":"en.wikipedia","access":"all-access","year":"2026","month":"11","day":"18","articles":[{"article":"Main_Page","views":3817218,"rank":1}]}]}` — `article` uses underscores; output field is `title` with spaces.
- Unique devices: `{"items":[{"project":"en.wikipedia","access-site":"all-sites","granularity":"monthly","timestamp":"20230101","devices":851183354,"offset":361411016,"underestimate":489772338}]}`.
- Attribution essential: see §3.7.
- Action `extmetadata`: values are HTML strings, e.g. `Artist: "<div class=\"fn value\">NASA/Apollo 17 crew; taken by either <a ...>Harrison Schmitt</a>...</div>"`, `LicenseShortName: "Public domain"`, `License: "pd"`, `AttributionRequired: "false"`, `Copyrighted: "False"`, `Restrictions: ""`. `LicenseUrl` is **absent** for public-domain markers; the parser must not assume it exists.

Notes:

- The unique-devices `access-site` parameter accepts exactly `all-sites`, `desktop-site`, `mobile-site` (`desktop`, `mobile-web` and `all-access` return HTTP 400). The pageviews `access` parameter accepts `all-access`, `desktop`, `mobile-app`, `mobile-web`.
- The Attribution API returns a **same-origin 301** when a `File:` title contains an unencoded colon. Encode `:` as `%3A` and spaces as `%20` before interpolation (never `+`). Follow same-origin redirects only; a cross-origin redirect is `upstream_unavailable` (SR-3).
- Titles in all three families are validated for control characters, backslashes and `..` path segments before encoding, then percent-encoded with `encodeURIComponent` (plus the underscore/colon normalisation above).

### 3.2 Project resolution and filename resolution

**Metrics project resolution (reuse of the Phase 1 resolver in reverse).** `project` accepts the dotted Analytics form `{lang}.{family}` (e.g. `en.wikipedia`, `de.wikipedia`, `en.wiktionary`, `commons.wikimedia`) **and** the Phase 1 aliases: `wiki`/`wp`, `{lang}wiki` (`enwiki`), `wikipedia:en`, `en.wikipedia`, `commonswiki`, `commons`, `wikidatawiki`, `meta`, `species`. The resolver applies the Phase 1 variant-host map (`zh-hans`→`zh`, `pt-br`→`pt`; `be-tarask` and `zh-min-nan` keep their real hosts). Canonical output:

- `enwiki` / `wikipedia:en` / `en.wikipedia` → `en.wikipedia`
- `commonswiki` / `commons` → `commons.wikimedia`
- `dewiki` → `de.wikipedia`

An unresolvable or host-shaped value (e.g. `http://…`, `169.254.169.254`) is rejected locally as `invalid_project` with **zero outbound requests** (SR-3; report 09 AC-30 pattern). The Analytics host itself is never caller-controlled.

**Media filename resolution.** `filename` must begin with `File:` (case-insensitive prefix accepted, canonicalised to `File:`). The project resolver supplies the wiki host; `commonswiki` is the default because the corpus media cases are Commons files. The `File:` prefix is retained in the API title. A non-`File:` title is `validation_error` with a hint to prefix it.

### 3.3 Group C provenance block

The numeric aggregates are **data, not creative content**. Phase 3 freezes their licence as **CC0 1.0**, with `attribution.required: false`; source attribution is still emitted on 100% of results. Rationale: numbers are facts, CC0 is the least-restrictive and most conservative classification for reuse, and it matches Phase 2's treatment of Wikidata structured data. The disclaimer makes clear that linked article titles and content retain their own licences. Canonical example:

```json
{
  "source": "wikimedia:analytics",
  "endpoint": "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Earth/daily/20261101/20261120",
  "revision": null,
  "timestamp": null,
  "license": {
    "title": "Creative Commons CC0 1.0 Universal Public Domain Dedication",
    "short": "CC0 1.0",
    "url": "https://creativecommons.org/publicdomain/zero/1.0/"
  },
  "attribution": {
    "required": false,
    "text": "Wikimedia Analytics API — aggregate statistics, CC0 1.0",
    "link": "https://wikitech.wikimedia.org/wiki/Analytics/AQS",
    "disclaimer": "Aggregate statistics are CC0 1.0; linked article titles and content retain their own licences (typically CC BY-SA 4.0)."
  },
  "resultType": "complete"
}
```

`revision` and `timestamp` are always `null` for metrics (there is no single revision); `endpoint` always names the exact URL used. Every Group C result also carries `_meta["io.modelcontextprotocol/serverInfo"]` from the shared layer and never carries `ttlMs`/`cacheScope` (AC-09). **No `tools/call` result in any phase carries cache fields.**

### 3.4 Group F provenance and per-file licence block

Every media result carries the complete block below. `license` is **always** present and is derived from the individual file, never from site-wide `rightsinfo`. `author` is always present (may be `null` with a warning when no source supplies it). `attribution.disclaimer` is injected verbatim from `ATTRIBUTION_DISCLAIMER`.

```json
{
  "source": "commonswiki",
  "revision": 43894484,
  "timestamp": "2020-09-25T20:35:46Z",
  "storage": "local",
  "attribution_source": "attribution-v0-beta",
  "license": {
    "title": "Public domain",
    "short": "Public domain",
    "url": "https://creativecommons.org/publicdomain/mark/1.0/",
    "source": "action-extmetadata"
  },
  "author": "NASA/Apollo 17 crew; taken by either Harrison Schmitt or Ron Evans",
  "attribution": {
    "required": false,
    "text": "File:The Earth seen from Apollo 17.jpg — NASA/Apollo 17 crew, Public domain",
    "link": "https://commons.wikimedia.org/w/index.php?title=File:The_Earth_seen_from_Apollo_17.jpg&wprov=afsw1",
    "disclaimer": "You remain responsible for licence compliance."
  },
  "resultType": "complete"
}
```

`attribution_source` is one of `attribution-v0-beta`, `action-extmetadata`, `rest-bare`. `revision` comes from Action `imageinfo`/`pageid` when available, otherwise `null`; it is never fabricated. `warnings` is a non-fatal string array used for fallbacks, HTML-strip events, skipped fallback sources and missing licence URLs.

### 3.5 Error envelope and Group C/F error codes

Identical envelope to Phases 1–2 (`isError: true`):

```json
{
  "error": {
    "code": "file_not_found",
    "message": "No file titled 'File:DefinitelyMissingFile_9f3a2b.png' exists on commonswiki. Check the filename and the 'File:' prefix.",
    "retryable": false,
    "retry_after_seconds": null,
    "hint": "Confirm the exact filename on Commons, then call get_file_metadata again.",
    "details": { "http_status": 404, "backend": "action-imageinfo" }
  }
}
```

Group C/F codes (superset of Phase 1 and 2; rules from report 09 §3.1 and report 10 §3.3 apply):

| Code | Retryable | When |
|---|---|---|
| `validation_error` | false | Strict-schema failure: wrong type, missing required, unknown field, malformed date/project/filename |
| `invalid_project` | false | Unresolvable or host-shaped `project`; zero outbound requests |
| `invalid_article` | false | Article/title fails the encoding guard (control chars, `\`, `..`) |
| `invalid_date_range` | false | Future/reversed date, wrong timestamp shape for granularity, non-Monday weekly, non-1st monthly, span above cap, `start` before 20150101, `end` after yesterday UTC |
| `file_not_found` | false | Both the Attribution API and Action `imageinfo` indicate the file is absent (TC-F-003) |
| `attribution_unavailable` | true on 5xx/timeout/429-exhaustion, otherwise false | All applicable attribution sources failed and no per-file licence can be established |
| `rate_limited` | true | 429 after bounded retries; `retry_after_seconds` populated |
| `upstream_unavailable` | true | Timeout, non-2xx not otherwise mapped, parse failure, cross-origin redirect, exhausted media source chain |
| `timeout` | true | Non-attribution/non-metrics upstream timeout |
| `internal_error` | true | Unhandled fault; no stack trace or raw upstream body in `message` |

Rules: `message` never contains a raw HTTP 401/429 body, token, credential or the literal `rest-no-match` body from the beta API; it always carries a non-empty `hint`/`action` the model can follow (AC-24/M6). Empty data sets are success, never `*_not_found`.

### 3.6 Annotations

All five tools: `{"readOnlyHint": true, "destructiveHint": false, "openWorldHint": true, "idempotentHint": true}`. Metrics are idempotent because all accepted dates are completed UTC periods and nothing is written; media tools are pure reads. No tool declares `x-mcp-header`; incoming `Mcp-Param-*` is rejected with `-32020` (report 09 AC-17).

### 3.7 Attribution resolution pipeline (normative)

Runs in this exact order. Primary and fallback results are cached; no partial licence is ever fabricated.

**Step 1 — primary Attribution API.** Call `{host}/w/rest.php/attribution/{ATTRIBUTION_API_VERSION}/pages/{encodedTitle}/signals`. On HTTP 200, read only the `essential` block and map these **exact field paths**:

| `essential.*` path | Output field |
|---|---|
| `essential.title` | `title` |
| `essential.link` | `attribution.link` (preserve `wprov=afsw1` verbatim — do not rewrite or strip the query) |
| `essential.source_wiki.site_name` | `wiki.site_name` |
| `essential.source_wiki.project_family` | `wiki.project_family` |
| `essential.source_wiki.site_id` | `wiki.site_id` (also used as `source`) |
| `essential.source_wiki.site_language` | `wiki.site_language` |
| `essential.source_wiki.page_language` | `wiki.page_language` |
| `essential.license.title` | `license.title` |
| `essential.license.short` | `license.short` |
| `essential.license.url` | `license.url` (may be `null` in beta — see Step 3) |
| `essential.default_brand_marks[]` (`name`, `url`, `type`) | `brand_marks[]` (`get_file_metadata` only, when `include_brand_marks: true`) |
| `essential.credit` | `credit` (present for Commons `File:` pages) |

Live confirmation (2026-11-21): `essential.license = {"title":"pd","short":"PDM","url":null}` for a Commons public-domain file, and `essential.credit` is present. `essential.link` is `https://commons.wikimedia.org/w/index.php?title=File:The_Earth_seen_from_Apollo_17.jpg&wprov=afsw1`.

**Step 2 — trigger fallback.** Fall back when: HTTP `404` with body key `errorKey: "rest-no-match"` (this includes the `v1` promotion case, verified live), HTTP 5xx, timeout, malformed/non-JSON body, or the `essential` block is absent. A `404` where `essential` is missing is a source miss, **not** immediately `file_not_found`: Step 4 decides.

**Step 3 — Action API `imageinfo` enrichment (mandatory even on primary success for media).** Call the imageinfo URL in §3.1 with `iiprop=url|size|mime|extmetadata|user|timestamp`. Map: `url`, `thumburl`→`thumb_url`, `mime`, `width`, `height`, `size`, `user`, `timestamp`, `descriptionurl`→`description_url`, `pageid`→`revision`, `imagerepository`→`storage`. From `extmetadata` map `Artist`→`author`, `Credit`→`credit` (only when `essential.credit` is absent), `LicenseShortName`→`license.short`, `License`/`UsageTerms`→`license.title`, `LicenseUrl`→`license.url`, `AttributionRequired`→`attribution.required`, `Restrictions`→`restrictions`. **Strip HTML from every `extmetadata` value** (remove tags, decode `&amp;`/`&lt;`/`&gt;`/`&quot;`/`&#…;`, collapse whitespace) and treat the result as untrusted data (SR-2).

**Step 4 — fallback decision and terminal errors.**

1. If primary succeeded **and** imageinfo succeeded, merge with per-file `extmetadata` taking precedence for `license.short`/`license.title`/`license.url` (beta licence-name normalisation is in progress; extmetadata is authoritative for individual files). Set `attribution_source: "action-extmetadata"` when extmetadata changed the licence, otherwise `"attribution-v0-beta"`.
2. If primary missed, walk the **media-filtered** `ATTRIBUTION_FALLBACKS`: `action-imageinfo` first, then `rest-bare`. `action-rightsinfo` is skipped for media by rule D8/§5.4; record `"skipped action-rightsinfo: site-wide licence is not a per-file licence"` in `warnings`. If imageinfo succeeds, continue as in (1) with `attribution_source: "action-extmetadata"`.
3. If the file is absent in **both** sources (Attribution 404/miss and Action `missing` flag), return `file_not_found` (TC-F-003). An Attribution 404 **with valid imageinfo** is a beta gap, not `file_not_found` (new TC-F-009).
4. If all applicable sources fail without establishing absence, return `attribution_unavailable` (never a site-wide licence).
5. On 429/503, **stay on the same source**, honour `Retry-After`, use the shared bounded jittered backoff, and only then advance. Exhaustion → `rate_limited` (429) or `upstream_unavailable` (503) with `retryable: true` and `retry_after_seconds`.

**Step 5 — licence URL safety.** If no source supplies `license.url`, consult the static, code-reviewed `LICENSE_URL_MAP` constant (canonical deed URLs for a small allowlist of short names, e.g. `Public domain` → `https://creativecommons.org/publicdomain/mark/1.0/`, `CC BY-SA 4.0` → `https://creativecommons.org/licenses/by-sa/4.0/`). If unmapped, emit `license.url: null` plus a warning. **Never** substitute the site-wide CC BY-SA 4.0 URL. This constant is code, not config (§1.4).

---

## 4. Group C tool contracts (normative)

Every INPUT schema below is strict (`additionalProperties: false`), with defaults and bounds, advertised verbatim in `tools/list` via `z.toJSONSchema()`. Every OUTPUT example is complete and valid JSON; the implementation must emit the full §3.3 provenance block on every result plus `_meta["io.modelcontextprotocol/serverInfo"]`.

### 4.1 `get_pageviews`

**Purpose.** Daily/hourly/weekly/monthly view counts for one article on one project over a bounded, completed date range.

**Backend.** `GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{project}/{access}/{agent}/{article}/{granularity}/{start}/{end}`.

**INPUT**

```json
{
  "type": "object",
  "properties": {
    "project": {
      "type": "string",
      "default": "en.wikipedia",
      "minLength": 2,
      "maxLength": 64,
      "description": "Analytics dotted project code or a Phase 1 project alias, e.g. 'en.wikipedia', 'enwiki', 'commonswiki'."
    },
    "article": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Page title; spaces or underscores accepted. Encoded and validated locally before use."
    },
    "start": {
      "type": "string",
      "pattern": "^[0-9]{8}([0-9]{2})?$",
      "description": "Inclusive start. YYYYMMDD for daily/weekly/monthly; YYYYMMDDHH for hourly."
    },
    "end": {
      "type": "string",
      "pattern": "^[0-9]{8}([0-9]{2})?$",
      "description": "Inclusive end, same shape as start. Must be <= yesterday UTC."
    },
    "granularity": {
      "type": "string",
      "default": "daily",
      "enum": ["hourly", "daily", "weekly", "monthly"],
      "description": "Aggregation period. Determines the required timestamp shape and range cap (section 4.4)."
    },
    "access": {
      "type": "string",
      "default": "all-access",
      "enum": ["all-access", "desktop", "mobile-app", "mobile-web"],
      "description": "Access method."
    },
    "agent": {
      "type": "string",
      "default": "user",
      "enum": ["user", "spider", "automated"],
      "description": "Traffic class. 'user' is the default human pageview class."
    }
  },
  "required": ["article", "start", "end"],
  "additionalProperties": false
}
```

**OUTPUT example** (fixed historical dates; TC-C-001 shape)

```json
{
  "project": "en.wikipedia",
  "article": "Earth",
  "granularity": "daily",
  "access": "all-access",
  "agent": "user",
  "start": "20261101",
  "end": "20261103",
  "results": [
    { "timestamp": "20261101", "views": 7108 },
    { "timestamp": "20261102", "views": 6948 },
    { "timestamp": "20261103", "views": 6856 }
  ],
  "count": 3,
  "source": "wikimedia:analytics",
  "endpoint": "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Earth/daily/20261101/20261103",
  "revision": null,
  "timestamp": null,
  "license": { "title": "Creative Commons CC0 1.0 Universal Public Domain Dedication", "short": "CC0 1.0", "url": "https://creativecommons.org/publicdomain/zero/1.0/" },
  "attribution": { "required": false, "text": "Wikimedia Analytics API — aggregate statistics, CC0 1.0", "link": "https://wikitech.wikimedia.org/wiki/Analytics/AQS", "disclaimer": "Aggregate statistics are CC0 1.0; linked article titles and content retain their own licences (typically CC BY-SA 4.0)." },
  "resultType": "complete"
}
```

**Errors.** `validation_error`, `invalid_project`, `invalid_article`, `invalid_date_range`, `rate_limited`, `upstream_unavailable`, `timeout`, `internal_error`.

**Annotations.** `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`.

**Empty data.** Upstream `items: []`, zero-view articles or a missing article yield `results: []`, `count: 0` and success — no exception, no `page_not_found` (TC-C-003).

### 4.2 `get_most_read`

**Purpose.** The most-read articles of one completed UTC day on one project, in rank order.

**Backend.** `GET https://wikimedia.org/api/rest_v1/metrics/pageviews/top/{project}/{access}/{year}/{month}/{day}`.

**INPUT**

```json
{
  "type": "object",
  "properties": {
    "project": {
      "type": "string",
      "default": "en.wikipedia",
      "minLength": 2,
      "maxLength": 64,
      "description": "Analytics dotted project code or a Phase 1 alias."
    },
    "date": {
      "type": "string",
      "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
      "description": "Completed UTC date, YYYY-MM-DD. 'today' and future dates are rejected (section 4.4)."
    },
    "access": {
      "type": "string",
      "default": "all-access",
      "enum": ["all-access", "desktop", "mobile-app", "mobile-web"],
      "description": "Access method."
    },
    "limit": {
      "type": "integer",
      "default": 10,
      "minimum": 1,
      "maximum": 100,
      "description": "Maximum articles returned; hard cap 100."
    }
  },
  "required": ["date"],
  "additionalProperties": false
}
```

**OUTPUT example** (TC-C-002 shape)

```json
{
  "project": "en.wikipedia",
  "date": "2026-11-20",
  "access": "all-access",
  "articles": [
    { "title": "Main Page", "views": 3817218, "rank": 1, "url": "https://en.wikipedia.org/wiki/Main_Page" },
    { "title": "Special:Search", "views": 777700, "rank": 2, "url": "https://en.wikipedia.org/wiki/Special:Search" }
  ],
  "count": 2,
  "source": "wikimedia:analytics",
  "endpoint": "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2026/11/20",
  "revision": null,
  "timestamp": null,
  "license": { "title": "Creative Commons CC0 1.0 Universal Public Domain Dedication", "short": "CC0 1.0", "url": "https://creativecommons.org/publicdomain/zero/1.0/" },
  "attribution": { "required": false, "text": "Wikimedia Analytics API — aggregate statistics, CC0 1.0", "link": "https://wikitech.wikimedia.org/wiki/Analytics/AQS", "disclaimer": "Aggregate statistics are CC0 1.0; linked article titles and content retain their own licences (typically CC BY-SA 4.0)." },
  "resultType": "complete"
}
```

`title` is the upstream `article` with underscores replaced by spaces; `rank` and `views` are preserved from upstream; `url` is built from the allowlisted resolver host, never from caller input. `count` is the number returned after `limit`. Empty `articles` is success with `count: 0`.

**Errors.** `validation_error`, `invalid_project`, `invalid_date_range`, `rate_limited`, `upstream_unavailable`, `timeout`, `internal_error`.

**Annotations.** `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`.

### 4.3 `get_unique_devices`

**Purpose.** Project-wide estimated unique-device counts for a bounded completed period. Used to gauge reach, not page popularity.

**Backend.** `GET https://wikimedia.org/api/rest_v1/metrics/unique-devices/{project}/{access-site}/{granularity}/{start}/{end}`.

**INPUT**

```json
{
  "type": "object",
  "properties": {
    "project": {
      "type": "string",
      "default": "en.wikipedia",
      "minLength": 2,
      "maxLength": 64,
      "description": "Analytics dotted project code or a Phase 1 alias."
    },
    "access_site": {
      "type": "string",
      "default": "all-sites",
      "enum": ["all-sites", "desktop-site", "mobile-site"],
      "description": "Mapped to the upstream 'access-site' parameter."
    },
    "granularity": {
      "type": "string",
      "default": "monthly",
      "enum": ["daily", "monthly"],
      "description": "Unique devices is available only at daily or monthly granularity."
    },
    "start": {
      "type": "string",
      "pattern": "^[0-9]{8}$",
      "description": "Inclusive start YYYYMMDD; must be the 1st when granularity is monthly."
    },
    "end": {
      "type": "string",
      "pattern": "^[0-9]{8}$",
      "description": "Inclusive end YYYYMMDD; must be the 1st when granularity is monthly and <= yesterday UTC."
    }
  },
  "required": ["start", "end"],
  "additionalProperties": false
}
```

**OUTPUT example** (fixed historical date; new TC-C-007)

```json
{
  "project": "en.wikipedia",
  "access_site": "all-sites",
  "granularity": "monthly",
  "start": "20230101",
  "end": "20230101",
  "results": [
    { "timestamp": "20230101", "devices": 851183354, "offset": 361411016, "underestimate": 489772338 }
  ],
  "count": 1,
  "meaning": "Estimated distinct devices (cookie-based) that accessed the whole project at least once in the period; a project-scope reach estimate, not a page view count and not an exact device census.",
  "source": "wikimedia:analytics",
  "endpoint": "https://wikimedia.org/api/rest_v1/metrics/unique-devices/en.wikipedia/all-sites/monthly/20230101/20230101",
  "revision": null,
  "timestamp": null,
  "license": { "title": "Creative Commons CC0 1.0 Universal Public Domain Dedication", "short": "CC0 1.0", "url": "https://creativecommons.org/publicdomain/zero/1.0/" },
  "attribution": { "required": false, "text": "Wikimedia Analytics API — aggregate statistics, CC0 1.0", "link": "https://wikitech.wikimedia.org/wiki/Analytics/AQS", "disclaimer": "Aggregate statistics are CC0 1.0; linked article titles and content retain their own licences (typically CC BY-SA 4.0)." },
  "resultType": "complete"
}
```

**Meaning and availability (decisive).** "Unique devices" is Wikimedia's cookie-based estimate of the number of distinct devices that made at least one request to a **project** in a day or month. It is *not* a per-article metric and *not* the number of people or pageviews: one device may generate many views. The upstream item reports `devices` (the estimate), `offset` (devices whose counts were extrapolated) and `underestimate` (additional estimated devices not counted); all three are emitted so callers can see the uncertainty. It exists only at project scope and only for `daily`/`monthly`; there is no `article` parameter in the strict schema (D5). The `meaning` string is emitted on every result so the model cannot mistake it for pageviews. Empty `results` is success.

**Errors.** `validation_error`, `invalid_project`, `invalid_date_range`, `rate_limited`, `upstream_unavailable`, `timeout`, `internal_error`.

**Annotations.** `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`.

### 4.4 Metrics date, granularity and range guards (normative)

All checks are **local, in this order, before any outbound request**. A failure returns `validation_error` (shape) or `invalid_date_range` (semantics) with zero outbound requests and an actionable hint.

| Constant | Value | Meaning |
|---|---|---|
| `MIN_DATE` | `20150101` | Earliest accepted pageview date. |
| `MAX_END` | yesterday UTC (inclusive) | Metrics for "today" are incomplete; `"today"` and future dates are rejected. |
| `MAX_SPAN` | hourly 24 h; daily 366 d; weekly 730 d; monthly 3650 d | Bounded result sets and polite upstream load. |
| `MIN_DATE` for most-read | `20160101` | Top-articles series starts later than per-article pageviews. |

1. **Shape.** `hourly` requires `YYYYMMDDHH` for both `start` and `end`; `daily`/`weekly`/`monthly` require `YYYYMMDD`. Unique devices requires `YYYYMMDD` and only `daily`/`monthly`. Any other shape → `validation_error` with `details.field`.
2. **Calendar validity.** Parse with a strict round-trip (reject e.g. `20260230`, `20261301`). Hour values `00`–`23`. Failure → `validation_error`.
3. **Alignment.** `weekly` dates must both be Mondays; `monthly` dates must both be day `01`. Failure → `invalid_date_range`.
4. **Order and bounds.** `MIN_DATE ≤ start ≤ end ≤ MAX_END`. Reversed range, future `end`, `start` before `MIN_DATE`, or `end` after yesterday → `invalid_date_range`.
5. **Span.** `(end − start)` inclusive ≤ `MAX_SPAN` for the granularity; `hourly` must stay within one UTC day. Breach → `invalid_date_range` with `details.limits` containing the cap and the observed span.
6. **Determinism.** Fixed historical dates only. Fixtures and the nightly metrics sample use: pageviews `20261101`–`20261120` (TC-C-001), most-read `2026-11-20` (TC-C-002), zero-view `20200101`–`20200102` (TC-C-003), unique devices monthly `20230101`–`20230101` (new TC-C-007). These are frozen; do not substitute the current date.
7. **Output normalisation.** Upstream daily `timestamp` values such as `2026110100` are truncated to `YYYYMMDD` in `results[].timestamp`; hourly values keep all 10 digits. Ordering is upstream order, never sorted or re-sampled.

---

## 5. Group F tool contracts (normative)

### 5.1 `get_file_metadata`

**Purpose.** One-call, licence-aware metadata for a Commons (or other wiki) file: detailed attribution, author, credit, brand marks, per-file licence and technical metadata.

**Backend.** Attribution API primary (§3.7 Step 1) + Action API `imageinfo` enrichment (Step 3), with the media-filtered fallback chain (Step 4).

**INPUT**

```json
{
  "type": "object",
  "properties": {
    "filename": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Full file title, e.g. 'File:The Earth seen from Apollo 17.jpg'."
    },
    "project": {
      "type": "string",
      "default": "commonswiki",
      "minLength": 2,
      "maxLength": 24,
      "description": "Wiki hosting the file; 'commonswiki' by default."
    },
    "thumb_width": {
      "type": "integer",
      "default": 320,
      "minimum": 40,
      "maximum": 1200,
      "description": "Thumbnail width in pixels."
    },
    "include_brand_marks": {
      "type": "boolean",
      "default": true,
      "description": "Include essential.default_brand_marks[] from the Attribution API."
    }
  },
  "required": ["filename"],
  "additionalProperties": false
}
```

**OUTPUT example** (TC-F-001 shape; complete provenance shown)

```json
{
  "filename": "File:The Earth seen from Apollo 17.jpg",
  "title": "File:The Earth seen from Apollo 17.jpg",
  "url": "https://upload.wikimedia.org/wikipedia/commons/9/97/The_Earth_seen_from_Apollo_17.jpg",
  "thumb_url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/330px-The_Earth_seen_from_Apollo_17.jpg",
  "mime": "image/jpeg",
  "width": 3000,
  "height": 3002,
  "size": 6511067,
  "description_url": "https://commons.wikimedia.org/wiki/File:The_Earth_seen_from_Apollo_17.jpg",
  "author": "NASA/Apollo 17 crew; taken by either Harrison Schmitt or Ron Evans",
  "credit": "NASA/Apollo 17 crew; taken by either Harrison Schmitt or Ron Evans",
  "brand_marks": [
    { "name": "Default logo", "url": "https://commons.wikimedia.org/static/images/project-logos/commonswiki.png", "type": "logo" }
  ],
  "wiki": { "site_name": "Wikimedia Commons", "project_family": "wikipedia", "site_id": "commonswiki", "site_language": "en", "page_language": "en" },
  "storage": "local",
  "attribution_source": "attribution-v0-beta",
  "restrictions": "",
  "warnings": [],
  "source": "commonswiki",
  "revision": 43894484,
  "timestamp": "2020-09-25T20:35:46Z",
  "license": { "title": "Public domain", "short": "Public domain", "url": "https://creativecommons.org/publicdomain/mark/1.0/", "source": "action-extmetadata" },
  "attribution": { "required": false, "text": "File:The Earth seen from Apollo 17.jpg — NASA/Apollo 17 crew, Public domain", "link": "https://commons.wikimedia.org/w/index.php?title=File:The_Earth_seen_from_Apollo_17.jpg&wprov=afsw1", "disclaimer": "You remain responsible for licence compliance." },
  "resultType": "complete"
}
```

**Errors.** `validation_error`, `file_not_found`, `attribution_unavailable`, `rate_limited`, `upstream_unavailable`, `timeout`, `internal_error`.

**Annotations.** `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`.

### 5.2 `get_image_info`

**Purpose.** Compact, machine-readable technical and licence view of one file: url, mime, dimensions, per-file licence short name and URL, attribution. Optimised for single-call resolution (TC-F-002).

**Backend.** Same shared resolve pipeline as `get_file_metadata`, with a compact projection (no `brand_marks`, no `wiki` block, no `credit` unless it is the only author signal).

**INPUT**

```json
{
  "type": "object",
  "properties": {
    "filename": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Full file title, e.g. 'File:NASA logo.svg'."
    },
    "project": {
      "type": "string",
      "default": "commonswiki",
      "minLength": 2,
      "maxLength": 24,
      "description": "Wiki hosting the file."
    },
    "thumb_width": {
      "type": "integer",
      "default": 320,
      "minimum": 40,
      "maximum": 1200,
      "description": "Thumbnail width in pixels."
    }
  },
  "required": ["filename"],
  "additionalProperties": false
}
```

**OUTPUT example** (TC-F-002 shape)

```json
{
  "filename": "File:NASA logo.svg",
  "url": "https://upload.wikimedia.org/wikipedia/commons/a/a3/NASA_logo.svg",
  "thumb_url": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/NASA_logo.svg/320px-NASA_logo.svg.png",
  "mime": "image/svg+xml",
  "width": 1000,
  "height": 1000,
  "size": 4321,
  "description_url": "https://commons.wikimedia.org/wiki/File:NASA_logo.svg",
  "author": "NASA",
  "storage": "local",
  "attribution_source": "action-extmetadata",
  "warnings": [],
  "source": "commonswiki",
  "revision": 12345678,
  "timestamp": "2020-01-01T00:00:00Z",
  "license": { "title": "NASA logo", "short": "NASA", "url": "https://www.nasa.gov/", "source": "action-extmetadata" },
  "attribution": { "required": true, "text": "File:NASA logo.svg — NASA, NASA logo", "link": "https://commons.wikimedia.org/w/index.php?title=File:NASA_logo.svg&wprov=afsw1", "disclaimer": "You remain responsible for licence compliance." },
  "resultType": "complete"
}
```

**Errors.** `validation_error`, `file_not_found`, `attribution_unavailable`, `rate_limited`, `upstream_unavailable`, `timeout`, `internal_error`.

**Annotations.** `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`.

### 5.3 One tool or two — decision and justification

**Decision: keep two tools, implemented over one shared pipeline.**

- The two names are **frozen in `test-corpus.json`** (TC-F-001/003 use `get_file_metadata`; TC-F-002 uses `get_image_info`). Collapsing them into one tool with a `detail` enum would be a breaking rename/removal requiring a new major contract version, a corpus rewrite and renumbered AC — explicitly forbidden by the change-control rules of Phases 1–3.
- The return contracts differ in purpose: `get_file_metadata` is the compliance-oriented view (`author`, `credit`, `brand_marks`, `wiki`, `restrictions`); `get_image_info` is the compact machine-readable view (`mime`, dimensions, licence short/url). Both carry a licence and attribution, but they answer different tasks and corpus asserts different required fields.
- Duplicated network logic is avoided by a **single internal resolver** (`src/upstream/attribution.ts` + `src/attribution/assemble.ts`, completed from their day-1 stubs). Both tools call `resolveFile(filename, project, thumb_width)` once and project the result; there is no second Attribution client, no second HTML stripper and no second licence map. `tools/list` therefore advertises two names backed by one code path (AC-87).
- This respects report 03 §5.1's "small number of task-oriented tools": two file-level tasks, not one endpoint per backend.

### 5.4 Media licence resolution rules (normative)

1. **Per-file only.** `license.short`, `license.title` and `license.url` come from `essential.license` and/or `extmetadata` fields of the individual file. Site-wide `rightsinfo` is never consulted by Group F (D8, AC-77).
2. **Precedence.** For media, per-file `extmetadata` wins over beta `essential.license` where they disagree, because beta licence-name normalisation is still in progress (report 06 §6.2). `license.source` records which source supplied the final values.
3. **No guessed licences.** Absent `LicenseUrl` → `LICENSE_URL_MAP` hit or `license.url: null` plus a warning (§3.7 Step 5). Never a site-wide CC BY-SA 4.0 default.
4. **HTML stripping.** Every `extmetadata` value is stripped, entity-decoded and whitespace-collapsed before output; stripped text is untrusted data, never an instruction (SR-2).
5. **Remote media.** If `imagerepository != "local"`, skip the beta Attribution call entirely (the beta API has no remote-media support) and build from Action API `imageinfo`/`extmetadata` only; set `storage: "remote"`, `attribution_source: "action-extmetadata"` and add warning `"remote media: beta attribution unavailable"` (D12).
6. **Attribution link.** Always use `essential.link` verbatim when present (it contains `wprov=afsw1`); otherwise build the canonical `Special:Redirect`/index.php link locally with `wprov=afsw1`. Never strip the query parameter.
7. **Disclaimers.** `attribution.disclaimer` is always `ATTRIBUTION_DISCLAIMER` verbatim; the caller remains responsible for compliance (report 06 §6.4).

### 5.5 Resources and prompts — decision

**No new MCP resources or prompts in Phase 3.** The five tools expose the full C/F surface; query examples and the `meaning` string live in tool descriptions and results (§4.3). Server `instructions` is extended with one reviewed sentence: "Use `get_pageviews`/`get_most_read`/`get_unique_devices` for completed-period Analytics data (unique devices is a project-wide reach estimate, not pageviews); use `get_file_metadata` for full file attribution and `get_image_info` for compact machine-readable file licence data — licences are per-file and never assumed." This lives in the static signed catalogue (SR-12). `prompts/list` and `resources/list` continue to return empty arrays (AC-08 still passes).

---

## 6. Group C/F load profile

### 6.1 Separation from earlier gates (decisive)

**Phase 3 tools do NOT feed the Phase 1 nightly M3/M4 gate, and do NOT feed the Phase 2 B-M3/B-M4 gate.** Phase 1 M3 (global 2 s ceiling, Class R/A budgets), Phase 1 M4 (429 == 0 for Group A), and Phase 2 B-M3/B-M4 are computed only from their own phase's calls and remain unchanged (report 09 §4, report 10 §9.1). Phase 3 introduces **separate counters** in the same nightly window:

- **`CF-M3`** — per-class p95 budgets (§6.3), with ≥150 samples per class before a p95 is computed (report 09 §4.5).
- **`CF-M4`** — 429 count == 0 **per class**; any 429 in any Phase 3 class fails `CF-M4`, sample quarantined, ticket opened. Never retry-to-green or loosen the gate.

Overall nightly PASS iff Phase 1 M1–M6 pass **and** Phase 2 B-M3/B-M4 pass **and** `CF-M3` PASS **and** `CF-M4` PASS with zero timeouts/5xx. The Phase 1 global 2000 ms ceiling continues to apply to Group A only. Merge gate stays fixture-only (<2 min); **no live Analytics, Attribution or imageinfo call occurs in CI**.

### 6.2 Per-tool pacing, concurrency and caching

| Class | Tools | Token bucket | Semaphore | Basis |
|---|---|---|---|---|
| **M — Analytics** | `get_pageviews`, `get_most_read`, `get_unique_devices` | **1 req/s (60 req/min), burst 2** | `min(2, CONCURRENCY_LIMIT)` = 2, nested in global `p-limit(3)` | Live probe on 2026-11-21 returned HTTP 429 after only two rapid Analytics calls; deliberately conservative. |
| **T — Attribution API beta** | Group F primary | **1 req/s (60 req/min), burst 2** | same nested 2 | New beta service with undocumented limits; report 06 §6.2. |
| **I — Action imageinfo** | Group F enrichment/fallback | Public-API governor **2 req/s (120 req/min), burst 3** | global `p-limit(3)` | Phase 1 §4.1 compliant-UA tier. |

Global outbound concurrency remains **≤ 3** across all phases (report 09 AC-26; SR-4). Each class bucket is drawn from the same global semaphore. Identical-request caching: metrics TTL `min(300000, METADATA_CACHE_TTL_MS)` keyed by endpoint URL; attribution/enrichment TTL `METADATA_CACHE_TTL_MS` keyed by (host, version, filename). Cache keys never contain credentials (none exist). No `ttlMs`/`cacheScope` is advertised on `tools/call` (AC-09).

### 6.3 Latency budgets

| Class | Median evidence | p95 budget |
|---|---|---|
| M — Analytics | ~0.302 s (report 06 §2.2) | **≤ 1.0 s** |
| T — Attribution beta | not timed in research; new service | **≤ 1.5 s** |
| I — Action imageinfo | ~0.59 s Action median (report 06 §2.2) | **≤ 1.5 s** |

Measured end-to-end at the MCP client, as in report 09 §4.3. A timeout (> `HTTP_TIMEOUT_MS`, default 15 s) or non-2xx is a failed call and fails the run. `CF-M3` PASS iff every class p95 ≤ its budget with ≥150 samples/class and ≤5% invalid samples.

### 6.4 429 and politeness rules

- Instrument every M/T/I fetch with timestamp, tool, endpoint, status and `Retry-After`; emit `wmcp_metrics_429_total`, `wmcp_attribution_429_total` and a `Retry-After` gauge.
- On 429/503: stay on the same source, honour `Retry-After`; if absent wait ≥ `RETRY_AFTER_FALLBACK_MS`; bounded jittered backoff via `RETRY_MAX_ATTEMPTS`. Never switch hosts on 429 (SR-4; report 10 §4.7 logic applied to a single host).
- Any 429 during the nightly Phase 3 run → `CF-M4 FAIL` (no ratio, no threshold).
- GET only; fixed historical dates; no tight polling; metadata 100% cached. User-Agent on 100% of calls (AC-25).

---

## 7. Binary acceptance criteria AC-60 onward

Each criterion is yes/no. All run on fixtures in the blocking merge gate unless marked **live** (nightly). "Zero outbound requests" is asserted with MSW request counters.

### A. Registration, annotations and configuration

- **AC-60** `tools/list` advertises exactly the five names in §1.1, each with a strict JSON Schema and a non-empty description; no Enterprise, write, D-group or G-group tool is registered. *(report 05 §2; SR-12)*
- **AC-61** All five tools carry `readOnlyHint:true, destructiveHint:false, openWorldHint:true, idempotentHint:true`; none declares `x-mcp-header`. *(report 09 AC-23; §3.6)*
- **AC-62** Config smoke reads `ATTRIBUTION_API_VERSION`, `ATTRIBUTION_FALLBACKS`, `ATTRIBUTION_DISCLAIMER` with documented defaults when unset; **no new config key exists**; an empty/malformed version or an unknown fallback token terminates boot; `v1` is accepted but falls back on `rest-no-match`. *(§1.4; report 09 AC-31)*
- **AC-63** After Phase 3 registration, Phase 1 AC-01…AC-32 and Phase 2 AC-33…AC-59 pass unchanged over both transports; no Phase 3 `tools/call` result carries `ttlMs` or `cacheScope`. *(report 09 AC-09/AC-32; report 10 AC-35/AC-58)*

### B. Metrics validation and date guards

- **AC-64** Every Group C schema rejects wrong types, missing required params, out-of-range `limit`/`thumb_width`, malformed project/article/date and unknown extra fields (strict object), with `validation_error` and zero outbound requests. *(SR-1; report 09 AC-21)*
- **AC-65** Timestamp shape is enforced per granularity: hourly needs `YYYYMMDDHH`, daily/weekly/monthly need `YYYYMMDD`, unique devices needs `YYYYMMDD` and only `daily`/`monthly`; weekly must be Mondays, monthly must be the 1st; calendar round-trip rejects impossible dates. *(§4.4)*
- **AC-66** Date bounds are enforced locally: `start ≥ 20150101`, `end ≤ yesterday UTC`, `start ≤ end`, no `"today"`/future dates, and span caps (hourly 24 h, daily 366 d, weekly 730 d, monthly 3650 d) with `details.limits` on breach and zero outbound requests. *(§4.4; TC-C-004/005/006/008)*
- **AC-67** `enwiki`, `wikipedia:en` and `en.wikipedia` all resolve to `en.wikipedia`, `commonswiki` resolves to `commons.wikimedia`, and an unresolvable or host-shaped `project` returns `invalid_project` with zero outbound requests. *(§3.2; SR-3; new TC-C-009/011)*
- **AC-68** TC-C-003: a zero-view/missing article returns `results: []`, `count: 0`, `resultType: "complete"` and success — no exception and no `page_not_found`. *(TC-C-003; D6)*
- **AC-69** `get_most_read` maps upstream `Main_Page`→`title: "Main Page"`, preserves `rank`/`views`, caps `limit` at 100, builds `url` from the allowlisted resolver host, and returns `articles: []` on empty upstream data. *(§4.2)*
- **AC-70** `get_unique_devices` exposes no `article` parameter, emits `devices`/`offset`/`underestimate` and the fixed `meaning` string, and accepts only `all-sites`/`desktop-site`/`mobile-site` and `daily`/`monthly`; a rejected access value yields zero outbound requests. *(§4.3; D5; new TC-C-007)*

### C. Metrics corpus and provenance

- **AC-71** **TC-C-001 (live):** `get_pageviews` for Earth `20261101`–`20261120` returns `results[].views ≥ 0`, covers the requested range, and carries the full §3.3 provenance block. *(corpus)*
- **AC-72** **TC-C-002 (live):** `get_most_read` for `2026-11-20` returns `articles[0].title`, `articles[0].views`, `count ≤ 5`, and resolves in a single tool call. *(corpus)*
- **AC-73** 100% of Group C results carry `source`, `endpoint`, `license` (CC0 1.0), `attribution` and `resultType`; one omission fails the run. *(§3.3; SR-11; report 05 M5)*
- **AC-74** New TC-C-007 (fixture, fixed `20230101`) exercises the unique-devices parser and emits the exact `devices`/`offset`/`underestimate` fields with provenance. *(§4.3)*

### D. Attribution pipeline and beta fallbacks

- **AC-75** A 200 from the Attribution API calls the exact `{host}/w/rest.php/attribution/{version}/pages/{encodedTitle}/signals` URL (colon as `%3A`, spaces as `%20`) and maps **every** `essential.*` path in §3.7 Step 1, preserving `wprov=afsw1` in `attribution.link` verbatim. *(§3.7; report 06 §6.2)*
- **AC-76** Beta `404 rest-no-match` and `ATTRIBUTION_API_VERSION=v1` 404 each trigger the `ATTRIBUTION_FALLBACKS` chain, reach `action-imageinfo`, emit a warning and a non-fatal result; no raw 404/`rest-no-match` body appears in `message`. *(§3.7 Step 2/4; report 06 §6.4; new TC-F-004/005)*
- **AC-77** The site-wide CC BY-SA 4.0 licence URL **never** appears in any Group F result: a fixture with beta `license.short:"PDM"`, `license.url:null` and extmetadata `"Public domain"` emits the per-file licence, `action-rightsinfo` is skipped with a recorded warning, and `attribution_source`/`license.source` identify the real source. *(D8/D10; report 09 §3.3; new TC-F-006)*
- **AC-78** All `extmetadata` values (`Artist`, `Credit`, `UsageTerms`, `LicenseShortName`) are HTML-stripped, entity-decoded and whitespace-collapsed; a canary in `Artist` is returned as data with no instruction executed and no prompt/token disclosed. *(§3.7 Step 3; SR-2; new TC-F-007)*
- **AC-79** When `imagerepository != "local"`, no Attribution API call is made, `storage:"remote"` and a `remote media` warning are emitted, and fields are built solely from Action API `imageinfo`/`extmetadata`. *(D12; report 06 §6.2; new TC-F-008)*
- **AC-80** `file_not_found` is returned only when both sources indicate absence; a beta 404 with valid `imageinfo` data is a successful fallback result, not `file_not_found`. *(§3.7 Step 4; TC-F-003; new TC-F-009)*
- **AC-81** A same-origin 301 for a `File:` title with an unencoded colon is followed safely; a cross-origin redirect returns `upstream_unavailable` with no credential or host leak. *(§3.1; SR-3; new TC-F-010)*
- **AC-82** When no source supplies `license.url`, the static `LICENSE_URL_MAP` is used or `url: null` plus a warning is emitted; no guessed or site-wide URL is ever substituted. *(§3.7 Step 5; new TC-F-006/012)*

### E. Media corpus, licensing and security

- **AC-83** **TC-F-001 (live):** `get_file_metadata` returns `filename`, `url`, `license`, `author`, `attribution`, `source`, `resultType` and `_meta`; the licence is machine-readable. *(corpus)*
- **AC-84** **TC-F-002 (fixture):** `get_image_info` returns `filename`, `url`, `mime`, `license` (non-empty `short` and a URL or documented null), `attribution`, and resolves in a single tool call. *(corpus)*
- **AC-85** **TC-F-003 (fixture):** a missing Commons file returns `file_not_found`, `retryable:false` and a single readable failure reason. *(corpus)*
- **AC-86** **100% of media results** carry `license`, `attribution`, `source`, `author` (present, possibly `null` with warning), `resultType` and `_meta`; one omission fails the run. *(report 05 M5; SR-11; TC-F-001/002; new TC-F-011)*
- **AC-87** `get_file_metadata` and `get_image_info` are backed by a single shared resolver (one Attribution client, one HTML stripper, one licence map); the catalogue advertises two distinct names with distinct output shapes. *(§5.3)*
- **AC-88** No media string — `author`, `credit`, `ObjectName`, `ImageDescription` or an error body — is ever promoted to an instruction; the untrusted-content canary is returned as data with no system prompt or token disclosure. *(SR-2; report 08 T-02)*
- **AC-89** Every Phase 3 result has `resultType:"complete"` and `_meta["io.modelcontextprotocol/serverInfo"]`; no `input_required` result is produced; every error has non-empty `code`/`message`, boolean `retryable` and a non-empty `action`/`hint`. *(report 09 AC-05/06/24; report 10 §3.3)*

### F. Transport, politeness and load

- **AC-90** All five tool contracts pass over both stdio and Streamable HTTP, including `Mcp-Name` validation; transport-specific checks are otherwise identical. *(report 09 AC-32 pattern; report 10 AC-58)*
- **AC-91** 100% of Phase 3 outbound calls carry the configured non-empty `USER_AGENT`; global concurrency ≤ 3; Class M/T buckets ≤ 1 req/s burst 2 and Class I ≤ 2 req/s burst 3, asserted with fake timers and no real sleep in CI. *(§6.2; report 09 AC-25/26)*
- **AC-92** **live** Phase 3 load run: `CF-M3` per-class p95 within budget (M ≤ 1.0 s, T ≤ 1.5 s, I ≤ 1.5 s) with ≥150 samples/class; `CF-M4` 429 count == 0 per class; Phase 1 M1–M6 and Phase 2 B-M3/B-M4 unchanged and still passing. *(§6; report 09 §4; report 10 §9)*
- **AC-93** On 429/503 the server stays on the same source, honours `Retry-After`, uses bounded jittered backoff, and either returns a normal result with a warning or `rate_limited`/`upstream_unavailable` with `retryable:true` and `retry_after_seconds`; a 429 without `Retry-After` waits ≥ `RETRY_AFTER_FALLBACK_MS`. *(§6.4; report 10 AC-39/40)*
- **AC-94** All new fixture cases in §7.2 (TC-C-004…TC-C-011 and TC-F-004…TC-F-012) are present in `test-corpus.json`, have fixture doubles for every live case, and pass in the merge gate with zero live network calls. *(§7.2; report 09 §4.5)*

### 7.1 CI placement

AC-60…AC-91 and AC-93…AC-94 are blocking merge gates (deterministic on fixtures). **AC-71, AC-72 and AC-92 are nightly live** only. No live network call occurs in the merge gate.

### 7.2 Corpus mapping and new cases required

Existing cases (already in `test-corpus.json`):

| Case | Tool | Covered by |
|---|---|---|
| TC-C-001 | `get_pageviews` (live) | AC-71 |
| TC-C-002 | `get_most_read` (live) | AC-72 |
| TC-C-003 | `get_pageviews` (zero views) | AC-68 |
| TC-F-001 | `get_file_metadata` (live) | AC-83, AC-86 |
| TC-F-002 | `get_image_info` (fixture) | AC-84, AC-86 |
| TC-F-003 | `get_file_metadata` (missing file) | AC-80, AC-85 |

New cases to add to `test-corpus.json` (all `mode: fixture`):

| Case | Purpose | Criterion |
|---|---|---|
| TC-C-004 | Malformed date shapes (hourly with 8 digits, daily with 10 digits, `20260230`) → `validation_error`, zero outbound | AC-64, AC-65 |
| TC-C-005 | Future date, reversed range, over-cap span → `invalid_date_range` with `details.limits`, zero outbound | AC-66 |
| TC-C-006 | Weekly non-Monday and monthly non-1st → `invalid_date_range` | AC-65 |
| TC-C-007 | `get_unique_devices` happy path, fixed `20230101` monthly — `devices`/`offset`/`underestimate` + `meaning` | AC-70, AC-74 |
| TC-C-008 | `get_most_read` future date and `"today"` → `invalid_date_range` | AC-66 |
| TC-C-009 | Project alias normalisation (`enwiki`→`en.wikipedia`, `commonswiki`→`commons.wikimedia`) | AC-67 |
| TC-C-010 | Analytics 429 with `Retry-After: 1` → stay, delay ≥1 s, eventual success (fake timers) | AC-93 |
| TC-C-011 | Unresolvable/host-shaped `project` → `invalid_project`, zero outbound | AC-67 |
| TC-F-004 | Beta `404 rest-no-match` → `action-imageinfo` fallback, warning, success | AC-76 |
| TC-F-005 | `ATTRIBUTION_API_VERSION=v1` → 404 `rest-no-match` → fallback (config-variant fixture) | AC-62, AC-76 |
| TC-F-006 | Beta `license.short:"PDM"`, `url:null` + extmetadata `"Public domain"` → per-file licence; no site-wide CC BY-SA | AC-77, AC-82 |
| TC-F-007 | HTML `<a>` in `Artist` stripped; prompt-injection canary returned as data | AC-78, AC-88 |
| TC-F-008 | `imagerepository != "local"` → Action-only, `storage:"remote"`, warning, zero beta call | AC-79 |
| TC-F-009 | Attribution 404 but valid `imageinfo` → success, not `file_not_found` | AC-80 |
| TC-F-010 | Same-origin 301 followed; cross-origin redirect → `upstream_unavailable` | AC-81 |
| TC-F-011 | `ATTRIBUTION_DISCLAIMER` injected verbatim on 100% of media results | AC-86 |
| TC-F-012 | Unknown licence short with no `LicenseUrl` → `url:null` + warning, no guessed URL | AC-82 |

---

## 8. Change-control note and status line

- Contract version **3.0.0** is frozen on 2026-11-21. It is additive to Phase 1 v1.0.1 and Phase 2 v2.0.0; neither is reopened.
- Tool names, required parameters, output field names (`results`, `devices`, `offset`, `underestimate`, `articles[].title`, `license`, `author`, `attribution`, `attribution_source`, `meaning`), error codes, date/span caps (§4.4), the project-code alias set (§3.2), the Attribution `essential.*` mapping (§3.7 Step 1) and the media fallback order (§5.4) are **frozen**. Changes require v4.0.0, an updated `test-corpus.json` and renumbered/extended AC.
- Additive optional output fields or a revised tool description may be v3.1.0 with a logged change. Setting `ATTRIBUTION_API_VERSION=v1` when v1 reaches general availability, or amending `ATTRIBUTION_FALLBACKS` as beta gaps close, is a deployment/configuration change recorded in the change log with **no** version bump; reversal triggers are those in report 06 §6.2/§6.4 (v1 path still returns `rest-no-match`; beta remote-media and licence-normalisation gaps remain).
- The §3.3 classification of aggregate metrics as CC0 1.0 is a frozen engineering decision; if Wikimedia publishes a contrary data licence, re-classification is a **major** version change (it alters every Group C output).
- Every change must re-run AC-60…AC-94 **and** the Phase 1 (AC-01…AC-32) and Phase 2 (AC-33…AC-59) regression checks (AC-63). Failure to preserve earlier criteria blocks release.

### Change log

| Version | Date | Change |
|---|---|---|
| 3.0.0 | 2026-11-21 | Initial frozen Phase 3 contract: five Group C/F tools, metrics date guards, Attribution API pipeline with beta fallbacks, two-tool/one-pipeline media decision, separate load profile, AC-60…AC-94, 17 new corpus cases. |

---

**Status: FROZEN — ready for implementation. Phase 3 is read-only Groups C (metrics) + F (Commons media and attribution). Enterprise (Group E), all write tools (Group G), EventStreams (Group D), Lift Wing and Wikifunctions remain out of scope. Phase 1 v1.0.1, Phase 2 v2.0.0, AC-01…AC-59 and their nightly gates are unchanged.**

*End of Phase 3 implementation contract — version 3.0.0.*
