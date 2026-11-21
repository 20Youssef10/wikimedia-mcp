# Immutable (WORM) audit sink — requirements specification

**Status:** requirements + gap statement. **The current implementation is a local, in-memory HMAC hash chain (`AuditStore`) with an injectable daily-anchor callback whose default sink is a no-op. External WORM anchoring is NOT DONE.** No production audit sink has been configured, exercised or signed off.

**Grounding:** `wikimedia-mcp/src/write/audit.ts` (full implementation), `src/write/config.ts:65-67,180-181,221-223` (sink / HMAC secret / retention keys), `src/write/constants.ts:35-38` (outcomes), `write-security/incident-revocation-drill.md:18,23`, `tests/write/control-plane.test.ts:273-321`, `tests/write/incident-drill.test.ts:56-67`, research report 08 §5.4/§6.2 G6/§7 item 11.

---

## 1. What the code guarantees today

- Append-only log of `AuditEvent` objects held in process memory (`memory:process` default sink identifier). Records are never mutated in place by production code.
- Each record has a deterministic HMAC chain: `record_hash = HMAC-SHA256(MCP_WRITE_AUDIT_HMAC_SECRET, canonical({...record, record_hash: null}))`. The canonical payload includes `prev_hash`, so each record is bound to its predecessor (`genesis` for the first).
- `AuditStore.verify()` walks the chain: returns the index of the first record whose `prev_hash` does not match, or whose recomputed HMAC differs; returns `null` when intact.
- `AuditStore.verifyHead(expectedHead)` compares the current head with a previously anchored head to detect deletion/truncation.
- `AuditStore.anchorDaily()` produces one `AuditAnchor` per UTC day — `{date, head, anchored_at}` — and calls the injected `anchorSink`. The default sink discards it; a deployment must inject a real one.
- Mandated outcomes (`AUDIT_OUTCOMES`): `previewed`, `dry_run`, `executed`, `denied`, `failed`, `halted`.

**Gap:** there is no durable storage, no external anchor, no retention enforcement code and no export tool in the repository. Retention is a config value (`MCP_WRITE_AUDIT_RETENTION_DAYS`, >= 365), not behaviour implemented by `AuditStore`.

---

## 2. Mandated fields on every event

`MANDATED_AUDIT_FIELDS` (`src/write/audit.ts:36-41`) — every field must be present; `null` when inapplicable:

`event_id`, `timestamp`, `actor`, `tool`, `action`, `target`, `base_revision`, `new_revision`, `diff_hash`, `content_hash`, `confirmation_id`, `capability_id`, `approvals`, `outcome`, `error_code`, `correlation_id`, `token_id`, `origin`, `prev_hash`, `record_hash`.

Security-critical subset called out by report 08 §6.2 G6:

| Field | Requirement |
|---|---|
| `actor` | Object with `issuer`, `sub_hash`, `tenant`, `client_id_hash`. Hashed/prefixed identifiers only — no raw subject or token. |
| `target` | `{source, namespace, title}` — exact page/media target of the action. |
| `diff_hash` | `sha256:`-prefixed hash of the exact diff/content that was confirmed. Must match the diff the human approved. |
| `confirmation_id` | The signed MRTR `jti` (or null for preview/denied paths). Proves which confirmation authorised the action. |
| `outcome` | One of the six mandated outcomes above; never free text. |

Supporting integrity fields: `content_hash`, `base_revision`/`new_revision`, `capability_id`, `approvals`, `correlation_id`, `token_id` (hash prefix only), `origin`, `prev_hash`, `record_hash`, `event_id`, `timestamp`.

**Never** store raw bearer tokens, credentials, CSRF secrets, confirmation state or capability tokens in the audit sink. Token identifiers are hashed (`sha256-prefix:…`) by `src/write/auth.ts`.

---

## 3. HMAC hash-chain verification procedure

Perform on every export and on every daily anchor:

1. Recompute `HMAC-SHA256(MCP_WRITE_AUDIT_HMAC_SECRET, canonical({...record, record_hash: null}))` for each record in order; compare with `record.record_hash`.
2. Confirm `record.prev_hash === previous.record_hash` (first record must be `genesis`).
3. Confirm `AuditStore.verify() === null`.
4. Confirm `AuditStore.verifyHead(anchoredHead) === true` against the most recent trusted external anchor — this is the check that detects whole-tail deletion.
5. Confirm all `outcome` values are in `AUDIT_OUTCOMES` and all mandated fields are present.
6. Record the result (verifier identity, UTC time, head hash, record count) as its own signed verification event.

Detection properties (evidenced in `tests/write/control-plane.test.ts:287-321`): field edits → HMAC mismatch at that index; record deletion → `prev_hash` break; reordering → chain break; tail truncation → head mismatch against the anchor.

**Key-management caveat:** an attacker who obtains both the audit log and `MCP_WRITE_AUDIT_HMAC_SECRET` can recompute a consistent chain. Keep the HMAC secret in a different trust domain from the sink (secret manager vs. WORM store), rotate with a documented re-anchor, and never ship the secret to the log provider.

---

## 4. Retention — 365 days minimum

- `MCP_WRITE_AUDIT_RETENTION_DAYS` defaults to 365 and boot fails if configured below 365 (`src/write/config.ts:180-181`).
- The external sink must enforce retention independent of the application: no silent deletion before the retention window, and a documented, audited purge procedure after it.
- Retention applies to audit events **and** daily anchors. Keep at least one signed anchor older than the event retention window so tail deletion remains detectable across the whole retained period.
- The in-process `AuditStore` does not prune; do not claim it implements retention. Export must happen before process restart/teardown or events are lost.

---

## 5. Export procedure (operator-run, read-only on the source)

