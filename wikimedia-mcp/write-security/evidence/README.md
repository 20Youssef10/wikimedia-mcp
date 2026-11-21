# Rollback evidence artefacts (WP5)

`npm run rollback:harness` writes plan/evidence skeletons here. The harness **records** the
human-executed dry-run → edit → rollback → verify sequence; it performs **no real wiki write**
and signs nothing. Live evidence (exported audit `events` + `anchors`) is only attached by a
human operator after a genuine testwiki execution, per `handoff/REAL-WIKI-ROLLBACK-PLAN.md`.

Runtime JSON artefacts are gitignored by the local `.gitignore`.
