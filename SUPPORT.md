# Support

## Where to get help

- **Documentation.** Start with the [README quick start](./README.md#quick-start),
  the [documentation index](./README.md#documentation-index),
  [`TOOLS.md`](./TOOLS.md) for tool schemas, and the operational docs in
  [`handoff/`](./handoff/DEPLOYMENT-RUNBOOK.md).
- **GitHub Issues.** For bugs and feature requests, open an issue at
  <https://github.com/20Youssef10/wikimedia-mcp/issues> using the
  [bug report](./.github/ISSUE_TEMPLATE/bug_report.md) or
  [feature request](./.github/ISSUE_TEMPLATE/feature_request.md) template.
- **GitHub Discussions.** If discussions are enabled for this repository, use
  them for questions and usage help. If they are not enabled, open a GitHub
  Issue instead.
- **Contribution questions.** See [CONTRIBUTING.md](./CONTRIBUTING.md).
- **Security vulnerabilities.** Do **not** open a public issue. Follow the
  private reporting steps in [SECURITY.md](./SECURITY.md).

Before opening an issue, please check existing issues and confirm you are using
a supported version (see [SECURITY.md § Supported versions](./SECURITY.md#supported-versions)).
This server speaks **MCP 2026-07-28 only**; classic `initialize`/2024–2025 hosts
are not supported, and that is the most common cause of connection failures.

## What to include in a bug report

Please provide enough information to reproduce the problem:

1. **Host** — client name and version (for example Claude Code, Grok Build,
   OpenCode, Gemini CLI).
2. **Transport** — stdio or Streamable HTTP, plus the URL/path if HTTP.
3. **MCP revision** — the version your host negotiates; this server requires
   `2026-07-28`.
4. **Tool name and arguments** — the exact `tools/call` name and the arguments
   supplied (with any titles or queries you are comfortable sharing).
5. **Steps to reproduce** — minimal sequence, expected result, actual result.
6. **Error details** — error code (for example `-32022`), message, and a
   correlation ID from stderr if one is present.
7. **Environment** — Node.js and npm versions, operating system, and whether you
   are using the default 28-tool catalogue or `READ_ONLY_PROFILE=1`.
8. **Configuration** — non-secret keys relevant to the failure (transport,
   host/origin allowlists, timeouts). Redact all secrets.

**Never paste OAuth tokens, session tokens, CSRF secrets, API keys or other
credentials into an issue.** If a log contains one, redact it before posting.

## Known behaviour that is not a bug

- The Streamable HTTP endpoint is **POST-only**; a `GET` probe returns `405` with
  `Allow: POST` (legacy SSE clients fail here).
- Wrong `Content-Type` → `415`; unlisted `Origin`/`Host` → `403`; header/body
  mismatch → `-32020` with HTTP 400.
- `subscriptions/listen` returns `-32601`; there are no change notifications or
  EventStreams consumer.
- With no OAuth/CIMD configuration, the five write tools fail closed with
  `authentication_required`/`invalid_issuer`, and G8 blocks uploads with
  `licence_not_signed_off`. This is intentional — see
  [SECURITY.md](./SECURITY.md).