```js
// Conceptual — matches tests/write/incident-drill.test.ts:56-58
const events = store.all.map((event) => ({ ...event }));
const anchors = store.anchors.map((anchor) => ({ ...anchor }));
if (store.verify() !== null) throw new Error('chain broken — do not export as evidence');
if (!store.verifyHead(anchors.at(-1)?.head ?? 'genesis')) throw new Error('head mismatch');
const payload = JSON.stringify({ schema_version: 1, exported_at: new Date().toISOString(), events, anchors }, null, 2) + '\n';
// write payload to the WORM sink; do not mutate store.all
```

Operator steps:

1. Freeze writes (engage `MCP_WRITE_KILL_SWITCH=engaged`) if this is an incident export.
2. Export `events` + `anchors` as pretty, newline-terminated JSON (same convention as `reports/nightly-live.json`).
3. Verify the chain and head **before** transfer; verify the stored copy again **after** transfer.
4. Write once to the WORM sink; record object/store id, SHA-256 of the export file, verifier and timestamp in the incident/ops log.
5. Simulate tamper only on a **copy** (as the G12 drill does) — never on the authoritative chain.
6. Restrict read access; keep the HMAC secret out of the export and out of the sink's IAM domain.

---

## 6. Concrete implementation options (choose one, or layer them)

### Option A — Append-only object storage with object lock (recommended baseline)

- Use S3-compatible object storage with **Object Lock in COMPLIANCE mode** (or GCS bucket lock + retention policy) on a dedicated bucket; enable versioning and default retention >= 365 days.
- Map the injected `anchorSink` to a daily object write: key `audit/anchors/YYYY-MM-DD.json` containing `{date, head, anchored_at}`; append a daily NDJSON/JSON export `audit/events/YYYY-MM-DD.json`.
- Compliance-mode lock prevents overwrite/delete even by administrators until retention expires; use a separate project/account and a service identity with write-only (no `s3:DeleteObject`, no `storage.objects.delete`) permissions.
- Enable replication to a second region and object-lock replication; monitor for `PutObjectRetention`/`PutBucketLifecycleConfiguration` changes as alerts.
- Pros: cheap, durable, API-driven from the existing anchor callback. Cons: compliance-mode retention is irreversible — test with a short retention in staging first.

### Option B — WORM appliance / compliant write-once storage

- Dedicated WORM storage (optical/JBOD or certified WORM filesystem, e.g. SEC 17a-4 / OST-style) with media-level write-once semantics and a retention policy enforced by the appliance.
- Anchor daily by writing the signed anchor file and a full daily export to the appliance; store media offsite/air-gapped on a defined rotation; document chain-of-custody and retrieval time.
- Pros: strongest physical immutability and independence from cloud account compromise. Cons: higher cost/ops overhead, slower retrieval, needs a documented integration path from `anchorSink` (e.g. NFS/SMB drop zone + scheduled ingest).

### Option C — External logging provider with immutable retention

- Forward audit events over TLS to a SIEM/log platform with immutable/WORM indexes or retention locks (e.g. a locked Cloud Logging bucket with CMEK, or a SIEM immutable store), in a separate account from the MCP server.
- Configure provider-side retention >= 365 days, remove delete/index-delete rights from operational roles, and alert on retention-policy changes or gaps in the daily feed.
- Keep the daily anchor (head hash) in a second sink (Option A or B) so the provider alone cannot rewrite the observable chain.
- Pros: best search/alerting and incident workflow. Cons: immutability guarantees vary by product and plan — verify the specific retention-lock feature contractually before relying on it.

---

## 7. Acceptance criteria before this can be called done

- [ ] A real `anchorSink` is injected and writes to a sink with enforced immutability.
- [ ] 365-day retention is enforced by the sink, not just configured in the app.
- [ ] Chain verification (Section 3) is run automatically on export/daily anchor and its result retained.
- [ ] Tamper simulation on a copy detects edit, deletion, reordering and truncation (`tests/write/control-plane.test.ts` equivalents pass).
- [ ] HMAC secret is stored in a separate trust domain with a rotation/re-anchor procedure.
- [ ] Export/restore is rehearsed and the export file hash/verifier is recorded.
- [ ] G6 evidence attached and AC-155 sign-off (Security Architect, Backend Lead, Product Owner) obtained.

**Current status:** none of the above is evidenced for production. The local hash chain is fixture-tested only; external WORM anchoring is not yet done.

---

## 8. WP3 machine-checkable status (additive, 2026-11-21)

The gate-first spine added `src/write/audit-sink.ts` and made chain verification automatic;
`tests/write/worm-sink.test.ts` evidences the following boxes **in fixtures only**:

- [x] (machine-checkable) A real, pluggable `anchorSink` exists with `local-noop` (default),
  `append-only-log`, `s3-object-lock` and `webhook` sinks; the latter two require an injected
  transport and make no network call on their own.
- [x] (machine-checkable) Chain verification runs automatically inside `anchorDaily()` and
  `export()`; `export()` refuses a broken chain or a head mismatch.
- [x] (machine-checkable) Anchors carry only `{date, head, anchored_at}` plus an optional
  verified chain export; the HMAC secret and raw subjects are never in the sink payload
  (string-scan asserted).
- [x] (machine-checkable) Default config still yields `memory:process` with the local no-op
  sink; `verify:catalogue` stays green (28 tools, all controls wired).

Still **human/operator checks** (not closed by code): sink-enforced 365-day retention in a
separate trust domain, HMAC secret rotation/re-anchor, a real external sink injected in
production, export/restore rehearsal, G6 evidence attachment and AC-155 sign-off. The
`AuditStore` continues not to claim retention.
