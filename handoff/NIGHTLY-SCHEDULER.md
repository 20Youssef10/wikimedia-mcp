# Nightly live gate scheduler, collection and alerting

**Status:** operational template. Replace all `/path/to/...` and `PLACEHOLDER_*` values with real deployment paths/endpoints. **No nightly live run is performed by this hand-off package.** The exact project command is:

```sh
npm run build && WMCP_LIVE=1 npx vitest run tests/live/live.test.ts
```

**Grounding:** `README.md:373-381`, `tests/live/live.test.ts:15-23`, `src/observability/nightly-report.ts`, `reports/nightly-live.json` (sample output), `package.json:11-20`, `vitest.config.ts`.

---

## 1. What the job does and what it writes

- The gate makes **330 live calls** (30 warm-up + 300 measured, M1–M4) at peak concurrency <= 3 (`CONCURRENCY_LIMIT`), from clean egress. It is skipped entirely unless `WMCP_LIVE=1`; fixture-only CI never uses live network.
- **Every run** — pass, assertion failure, or startup failure — persists a report via a `finally` block. Default path: `reports/nightly-live.json` (gitignored). Override with `WMCP_NIGHTLY_REPORT_PATH` (absolute or cwd-relative).
- Report `schema_version: 1` fields: `timestamp`, `total`, `warmup`, `measured`, `peak_concurrency`, `per_tool_success`, `per_tool_p95_ms`, `m1`…`m6` (each with `pass`), `m4` (`count429`), `m4_429_count`, `overallPass`, `failures[{id,detail}]`.
- Group D `get_recent_changes` feeds **no** nightly gate; optional `D-M3`/`D-M4` counters are not registered. Group C/F and Phase 5 tools keep their own load profiles. Do not attribute their counters to M1–M6.
- Schedule off-peak (e.g. 02:30 UTC) so rate-limit noise is representative and Wikimedia is least affected.

---

## 2. Cron example

Runs as the deployment user; `flock` prevents overlap; output appended to a log that logrotate manages. Paths and the npm binary location are placeholders.

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin:PLACEHOLDER_NODE_BIN_DIR
MAILTO=PLACEHOLDER_ONCALL_ALIAS

30 2 * * * cd /path/to/wikimedia-mcp && flock -n /tmp/wmcp-nightly.lock bash -c 'npm run build && WMCP_LIVE=1 npx vitest run tests/live/live.test.ts' >> /var/log/nightly.log 2>&1
```

Notes:

- Keep `WMCP_NIGHTLY_REPORT_PATH` unset to use `reports/nightly-live.json`, or set it in the crontab line, e.g. `WMCP_NIGHTLY_REPORT_PATH=/var/lib/reports/nightly-live.json`.
- `flock -n` drops overlapping runs silently; alert on a missing/new report instead of a duplicate.
- On Termux, use `$PREFIX/bin/bash`/`$PREFIX/bin/npm` equivalents and an accessible working directory; the example above targets a conventional Linux host.

---

## 3. systemd timer example

`/etc/systemd/system/wmcp-nightly.service`:

```ini
[Unit]
Description=Wikimedia MCP nightly live gate (330 calls)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=PLACEHOLDER_SERVICE_USER
WorkingDirectory=/path/to/wikimedia-mcp
Environment=WMCP_LIVE=1
Environment=WMCP_NIGHTLY_REPORT_PATH=/var/lib/reports/nightly-live.json
Environment=PATH=/usr/local/bin:/usr/bin:/bin:PLACEHOLDER_NODE_BIN_DIR
ExecStart=/usr/bin/env bash -c 'npm run build && npx vitest run tests/live/live.test.ts'
TimeoutStartSec=3600
StandardOutput=append:/var/log/nightly.log
StandardError=append:/var/log/nightly.log
```

`/etc/systemd/system/wmcp-nightly.timer`:

```ini
[Unit]
Description=Run Wikimedia MCP nightly live gate off-peak

[Timer]
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=900
Persistent=true
Unit=wmcp-nightly.service

