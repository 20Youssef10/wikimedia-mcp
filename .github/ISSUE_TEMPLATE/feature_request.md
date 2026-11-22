---
name: Feature request
about: Propose a new tool, capability or documentation improvement
title: "[Feature]: "
labels: enhancement
assignees: ''
---

## Problem

What problem would this solve, and for whom? If it came from observed demand,
describe how it was measured (counts only — no query text or user data).

## Proposed change

Describe the tool, capability or documentation change. For a new tool, include:

- proposed tool name;
- input fields (types and bounds);
- expected output shape and provenance;
- upstream Wikimedia/Wikidata API used;
- read-only / write annotation (writes require the human gates in `SECURITY.md`).

## Contract impact

- [ ] This is additive and requires a contract version bump in `research/`.
- [ ] `TOOLS.md` must be regenerated with `npm run docs:tools`.
- [ ] New capability tokens/counters are additive and use a separate namespace.

## Alternatives considered

Other approaches you evaluated and why they were not chosen.

## Verification plan

Which checks and tests would demonstrate the change works (reference the
commands in `CONTRIBUTING.md`).

## Additional context

Links to relevant reports in `research/`, operational docs in `handoff/`, or
related issues.
