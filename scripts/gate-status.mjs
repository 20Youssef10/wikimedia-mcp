#!/usr/bin/env node
// WP1 — thin ESM entry for `npm run gate:status`.
// Run AFTER `npm run build`: node scripts/gate-status.mjs [--require-signed]
// Mirrors scripts/assert-catalogue.mjs: import the shipped dist module.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, 'dist', 'cli', 'index.js');
if (!existsSync(entry)) {
  console.error('FAIL  dist/cli/index.js not found — run `npm run build` first.');
  process.exit(1);
}
const { runGateStatus } = await import(entry);
process.exit(runGateStatus(process.argv.slice(2)));