[Install]
WantedBy=timers.target
```

Enable with `systemctl daemon-reload && systemctl enable --now wmcp-nightly.timer`. Check with `systemctl list-timers wmcp-nightly.timer` and `journalctl -u wmcp-nightly.service -n 200`.

---

## 4. Container examples

### 4.1 One-shot Docker run (host scheduler triggers it)

```sh
docker run --rm \
  -e WMCP_LIVE=1 \
  -e WMCP_NIGHTLY_REPORT_PATH=/reports/nightly-live.json \
  -v /srv/wmcp/reports:/reports \
  -v /srv/wmcp/nightly.log:/var/log/nightly.log \
  PLACEHOLDER_IMAGE:PLACEHOLDER_TAG \
  sh -c 'cd /app/wikimedia-mcp && npm run build && npx vitest run tests/live/live.test.ts >> /var/log/nightly.log 2>&1'
```

### 4.2 Docker Compose service (triggered by cron/systemd on the host)

```yaml
services:
  nightly:
    image: PLACEHOLDER_IMAGE:PLACEHOLDER_TAG
    working_dir: /app/wikimedia-mcp
    environment:
      WMCP_LIVE: "1"
      WMCP_NIGHTLY_REPORT_PATH: /reports/nightly-live.json
    command: ["sh", "-c", "npm run build && npx vitest run tests/live/live.test.ts"]
    volumes:
      - /srv/wmcp/reports:/reports
    logging:
      driver: json-file
      options:
        max-size: "20m"
        max-file: "7"
    restart: "no"
```

### 4.3 Kubernetes CronJob (optional)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: wmcp-nightly-live
spec:
  schedule: "30 2 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: gate
              image: PLACEHOLDER_IMAGE:PLACEHOLDER_TAG
              workingDir: /app/wikimedia-mcp
              env:
                - { name: WMCP_LIVE, value: "1" }
                - { name: WMCP_NIGHTLY_REPORT_PATH, value: /reports/nightly-live.json }
              command: ["sh", "-c", "npm run build && npx vitest run tests/live/live.test.ts"]
              volumeMounts:
                - { name: reports, mountPath: /reports }
          volumes:
            - name: reports
              persistentVolumeClaim: { claimName: PLACEHOLDER_REPORT_PVC }
```

---

## 5. Collecting `reports/nightly-live.json`

After each run, copy the report to durable storage (the source path is gitignored and may be overwritten on the next run):

```sh
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
cp /path/to/reports/nightly-live.json \
   /srv/wmcp/report-archive/nightly-live-${STAMP}.json
```

Alert-check snippet (reads the current report, exits 2 on any alert condition):

```sh
node --input-type=module -e '
import { readFileSync } from "node:fs";
const p = process.env.WMCP_NIGHTLY_REPORT_PATH ?? "reports/nightly-live.json";
const r = JSON.parse(readFileSync(p, "utf8"));
const staleMs = Date.now() - Date.parse(r.timestamp);
const bad = r.overallPass !== true || r.m4_429_count > 0
  || (r.failures?.length ?? 0) > 0 || staleMs > 26 * 3600_000;
console.log(JSON.stringify({ timestamp: r.timestamp, overallPass: r.overallPass,
  m4_429_count: r.m4_429_count, failures: r.failures, staleMs }));
process.exit(bad ? 2 : 0);'
```

The report is also human-readable: the `[nightly]` console lines print per-tool success, per-tool p95, M1 rate, M4 429 count, and each failure detail. Keep those lines in the scheduler log.

### Additive `politeness` block (WP16)

`reports/nightly-live.json` now also carries a `politeness` object. It is strictly additive: the alert snippet above and every pre-existing field (`overallPass`, `m4_429_count`, `failures`, `total`, `measured`, `peak_concurrency`) are unchanged. The block contains counts and ratios only — never a token, title, raw subject or secret — so it is safe to archive alongside the report.

