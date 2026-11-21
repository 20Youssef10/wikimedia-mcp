# Group D reversal watch — monthly demand monitor

**Status:** monitoring procedure. The watcher is **read-only**: all HTTP calls are GETs to public APIs; the only file it writes is `handoff/group-d-watch-report.json` next to the script. It has no credentials and cannot modify the registry, npm, GitHub or the server. It has **not** been run as part of this hand-off.

**Grounding:** `wikimedia-mcp-research/12-group-d-spike.md` §2 (demand re-check) and §6 (recommendation / reversal triggers), `wikimedia-mcp/README.md:385-408` (Group D tool feeds no nightly gate), research report 15 (contract v6.x).

---

## 1. Decision being watched

Report 12 (2026-11-21) decided: **BUILD** the bounded, stateless `get_recent_changes` tool backed by Action API polling; **DROP** the permanent internal EventStreams (SSE) consumer / rolling-window service. Keep the registry watch running. This is implemented: the tool polls `action=query&list=recentchanges`, with no SSE consumer, no EventStreams env key and no rolling window.

The watcher re-checks whether evidence has crossed a threshold that should reopen that decision.

---

## 2. Baselines and thresholds (from report 12)

| Signal | 2026-11-21 baseline | Source |
|---|---|---|
| Registry exact queries `recent changes`, `recentchange`, `eventstreams`, `wikimedia stream` | **0 results each** | report 12 §2.1 |
| Registry `wikipedia` query | 49 raw / 13 unique names; **1** active live-edit-feed entry (`io.github.guptaprakhariitr/wikipedia-recent-changes-mcp`, description "Live Wikipedia edit feed…"; 0 stars/issues) | report 12 §2.1 |
| Dedicated npm package `@insnapsprakhar/wikipedia-recent-changes-mcp`, last-month downloads | **19** | report 12 §2.3 |
| General packages, last-month downloads | `wikipedia-mcp` **68,555**; `@professional-wiki/mediawiki-mcp-server` **9,485**; `@cyanheads/wikipedia-mcp-server` **3,123** | report 12 §2.3 |
| Relevant GitHub issues for `wikimedia mcp recent changes in:title,body type:issue` | 13 raw / **0 relevant** | report 12 §2.4 |
| SPIKE-MORE threshold | **>= 2** active registry entries advertising EventStreams/live-change tools | report 12 §6 trigger 1 |
| DROP threshold | dedicated package **< 50 downloads/month** AND **no** registry entry, GitHub issue or downstream ask, **within 4 weeks of shipping** | report 12 §6 trigger 2 |

The registry `search` parameter matches **descriptions, not names** (report 12 §2.1): a zero exact-query count can be an index artifact. The watcher therefore also queries `wikipedia` and uses a description/name keyword heuristic. All heuristics are coarse and flagged for human review.

---

## 3. Reversal triggers (report 12 §6, verbatim intent)

1. **→ SPIKE-MORE on EventStreams** if a concrete user/issue requires true push (sub-minute notification, not poll), **or >= 2 active registry entries advertise EventStreams/live-change tools**, **or a top-10 Wikimedia MCP repo adds a live SSE tool**.
2. **→ DROP the bounded tool too** if, within 4 weeks of shipping, the dedicated recent-changes package remains **< 50 downloads/month** and no registry entry, GitHub issue or downstream user asks for the feature.
3. **→ Revisit cost/ToS** if Wikimedia tightens Action API rate limits for our polling volume or publishes an affordable Enterprise Realtime tier.
4. **→ Re-open architecture** if MCP adds a first-class resumable streaming primitive that makes a bounded live stream stateless to host.

The script can evaluate trigger 1's registry-count condition and produce a *candidate* for trigger 2. Triggers that require human judgement (sub-minute need, top-10 repo SSE review, rate-limit/ToS changes, MCP protocol primitives, "downstream user asks", the 4-week window) are emitted under `manual_review_items`; they are never auto-resolved.

---

## 4. What the script queries

`handoff/group-d-watch.mjs` (Node >= 22, built-in `fetch` only):

