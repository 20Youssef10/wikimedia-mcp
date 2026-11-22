---
name: Bug report
about: Report a reproducible problem with the server or a tool
title: "[Bug]: "
labels: bug
assignees: ''
---

## Summary

A clear, one-paragraph description of the problem.

## Environment

- **Host / client** (name + version):
- **Transport**: stdio / Streamable HTTP
- **MCP revision your host negotiates** (this server requires `2026-07-28`):
- **Node.js version**:
- **npm version**:
- **OS**:
- **Catalogue**: default (28 tools) / `READ_ONLY_PROFILE=1` (23 tools)

## Tool and call

- **Tool name** (or JSON-RPC method):
- **Arguments supplied** (redact secrets; note that titles/queries are fine):
- **Fixture-only merge gate or live/nightly run?**

## Steps to reproduce

1.
2.
3.

## Expected behaviour

What you expected to happen.

## Actual behaviour

What happened instead. Include the exact error code (for example `-32601`,
`-32020`, `authentication_required`) and message.

## Logs

Relevant stderr lines, including the correlation ID if present. **Redact all
tokens, secrets and credentials before posting.**

## Possible fix / additional context

Optional. Link any related issue or documentation section.

> For security vulnerabilities, do not use this template. Follow the private
> reporting steps in `SECURITY.md` instead.
