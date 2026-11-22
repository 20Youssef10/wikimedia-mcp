# Contributing

Thanks for your interest in improving this MCP server. This document covers local
setup, the standards the codebase follows, the checks a change must pass and how
to get a pull request reviewed.

For help rather than a code change, see [SUPPORT.md](./SUPPORT.md). For security
issues, do **not** open a public issue — follow [SECURITY.md](./SECURITY.md).

## Setup

The project targets **Node.js 22 LTS or newer** and npm 11 (a `package-lock.json`
is committed).

```bash
npm ci                                  # install from the committed lockfile
cp .env.example .env                    # then set USER_AGENT (required)
npm run build                           # compile TypeScript to dist/
READ_ONLY_PROFILE=1 npm test            # fixture-only suite; no live network calls
```

`USER_AGENT` must be a contactable value. The server validates all configuration
at boot with Zod; invalid values terminate startup. See [README.md § Install and
run](./README.md#install-and-run) for stdio and Streamable HTTP launch commands.

## Coding standards

- **TypeScript strict** is enabled (`tsconfig.json`, `tsconfig.test.json`). Code
  must pass `npm run typecheck` with no new suppressions.
- **Tool inputs are Zod schemas.** Define the schema once, derive the advertised
  JSON Schema from it and validate at the boundary. Do not accept untyped or
  unvalidated arguments in a tool handler.
- **Additive tool changes require a contract version bump.** If you add a tool or
  a field to a tool's schema, update the relevant frozen contract in
  [`research/`](./research/README.md) and bump its contract version, then
  regenerate the reference with `npm run docs:tools` and confirm
  `npm run docs:tools -- --check` is clean. Tool registration is static — never
  add dynamic registration.
- **Fail closed.** New write-adjacent behaviour must default to disabled and
  require an explicit, named human decision. Never auto-confirm a gate or
  fabricate a signature recorded under `write-security/records/`.
- **Untrusted data stays data.** Wikimedia/Wikidata text, titles and HTML are
  returned as data with provenance, never interpreted as instructions. Errors
  must not leak raw HTTP text, tokens or stack traces. Tokens and token-shaped
  values are redacted from stderr logs; stdout on stdio is reserved for JSON-RPC.
- Keep changes focused. Prefer additive changes; call out any behavioural change
  in the pull request description.

## Test requirements

Run these from the repository root before requesting review:

```bash
npm run build                              # compile
npm run typecheck                          # both tsconfig projects
npm run lint                               # eslint .
npm test                                   # vitest run (fixture-only merge gate)
npm run verify:catalogue                   # default 28-tool catalogue
READ_ONLY_PROFILE=1 npm run verify:read-only  # explicit 23-tool read-only profile
```

Additional checks, required when the change touches their area:

```bash
npm run verify:sdk                         # SDK / protocol surface
npm run test:coverage                      # coverage report
npm run docs:tools -- --check              # tool reference is not stale
npm run smoke                              # stdio smoke script
```

The independent QA smoke scripts (`qa-mcp-smoke.mjs`, `qa-mcp-http.mjs` and
`qa-mcp-defects.mjs`, maintained outside this repository) are also run before a
release; the last run reported 16/16, 10/10 and 9/9. They are not npm scripts and
are not required for an ordinary documentation or fixture change — see
[README.md § Verification](./README.md#verification).

Notes:

- The merge gate is fixture-only (MSW + Vitest) and covers both transports. No
  live network call and no real wiki write occurs in `npm test`.
- Nightly live M3/M4 load tests under `tests/live` are skipped by default; enable
  them off-peak with `WMCP_LIVE=1`. They are read-only.
- Regression tests are expected with every bug fix, and schema/catalogue tests
  with every tool change.

## Pull requests

1. Create a focused branch from `main`.
2. Make the change with the standards above; keep the default catalogue and
   protocol revision unchanged unless the change explicitly calls for it.
3. Run the full check list above and paste the result into the PR description.
4. Fill in [the pull request template](./.github/PULL_REQUEST_TEMPLATE.md).
5. Link the issue the change addresses, request a review and respond to feedback.
6. Write-related changes additionally need the human gates in
   [`handoff/SIGNOFF-TEMPLATES.md`](./handoff/SIGNOFF-TEMPLATES.md) to be
   satisfied before any real-world enablement; a passing test run is not a
   sign-off.

## Commit conventions

Use Conventional Commits: a short type, optional scope, and an imperative
description.

```
feat(tools): add bounded geo search tool
fix(http): reject missing Origin when MCP_REQUIRE_ORIGIN is set
docs: add quick start and documentation index
test(write): cover fail-closed authentication path
chore: regenerate tool reference
```

Keep commits small and self-contained. Do not mix formatting with behaviour
changes.

## Where to ask questions

- Usage and setup questions: [SUPPORT.md](./SUPPORT.md).
- Bug reports and feature requests: GitHub Issues for this repository, using
  [the bug report](./.github/ISSUE_TEMPLATE/bug_report.md) or
  [feature request](./.github/ISSUE_TEMPLATE/feature_request.md) template.
- Repositories: <https://github.com/20Youssef10/wikimedia-mcp>.
- Security reports: private reporting only, per [SECURITY.md](./SECURITY.md).