| Field | Meaning |
|---|---|
| `upstream_calls_by_tool` | Upstream attempts keyed by tool/backend label (counts only). In the spawned nightly runner, derived from the measured call mix. |
| `upstream_calls_total` | Sum of the above. |
| `cache_hits`, `cache_misses`, `cache_hit_rate` | Metadata-cache behaviour. `cache_hit_rate` is `hits / (hits + misses)`, or `0` when no lookups were instrumented in that run. |
| `retry_after.observed` | Responses carrying a `Retry-After` header. |
| `retry_after.rate_limited` | Responses with HTTP 429. |
| `retry_after.honored` | Times the configured backoff honoured the advertised `Retry-After` in full. |
| `retry_after.proximity_ratio` | `rate_limited / upstream_calls_total` — how often the upstream rate-limited us. `0` in a healthy run. |
| `retry_after.max_observed_ms` | Largest `Retry-After` seen, in milliseconds. |
| `concurrency_reductions` | Temporary WP17 reductions of the effective concurrency ceiling on 429/503. The ceiling never exceeds `CONCURRENCY_LIMIT` (3) and recovers after a cooldown. |
| `coalesced_calls`, `coalesced_waiters` | WP18 in-flight read coalescing: number of shared calls and the extra waiters they served (a measurable reduction in upstream calls per session). |

When the report is built by the nightly runner (a separate process from the MCP server), cache/coalescing/reduction counters are `0` because they are not visible across the process boundary — use the fixture suites for per-client instrumentation. The per-tool call counts and 429 proximity are always derived from the gate observations.

**WP19 additive update (child→parent telemetry).** The nightly live test now sets `WMCP_TELEMETRY_SNAPSHOT_PATH` (default file: `reports/nightly-telemetry.json`, gitignored with the rest of `reports/`) on the MCP child. The child atomically writes a counts/ratios-only `PolitenessSnapshot` every second and once on SIGTERM; no GET endpoint is added and no token/title/secret is written. The parent reads and strictly validates that file before building the report. A new additive `telemetry_source` field is `child` when real counters were merged, or `observation-derived` when the snapshot is missing/malformed and the pre-existing fallback was used. All pre-existing report fields keep their meaning. A stale snapshot from a prior run is removed at the start of every live run.

---

## 6. Alerting policy

Alert on **any** of:

| Condition | Why |
|---|---|
| `overallPass === false` | Any M1–M6 gate failed (success rate, latency p95, 429 count, coverage). |
| `m4_429_count > 0` | Upstream rate limiting occurred even if the gate still passed — politeness/egress regression. |
| `failures[]` non-empty | Startup failure or assertion failure; report may be an incomplete run. |
| Report missing or `timestamp` older than ~26 h | Scheduler did not run or report was not persisted. |
| `total !== 330` / `measured !== 300` / `peak_concurrency > 3` | Gate ran with an unexpected call mix or concurrency budget. |
| Repeated `upstream_unavailable` failures | Egress/network problem rather than code regression. |

Delivery example (no credentials in the command; use a secret store for webhook URLs):

```sh
node --input-type=module -e '
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync("reports/nightly-live.json", "utf8"));
if (r.overallPass !== true || r.m4_429_count > 0) {
  await fetch(process.env.PLACEHOLDER_ALERT_WEBHOOK, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `[wmcp-nightly] overallPass=${r.overallPass} 429s=${r.m4_429_count} ${r.timestamp}`, failures: r.failures }),
  });
}'
```

Route `overallPass=false` to the on-call engineering channel; route `m4_429_count>0` (with zero gate failures) to the same channel as a warning and check egress/proxy changes and `CONCURRENCY_LIMIT`. Do not auto-retry the gate immediately — re-running 330 live calls after a 429 aggravates the rate-limit condition.

---

## 7. Log and report retention

- Scheduler console log: rotate daily or at 20 MB, keep **14–30 days** (`logrotate` or the container `max-size`/`max-file` settings above).
- Machine-readable nightly reports: keep **90 days** online; keep **all failure reports** and any report with `m4_429_count > 0` for **1 year** as regression evidence.
- `reports/nightly-live.json` is gitignored: never commit it; archive by timestamped copy instead.
- Restrict access to reports and logs to the ops/on-call group; they contain call patterns and failure detail (not credentials — the server redacts tokens).
- Review monthly: gate pass rate, 429 trend, p95 trend per tool; attach findings to the nightly-gate section of the ops log.

---

## 8. Assumptions

- `npm`, `npx` and Node >= 22 are on `PATH` for the scheduler user/container.
- The host has clean, outbound HTTPS egress to Wikimedia endpoints and respects Wikimedia's robot/rate policies.
- `WMCP_LIVE=1` is set **only** for this nightly job; the merge gate remains fixture-only.
- Alert sink URLs/secrets, image names, service users and paths are operator-supplied; none are included here.
