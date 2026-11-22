# Security policy

## Supported versions

This repository is published at <https://github.com/20Youssef10/wikimedia-mcp>.
Security fixes are made on `main`; there are no long-term maintenance branches.

| Version / tag | Status |
|---|---|
| Package `3.0.0` on `main` (tag `restructured-root`) | Supported |
| Earlier tags (`phase-1-merged` … `observability-complete`) | Historical baselines; not maintained |

## Reporting a vulnerability

**Please do not open a public GitHub Issue for a vulnerability.** Use GitHub's
private reporting channel for this repository: the **Security** tab, then
**Report a vulnerability** (private vulnerability reporting / a draft security
advisory). This keeps details out of the public issue tracker until a fix is
available.

Include, at minimum:

- the affected tool name and transport (stdio or Streamable HTTP);
- the MCP revision in use (`2026-07-28`);
- steps to reproduce, with a minimal fixture where possible;
- the observed error code or behaviour and the relevant stderr correlation ID;
- impact and any suggested mitigation.

**Never paste OAuth tokens, session tokens, CSRF secrets or other credentials
into an issue, advisory or log snippet.** Redact them before sharing. For
non-security usage problems use [SUPPORT.md](./SUPPORT.md) instead.

## Response expectations

These are targets, not contractual guarantees:

- acknowledgement of a private report within **5 working days**;
- an initial assessment and severity judgment within **10 working days**;
- a fix or mitigation plan coordinated with the reporter before public
  disclosure, with credit only if the reporter agrees.

## Project security posture

- **Write tools fail closed.** The five write tools (`edit_page`, `protect_page`,
  `move_page`, `delete_page`, `upload_file`) are registered in the default
  catalogue but, with no OAuth/CIMD configuration, return
  `authentication_required`/`invalid_issuer`. G8 keeps real uploads blocked with
  `licence_not_signed_off`.
- **Human gates are not satisfied.** G1 and G8 remain unsigned; recorded
  decisions under `write-security/records/` are informational and never sign or
  auto-confirm a gate. See
  [`write-security/signoff.md`](./write-security/signoff.md) and
  [`handoff/SIGNOFF-TEMPLATES.md`](./handoff/SIGNOFF-TEMPLATES.md).
- **No real wiki writes in tests.** The merge gate is fixture-only (MSW +
  Vitest), both on the merge suite and on the independent QA smoke checks.
  Nightly live tests (`WMCP_LIVE=1`) are read-only; the rollback harness is
  testwiki-only and human-executed.
- **Tokens are never logged.** Logs go to stderr only, carry correlation IDs and
  redact token-shaped values; stdout on stdio is reserved for JSON-RPC. Demand
  telemetry records counts, never titles, queries or credentials.
- **HTTP is hardened at the boundary.** The Streamable HTTP endpoint is
  POST-only, binds to loopback by default, validates `Origin`/`Host` against
  explicit allowlists (no wildcards) and checks header/body agreement. TLS is
  terminated at a reverse proxy — see
  [`handoff/DEPLOYMENT-RUNBOOK.md`](./handoff/DEPLOYMENT-RUNBOOK.md).
- **Queries are bounded.** WDQS SPARQL is SELECT-only with complexity, LIMIT,
  timeout, row and byte caps; host/project/identifier values are allowlisted or
  validated before URL interpolation. Returned wiki text is untrusted data.

Threat model and gate evidence: [`research/08-threat-model.md`](./research/08-threat-model.md),
[`research/14-read-only-signoff.md`](./research/14-read-only-signoff.md),
[`research/17-threat-model-rereview.md`](./research/17-threat-model-rereview.md) and
[`SDK-VERIFICATION.md`](./SDK-VERIFICATION.md).
