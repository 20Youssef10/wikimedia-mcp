#!/usr/bin/env node
// WP5 — thin ESM entry for the testwiki rollback recording harness.
// Records a plan/evidence skeleton only; performs NO real wiki write.
// Run AFTER `npm run build`: node scripts/rollback-harness.mjs [--dry-run|--execute ...]

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, 'dist', 'cli', 'index.js');
if (!existsSync(entry)) {
  console.error('FAIL  dist/cli/index.js not found — run `npm run build` first.');
  process.exit(1);
}
const { runRollbackCli } = await import(entry);
process.exit(runRollbackCli(process.argv.slice(2)));