- Official MCP registry — `https://registry.modelcontextprotocol.io/v0/servers?search=<query>&limit=100` for the five queries above (JSON key `servers`).
- npm downloads API — `https://api.npmjs.org/downloads/point/last-month/<encoded-package>` for the dedicated package and the three general packages.
- GitHub public search API — issues query `wikimedia mcp recent changes in:title,body type:issue` and repositories query `wikimedia mcp recent changes` (`sort=stars`, `per_page=10`).

Politeness/constraints: sequential requests, **6 s** per-request timeout (`AbortSignal.timeout`), 250 ms pause between calls, `limit`/`per_page` kept small, identifying `User-Agent`, `Accept: application/json`, `redirect: 'error'`. No POST/PUT/DELETE, no auth token, no secrets. GitHub unauthenticated rate limit is 60 requests/hour; monthly cadence is well within it.

Exit codes: `0` = report written (including partial/incomplete runs, which are marked in the report); `1` = local write failure. Network failures are recorded as `warnings` and force `overall_status = INCOMPLETE_CHECK_NETWORK_OR_API_ERRORS` — do not interpret an incomplete run as evidence of either steady state or reversal.

---

## 5. How to run monthly

From any working directory (paths are resolved relative to the script):

```sh
node /data/data/com.termux/files/home/wiki-mcp/handoff/group-d-watch.mjs
# writes /data/data/com.termux/files/home/wiki-mcp/handoff/group-d-watch-report.json
```

Monthly cron example (e.g. 03:00 UTC on the 1st), alerting on the script's own exit code:

```cron
0 3 1 * * cd /data/data/com.termux/files/home/wiki-mcp/handoff && node group-d-watch.mjs >> /var/log/wmcp-group-d-watch.log 2>&1
```

After each run, archive the report outside `handoff/` (the watcher overwrites the same path each month):

```sh
STAMP=$(date -u +%Y%m%d)
cp /data/data/com.termux/files/home/wiki-mcp/handoff/group-d-watch-report.json \
   /srv/wmcp/group-d-watch/${STAMP}.json
```

Suggested check after the run:

```sh
node --input-type=module -e '
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync("/data/data/com.termux/files/home/wiki-mcp/handoff/group-d-watch-report.json", "utf8"));
console.log(r.overall_status, JSON.stringify(r.evaluations.map((e) => [e.id, e.status])));'
```

---

## 6. Interpreting `overall_status`

| Value | Meaning / action |
|---|---|
| `STEADY` | No automated reversal threshold crossed. Still review `manual_review_items` quarterly. |
| `REVERSAL_TRIGGERED` | >= 2 active registry entries advertise live-change tools → reopen report 12 decision; re-run the EventStreams spike before changing code. |
| `DROP_CANDIDATE_REQUIRES_HUMAN_CONFIRMATION` | Downloads < 50 and no public demand signal; operator must confirm the 4-week window and check private/downstream requests before considering removal of the bounded tool. |
| `REQUIRES_HUMAN_REVIEW` | A top-10 repo keyword candidate appeared; review whether it genuinely ships an SSE tool. |
| `INCOMPLETE_CHECK_NETWORK_OR_API_ERRORS` | One or more sources failed; fix egress/rate-limit issue and rerun. Do not conclude anything from this report. |

---

## 7. Limitations / assumptions

- Public APIs are coarse proxies for demand: npm downloads are not proof of feature usage; GitHub issue relevance was 0/13 in the baseline and needs human triage; registry search matches descriptions.
- The script does not query PyPI (report 12 §2.3 found a JS anti-bot "Client Challenge" there — unverified) and does not search the web for blog posts/surveys; those remain manual items.
- "Within 4 weeks of shipping" requires an operator-supplied shipping date; the watcher cannot infer it.
- Reversal is a **decision review**, not an automatic code change. Any architecture change must go through the project's contract/version process and, for anything touching writes, the G1–G12 / AC-155 gates.
- All endpoints and baseline figures are those recorded in report 12; if the project publishes a newer observation, update `BASELINE` in the script and this document together.
