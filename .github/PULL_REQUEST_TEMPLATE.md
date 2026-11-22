## Summary

What changed and why. Link the issue this addresses.

## Type of change

- [ ] Bug fix
- [ ] New tool / schema change (contract version bumped; see below)
- [ ] Documentation
- [ ] Test / fixture only
- [ ] Refactor / chore
- [ ] Security-relevant change

## Verification

Run from the repository root and paste results below:

- [ ] `npm run build`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test` (expected baseline: 498 passed / 5 skipped)
- [ ] `npm run verify:catalogue`
- [ ] `READ_ONLY_PROFILE=1 npm run verify:read-only`
- [ ] `npm run verify:sdk` (SDK or protocol changes)
- [ ] `npm run test:coverage` (coverage changes)
- [ ] `npm run docs:tools -- --check` (schema or description changes)
- [ ] `npm run smoke` (transport changes)

Results:

```
(paste concise command output here)
```

## Standards checklist

- [ ] TypeScript strict; no new suppressions.
- [ ] Tool inputs use Zod schemas; advertised JSON Schema derives from them.
- [ ] Additive tool/schema changes include a contract version bump and a
      regenerated `TOOLS.md`.
- [ ] No dynamic tool registration; tool surface and protocol revision
      unchanged unless explicitly intended.
- [ ] No token, secret or credential appears in logs, fixtures or diffs.
- [ ] No real wiki write is performed; write paths still fail closed.
- [ ] Human gates are not signed or auto-confirmed by this change.
- [ ] Wikimedia/Wikidata text remains untrusted data with provenance.
- [ ] Documentation updated and links checked (README, `research/`, `handoff/`).
- [ ] Tests added for the new behaviour where applicable.

## Review

- [ ] Requested a review; ready for merge once checks are green.
- [ ] Write-related changes additionally satisfy
      `handoff/SIGNOFF-TEMPLATES.md` before any real-world enablement.
